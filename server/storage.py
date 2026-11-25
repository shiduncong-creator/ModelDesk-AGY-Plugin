"""Private plugin data, cross-process locking and workspace trust boundaries."""

from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import tempfile
import time


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, allow_nan=False)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp, path)
    finally:
        Path(temp).unlink(missing_ok=True)


@contextmanager
def file_lock(path):
    with open(path, "a") as file:
        fcntl.flock(file, fcntl.LOCK_EX)
        yield


class Store:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.tasks = self.root / "tasks"
        self.tasks.mkdir(exist_ok=True, mode=0o700)

    def sessions(self):
        return read_json(self.root / "sessions.json", {}) or {}

    def session(self, conversation_id=None):
        state = self.sessions()
        return state.get("sessions", {}).get(conversation_id or state.get("active"), {})

    def prefs(self):
        return read_json(self.root / "prefs.json", {}) or {}

    def save_prefs(self, patch):
        with file_lock(self.root / "prefs.lock"):
            prefs = self.prefs()
            for key, value in patch.items():
                if key in {"office_scene", "translation", "translation_ollama"}:
                    prefs[key] = {**prefs.get(key, {}), **value}
                else:
                    prefs[key] = value
            atomic_json(self.root / "prefs.json", prefs)
        return prefs


def project_root(value):
    if not value or not Path(value).is_absolute():
        return None
    try:
        root = Path(value).resolve(strict=True)
    except (OSError, ValueError, RuntimeError):
        return None
    home = Path.home().resolve()
    protected = tuple(Path(p) for p in (
        "/System", "/Library", "/Applications", "/bin", "/sbin", "/usr", "/etc", "/private/etc",
        "/var", "/private/var/db", "/private/var/root", "/dev",
    )) + (home / "Library", home / ".ssh", home / ".gnupg")
    broad = {"/", "/private", "/users", "/volumes", str(home).casefold()}
    folded = str(root).casefold()
    if (not root.is_dir() or folded in broad or
            any(folded == str(p).casefold() or folded.startswith(str(p).casefold() + "/") for p in protected)):
        return None
    return root


class Scope:
    def __init__(self, session, private_root=None, *, strict_paths=False):
        self.session = session
        self.private_root = private_root
        self.strict_paths = strict_paths
        self.workspaces = self.roots(session.get("workspacePaths") or [])
        self.artifacts = self.roots([session.get("artifactDirectoryPath")])

    def roots(self, paths):
        return tuple(dict.fromkeys(root for path in paths if (root := project_root(path))))

    def resolve(self, value, *, workspace_only=False, exists=True, allow_root=False, direct=False):
        raw = Path(value)
        if ".." in raw.parts:
            raise ValueError("路径不能包含上级目录")
        if not raw.is_absolute():
            if len(self.workspaces) != 1:
                raise ValueError("请指定工作区内的绝对路径")
            raw = self.workspaces[0] / raw
        roots = self.workspaces if workspace_only else (*self.workspaces, *self.artifacts)
        try:
            path = raw.resolve(strict=exists)
        except (OSError, ValueError, RuntimeError):
            raise ValueError("路径不存在或无法解析") from None
        if (direct or self.strict_paths) and raw != path:
            raise ValueError("文件操作需要直接路径")
        for root in roots:
            if (raw.is_relative_to(root) and path.is_relative_to(root) and
                    (allow_root or path != root) and not self._private(path, root) and not self._private(raw, root)):
                return path
        raise ValueError("路径不在当前会话可用的工作区或产物目录")

    def _private(self, path, root):
        if self.private_root and path.is_relative_to(self.private_root):
            return True
        return any(part in {".system_generated", ".git"} for part in path.relative_to(root).parts)


def updated(record, **changes):
    record.update(changes, updated_at=time.time())
    return record
