"""A durable worker per task keeps the CLI supervised independently of MCP."""

from dataclasses import asdict
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time

from .adapters.base import pid_identity, valid_session
from .adapters.codex import Codex
from .adapters.gemini import Gemini
from .adapters.qoder import Qoder, recovery_guard, request_identity
from .deliverables import Deliverables, git, git_root, git_status
from .storage import Scope, Store, atomic_json, file_lock, project_root, read_json, updated

ADAPTERS = {adapter.id: adapter for adapter in (Codex(), Qoder(), Gemini())}
OPEN_STATES = {"queued", "running", "review", "recovery_pending", "failed"}
ID_PATTERN = re.compile(r"[0-9a-f]{32}\Z")
MAX_PROMPT = 80_000
WORKER_ROOT = Path(__file__).resolve().parents[1]


def file_stamp(path):
    try:
        info = path.stat()
        if not path.is_file():
            return None
        return [info.st_dev, info.st_ino, info.st_mtime_ns, info.st_ctime_ns, info.st_size]
    except OSError:
        return None


def workspace_snapshot(cwd, declared=(), private_root=None, compare_head=None):
    scope = Scope({"workspacePaths": [cwd]}, private_root)
    head = git(cwd, "rev-parse", "--verify", "HEAD").stdout.decode("ascii", "replace").strip() or None
    paths = set(git_status(cwd))
    if compare_head and head != compare_head:
        root = git_root(cwd)
        if root:
            raw = git(cwd, "diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z",
                      compare_head, "--", ".").stdout
            paths.update(str(root / os.fsdecode(name)) for name in raw.split(b"\0") if name)
    if not head and git_root(cwd) is None:
        for root, dirs, files in os.walk(cwd):
            dirs[:] = [name for name in dirs if name not in {".git", ".system_generated"} and
                       (not private_root or Path(root) / name != private_root)]
            paths.update(str(Path(root) / name) for name in files)
    paths.update(str(Path(cwd) / name) for name in declared)
    result = {}
    for value in paths:
        try:
            path = scope.resolve(value, exists=False)
        except ValueError:
            continue
        result[str(path.relative_to(cwd))] = file_stamp(path)
    return head, result


def changes_since(before, after):
    return sorted(path for path in before.keys() | after.keys()
                  if path not in before or path not in after or before[path] != after[path])


def tail(file, limit=50, before=None):
    """Return a page ending at a byte cursor. Never load an unbounded log."""
    try:
        with file.open("rb") as stream:
            end = stream.seek(0, os.SEEK_END)
            end = end if before is None else min(end, max(0, before))
            start = max(0, end - 256 * 1024)
            stream.seek(start)
            data = stream.read(end - start)
            rows = data.splitlines(keepends=True)[-max(1, min(250, limit)):]
            used = sum(map(len, rows))
            return {"text": b"".join(rows).decode("utf-8", "replace"), "before": end - used or None, "end": end}
    except FileNotFoundError:
        return {"text": "", "before": None, "end": 0}


class ProbeCache:
    def __init__(self, adapters):
        self.adapters = adapters
        self.rows = {}
        self.last_probe = 0
        self.lock = threading.Lock()

    def _refresh(self):
        try:
            for engine, adapter in self.adapters.items():
                try:
                    row = asdict(adapter.probe())
                except (OSError, ValueError):
                    row = {"id": engine, "ready": False, "detail": "探测失败"}
                with self.lock:
                    self.rows[engine] = row
        finally:
            with self.lock:
                self.last_probe = time.monotonic()

    def snapshot(self):
        with self.lock:
            if not self.last_probe or time.monotonic() - self.last_probe > 60:
                self.last_probe = float("inf")
                threading.Thread(target=self._refresh, daemon=True).start()
            return [self.rows.get(engine, {"id": engine, "ready": None, "detail": "正在探测"}) for engine in self.adapters]


