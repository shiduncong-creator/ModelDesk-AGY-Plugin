from http.client import HTTPMessage
import io
import json
from pathlib import Path
import subprocess
from urllib.error import HTTPError
import unittest
from unittest.mock import patch

from server.main import create_server
from server.storage import Store
from server.translator import KeyStore, PRESETS, Translator, chat_endpoint, complete

from .support import register, sandbox


MOCK_KEY = "sk-offline-testing-wxyz"


class MockChat:
    def __init__(self):
        self.requests = []
        self.payloads = []

    def open(self, request, timeout):
        self.requests.append(request)
        payload = json.loads(request.data)
        self.payloads.append(payload)
        content = payload["messages"][-1]["content"]
        answer = content.replace("Hello", "你好").replace("English", "英文").replace("中文", "Chinese")
        return io.BytesIO(json.dumps({"choices": [{"message": {"content": answer}}]}).encode())


class TranslatorTest(unittest.TestCase):
    def setUp(self):
        self.root = self.enterContext(sandbox())
        self.store = Store(self.root / "data")
        self.translator = Translator(self.store)
        self.translator.keys.security = Path("/not-installed/keychain")
        self.translator.keys.set("gpt-6-luna", MOCK_KEY)
        self.mock = MockChat()
        self.enterContext(patch("server.translator.build_opener", return_value=self.mock))

    def test_model_presets_request_contract_and_bilingual(self):
        source = "# Hello\n\nHello `module_var`\n\n```js\nconst a = 'Hello'\n```\n"
        result = self.translator.translate(source)
        self.assertEqual(result["target"], "zh")
        self.assertEqual(result["model"], "gpt-6-luna")
        self.assertIn("你好 `module_var`", result["translation"])
        self.assertIn("```js\nconst a = 'Hello'\n```", result["translation"])
        self.assertIn("Hello `module_var`\n\n你好 `module_var`", result["bilingual"])
        self.assertEqual(len(self.mock.requests), 2)
        self.assertEqual(set(PRESETS),
                         {"gpt-6-luna", "gemini-2.5-flash-lite", "qwen-flash", "deepseek-chat", "ollama", "custom"})
        for request, data in zip(self.mock.requests, self.mock.payloads):
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(request.full_url, "https://api.openai.com/v1/chat/completions")
            self.assertEqual(request.get_header("Authorization"), "Bearer " + MOCK_KEY)
            self.assertEqual(data["model"], "gpt-6-luna")
            self.assertNotIn("const a", data["messages"][-1]["content"])
        self.assertEqual((self.store.root / "secrets.json").stat().st_mode & 0o777, 0o600)
        self.assertNotIn(MOCK_KEY, json.dumps(self.translator.status()))
        self.assertTrue(self.translator.status()["api_key_mask"].endswith("wxyz"))

    def test_auto_translation_of_chinese_keeps_code_exact(self):
        result = self.translator.translate("中文 `some_identifier` 和 apiToken、input_path\n")
        self.assertEqual(result["target"], "en")
        self.assertEqual(result["translation"], "Chinese `some_identifier` 和 apiToken、input_path\n")
        self.assertNotIn("apiToken", self.mock.payloads[0]["messages"][-1]["content"])
        self.assertNotIn("input_path", self.mock.payloads[0]["messages"][-1]["content"])

    def test_long_text_concurrent_chunks_in_original_order(self):
        source = "".join(f"段落 {index} " + "字" * 1800 + "\n\n" for index in range(5))
        result = self.translator.translate(source, target="en")
        self.assertEqual(result["chunks"], 5)
        self.assertEqual(result["translation"], source)
        self.assertEqual(len(self.mock.requests), 5)

    def test_provider_error_body_and_echo_cannot_expose_key(self):
        self.mock.open = lambda *_args, **_kwargs: io.BytesIO(
            json.dumps({"choices": [{"message": {"content": "echo: " + MOCK_KEY}}]}).encode())
        result = self.translator.translate("Hello")
        self.assertNotIn(MOCK_KEY, json.dumps(result))
        self.assertIn("[已脱敏]", result["translation"])

        def fail(request, timeout):
            raise HTTPError(request.full_url, 401, MOCK_KEY, HTTPMessage(), io.BytesIO(MOCK_KEY.encode()))

        self.mock.open = fail
        with self.assertRaises(ValueError) as caught:
            self.translator.translate("Hello")
        self.assertIn("401", str(caught.exception))
        self.assertNotIn(MOCK_KEY, str(caught.exception))

    def test_custom_endpoint_and_redirect_protection(self):
        self.assertEqual(chat_endpoint("http://127.0.0.1:8031/v1/"), "http://127.0.0.1:8031/v1/chat/completions")
        for value in ("file:///etc", "http://external.invalid/v1", "https://secret@example.com",
                      "https://example.com/v1?api_key=secret"):
            with self.assertRaises(ValueError):
                chat_endpoint(value)
        self.assertEqual(complete("https://custom.example/v1", "custom-engine", MOCK_KEY, [
            {"role": "user", "content": "Hello"},
        ]), "你好")
        from server.translator import RejectRedirects
        self.assertIsNone(RejectRedirects().redirect_request(None, None, 302, None, None, "https://elsewhere.invalid"))

    def test_ollama_keyless_is_strictly_loopback(self):
        for base in ("http://localhost:11434/v1", "http://127.0.0.1:11434/v1", "http://[::1]:11434/v1"):
            self.store.save_prefs({"translation_ollama": {"base_url": base}})
            self.assertEqual(self.translator.translate("Hello", preset="ollama")["translation"], "你好")
            self.assertIsNone(self.mock.requests[-1].get_header("Authorization"))
        for base in ("https://localhost.example/v1", "https://localhost./v1", "https://127.0.0.2/v1",
                     "https://example.com/v1"):
            self.store.save_prefs({"translation_ollama": {"base_url": base}})
            with self.assertRaisesRegex(ValueError, "API Key"):
                self.translator.translate("Hello", preset="ollama")
        self.assertEqual(len(self.mock.requests), 3)
        self.translator.keys.set("ollama", MOCK_KEY)
        self.translator.translate("Hello", preset="ollama")
        self.assertEqual(self.mock.requests[-1].get_header("Authorization"), "Bearer " + MOCK_KEY)

    def test_probe_is_short_redirect_free_and_redacts_failures(self):
        probe = self.translator.test_connection()
        self.assertTrue(probe["ok"])
        self.assertGreaterEqual(probe["latency_ms"], 0)
        self.assertEqual(self.mock.payloads[0]["max_completion_tokens"], 128)
        self.assertNotIn("max_tokens", self.mock.payloads[0])
        self.assertTrue(self.translator.test_connection("ollama")["ok"])
        self.assertIn("max_tokens", self.mock.payloads[-1])
        self.assertNotIn("max_completion_tokens", self.mock.payloads[-1])
        original = self.mock.open

        def timeout(request, timeout):
            self.assertEqual(timeout, 20)
            raise TimeoutError(MOCK_KEY)

        self.mock.open = timeout
        probe = self.translator.test_connection()
        self.assertFalse(probe["ok"])
        self.assertIn("超时", probe["error"])
        self.assertNotIn(MOCK_KEY, str(probe))
        self.mock.open = original
        self.assertFalse(self.translator.test_connection("custom")["ok"])

    def test_bad_request_reports_only_known_field_names(self):
        def reject(field):
            def fail(request, timeout):
                body = json.dumps({"error": {"code": "unsupported_parameter", "param": field,
                                             "message": "Secret " + MOCK_KEY}}).encode()
                raise HTTPError(request.full_url, 400, "bad request", HTTPMessage(), io.BytesIO(body))
            self.mock.open = fail
            return self.translator.test_connection()["error"]
        self.assertIn("不支持请求参数 max_tokens", reject("max_tokens"))
        self.assertNotIn(MOCK_KEY, reject("max_tokens"))
        self.assertEqual(reject(MOCK_KEY), "API 请求失败（HTTP 400），服务端拒绝了请求参数")

    def test_keychain_prefers_security_and_never_uses_key_argument(self):
        keychain = KeyStore(self.store)
        # Delete only the mock file entries, without contacting the real Keychain.
        self.translator.keys.set("gpt-6-luna", "")
        calls = []
        saved = {}

        def fake(command, text=None):
            calls.append((command, text))
            if command == ["-i"]:
                saved["key"] = text.split()[-1]
            if command[0] == "delete-generic-password":
                saved.clear()
            return subprocess.CompletedProcess(command, 0, stdout=saved.get("key", ""), stderr="")

        with patch.object(keychain, "invoke", side_effect=fake):
            keychain.set("gpt-6-luna", MOCK_KEY)
            self.assertEqual(keychain.get("gpt-6-luna"), MOCK_KEY)
            self.assertNotIn(MOCK_KEY, (self.store.root / "secrets.json").read_text())
            keychain.set("gpt-6-luna", "")
            self.assertEqual(keychain.get("gpt-6-luna"), "")
        self.assertNotIn(MOCK_KEY, repr([command for command, _ in calls]))


