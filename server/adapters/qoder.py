import hashlib
import json
from pathlib import Path
import sys

from .base import CLIAdapter, valid_session


def recovery_guard(task, session):
    guard = task.get("recovery_guard") or {}
    actual = request_identity(task, session)
    if not valid_session(session) or guard != actual:
        raise ValueError("Qoder 原会话与原任务请求不一致，请核对中断现场")


def request_identity(task, session):
    fields = [task.get(key) for key in ("id", "engine", "cwd", "prompt", "model", "transport", "write")]
    return {"session_id": session,
            "request_sha256": hashlib.sha256(json.dumps(fields, ensure_ascii=False).encode()).hexdigest()}


class Qoder(CLIAdapter):
    id = "qoder"
    commands = ("qoderclicn", "qoder")
    candidates = (Path.home() / ".local/bin/qoderclicn",)

    def probe(self):
        status = super().probe()
        credential_dir = Path.home() / ".qoder-cn/.auth"
        try:
            if status.ready and any(p.name not in {".credential-transaction", "machine_id"} and
                                    p.is_file() and p.stat().st_size for p in credential_dir.iterdir()):
                status.login = "credential_present"
        except OSError:
            pass
        return status

    def argv(self, task, prompt, session):
        executable = self.required_executable()
        if session:
            recovery_guard(task, session)
        if task.get("transport") == "acp":
            return [sys.executable, str(Path(__file__).with_name("qoder_acp.py")),
                    executable, task["cwd"], session or "", task.get("model") or "", prompt]
        argv = [executable, "-w", task["cwd"], "--output-format", "stream-json", "-p"]
        if task.get("model"):
            argv += ["--model", task["model"]]
        if session:
            argv += ["--resume", session]
        if not task["write"]:
            argv += ["--tools", "", "--strict-mcp-config", "--setting-sources", ""]
        return [*argv, "--", prompt]

    def event(self, line):
        item, _ = super().event(line)
        session = item.get("session_id") if item.get("type") in {"system", "result", "session"} else None
        return item, session
