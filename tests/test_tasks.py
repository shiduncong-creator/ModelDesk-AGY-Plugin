import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from server.adapters.base import RunningHandle
from server.adapters.codex import Codex, DIRECTORY_REJECTION
from server.adapters.gemini import Gemini
from server.adapters.qoder import Qoder, recovery_guard, request_identity
from server.storage import Store
from server.task_runner import Runner, tail, work

from .support import fake_environment, git, poll, register, sandbox


class TaskTest(unittest.TestCase):
    def setUp(self):
        self.root = self.enterContext(sandbox())
        self.project = self.root / "project"
        self.project.mkdir()
        git(self.project, "init", "-q")
        (self.project / "baseline.txt").write_text("baseline")
        git(self.project, "add", ".")
        git(self.project, "commit", "-qm", "baseline")
        self.store = Store(self.root / "data")
        register(self.store, self.project)
        self.enterContext(patch.dict(os.environ, fake_environment(self.root)))
        self.runner = Runner(self.store)
        self.addCleanup(self.stop_workers)

    def stop_workers(self):
        for row in self.runner.rows():
            if row["status"] in {"queued", "running"}:
                self.runner.stop(row["id"])
        for proc in list(self.runner.children.values()):
            proc.wait(timeout=5)

    def wait_for(self, task, status, runner=None):
        runner = runner or self.runner
        task_id = task["id"]

        def current():
            runner.reconcile()
            return runner.read(task_id)

        row = poll(current, lambda row: row["status"] == status)
        if status not in {"running", "queued"} and task_id in runner.children:
            runner.children[task_id].wait(timeout=5)
        return row

    def dispatch(self, prompt, **kwargs):
        return self.runner.dispatch("gemini", prompt, transport="cli", **kwargs)

    def test_no_native_session_requires_explicit_checkpoint(self):
        task = self.dispatch("crash-early", declared_files=["partial.txt", "baseline.txt", "never-created.txt"])
        row = self.wait_for(task, "recovery_pending")
        self.assertEqual(row["changed_files"], ["calls.txt", "partial.txt"])
        self.assertIn("baseline.txt", row["interrupted_files"])
        self.assertIn("never-created.txt", row["interrupted_files"])
        new_runner = Runner(self.store)
        new_runner.reconcile()
        self.assertIsNone(row["native_session_id"])
        logs = new_runner.logs(row["id"])
        self.assertIn("crashed before native session", logs["snapshot"]["log"])
        self.assertIn("+unfinished", logs["snapshot"]["diff"])
        self.assertEqual(row["exit_code"], 7)
        with self.assertRaisesRegex(ValueError, "原生会话"):
            new_runner.resume(row["id"])
        answer = new_runner.resume(row["id"], "checkpoint")
        self.assertEqual(answer["status"], "confirmation_required")
        calls = self.project / "calls.txt"
        self.assertEqual(len(calls.read_text().splitlines()), 1)
        new_runner.resume(row["id"], "checkpoint", confirmed=True)
        final = self.wait_for(row, "review", new_runner)
        self.assertEqual(final["attempt"], 2)
        self.assertEqual(final["native_session_id"], "session-checkpoint-002")
        sent = json.loads(calls.read_text().splitlines()[-1])[-1]
        self.assertIn("crash-early", sent)
        self.assertIn("partial.txt", sent)
        self.assertIn("crashed before native session", sent)
        self.assertEqual(new_runner.review(row["id"], True)["status"], "accepted")

    def test_codex_directory_rejection_fails_before_resume(self):
        def queue_without_worker(folder, row):
            row.update(attempt=1, stop_reason=None)
            self.runner.persist(folder, row)

        with patch.object(self.runner, "launch", side_effect=queue_without_worker):
            task = self.runner.dispatch("codex", "start", declared_files=["baseline.txt", "never-created.txt"])
        adapter = self.runner.adapters["codex"]
        command = [sys.executable, "-c", f"print({DIRECTORY_REJECTION!r}); raise SystemExit(1)"]
        with subprocess.Popen(command, stdout=subprocess.PIPE) as proc, \
                patch.object(adapter, "start", return_value=RunningHandle(proc)), \
                patch("server.task_runner.signal.signal"):
            work(self.runner, task["id"], task["attempt"])
        failed = self.runner.logs(task["id"])["task"]
        self.assertEqual(failed["status"], "failed")
        self.assertIn("CLI 拒绝了当前项目目录", failed["error"])
        self.assertEqual(failed["changed_files"], [])
        with self.assertRaisesRegex(ValueError, "不处于可续接状态"):
            self.runner.resume(task["id"], "checkpoint", confirmed=True)

        # Old task records may still contain this exact startup error and
        # the declared-file list incorrectly stored as changes.
        original = self.runner.read(task["id"])
        folder = self.runner.folder(task["id"])
        original.update(status="recovery_pending", recovery_reason="cli_interrupted", attempt=1,
                        changed_files=task["declared_files"],
                        interrupted_files={name: task["baseline"][name] for name in task["declared_files"]})
        self.runner.persist(folder, original)
        self.assertEqual(self.runner.rows()[0]["status"], "failed")
        self.assertEqual(self.runner.logs(task["id"])["task"]["changed_files"], [])
        original["interrupted_files"]["baseline.txt"] = [1, 2, 3, 4, 5]
        self.runner.persist(folder, original)
        self.assertEqual(self.runner.read(task["id"])["status"], "recovery_pending")

    def test_native_resume_after_crash_reuses_exact_id(self):
        task = self.dispatch("crash-with-session", declared_files=["partial.txt"])
        row = self.wait_for(task, "recovery_pending")
        self.assertEqual(row["native_session_id"], "session-original-001")
        new_runner = Runner(self.store)
        new_runner.resume(row["id"], follow_up_prompt="继续处理")
        final = self.wait_for(row, "review", new_runner)
        self.assertEqual(final["native_session_id"], "session-original-001")
        calls = [json.loads(line) for line in (self.project / "calls.txt").read_text().splitlines()]
        self.assertEqual(len(calls), 2)
        self.assertIn("--resume", calls[1])
        self.assertEqual(calls[1][calls[1].index("--resume") + 1], row["native_session_id"])

    def test_recheck_conflict_proof_when_declared_file_changes_again(self):
        task = self.dispatch("crash-with-session", declared_files=["partial.txt"])
        row = self.wait_for(task, "recovery_pending")
        path = self.project / "partial.txt"
        path.write_text("manual edit")
        conflict = self.runner.resume(row["id"])
        self.assertEqual(conflict["status"], "conflict")
        self.assertIn("partial.txt", conflict["files"])
        path.write_text("manual edit again")
        updated = self.runner.resume(row["id"], conflict_token=conflict["conflict_token"])
        self.assertEqual(updated["status"], "conflict")
        self.assertNotEqual(updated["conflict_token"], conflict["conflict_token"])
        self.runner.resume(row["id"], conflict_token=updated["conflict_token"])
        self.wait_for(row, "review")

    def test_pause_and_cancel(self):
        task = self.dispatch("hold forever first")
        poll(lambda: self.runner.read(task["id"]), lambda row: bool(row["native_session_id"]))
        self.runner.stop(task["id"], pause=True)
        paused = self.wait_for(task, "recovery_pending")
        self.assertEqual(paused["recovery_reason"], "paused")
        self.assertEqual(self.runner.stop(task["id"])["status"], "cancelled")
        second = self.dispatch("hold forever second")
        poll(lambda: self.runner.read(second["id"]), lambda row: bool(row["native_session_id"]))
        self.runner.stop(second["id"])
        self.wait_for(second, "cancelled")

    def test_timeout_persists_session_and_exact_reason(self):
        # The fake CLI starts a separate Python interpreter. Give it time to
        # publish the session before exercising the task timeout.
        task = self.dispatch("hold forever timeout", timeout=3)
        row = self.wait_for(task, "recovery_pending")
        self.assertEqual(row["recovery_reason"], "timeout")
        self.assertEqual(row["native_session_id"], "session-original-001")

    def test_dead_worker_does_not_replay(self):
        task = self.dispatch("hold forever orphan")
        active = poll(lambda: self.runner.read(task["id"]), lambda row: bool(row["native_session_id"]))
        os.kill(active["worker_pid"], signal.SIGKILL)
        new_runner = Runner(self.store)

        def current():
            new_runner.reconcile()
            return new_runner.read(task["id"])

        row = poll(current, lambda row: row.get("orphaned") or row["status"] == "recovery_pending")
        self.assertEqual(len((self.project / "calls.txt").read_text().splitlines()), 1)
        if row["status"] == "running":
            new_runner.stop(task["id"], pause=True)
        self.wait_for(task, "recovery_pending", new_runner)

    def test_dispatch_cannot_set_unregistered_cwd_or_escape_declared_path(self):
        with self.assertRaises(ValueError):
            self.dispatch("task", cwd=str(self.root))
        with self.assertRaises(ValueError):
            self.dispatch("task", declared_files=["../private"])
        self.assertEqual(self.runner.rows(), [])

    def test_log_pages_do_not_repeat_lines(self):
        path = self.root / "output.log"
        path.write_text("one\ntwo\nthree\nfour\n")
        last = tail(path, 2)
        self.assertEqual(last["text"], "three\nfour\n")
        older = tail(path, 2, last["before"])
        self.assertEqual(older, {"text": "one\ntwo\n", "before": None, "end": 8})


