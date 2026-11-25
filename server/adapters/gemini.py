from pathlib import Path
import os
import shutil
import subprocess
import sys

from .base import AdapterStatus, CLIAdapter


class Gemini(CLIAdapter):
    id = "gemini"
    commands = ("gemini",)
    candidates = (Path.home() / ".local/bin/gemini",)

    @staticmethod
    def agy():
        return shutil.which("agy") or (
            str(path) if (path := Path.home() / ".local/bin/agy").is_file() and os.access(path, os.X_OK) else None)

    def probe(self):
        status = super().probe()
        if status.ready:
            status.login = ("credential_present" if os.environ.get("GEMINI_API_KEY") or
                            (Path.home() / ".gemini/oauth_creds.json").is_file() else "unknown")
        elif executable := self.agy():
            status = AdapterStatus(self.id, executable, True, detail="未安装 @google/gemini-cli · 可使用 agy 或 Gemini API")
            try:
                result = subprocess.run([executable, "--version"], capture_output=True, text=True, timeout=3)
                status.version = result.stdout.strip().splitlines()[0][:80] if result.stdout.strip() else None
            except (OSError, subprocess.SubprocessError):
                pass
        else:
            status.detail = "未安装 @google/gemini-cli · 可配置 Gemini API"
        return status

    def selected_transport(self):
        return "cli" if self.executable() else "agy" if self.agy() else "api"

    def argv(self, task, prompt, session):
        transport = task["transport"]
        if transport == "api":
            if task["write"] or session:
                raise ValueError("Gemini API 适用于无工具的独立文本任务")
            return [sys.executable, "-m", "server.adapters.gemini", task["plugin_data"], task.get("model") or
                    "gemini-2.5-flash-lite", prompt]
        if transport == "agy":
            if not (executable := self.agy()):
                raise ValueError("未安装 agy")
            argv = [executable, "--output-format", "stream-json", "--disable-slash-commands"]
            if not task["write"]:
                argv += ["--mode", "plan"]
        else:
            executable = self.executable()
            if not executable:
                raise ValueError("未安装 @google/gemini-cli，请切换 agy 或 Gemini API")
            argv = [executable, "--output-format", "stream-json"]
            if not task["write"]:
                argv += ["--approval-mode", "plan"]
        if session:
            argv += ["--resume", session]
        if task.get("model"):
            argv += ["--model", task["model"]]
        return [*argv, "--print" if transport == "agy" else "-p", prompt]

    def environment(self, task):
        env = super().environment(task)
        if task["transport"] == "api":
            env["PYTHONPATH"] = str(Path(__file__).resolve().parents[2])
        return env

    def event(self, line):
        item, _ = super().event(line)
        data = item.get("result") or item.get("step_update") or item.get("data")
        session = item.get("session_id") or item.get("sessionId") or item.get("conversationId") or item.get("conversation_id")
        if not session and isinstance(data, dict):
            session = data.get("sessionId") or data.get("conversationId") or data.get("conversation_id")
        return item, session

    def events(self, task, lines):
        if task["transport"] != "cli":
            yield from super().events(task, lines)
            return
        # Gemini CLI's json mode can end with an indented result envelope.
        buffered = []
        size = 0
        for line in lines:
            if not buffered:
                item, session = self.event(line)
                if item:
                    yield item, session
                    continue
                if line.strip() != "{":
                    continue
            buffered.append(line)
            size += len(line)
            if size > 2 * 1024 * 1024:
                buffered, size = [], 0
            elif line.rstrip() == "}":
                item, session = self.event("".join(buffered))
                buffered, size = [], 0
                if item:
                    yield item, session

    def outcome_error(self, item):
        # Stream warnings and individual tool failures can precede a successful final turn.
        if item.get("type") == "tool_result" or (item.get("type") == "error" and item.get("severity") == "warning"):
            return False
        result = item.get("result") if item.get("event") == "result" else item
        result = result if isinstance(result, dict) else {}
        return super().outcome_error(item) or bool(result.get("error")) or str(result.get("status")).lower() == "error"


if __name__ == "__main__":
    from server.storage import Store
    from server.translator import GEMINI_API, PRESETS, KeyStore, complete
    data, model, prompt = sys.argv[1:]
    try:
        text = complete(PRESETS["gemini-2.5-flash-lite"]["base_url"], model, KeyStore(Store(data)).get(GEMINI_API),
                        [{"role": "user", "content": prompt}])
        print(text)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