class TranslationToolsTest(unittest.IsolatedAsyncioTestCase):
    async def test_mcp_app_secret_redaction_and_safe_file_save(self):
        with sandbox() as root, patch.object(KeyStore, "invoke", return_value=None), \
                patch("server.translator.build_opener", return_value=MockChat()):
            workspace = root / "project"
            workspace.mkdir()
            path = workspace / "guide.md"
            path.write_text("Hello English")
            store = Store(root / "data")
            register(store, workspace)
            server = create_server(store.root)
            saved = await server.call_tool("app_save_prefs", {"patch": {"translation": {"preset": "gpt-6-luna"}},
                                                               "key_preset": "gpt-6-luna", "api_key": MOCK_KEY})
            self.assertNotIn(MOCK_KEY, saved.model_dump_json())
            self.assertNotIn(MOCK_KEY, (store.root / "prefs.json").read_text())
            status = await server.call_tool("app_dashboard", {"settings": True})
            self.assertNotIn(MOCK_KEY, status.model_dump_json())
            translated = await server.call_tool("app_translate", {"path": str(path), "save": True})
            self.assertEqual(translated.structuredContent["saved_path"], str(workspace / "guide.zh.md"))
            self.assertIn("Hello English", (workspace / "guide.zh.md").read_text())
            self.assertIn("你好 英文", (workspace / "guide.zh.md").read_text())
            visible = await server.call_tool("translate_text", {"path": str(path)})
            self.assertEqual(visible.content[0].text, "你好 英文")
            self.assertNotIn("Hello English", visible.model_dump_json())

    async def test_file_translation_can_save_displayed_result_without_a_second_api_call(self):
        chat = MockChat()
        with sandbox() as root, patch.object(KeyStore, "invoke", return_value=None), \
                patch("server.translator.build_opener", return_value=chat):
            project = root / "project"
            project.mkdir()
            path = project / "guide.md"
            path.write_text("Hello")
            store = Store(root / "data")
            register(store, project)
            server = create_server(store.root)
            await server.call_tool("app_save_prefs", {"patch": {"translation": {"preset": "ollama"}}})
            shown = await server.call_tool("app_translate", {"path": str(path)})
            args = {"path": str(path), "save": True, "save_format": "translation",
                    "save_token": shown.structuredContent["save_token"]}
            path.write_text("changed")
            with self.assertRaisesRegex(Exception, "原文已变更"):
                await server.call_tool("app_translate", args)
            path.write_text("Hello")
            saved = await server.call_tool("app_translate", args)
            self.assertEqual(Path(saved.structuredContent["saved_path"]).read_text(), "你好")
            self.assertEqual(len(chat.requests), 1)
