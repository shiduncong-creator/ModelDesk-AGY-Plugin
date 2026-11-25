from datetime import datetime, timedelta
from hashlib import sha256
import json
import os
import sqlite3
import unittest
from unittest.mock import patch

from server.codex_usage import UsageCache, normalize
from server.context_inspector import ContextInspector, book_yardstick, infer_context_window
from server.deliverables import Deliverables
from server.storage import Store
from server.usage import Usage

from .support import poll, register, sandbox


def row(model, at, input_tokens, cached, output, **other):
    return {"type": "PLANNER_RESPONSE", "created_at": at.isoformat(), "model": model,
            "input_tokens": input_tokens, "cache_read_tokens": cached, "output_tokens": output, **other}


def append(path, *rows):
    with path.open("a", encoding="utf-8") as file:
        for item in rows:
            file.write(json.dumps(item, ensure_ascii=False) + "\n")


class ContextTest(unittest.TestCase):
    def test_incremental_partial_line_and_rewritten_transcript(self):
        with sandbox() as root:
            path = root / "transcript.jsonl"
            now = datetime.now().astimezone()
            first = row("first", now, 10, 50, 3, step_index=1)
            second = row("second", now, 15, 60, 4, step_index=2)
            append(path, first)
            scanner = ContextInspector()
            initial = scanner.scan(path)
            partial = json.dumps(second)
            with path.open("a") as file:
                file.write(partial[:130])
            self.assertEqual(scanner.scan(path).latest["model"], "first")
            self.assertEqual(initial.offset, len(json.dumps(first).encode()) + 1)
            with path.open("a") as file:
                file.write(partial[130:] + "\n")
            parsed = scanner.scan(path)
            self.assertIs(initial, parsed)
            self.assertEqual(parsed.latest["model"], "second")
            self.assertEqual(parsed.totals["first"]["input_tokens"], 10)
            self.assertEqual(parsed.totals["second"]["cache_read_tokens"], 60)
            new = path.with_suffix(".new")
            append(new, row("replacement", now, 102, 402, 3))
            os.replace(new, path)
            state = scanner.scan(path)
            self.assertNotIn("first", state.totals)
            self.assertEqual(state.latest["model"], "replacement")

    def test_top_steps_meter_and_matching_tool_summary(self):
        with sandbox() as root:
            path = root / "transcript.jsonl"
            now = datetime.now().astimezone()
            append(path, row("model", now, 31000, 70000, 1000, step_index=1,
                            tool_calls=[{"name": "run_command", "args": {"CommandLine": "printf hello"}}]),
                   {"type": "GENERIC", "step_index": 2, "content": "大" * 2500})
            for index in range(20):
                append(path, {"type": "USER_INPUT", "content": "-" * (index + 5)})
            scanner = ContextInspector()
            context = scanner.context(scanner.scan(path), 128_000)
            self.assertEqual(context["used_tokens"], 101000)
            self.assertAlmostEqual(context["cache_hit_rate"], 70000 / 101000)
            self.assertIn("/compact", context["advice"])
            self.assertEqual(len(context["top"]), 10)
            self.assertEqual(context["top"][0]["tool"], "run_command")
            self.assertEqual(context["top"][0]["summary"], "printf hello")

    def test_week_and_today_aggregate_all_discoverable_transcripts_by_model(self):
        with sandbox() as root, patch("server.usage.usage_state", return_value={"buckets": []}):
            project = root / "project"
            project.mkdir()
            today = datetime.now().astimezone()
            active = root / "current.jsonl"
            append(active, row("A", today, 10, 100, 300), row("B", today - timedelta(days=9), 20, 2, 3))
            second = root / ".gemini/antigravity-cli/brain/other/.system_generated/logs/transcript.jsonl"
            second.parent.mkdir(parents=True)
            append(second, row("A", today - timedelta(days=4), 5, 50, 90), row("C", today, 1, 2, 3))
            store = Store(root / "data")
            register(store, project, transcript=active)
            tasks = [{"engine": "codex", "status": "accepted", "attempt": 2, "started_at": 10, "finished_at": 15}]
            result = Usage(store, home=root).snapshot(tasks)
            self.assertEqual(result["tokens"]["today"]["A"]["input_tokens"], 10)
            self.assertEqual(result["tokens"]["week"]["A"]["input_tokens"], 15)
            self.assertIn("B", result["tokens"]["session"])
            self.assertNotIn("B", result["tokens"]["week"])
            self.assertEqual(result["cli"]["codex"]["mean_seconds"], 5)
            self.assertEqual(result["cli"]["codex"]["calls"], 2)
            self.assertEqual(len(result["recent_sessions"]), 2)

    def test_v2_context_window_and_book_scale(self):
        for model, expected in {
            "Gemini 4 Neon": 512_000, "gemini-3-pro": 512_000, "gemini-2.5-flash": 512_000,
            "gemini-2-flash": 512_000, "Gemini 20": 200_000, "Claude Sonnet": 200_000,
            "gpt-5.4-codex": 200_000, "GPT 6 Luna": 200_000, "codex": 200_000,
            "o3": 200_000, "o4-mini": 200_000, "gpt-4.1": 128_000, "deepseek-chat": 128_000,
            "Qwen": 128_000, "model": 200_000,
        }.items():
            with self.subTest(model=model):
                self.assertEqual(infer_context_window(model), expected)
        self.assertEqual(book_yardstick(195_000), {"title": "双城记", "multiple": 1.0, "label": "《双城记》×1.0"})
        self.assertEqual(book_yardstick(0)["label"], "《道德经》×0.0")

    def test_subagent_usage_includes_only_observed_brain_logs_and_deduplicates(self):
        child_id = "2c3f5ed0-bb63-4cf9-ba4d-6f4d22ab8d02"
        missing = "3c3f5ed0-bb63-4cf9-ba4d-6f4d22ab8d02"
        unrelated = "4c3f5ed0-bb63-4cf9-ba4d-6f4d22ab8d02"
        with sandbox() as root, patch("server.usage.usage_state", return_value={"buckets": []}):
            now = datetime.now().astimezone()
            profile = root / ".gemini/antigravity/brain"
            for sid in (child_id, unrelated):
                path = profile / sid / ".system_generated/logs/transcript.jsonl"
                path.parent.mkdir(parents=True)
                append(path, row("sub", now, 4, 8, 12))
            main = root / "main.jsonl"
            append(main, row("Gemini 4 Neon", now, 100, 60, 20, tool_calls=[
                {"name": "invoke_subagent", "id": "call-1", "args": {"candidate": missing}},
                {"name": "read_file", "id": "call-2"},
            ]), {"type": "TOOL_RESULT", "toolCallId": "call-2", "result": unrelated},
                {"type": "TOOL_RESULT", "toolCallId": "call-1", "result": {"conversationId": child_id}},
                {"type": "TOOL_CALL", "toolName": "invoke_subagent", "args": {"again": child_id}})
            store = Store(root / "data")
            register(store, root, transcript=main)
            usage = Usage(store, home=root)
            result = usage.snapshot([])
            self.assertEqual(result["tokens"]["main"], {"input_tokens": 100, "cache_read_tokens": 60, "output_tokens": 20})
            self.assertEqual(result["tokens"]["subagents"],
                             {"count": 1, "input_tokens": 4, "cache_read_tokens": 8, "output_tokens": 12})
            self.assertEqual((result["context"]["window_source"], result["context"]["window_tokens"]), ("auto", 512_000))
            store.save_prefs({"context_window": 888})
            result = usage.snapshot([])
            self.assertEqual((result["context"]["window_source"], result["context"]["window_tokens"]), ("manual", 888))
            store.save_prefs({"context_window": None})
            self.assertEqual(usage.snapshot([])["context"]["window_tokens"], 512_000)

    def test_thoughts_are_incremental_bounded_and_replace_revised_steps(self):
        with sandbox() as root:
            path = root / "main.jsonl"
            now = datetime.now().astimezone()
            append(path, *(row("m", now, 0, 0, 0, step_index=i, thinking=str(i)) for i in range(33)))
            scanner = ContextInspector()
            initial = scanner.scan(path)
            self.assertEqual([r["step"] for r in initial.thoughts.values()], list(range(3, 33)))
            text = "思" * 6001
            append(path, row("m", now, 0, 0, 0, step_index=10, thinking=text),
                   {"type": "USER_INPUT", "step_index": 90, "thinking": "ignored"})
            again = scanner.scan(path)
            self.assertIs(again, initial)
            self.assertEqual(len(again.thoughts), 30)
            newest = list(again.thoughts.values())[-1]
            self.assertEqual(newest, {"step": 10, "kind": "summary", "timestamp": now.isoformat(), "model": "m",
                                      "hash": sha256(text.encode()).hexdigest()[:16],
                                      "text": text[:6000], "truncated": True})

    def test_translation_collects_public_replies_and_summaries_independently(self):
        with sandbox() as root:
            path = root / "transcript.jsonl"
            hook_log = root / "transcript_full.jsonl"
            base = {"type": "PLANNER_RESPONSE", "step_index": 1, "status": "DONE", "source": "MODEL"}
            greeting = "Hello! How can I help you today?"
            append(hook_log, {**base, "content": "Internal payload"})
            store = Store(root / "data")
            register(store, root, transcript=hook_log)
            usage = Usage(store, home=root)
            self.assertEqual(usage.thoughts()[1], [])
            append(path, {**base, "type": "USER_INPUT", "content": "hello"},
                   {**base, "content": greeting},
                   {**base, "step_index": 2, "thinkingSummary": "Public summary", "content": "Visible draft"},
                   {**base, "step_index": 2, "content": "Revised reply", "truncated_fields": ["content"]},
                   {**base, "type": "TOOL_RESULT", "content": "Tool result"},
                   {**base, "step_index": 3, "userVisible": False, "content": "Hidden reply"},
                   {**base, "step_index": 4, "visibility": "private", "thinking": "Private summary"},
                   {**base, "step_index": 5, "content": " ", "tool_calls": [{"name": "example"}]})
            rows = usage.thoughts()[1]
            self.assertEqual([(r["step"], r["kind"], r["text"]) for r in rows],
                             [(1, "reply", greeting), (2, "summary", "Public summary"), (2, "reply", "Revised reply")])
            self.assertTrue(rows[-1]["truncated"])

    def test_indexed_navigation_parent_hierarchy_three_profiles_and_read_only_files(self):
        parent = "aaa00000-0000-0000-0000-000000000001"
        child = "bbb00000-0000-0000-0000-000000000002"
        other = "ccc00000-0000-0000-0000-000000000003"
        with sandbox() as home, patch("server.usage.usage_state", return_value={}):
            root = home / "project A"
            root.mkdir()
            outside = home / "other"
            outside.mkdir()
            registry = home / ".gemini/config/projects"
            registry.mkdir(parents=True)
            (registry / "p.json").write_text(json.dumps({
                "id": "p", "name": "Sample project", "projectResources": {"resources": [{"folderUri": root.as_uri()}]}}))
            (registry / "empty.json").write_text(json.dumps({"id": "empty", "name": "No sessions"}))
            now = datetime.now().astimezone()
            host = home / ".gemini/antigravity"
            for profile, sid, tokens in (("antigravity", parent, 7), ("antigravity", other, 20),
                                        ("antigravity-cli", child, 3), ("antigravity-modeldesk", parent, 7)):
                log = home / ".gemini" / profile / "brain" / sid / ".system_generated/logs/transcript.jsonl"
                log.parent.mkdir(parents=True)
                append(log, row("MP", now, tokens, 1, 1, tool_calls=[
                    {"name": "invoke_subagent", "args": {"Prompt": "A mentioned ID " + other}}],
                    context_window_tokens=1_048_576))
            append(log, {"type": "CHECKPOINT", "created_at": now.isoformat(), "input_tokens": 4})
            with sqlite3.connect(host / "conversation_summaries.db") as db:
                db.execute("CREATE TABLE conversation_summaries(conversation_id, parent_conversation_id, "
                           "project_id, title, last_modified_time, workspace_uris)")
                db.executemany("INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?)", [
                    (parent, "", "p", "Sample title", now.isoformat(), json.dumps([root.as_uri()])),
                    (child, parent, "p", "", now.isoformat(), json.dumps([root.as_uri()])),
                    (other, "", "p", "", now.isoformat(), json.dumps([outside.as_uri()]))])
            store = Store(home / "data")
            usage = Usage(store, home)
            nav = usage.navigation(*usage.catalog())
            self.assertEqual(len(nav["sessions"]), 3)
            self.assertEqual(len(nav["projects"]), 2)
            self.assertEqual(usage.session(parent)["workspacePaths"], [str(root)])
            self.assertEqual(usage.session(other)["workspacePaths"], [])
            self.assertEqual(usage.session(parent)["title"], "Sample title")
            snap = usage.snapshot([], parent)
            self.assertEqual(snap["tokens"]["subagents"]["count"], 1)
            self.assertEqual(snap["tokens"]["main"]["input_tokens"], 11)
            self.assertEqual(snap["tokens"]["today"]["MP"]["input_tokens"], 30)
            self.assertEqual(snap["context"]["used_tokens"], 8)
            self.assertEqual((snap["context"]["window_basis"],snap["context"]["window_tokens"]), ("reported",1_048_576))
            target = root / "fixture.txt"
            target.write_text("fixture")
            files = Deliverables(store, session_lookup=usage.session)
            self.assertEqual(files.action("read_text", target, parent)["text"], "fixture")
            with self.assertRaisesRegex(ValueError, "仅可读取"):
                files.action("rename", target, parent, destination="changed.txt", confirmed=True)
            with self.assertRaises(ValueError):
                files.action("read_text", target, other)

    def test_labeled_context_and_visible_summary(self):
        now = datetime.now().astimezone()
        with sandbox() as root:
            path = root / "display.jsonl"
            append(path, row("Local (1M)", now, 20, 10, 3, thinkingSummary="Public summary"),
                   row("Local (1M)", now, 22, 11, 4, visibility="private", thinking="hidden"),
                   row("Local (1M)", now, 23, 11, 4, rawThinking="hidden"))
            scanner = ContextInspector()
            state = scanner.scan(path)
            self.assertEqual([r["text"] for r in state.thoughts.values()], ["Public summary"])
            self.assertEqual(scanner.context(state)["window_basis"], "model_label")
            self.assertEqual(scanner.context(state)["window_tokens"], 1_000_000)

    def test_codex_quota_cache_is_background_and_whitelists_fields(self):
        raw = {"rateLimits": {"limitId": "codex", "secondary": {"usedPercent": 23, "windowDurationMins": 10080,
                                                                "secret": "private-token"}}}
        self.assertEqual(normalize(raw)["buckets"][0]["windows"][0]["remaining_percent"], 77)
        cache = UsageCache(query=lambda: raw)
        cache.snapshot()
        result = poll(cache.snapshot, lambda data: data["status"] == "ready")
        self.assertNotIn("private-token", json.dumps(result))
