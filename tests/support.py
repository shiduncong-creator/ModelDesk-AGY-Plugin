import contextlib
from pathlib import Path
import subprocess
import tempfile
import time

from server.storage import Store, atomic_json

ROOT = Path(__file__).resolve().parents[1]


@contextlib.contextmanager
def sandbox():
    parent = ROOT / ".test-scratch"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=parent) as folder:
        yield Path(folder).resolve()


def register(store, workspace, artifact=None, transcript=None, conversation="test-conversation"):
    row = {"conversationId": conversation, "workspacePaths": [str(workspace)], "modelName": "mock-model"}
    if artifact:
        row["artifactDirectoryPath"] = str(artifact)
    if transcript:
        row["transcriptPath"] = str(transcript)
    atomic_json(store.root / "sessions.json", {"active": conversation, "sessions": {conversation: row}})


def poll(callback, until, timeout=9):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = callback()
        if until(result):
            return result
        time.sleep(.05)
    raise AssertionError(f"Condition timed out. Last value: {result!r}")


def git(workspace, *args):
    return subprocess.check_output(["git", "-C", str(workspace), "-c", "user.name=ModelDesk test",
                                    "-c", "user.email=test@example.invalid", *args], stderr=subprocess.PIPE)


def fake_environment(folder):
    import os
    import sys

    target = folder / "gemini"
    target.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT}/tests/fake_cli.py" "$@"\n')
    target.chmod(0o700)
    return {"PATH": str(folder) + os.pathsep + os.environ.get("PATH", os.defpath)}
