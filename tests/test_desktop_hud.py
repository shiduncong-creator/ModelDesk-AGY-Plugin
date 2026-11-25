"""The independent desktop receives only the selected chat's registered data."""

from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

from server.desktop_hud import DesktopHUD, HUDInputError, PROFILE
from server.storage import atomic_json
from .support import git, poll, ROOT, sandbox


A = "11111111-1111-4111-a111-111111111111"
B = "22222222-2222-4222-a222-222222222222"
FOREIGN = "33333333-3333-4333-a333-333333333333"


def transcript(home, profile, sid, summary):
    folder = home / ".gemini" / profile / "brain" / sid / ".system_generated/logs"
    folder.mkdir(parents=True)
    entry = {"type": "PLANNER_RESPONSE", "created_at": datetime.now().astimezone().isoformat(),
             "model": "Demo (128K)", "thinkingSummary": summary, "input_tokens": 20, "output_tokens": 6}
    (folder / "transcript.jsonl").write_text(json.dumps(entry) + "\n")
    return folder


class DesktopTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.root = self.enterContext(sandbox())
        self.home = self.root / "home"
        self.app = DesktopHUD(home=self.home)
        self.app.translator.keys.security = self.root / "unused-keychain"
        self.enterContext(patch("server.usage.usage_state", return_value={"status": "fixture"}))
        self.ws = self.root / "project"
        self.ws.mkdir()
        git(self.ws, "init", "-q")
        self.paths = {}
        sessions = {}
        foreign_log = transcript(self.home, "antigravity", FOREIGN, "Private foreign fixture.")
        for sid, sample in ((A, "First"), (B, "Second")):
            file = self.ws / (sample + ".txt")
            file.write_text(sample + " file.")
            self.paths[sid] = str(file)
            folder = transcript(self.home, PROFILE, sid, sample + " summary.")
            sessions[sid] = {"conversationId": sid, "title": sample, "workspacePaths": [str(self.ws)],
                             "artifactDirectoryPath": str(folder.parents[1]), "modelName": "Demo",
                             "observed_files": {str(file): {"cwd": str(self.ws)}},
                             "transcriptPath": str(foreign_log / "transcript.jsonl")}
        atomic_json(self.app.store.root / "sessions.json", {"sessions": sessions, "active": B})
        self.unrelated = self.ws / "unrelated.txt"
        self.unrelated.write_text("Unrelated fixture.")
        self.tasks = [("a"*32, A, self.ws), ("b"*32, B, self.ws),
                      ("c"*32, FOREIGN, self.ws), ("d"*32, A, self.root)]
        for taskid, sid, cwd in self.tasks:
            folder = self.app.store.tasks / taskid
            folder.mkdir()
            owns = [Path(self.paths[sid]).name] if sid in self.paths else []
            atomic_json(folder / "task.json", {"id": taskid, "prompt": "Check fixture", "cwd": str(cwd),
                        "conversation_id": sid, "engine": "codex", "updated_at": time.time(), "status": "review",
                        "declared_files": owns, "changed_files": owns, "git_head_before": None})
            (folder / "output.log").write_text("fixture task log " + sid)

    def tearDown(self):
        self.app.thoughts.pool.shutdown(wait=True)

    async def test_home_unknown_and_chat_selection(self):
        home = await self.app.call("snapshot", {"conversation_id": None})
        self.assertIsNone(home["session"]["id"])
        self.assertIsNone(home["context"])
        self.assertEqual(home["thoughts"]["entries"], [])
        self.assertEqual(home["files"], [])
        self.assertEqual({row["id"] for row in home["tasks"]}, {"a"*32, "b"*32})
        self.assertEqual(home["translation"]["preset"], "gpt-6-luna")
        for sid, label in ((A, "First"), (B, "Second")):
            state = await self.app.call("snapshot", {"conversation_id": sid})
            self.assertEqual(state["session"]["id"], sid)
            self.assertEqual([item["conversation_id"] for item in state["tasks"]], [sid])
            self.assertEqual([item["path"] for item in state["files"]], [self.paths[sid]])
            self.assertEqual(state["context"]["conversation_id"], sid)
            self.assertEqual(state["context"]["tokens"]["main"]["input_tokens"], 20)
            self.assertEqual(state["thoughts"]["entries"][0]["text"], label + " summary.")
            self.assertEqual(state["thoughts"]["entries"][0]["status"], "pending")
        wrong = await self.app.call("snapshot", {"conversation_id": FOREIGN})
        self.assertIsNone(wrong["session"]["id"])
        self.assertIsNone(wrong["context"])
        self.assertEqual(wrong["tasks"] + wrong["files"] + wrong["thoughts"]["entries"], [])
        with self.assertRaises(HUDInputError):
            await self.app.call("app_thoughts", {"conversation_id": FOREIGN})

    async def test_file_receipts_survive_rename_and_restart(self):
        own = {"conversation_id": A, "path": self.paths[A]}
        self.assertEqual((await self.app.call("app_file_action", {**own, "action": "read_text"}))["text"], "First file.")
        for path in (str(self.unrelated), self.paths[B]):
            with self.assertRaises(HUDInputError):
                await self.app.call("app_translate", {**own, "path": path})
            with self.assertRaises(HUDInputError):
                await self.app.call("app_file_action", {**own, "path": path, "action": "read_text"})
        # A previously registered file replaced by a link cannot register the
        # new target in this chat or grant read access through its old name.
        owned = Path(self.paths[A])
        owned.unlink()
        owned.symlink_to(self.unrelated)
        self.assertEqual((await self.app.call("app_list_files", {"conversation_id": A}))["files"], [])
        with self.assertRaises(HUDInputError):
            await self.app.call("app_file_action", {**own, "action": "read_text"})
        owned.unlink()
        owned.write_text("First file.")
        rename = {**own, "action": "rename", "destination": "renamed.md"}
        with self.assertRaises(HUDInputError):
            await self.app.call("app_file_action", rename)
        new = await self.app.call("app_file_action", {**rename, "confirmed": True})
        self.assertFalse(Path(self.paths[A]).exists())
        newpath = new["path"]
        self.assertEqual(Path(newpath).read_text(), "First file.")
        dest = self.ws / "export"
        dest.mkdir()
        exported = await self.app.call("app_file_action", {"conversation_id": A, "path": newpath,
                            "action": "export_copy", "destination": str(dest), "confirmed": True})
        other_hud = DesktopHUD(home=self.home)
        try:
            listing = await other_hud.call("app_list_files", {"conversation_id": A})
            self.assertEqual({x["path"] for x in listing["files"]}, {newpath, exported["path"]})
            with self.assertRaises(HUDInputError):
                await other_hud.call("app_file_action", {"conversation_id": B, "path": newpath, "action": "read_text"})
        finally:
            other_hud.thoughts.pool.shutdown()

    async def test_task_scope_actions_and_log_diff(self):
        scope = {"conversation_id": A, "task_id": "a"*32}
        args = {**scope, "include_diff": True}
        result = await self.app.call("app_get_task_logs", args)
        self.assertEqual(result["text"], "fixture task log " + A)
        self.assertIn("First file.", result["snapshot"]["diff"])
        self.assertNotIn("unrelated", json.dumps(result["snapshot"]))
        self.assertNotIn("Second", json.dumps(result["snapshot"]))
        for bad in ({"conversation_id": B}, {"task_id": "d"*32}):
            with self.assertRaises(HUDInputError):
                await self.app.call("app_get_task_logs", {**args, **bad})
        for action in ("dispatch", "cancel"):
            with self.assertRaises(HUDInputError):
                await self.app.call("app_task_action", {**scope, "action": action})
        self.assertEqual((await self.app.call("app_task_action", {**scope, "action": "accept"}))["status"], "accepted")

    async def test_pref_sanitization_and_key_presence(self):
        secret = "sk-fixture-only-sensitive"
        atomic_json(self.app.translator.keys.path, {"gpt-6-luna": secret})
        atomic_json(self.app.store.root / "prefs.json", {"hud_theme": "dark", "unknown_secret": secret})
        state = await self.app.call("snapshot", {})
        self.assertEqual(state["translation"]["api_key_mask"], "已保存")
        self.assertEqual(state["prefs"], {"hud_theme": "dark"})
        self.assertNotIn("sitive", json.dumps(state))
        reply = await self.app.call("app_save_prefs", {"patch": {"thought_bilingual": True}})
        self.assertEqual(reply["prefs"], {"thought_bilingual": True, "hud_theme": "dark"})
        status = await self.app.call("app_provider_status", {"preset": "ollama"})
        self.assertEqual(status["selected_preset"], "ollama")
        self.assertEqual(status["api_key_mask"], "")
        self.assertEqual(status["preset"], "gpt-6-luna")

    async def test_auto_translation_waits_for_key_then_schedules_once(self):
        sid = {"conversation_id": A}
        await self.app.call("app_save_prefs", {"patch": {"thought_auto_translate": True}})
        with patch.object(self.app.translator, "send", return_value="临时示例。") as send:
            with patch.object(self.app.translator, "credentials", side_effect=AssertionError("unconfigured")):
                self.assertFalse((await self.app.call("app_provider_status", {}))["configured"])
                state = await self.app.call("snapshot", sid)
                self.assertEqual(state["thoughts"]["entries"][0]["status"], "pending")
                for _ in range(2):
                    entry = (await self.app.call("app_thoughts", sid))["entries"][0]
                    self.assertIsNone(entry["error"])
                    self.assertEqual(entry["text"], "First summary.")
                send.assert_not_called()
            saved = await self.app.call("app_save_prefs", {"key_preset": "gpt-6-luna", "api_key": "fixture-test-key"})
            self.assertTrue(saved["translation"]["configured"])
            await self.app.call("app_thoughts", sid)
            entry = poll(lambda: self.app.thought_rows(A)["entries"][0], lambda row: row["status"] == "translated")
            self.assertEqual(entry["translation"], "临时示例。")
            send.assert_called_once()
        self.assertTrue((await self.app.call("app_provider_status", {"preset": "ollama"}))["configured"])

    async def test_visible_summary_shares_cache_and_checks_session_and_preferences(self):
        selected = {"conversation_id": A, "visible_step": 9, "visible_revision": 1, "visible_text": "First summary."}
        await self.app.call("app_save_prefs", {"key_preset": "gpt-6-luna", "api_key": "fixture-test-key"})
        with patch.object(self.app.translator, "send", return_value="已在原位显示的示例。") as send:
            self.assertEqual((await self.app.call("app_thoughts", selected))["status"], "unavailable")
            send.assert_not_called()
            await self.app.call("app_save_prefs", {"patch":{"thought_auto_translate": True}})
            with self.assertRaises(HUDInputError):
                await self.app.call("app_thoughts", {**selected, "conversation_id": FOREIGN})
            with self.assertRaises(HUDInputError):
                await self.app.call("app_thoughts", {**selected, "visible_text": "x"*24001})
            await self.app.call("app_thoughts", selected)
            result = poll(lambda: self.app.visible_thought(A, selected["visible_text"], 9, 1),
                          lambda item: item["status"] == "translated")
            self.assertEqual(result["revision"], 1)
            self.assertEqual(result["translation"], "已在原位显示的示例。")
            rail = await self.app.call("app_thoughts", {"conversation_id": A})
            self.assertEqual(rail["entries"][0]["translation"],result["translation"])
            send.assert_called_once()
            lengthy = "A" * 5500 + "\n" + "B" * 1000
            await self.app.call("app_thoughts", {**selected, "visible_text":lengthy})
            long_result = poll(lambda: self.app.visible_thought(A, lengthy, 9, 2),lambda row:row["status"]=="translated")
            self.assertEqual(long_result["translation"].count("已在原位显示的示例。"),2)
            self.assertEqual(send.call_count,3)

    def test_ndjson_worker_rejects_invalid_request_and_recovers(self):
        secret = "invalid-do-not-echo"
        messages = [(1, "snapshot", {}), (2, "unregistered", {}), (3, "app_list_files", {"limit": secret}),
                    (4, "app_provider_status", {"preset": "ollama"}), (5, "app_translate", {"text": secret})]
        wire = "\n".join(json.dumps({"id": i, "method": m, "args": a}) for i,m,a in messages) + "\n"
        run = subprocess.run([sys.executable, "-m", "server.desktop_hud"], input=wire, cwd=ROOT,
                             text=True, capture_output=True, timeout=20, check=True,
                             env={**os.environ, "HOME": str(self.root / "isolated-process")})
        self.assertNotIn(secret, run.stdout + run.stderr)
        replies = {row["id"]: row for row in map(json.loads, run.stdout.splitlines())}
        self.assertEqual(set(replies), {1,2,3,4,5})
        self.assertIsNone(replies[1]["result"]["context"])
        self.assertEqual(replies[4]["result"]["selected_preset"], "ollama")
        self.assertTrue(all(not replies[i]["ok"] for i in (2,3,5)))