class AdapterTest(unittest.TestCase):
    def test_codex_sandbox_and_thread_parser(self):
        adapter = Codex()
        with patch.object(adapter, "required_executable", return_value="codex"), \
                patch("server.adapters.codex.git_root", return_value=Path("/some/project")):
            command = adapter.argv({"cwd": "/some/project", "write": True}, "--a prompt", "id-native")
        self.assertEqual(command, ["codex", "exec", "--json", "-C", "/some/project", "-s",
                                   "workspace-write", "resume", "id-native", "--", "--a prompt"])
        self.assertEqual(adapter.event('{"type":"thread.started","thread_id":"id-native"}')[1], "id-native")

    def test_codex_plain_folder_supports_both_sandboxes_without_git_init(self):
        adapter = Codex()
        with tempfile.TemporaryDirectory() as directory, patch.object(adapter, "required_executable", return_value="codex"):
            for write, sandbox_mode in ((False, "read-only"), (True, "workspace-write")):
                for session in (None, "id-native"):
                    command = adapter.argv({"cwd": directory, "write": write}, "prompt", session)
                    self.assertEqual(command[command.index("-s") + 1], sandbox_mode)
                    self.assertIn("--skip-git-repo-check", command[:command.index("--")])
            self.assertFalse((Path(directory) / ".git").exists())

    def test_codex_reports_completed_file_change_events(self):
        adapter = Codex()
        item = {"type": "file_change", "changes": [{"path": "written.txt"}], "status": "in_progress"}
        self.assertEqual(adapter.declared_output({"type": "item.started", "item": item}), [])
        item["status"] = "failed"
        self.assertEqual(adapter.declared_output({"type": "item.completed", "item": item}), [])
        item["status"] = "completed"
        self.assertEqual(adapter.declared_output({"type": "item.completed", "item": item}), ["written.txt"])

    def test_qoder_original_guard_and_both_transports(self):
        adapter = Qoder()
        task = {"id": "task1", "engine": "qoder", "cwd": "/tmp/project", "prompt": "original",
                "model": None, "transport": "cli", "write": True}
        session = "149837ef-55c9-4d30-ad43-23f599010fc0"
        task["recovery_guard"] = request_identity(task, session)
        with patch.object(adapter, "required_executable", return_value="qoderclicn"):
            self.assertIn("--resume", adapter.argv(task, "follow up", session))
            with self.assertRaises(ValueError):
                adapter.argv({**task, "prompt": "changed"}, "follow up", session)
            self.assertIn("qoder_acp.py", adapter.argv({**task, "transport": "acp"}, "ask", None)[1])
        for invalid in ("--continue", "../query", "bad id", "x" * 128 + "x"):
            with self.assertRaises(ValueError):
                recovery_guard(task, invalid)

    def test_agy_and_gemini_fallback_schema(self):
        adapter = Gemini()
        with patch.object(adapter, "executable", return_value=None), patch.object(adapter, "agy", return_value="/bin/agy"):
            self.assertEqual(adapter.selected_transport(), "agy")
            command = adapter.argv({"cwd": "/project", "transport": "agy", "write": False}, "resume", "native-id")
        self.assertIn("--resume", command)
        self.assertEqual(command[-2:], ["--print", "resume"])
        rows = [
            '{"event":"init","conversation_id":"agy-id"}',
            '{"event":"step_update","step_update":{"conversation_id":"agy-id"}}',
            '{"event":"result","result":{"conversation_id":"agy-id","status":"ERROR"}}',
        ]
        for line in rows:
            self.assertEqual(adapter.event(line)[1], "agy-id")
        self.assertTrue(adapter.outcome_error(json.loads(rows[-1])))

    def test_gemini_cli_yields_session_before_completion_and_allows_recovered_tool_errors(self):
        adapter = Gemini()
        with patch.object(adapter, "executable", return_value="gemini"):
            argv = adapter.argv({"transport": "cli", "write": False}, "test", None)
        self.assertEqual(argv[argv.index("--output-format") + 1], "stream-json")
        def pending_stream():
            yield '{"type":"init","session_id":"native-id","model":"gemini"}'
            self.fail("A session ID must be available before the next CLI event")
        self.assertEqual(next(adapter.events({"transport": "cli"}, pending_stream()))[1], "native-id")
        self.assertFalse(adapter.outcome_error({"type": "error", "severity": "warning"}))
        self.assertFalse(adapter.outcome_error({"type": "tool_result", "status": "error"}))
        self.assertTrue(adapter.outcome_error({"type": "result", "status": "error"}))

    def test_gemini_indented_json_envelope_is_parsed_as_one_event(self):
        adapter = Gemini()
        lines = ["diagnostic\n", *json.dumps({"session_id": "gemini-id", "response": "result"}, indent=2).splitlines(True)]
        self.assertEqual(list(adapter.events({"transport": "cli"}, iter(lines))),
                         [({"session_id": "gemini-id", "response": "result"}, "gemini-id")])

    def test_qoder_acp_starts_and_loads_exact_session_over_stdio(self):
        adapter = Qoder()
        with sandbox() as root:
            fake_environment(root)
            task = {"id": "qoder-test", "cwd": str(root), "engine": "qoder", "transport": "acp", "model": None,
                    "prompt": "original", "run_prompt": "original", "write": False}
            with patch.object(adapter, "required_executable", return_value=str(root / "gemini")):
                started = adapter.start(task).process
                first, _ = started.communicate(timeout=5)
                self.assertEqual(started.returncode, 0, first)
                first_session = adapter.event(first.decode().splitlines()[0])[1]
                self.assertEqual(first_session, "session-qoder-001")
                task.update(native_session_id=first_session, recovery_guard=request_identity(task, first_session))
                resumed = adapter.resume(task, "follow up").process
                second, _ = resumed.communicate(timeout=5)
                self.assertEqual(resumed.returncode, 0, second)
                self.assertEqual(adapter.event(second.decode().splitlines()[0])[1], first_session)
                self.assertIn(b"ACP reply", second)
