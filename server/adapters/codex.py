import subprocess

from .base import CLIAdapter


class Codex(CLIAdapter):
    id = "codex"
    commands = ("codex",)
    candidates = (
        "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
    )

    def probe(self):
        status = super().probe()
        if status.ready:
            try:
                result = subprocess.run([status.executable, "login", "status"],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
                status.login = "signed_in" if result.returncode == 0 else "unknown"
            except (OSError, subprocess.SubprocessError):
                pass
        return status

    def argv(self, task, prompt, session):
        sandbox = "workspace-write" if task["write"] else "read-only"
        argv = [self.required_executable(), "exec", "--json", "-C", task["cwd"], "-s", sandbox]
        if task.get("model"):
            argv += ["-m", task["model"]]
        if session:
            argv += ["resume", session]
        return [*argv, "--", prompt]

    def event(self, line):
        item, _ = super().event(line)
        session = item.get("thread_id") if item.get("type") == "thread.started" else None
        return item, session

    def declared_output(self, item):
        nested = item.get("item") or {}
        if isinstance(nested, dict) and nested.get("type") == "file_change":
            return [c["path"] for c in (nested.get("changes") or [])
                    if isinstance(c, dict) and isinstance(c.get("path"), str)]
        return super().declared_output(item)

    def outcome_error(self, item):
        return item.get("type") == "turn.failed" or item.get("is_error") is True
