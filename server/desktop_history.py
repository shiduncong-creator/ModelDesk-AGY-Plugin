"""Bring missing local Antigravity desktop conversations into ModelDesk before its host starts."""
import ctypes
import errno
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile

from .storage import atomic_json, file_lock, read_json

UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", re.I)
CLONE = getattr(ctypes.CDLL(None, use_errno=True), "clonefile", None)


def copy_regular(src, dest):
    if CLONE and CLONE(os.fsencode(src), os.fsencode(dest), 0) == 0:
        return
    if CLONE and ctypes.get_errno() not in (errno.EXDEV, errno.ENOTSUP, errno.ENOSYS, errno.EINVAL):
        raise OSError(ctypes.get_errno(), "Cannot clone conversation file")
    shutil.copy2(src, dest, follow_symlinks=False)


def skip_links_and_special(folder, names):
    return [name for name in names if not (stat.S_ISREG(mode := os.lstat(Path(folder) / name).st_mode)
                                            or stat.S_ISDIR(mode))]


def version(path):
    try:
        s = path.lstat()
        if not stat.S_ISREG(s.st_mode):
            raise ValueError("Unexpected history file")
        return s.st_ino, s.st_size, s.st_mtime_ns
    except FileNotFoundError:
        return None


def stable_database(src, dest, conversation_id=None):
    # Take a filesystem snapshot without opening a SQLite writer or creating
    # -shm in the original account. Recover committed WAL pages in the copy.
    files = [src, Path(str(src) + "-wal"), Path(str(src) + "-journal")]
    before = list(map(version, files))
    for path, stamp in zip(files, before):
        if stamp:
            copy_regular(path, Path(str(dest) + path.name[len(src.name):]))
    if before != list(map(version, files)):
        raise ValueError("Source is changing")
    with sqlite3.connect(dest) as conn:
        conn.execute("PRAGMA journal_mode=DELETE").fetchone()
        if conversation_id and not conn.execute("SELECT 1 FROM trajectory_meta WHERE cascade_id=? LIMIT 1",
                                                (conversation_id,)).fetchone():
            raise ValueError("Source body belongs to a different conversation")
        if conn.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("Incomplete SQLite snapshot")


def import_missing(source, target):
    index = source / "conversation_summaries.db"
    if not index.is_file() or source.is_symlink() or target.is_symlink():
        return 0, 0
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    for folder in ("conversations", "brain", "annotations"):
        if (target / folder).is_symlink() or (source / folder).is_symlink():
            raise ValueError("Unexpected history directory")
        (target / folder).mkdir(mode=0o700, exist_ok=True)
    ledger = target / "modeldesk-imported-history.json"
    added = skipped = 0
    with file_lock(target / "modeldesk-imported-history.lock"):
        seen = set(read_json(ledger, []))
        candidates = {p.stem: p for p in (source / "conversations").glob("*.db")
                      if UUID.fullmatch(p.stem) and not p.is_symlink() and p.stem not in seen}
        if not candidates:
            return 0, 0
        with tempfile.TemporaryDirectory(dir=target, prefix=".history-") as tmp:
            stage = Path(tmp)
            stable_database(index, stage / "source.db")
            with sqlite3.connect(stage / "source.db") as db:
                db.row_factory = sqlite3.Row
                rows = {r["conversation_id"]: r for r in db.execute("SELECT * FROM conversation_summaries")}
                # A live conversation can retain archived search chunks after compaction.
                archived = {r[0] for r in db.execute("SELECT conversation_id FROM conversations_fts "
                                                     "GROUP BY conversation_id HAVING MIN(archived)=1")}
                for sid, body in candidates.items():
                    row = rows.get(sid)
                    if not row or row["status"] not in ("", "CASCADE_RUN_STATUS_IDLE") or sid in archived:
                        continue
                    dest = target / "conversations" / body.name
                    if dest.exists() or dest.is_symlink():
                        seen.add(sid)
                        continue
                    parent = row["parent_conversation_id"]
                    chain = {sid}
                    while parent in rows and parent not in archived and parent not in chain:
                        chain.add(parent)
                        parent = rows[parent]["parent_conversation_id"]
                    if parent in archived or parent in chain:
                        continue
                    try:
                        with tempfile.TemporaryDirectory(dir=stage) as transaction:
                            work = Path(transaction)
                            stable_database(body, work / body.name, sid)
                            brain = source / "brain" / sid
                            if brain.is_dir() and not brain.is_symlink() and not os.path.lexists(target / "brain" / sid):
                                shutil.copytree(brain, work / "brain", copy_function=copy_regular, ignore=skip_links_and_special)
                                (work / "brain").rename(target / "brain" / sid)
                            note = source / "annotations" / (sid + ".pbtxt")
                            if note.is_file() and not note.is_symlink() and not os.path.lexists(target / "annotations" / note.name):
                                copy_regular(note, work / "annotation")
                                os.link(work / "annotation", target / "annotations" / note.name)
                            os.link(work / body.name, dest)
                        seen.add(sid)
                        atomic_json(ledger, sorted(seen))
                        added += 1
                    except (OSError, ValueError, sqlite3.Error):
                        skipped += 1
            atomic_json(ledger, sorted(seen))
    return added, skipped


if __name__ == "__main__":
    base = Path.home() / ".gemini"
    imported, deferred = import_missing(base / "antigravity", base / "antigravity-modeldesk")
    print(f"ModelDesk history: {imported} imported, {deferred} deferred", flush=True)