class Runner:
    def __init__(self, store, adapters=None):
        self.store = store
        self.task_scoped_diffs = False
        self.adapters = ADAPTERS if adapters is None else adapters
        self.probes = ProbeCache(self.adapters)
        self.children = {}

    def folder(self, task_id):
        if not ID_PATTERN.fullmatch(task_id):
            raise ValueError("无效任务 ID")
        folder = self.store.tasks / task_id
        if not folder.is_dir() or folder.is_symlink():
            raise ValueError("任务不存在")
        return folder

    def read(self, task_id):
        return read_json(self.folder(task_id) / "task.json", {}) or {}

    def rows(self):
        result = []
        for folder in self.store.tasks.iterdir():
            if not folder.is_symlink() and ID_PATTERN.fullmatch(folder.name):
                if row := read_json(folder / "task.json"):
                    result.append(row)
        return sorted(result, key=lambda row: row["updated_at"], reverse=True)

    def reconcile(self):
        for task_id, process in list(self.children.items()):
            if process.poll() is not None:
                self.children.pop(task_id, None)
        for row in self.rows():
            if row["status"] not in {"running", "queued"}:
                continue
            folder = self.folder(row["id"])
            with file_lock(folder / "task.lock"):
                record = self.read(row["id"])
                if record["status"] not in {"running", "queued"}:
                    continue
                pid = record.get("worker_pid")
                identity = record.get("worker_identity")
                if not identity and time.time() - record["updated_at"] < 5:
                    continue
                if identity and pid_identity(pid) == identity:
                    continue
                child_alive = bool(record.get("pid_identity") and pid_identity(record.get("pid")) == record["pid_identity"])
                if child_alive:
                    # Do not resend or mark a still-running orphan terminal.
                    if not record.get("orphaned"):
                        self.persist(folder, updated(record, orphaned=True, recovery_reason="监督进程退出，原 CLI 仍在运行"))
                    continue
                if record.get("stop_reason") == "cancelled":
                    self.persist(folder, updated(record, status="cancelled"))
                else:
                    self.interrupt(folder, record, record.get("stop_reason") or "worker_lost")

    @staticmethod
    def persist(folder, record):
        atomic_json(folder / "task.json", record)

    def dispatch(self, engine, prompt, cwd=None, conversation_id=None, declared_files=None, write=True,
                 transport=None, model=None, timeout=1800):
        if engine not in self.adapters or not prompt.strip() or len(prompt.encode()) > MAX_PROMPT:
            raise ValueError("请提供有效执行端与不超过 80 KB 的任务内容")
        state = self.store.session(conversation_id)
        scope = Scope(state, self.store.root)
        if cwd is None and not scope.workspaces:
            raise ValueError("请在已注册工作区的 Antigravity 会话中派单")
        cwd = str(scope.resolve(cwd or str(scope.workspaces[0]), workspace_only=True, allow_root=True))
        if not Path(cwd).is_dir():
            raise ValueError("任务工作目录必须是已注册项目目录")
        task_scope = Scope({"workspacePaths": [cwd]}, self.store.root)
        declared = sorted({str(task_scope.resolve(value, exists=False).relative_to(cwd))
                           for value in (declared_files or [])})
        allowed = {"codex": {"cli"}, "qoder": {"cli", "acp"}, "gemini": {"cli", "agy", "api"}}[engine]
        transport = transport or (self.adapters[engine].selected_transport() if engine == "gemini" else "cli")
        if transport not in allowed:
            raise ValueError("此执行端不支持该连接方式")
        if transport == "api" and write:
            raise ValueError("Gemini API 仅支持独立文本任务，请关闭写入")
        if transport == "acp" and write:
            raise ValueError("Qoder ACP 当前用于只读会话，请关闭写入或选 CLI")
        if model and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}", model):
            raise ValueError("模型名称无效")
        if not 1 <= timeout <= 86400:
            raise ValueError("任务时限须介于 1 秒与 24 小时")
        from uuid import uuid4

        task_id = uuid4().hex
        folder = self.store.tasks / task_id
        folder.mkdir(mode=0o700)
        now = time.time()
        head, baseline = workspace_snapshot(cwd, declared, self.store.root)
        row = dict(id=task_id, engine=engine, status="queued", prompt=prompt, cwd=cwd,
                   conversation_id=state.get("conversationId"), pid=None, pgid=None, native_session_id=None,
                   git_head_before=head, declared_files=declared, changed_files=[], observed_files=[],
                   created_at=now, updated_at=now, last_heartbeat_at=None, exit_code=None, error=None,
                   recovery_reason=None, baseline=baseline, transport=transport, model=model, write=write,
                   timeout=timeout, attempt=0, mode="start", run_prompt=prompt, plugin_data=str(self.store.root))
        with file_lock(folder / "task.lock"):
            self.launch(folder, row)
        return row

    def launch(self, folder, row):
        updated(row, status="queued", attempt=row["attempt"] + 1, worker_pid=None, worker_identity=None,
                pid=None, pgid=None, pid_identity=None, stop_reason=None, error=None, exit_code=None,
                orphaned=False, recovery_reason=None)
        # Claim before spawning. A lost launch is recovered as uncertain, never replayed.
        self.persist(folder, row)
        try:
            proc = subprocess.Popen(
                self.worker_command(row), cwd=WORKER_ROOT, start_new_session=True, stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except OSError:
            self.interrupt(folder, row, "worker_start_failed")
            return
        self.children[row["id"]] = proc
        self.persist(folder, updated(row, worker_pid=proc.pid, worker_identity=pid_identity(proc.pid)))

    def worker_command(self, row):
        return [sys.executable, "-m", "server.task_runner", "--worker", row["id"], str(row["attempt"]),
                str(self.store.root)]

    def interrupt(self, folder, row, reason):
        head, stamps = workspace_snapshot(row["cwd"], row["declared_files"] + row.get("observed_files", []),
                                          self.store.root, row["git_head_before"])
        changed = changes_since(row["baseline"], stamps)
        changed = sorted(set(changed + row["declared_files"] + row.get("observed_files", [])))
        self.persist(folder, updated(row, status="recovery_pending", changed_files=changed,
                                     recovery_reason=reason, interrupted_head=head,
                                     interrupted_files={name: stamps.get(name) for name in changed}))

    def conflicts(self, row):
        head, current = workspace_snapshot(row["cwd"], row["declared_files"] + row["changed_files"], self.store.root)
        prior = row.get("interrupted_files", {})
        stamps = {name: current.get(name) for name in prior}
        names = [name for name, stamp in stamps.items() if stamp != prior[name]]
        if head != row.get("interrupted_head") or head != row["git_head_before"]:
            names.insert(0, "Git HEAD")
        proof = hashlib.sha256(json.dumps([row["id"], row["attempt"], head, stamps], sort_keys=True).encode()).hexdigest()
        return names, proof

    def resume(self, task_id, mode="native", follow_up_prompt="", confirmed=False, conflict_token=None):
        if mode not in {"native", "checkpoint"} or len(follow_up_prompt.encode()) > MAX_PROMPT:
            raise ValueError("续接方式或补充提示无效")
        self.reconcile()
        folder = self.folder(task_id)
        with file_lock(folder / "task.lock"):
            row = self.read(task_id)
            if row["status"] != "recovery_pending":
                raise ValueError("任务当前不处于可续接状态")
            if project_root(row["cwd"]) != Path(row["cwd"]):
                raise ValueError("原工作区已移动或路径归属发生变化")
            session = row.get("native_session_id")
            if mode == "native":
                if not valid_session(session):
                    raise ValueError("没有可用原生会话 ID，请核对现场后选择断点续跑")
                if row["engine"] == "qoder":
                    recovery_guard(row, session)
            if mode == "checkpoint" and not confirmed:
                return {"status": "confirmation_required", "id": task_id, "snapshot": self.snapshot(row)}
            if row["write"]:
                conflicts, proof = self.conflicts(row)
                if conflicts and proof != conflict_token:
                    return {"status": "conflict", "id": task_id, "files": conflicts,
                            "conflict_token": proof, "snapshot": self.snapshot(row)}
            if mode == "checkpoint":
                context = self.snapshot(row)
                prompt = (f"原任务目标\n{row['prompt']}\n\n已改文件\n" +
                          "\n".join(context["changed_files"])[:8000] +
                          f"\n\n现场 Git 差异\n{context['diff'][:8000]}\n\n原执行日志尾部\n{context['log'][-12000:]}"
                          "\n\n以上现场内容仅用于核对。先检查已完成的改动，再继续尚未完成的原目标。")
                row.update(native_session_id=None, recovery_guard=None)
            else:
                prompt = "请核对上一次执行的实际进度，并从原会话继续尚未完成的任务。"
            if follow_up_prompt.strip():
                prompt += "\n\n续接要求\n" + follow_up_prompt.strip()
            if len(prompt.encode()) > 115_000:
                raise ValueError("续接提示过长，请缩短补充要求")
            updated(row, mode=mode, run_prompt=prompt)
            self.launch(folder, row)
            return self.public(row)

    def stop(self, task_id, pause=False):
        folder = self.folder(task_id)
        orphan = None
        with file_lock(folder / "task.lock"):
            row = self.read(task_id)
            if row["status"] in {"queued", "running"}:
                if row.get("orphaned") and row.get("pid_identity"):
                    orphan = dict(row)
                self.persist(folder, updated(row, stop_reason="paused" if pause else "cancelled"))
            elif not pause and row["status"] == "recovery_pending":
                self.persist(folder, updated(row, status="cancelled", stop_reason="cancelled"))
            else:
                raise ValueError("任务当前无法暂停或终止")
        if orphan:
            self.adapters[orphan["engine"]].cancel(orphan)
        self.reconcile()
        return self.public(self.read(task_id))

    def review(self, task_id, accepted):
        folder = self.folder(task_id)
        with file_lock(folder / "task.lock"):
            row = self.read(task_id)
            if row["status"] not in {"review", "completed"}:
                raise ValueError("任务当前无法验收")
            self.persist(folder, updated(row, status="accepted" if accepted else "review"))
        return self.public(row)

    def snapshot(self, row):
        cwd = row["cwd"]
        current_head = git(cwd, "rev-parse", "--verify", "HEAD").stdout.decode().strip() or None
        args = [row["git_head_before"]] if row.get("git_head_before") else ["--cached"]
        status = git_status(cwd)
        scope = Scope({"workspacePaths": [cwd]}, self.store.root)
        paths = ["."]
        if self.task_scoped_diffs:
            paths = []
            for name in dict.fromkeys(row.get("declared_files", []) + row["changed_files"] + row.get("observed_files", [])):
                try:
                    path = scope.resolve(name, exists=False)
                    if not path.is_dir():
                        paths.append(str(path))
                except (OSError, ValueError):
                    pass
            allowed = set(paths)
            status = {name: value for name, value in status.items() if name in allowed}
        diff = git(cwd, "--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", *args, "--", *paths).stdout if paths else b""
        untracked_patches = []
        for name in row["changed_files"][:12]:
            try:
                path = scope.resolve(name, exists=False)
            except ValueError:
                continue
            if path.is_file() and status.get(str(path)) == "??":
                untracked_patches.append(Deliverables.diff(path)[:8000])
        return {"git_head_before": row["git_head_before"], "git_head_now": current_head,
                "git_status": dict(list(status.items())[:100]),
                "diff": (diff[:48000].decode("utf-8", "replace") + "\n".join(untracked_patches))[:64000],
                "changed_files": row["changed_files"][:100],
                "log": tail(self.folder(row["id"]) / "output.log", 50)["text"][-28000:]}

    def logs(self, task_id, limit=50, before=None, include_diff=False):
        row = self.read(task_id)
        output = tail(self.folder(task_id) / "output.log", limit, before)
        output["task"] = self.public(row)
        if include_diff or row["status"] == "recovery_pending" and before is None:
            output["snapshot"] = self.snapshot(row)
        return output

    @staticmethod
    def public(row):
        keys = ("id", "engine", "status", "cwd", "conversation_id", "native_session_id", "created_at",
                "updated_at", "exit_code", "error", "recovery_reason", "stop_reason", "write", "transport",
                "last_heartbeat_at", "started_at", "orphaned")
        return {**{key: row.get(key) for key in keys}, "title": row["prompt"].splitlines()[0][:120],
                "declared_files": [p[:512] for p in row["declared_files"][:12]],
                "changed_files": [p[:512] for p in row["changed_files"][:12]]}


def work(runner, task_id, attempt):
    folder = runner.folder(task_id)
    lock = folder / "task.lock"
    handle = None
    adapter = None
    worker_stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: worker_stop.set())
    with file_lock(lock):
        row = runner.read(task_id)
        if row["attempt"] != attempt or row["status"] != "queued":
            return
        if row["stop_reason"] == "cancelled":
            runner.persist(folder, updated(row, status="cancelled"))
            return
        if row["stop_reason"] == "paused":
            runner.interrupt(folder, row, "paused")
            return
        updated(row, status="running", worker_pid=os.getpid(), worker_identity=pid_identity(os.getpid()),
                last_heartbeat_at=time.time(), started_at=time.time())
        runner.persist(folder, row)
    control = {"reason": None}
    done = threading.Event()
    seen_error = False
    code = None

    def monitor():
        deadline = time.monotonic() + row["timeout"]
        last = time.monotonic()
        while not done.wait(.15):
            with file_lock(lock):
                current = runner.read(task_id)
                reason = current["stop_reason"]
                if not reason and worker_stop.is_set():
                    reason = "worker_signal"
                if not reason and time.monotonic() >= deadline:
                    reason = "timeout"
                if time.monotonic() - last >= 2:
                    runner.persist(folder, updated(current, last_heartbeat_at=time.time()))
                    last = time.monotonic()
            if reason:
                control["reason"] = reason
                adapter.cancel(current, handle.process)
                return

    try:
        adapter = runner.adapters[row["engine"]]
        with file_lock(lock):
            current = runner.read(task_id)
            if current["stop_reason"]:
                return
            if project_root(row["cwd"]) != Path(row["cwd"]):
                raise ValueError("工作区路径已改变")
            if row["mode"] == "native":
                handle = adapter.resume(row, row["run_prompt"])
            else:
                handle = adapter.start(row)
            runner.persist(folder, updated(runner.read(task_id), pid=handle.pid, pgid=handle.pgid,
                                           pid_identity=pid_identity(handle.pid)))
        supervisor = threading.Thread(target=monitor, daemon=True)
        supervisor.start()
        with (folder / "output.log").open("ab", buffering=0) as output, \
                (folder / "events.jsonl").open("ab", buffering=0) as events, handle.process.stdout as stream:
            def lines():
                for raw in iter(lambda: stream.readline(2 * 1024 * 1024), b""):
                    output.write(raw)
                    yield raw.decode("utf-8", "replace")

            for item, session in adapter.events(row, lines()):
                seen_error = seen_error or adapter.outcome_error(item)
                paths = adapter.declared_output(item)
                if item:
                    events.write((json.dumps({"attempt": attempt, "at": time.time(), "event": item},
                                              ensure_ascii=False) + "\n").encode("utf-8", "replace"))
                if valid_session(session) or paths:
                    with file_lock(lock):
                        current = runner.read(task_id)
                        if valid_session(session):
                            existing = current.get("native_session_id")
                            if existing and existing != session:
                                seen_error = True
                            elif not existing:
                                current["native_session_id"] = session
                                if row["engine"] == "qoder":
                                    current["recovery_guard"] = request_identity(row, session)
                        scope = Scope({"workspacePaths": [row["cwd"]]}, runner.store.root)
                        observed = set(current["observed_files"])
                        for name in paths:
                            try:
                                observed.add(str(scope.resolve(name, exists=False).relative_to(row["cwd"])))
                            except ValueError:
                                pass
                        current["observed_files"] = sorted(observed)
                        runner.persist(folder, updated(current, last_heartbeat_at=time.time()))
        code = handle.process.wait()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        if handle and adapter:
            adapter.cancel(row, handle.process)
        message = str(error) if isinstance(error, ValueError) else "CLI 启动或输出读取失败"
        with (folder / "output.log").open("ab") as output:
            output.write((message + "\n").encode())
        seen_error = True
    finally:
        done.set()
        if handle and "supervisor" in locals():
            supervisor.join()
        with file_lock(lock):
            current = runner.read(task_id)
            if current["attempt"] != attempt or current["status"] != "running":
                return
            reason = current["stop_reason"] or control["reason"]
            updated(current, exit_code=code, last_heartbeat_at=time.time(), finished_at=time.time())
            if reason == "cancelled":
                runner.persist(folder, updated(current, status="cancelled"))
            elif reason or code != 0 or seen_error:
                current["error"] = "CLI 执行中断或没有成功回执"
                if current["engine"] == "codex" and code and not reason and "Not inside a trusted directory" in tail(folder / "output.log", 4)["text"]:
                    current["error"] = "Codex 拒绝了当前工作目录。请在派单时选择已登记项目中的 Git 仓库，或选择你已在 Codex 中信任的目录。"
                runner.interrupt(folder, current, reason or "cli_interrupted")
            else:
                _, after = workspace_snapshot(current["cwd"], current["declared_files"] + current["observed_files"],
                                              runner.store.root, current["git_head_before"])
                files = set(changes_since(current["baseline"], after)) | set(current["observed_files"])
                runner.persist(folder, updated(current, status="review" if files or current["write"] else "completed",
                                               changed_files=sorted(files)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true", required=True)
    parser.add_argument("task_id")
    parser.add_argument("attempt", type=int)
    parser.add_argument("data_dir")
    args = parser.parse_args()
    work(Runner(Store(args.data_dir)), args.task_id, args.attempt)
