import json
import os
import subprocess
import time
import unittest

from .support import ROOT, sandbox


class HooksTest(unittest.TestCase):
    def invoke(self, root, event, **params):
        command = self.config[event][0]
        if event == "PostToolUse":
            command = command["hooks"][0]
        data = {"conversationId": "conv-1", "hookEventName": event, "workspacePaths": [str(root / "project")],
                "transcriptPath": str(root / "transcript.jsonl"), "artifactDirectoryPath": str(root / "artifacts"),
                "modelName": "gemini-test", "stepIdx": 24, **params}
        started = time.perf_counter()
        result = subprocess.run(command["command"].split(), cwd=ROOT, input=json.dumps(data), text=True,
                                capture_output=True, check=True, env={**os.environ, "PLUGIN_DATA": str(root)},
                                timeout=1)
        self.timings.append((time.perf_counter() - started) * 1000)
        self.assertEqual(result.stdout.strip(), "{}")
        self.assertEqual(result.stderr, "")
        return json.loads((root / "sessions.json").read_text())

    def setUp(self):
        self.config = json.loads((ROOT / "hooks.json").read_text())["modeldesk-observer"]
        self.timings = []

    def test_manifest_and_camel_case_hook_flow_under_50ms(self):
        self.assertNotIn("PreToolUse", self.config)
        with sandbox() as root:
            first = self.invoke(root, "SessionStart", lastUserInput="private-user-message")
            self.assertEqual(first["active"], "conv-1")
            self.assertNotIn("private-user-message", (root / "sessions.json").read_text())
            row = first["sessions"]["conv-1"]
            self.assertEqual(row["stepIdx"], 24)
            self.assertEqual(row["modelName"], "gemini-test")
            self.assertEqual(row["transcriptPath"], str(root / "transcript.jsonl"))
            self.invoke(root, "PreInvocation")
            self.invoke(root, "PostToolUse", toolCall={"name": "run_command",
                        "args": {"CommandLine": "cd project && /the/path/qoderclicn -p 'hello'"}})
            self.invoke(root, "PostToolUse", error="exited with error",
                        toolCall={"toolName": "run_command", "args": {"CommandLine": "agy -p mock"}})
            self.invoke(root, "PostToolUse", toolCall={"name": "write_to_file",
                        "args": {"TargetFile": "notes.md"}})
            self.invoke(root, "PostInvocation")
            state = self.invoke(root, "Stop")
            row = state["sessions"]["conv-1"]
            self.assertIn("notes.md", row["observed_files"])
            self.assertEqual([(r["engine"], r["status"]) for r in row["passive_cli_runs"]],
                             [("qoder", "completed"), ("gemini", "failed")])
            self.assertEqual(row["invocation_status"], "idle")
        print(f"\nHook timing · {len(self.timings)} events · max {max(self.timings):.2f} ms")
        self.assertLess(max(self.timings), 50)

    def test_late_event_does_not_steal_active_conversation(self):
        with sandbox() as root:
            self.invoke(root, "SessionStart")
            self.invoke(root, "PreInvocation", conversationId="conv-2")
            state = self.invoke(root, "Stop")
            self.assertEqual(state["active"], "conv-2")

    def test_failed_file_tool_not_reported_as_artifact(self):
        with sandbox() as root:
            self.invoke(root, "SessionStart")
            state = self.invoke(root, "PostToolUse", error="permission error",
                                toolCall={"name": "edit_file", "args": '{"path":"test.txt"}'})
            self.assertNotIn("observed_files", state["sessions"]["conv-1"])

    def test_malformed_input_fails_open_without_approval_fields(self):
        with sandbox() as root:
            result = subprocess.run(["bash", "./scripts/run-hook.sh"], cwd=ROOT,
                                    input="{missing", text=True, capture_output=True, check=True,
                                    env={**os.environ, "PLUGIN_DATA": str(root)})
            self.assertEqual(result.stdout.strip(), "{}")
            self.assertFalse((root / "sessions.json").exists())
