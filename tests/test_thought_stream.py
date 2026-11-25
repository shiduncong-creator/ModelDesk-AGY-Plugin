import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

from server.storage import Store, atomic_json
from server.thought_stream import ThoughtStream
from server.translator import Translator

from .support import poll, sandbox


def entry(index):
    return {"step": index, "timestamp": None, "model": "source", "hash": f"{index:016x}",
            "text": f"Thought {index}", "truncated": False}


class ThoughtStreamTest(unittest.TestCase):
    def setUp(self):
        self.store = Store(self.enterContext(sandbox()) / "data")
        self.store.save_prefs({"translation": {"preset": "ollama"}})
        self.translator = Translator(self.store)
        self.translator.keys.security = Path("/not-installed/keychain")

    def stream(self):
        stream = ThoughtStream(self.store, self.translator)
        self.addCleanup(stream.pool.shutdown, wait=True)
        return stream

    def test_bounded_queue_is_nonblocking_and_deduplicates_during_poll(self):
        stream = self.stream()
        gate = threading.Event()
        first_two = threading.Event()
        started = []
        self.addCleanup(gate.set)

        def translate(config, key, messages):
            started.append(messages[-1]["content"])
            if len(started) == 2:
                first_two.set()
            if not gate.wait(3):
                raise AssertionError("test did not release translation workers")
            return "思考"

        with patch.object(self.translator, "send", side_effect=translate) as send:
            rows = [entry(i) for i in range(8)]
            initial = stream.snapshot("main", rows, auto_translate=True)["entries"]
            self.assertEqual([r["status"] for r in initial], ["pending"] * 3 + ["translating"] * 5)
            self.assertTrue(first_two.wait(2))
            stream.snapshot("main", rows, auto_translate=True)
            stream.snapshot("another", rows, auto_translate=True)
            self.assertEqual(send.call_count, 2)
            gate.set()
            final = poll(lambda: stream.snapshot("main", rows, auto_translate=True),
                         lambda data: all(r["status"] == "translated" for r in data["entries"]))
            self.assertEqual(send.call_count, 8)
            self.assertTrue(all(r["cached"] for r in final["entries"]))

    def test_persistent_lru_recency_and_no_repeat_after_restart(self):
        stream = self.stream()
        stream.cache_limit = 400
        cache = {f"ollama:qwen2.5:7b:{index:016x}": {"translation": str(index), "latency_ms": 3}
                 for index in range(400)}
        atomic_json(stream.path, cache)
        oldest, evicted = list(cache)[:2]
        entries = [entry(0), entry(400)]
        with patch.object(self.translator, "send", return_value="测试") as send:
            stream.snapshot("main", entries, auto_translate=True)
            poll(lambda: stream.snapshot("main", entries, auto_translate=True), lambda val: val["entries"][-1]["status"] == "translated")
            self.assertEqual(send.call_count, 1)
            self.assertEqual(stream.path.stat().st_mode & 0o777, 0o600)
            data = json.loads(stream.path.read_text())
            self.assertEqual(len(data), 400)
            self.assertIn(oldest, data)
            self.assertNotIn(evicted, data)
            restarted = self.stream()
            restored = restarted.snapshot("main", entries, auto_translate=True)["entries"]
            self.assertEqual(restored[-1]["translation"], "测试")
            self.assertTrue(restored[-1]["cached"])
            self.assertEqual(send.call_count, 1)


    def test_two_server_instances_share_completed_results_for_inflight_requests(self):
        first, second = self.stream(), self.stream()
        gate = threading.Event()
        started = threading.Event()
        self.addCleanup(gate.set)
        entries = [entry(16)]

        def translate(*_):
            started.set()
            self.assertTrue(gate.wait(3))
            return "只翻译一次"

        with patch.object(self.translator, "send", side_effect=translate) as send:
            first.snapshot("one", entries, auto_translate=True)
            self.assertTrue(started.wait(2))
            second.snapshot("two", entries, auto_translate=True)
            gate.set()
            poll(lambda: second.snapshot("two", entries, auto_translate=True), lambda data: data["entries"][0]["status"] == "translated")
            self.assertEqual(send.call_count, 1)

    def test_disabled_unconfigured_and_failure_requires_explicit_retry(self):
        stream = self.stream()
        sample = entry(9)
        self.store.save_prefs({"translation": {"preset": "deepseek-chat"}})
        self.assertEqual(stream.snapshot("x", [sample], auto_translate=False)["entries"][0]["status"], "pending")
        self.assertEqual(stream.snapshot("x", [sample], auto_translate=True)["entries"][0]["status"], "unconfigured")
        secret = "mock-secret-abcdef"
        self.translator.keys.set("deepseek-chat", secret)

        with patch.object(self.translator, "send", side_effect=[ValueError("failed " + secret), "已译", "强制更新"]) as send:
            snapshot = lambda: stream.snapshot("x", [sample], auto_translate=True)
            snapshot()
            failed = poll(snapshot, lambda data: data["entries"][0]["status"] == "error")["entries"][0]
            self.assertNotIn(secret, failed["error"])
            self.assertEqual(snapshot()["entries"][0]["status"], "error")
            self.assertEqual(send.call_count, 1)
            self.assertEqual(stream.retry(sample["hash"], sample)["status"], "translating")
            poll(snapshot, lambda data: data["entries"][0]["translation"] == "已译")
            stream.retry(sample["hash"], sample)
            poll(snapshot, lambda data: data["entries"][0]["translation"] == "强制更新")
            self.assertEqual(send.call_count, 3)

    def test_default_is_offline_and_cache_distinguishes_custom_urls(self):
        stream = self.stream()
        sample = entry(18)
        with patch.object(self.translator, "credentials", side_effect=AssertionError("offline")), \
                patch.object(self.translator, "send", side_effect=AssertionError("offline")):
            self.assertEqual(stream.snapshot("x", [sample])["entries"][0]["status"], "pending")
        one = {"model": "same", "base_url": "https://api.example/a"}
        two = {"model": "same", "base_url": "https://api.example/b"}
        self.assertNotEqual(stream.cache_key("custom", one, sample), stream.cache_key("custom", two, sample))

    def test_parallel_explicit_refresh_of_same_cached_revision_is_charged_once(self):
        first, second = self.stream(), self.stream()
        sample = entry(27)
        cache_key = first.cache_key(*self.translator.config(), sample)
        first.disk_cache(write=(cache_key, {"translation": "earlier", "latency_ms": 1}))
        go, started = threading.Event(), threading.Event()
        self.addCleanup(go.set)

        def reply(*_):
            started.set()
            self.assertTrue(go.wait(3))
            return "updated"

        with patch.object(self.translator, "send", side_effect=reply) as send:
            first.retry(sample["hash"], sample)
            self.assertTrue(started.wait(2))
            second.retry(sample["hash"], sample)
            go.set()
            poll(lambda: second.snapshot("two", [sample]), lambda data: data["entries"][0]["translation"] == "updated")
            self.assertEqual(send.call_count, 1)
