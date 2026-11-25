"""Common adapter API for locally installed agents."""

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time

SESSION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")


def valid_session(value):
    return isinstance(value, str) and bool(SESSION_ID.fullmatch(value))


@dataclass
class AdapterStatus:
    id: str
    executable: str | None
    ready: bool
    version: str | None = None
    login: str = "unknown"
    detail: str = ""


@dataclass
class RunningHandle:
    process: subprocess.Popen

    @property
    def pid(self):
        return self.process.pid

    @property
    def pgid(self):
        return self.process.pid


def pid_identity(pid):
    if not isinstance(pid, int) or pid <= 1:
        return None
    try:
        result = subprocess.run(["ps", "-p", str(pid), "-o", "pgid=", "-o", "stat=", "-o", "lstart="],
                                capture_output=True, text=True, timeout=1, check=True)
        pgid, status, born = result.stdout.strip().split(maxsplit=2)
        return f"{pgid}:{born}" if int(pgid) == pid and not status.startswith("Z") else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def stop_group(pid, identity=None, process=None):
    if not pid or (process is None and (not identity or pid_identity(pid) != identity)):
        return False
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return False
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if process is not None:
            process.poll()
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            return True
        time.sleep(.05)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    if process is not None:
        process.wait(timeout=3)
    return True


class CLIAdapter:
    id = ""
    commands = ()
    candidates = ()

    def executable(self):
        for candidate in (*self.candidates, *(shutil.which(cmd) for cmd in self.commands)):
            if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
        return None

    def probe(self):
        executable = self.executable()
        if not executable:
            return AdapterStatus(self.id, None, False, detail=f"未找到 {self.id} CLI")
        try:
            result = subprocess.run([executable, "--version"], capture_output=True, text=True, timeout=3)
            version = re.search(r"\d+\.\d+\.\d+[-\w.]*", result.stdout + result.stderr)
            return AdapterStatus(self.id, executable, result.returncode == 0 or bool(version),
                                 version[0] if version else None)
        except (OSError, subprocess.SubprocessError):
            return AdapterStatus(self.id, executable, False, detail="CLI 探测超时或启动失败")

    def start(self, task_spec):
        return self.spawn(task_spec, task_spec["run_prompt"], None)

    def resume(self, task_record, follow_up_prompt):
        session = task_record.get("native_session_id")
        if not valid_session(session):
            raise ValueError("原生会话 ID 无效")
        return self.spawn(task_record, follow_up_prompt, session)

    def spawn(self, task, prompt, session):
        return RunningHandle(subprocess.Popen(
            self.argv(task, prompt, session), cwd=task["cwd"], start_new_session=True,
            env=self.environment(task), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        ))

    def environment(self, task):
        env = {k: v for k, v in os.environ.items() if k not in {"PLUGIN_DATA", "PLUGIN_ROOT"}}
        env["PATH"] = str(Path.home() / ".local/bin") + os.pathsep + env.get("PATH", os.defpath)
        return env

    def argv(self, task, prompt, session):
        raise NotImplementedError

    def required_executable(self):
        if not (executable := self.executable()):
            raise ValueError(f"{self.id} CLI 未安装")
        return executable

    def cancel(self, record, process=None):
        return stop_group(record.get("pid"), record.get("pid_identity"), process)

    def event(self, line):
        try:
            item = json.loads(line)
        except ValueError:
            return {}, None
        return (item, None) if isinstance(item, dict) else ({}, None)

    def events(self, task, lines):
        for line in lines:
            yield self.event(line)

    def declared_output(self, item):
        paths = item.get("changed_files", [])
        return [p for p in paths if isinstance(p, str)] if isinstance(paths, list) else []

    def outcome_error(self, item):
        return item.get("is_error") is True or item.get("type") in {"turn.failed", "error"}
