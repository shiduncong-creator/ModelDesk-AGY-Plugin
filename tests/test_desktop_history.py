from pathlib import Path
import sqlite3
import tempfile
import unittest
from uuid import UUID

from server.desktop_history import import_missing


def ident(n):
    return str(UUID(int=n))


class HistoryTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.source = Path(tmp.name) / "antigravity"
        self.target = Path(tmp.name) / "antigravity-modeldesk"
        for name in ("conversations", "brain", "annotations"):
            (self.source / name).mkdir(parents=True)
        self.index = self.source / "conversation_summaries.db"
        with sqlite3.connect(self.index) as db:
            db.execute("create table conversation_summaries(conversation_id text, status text, parent_conversation_id text)")
            db.execute("create table conversations_fts(conversation_id text, archived integer)")

    def history(self, n, parent=None, archived=False, active=False):
        sid = ident(n)
        with sqlite3.connect(self.index) as db:
            db.execute("insert into conversation_summaries values(?,?,?)", (sid, "RUNNING" if active
                       else "CASCADE_RUN_STATUS_IDLE", ident(parent) if parent else ""))
            db.execute("insert into conversations_fts values(?,?)", (sid, int(archived)))
        with sqlite3.connect(self.body(n)) as db:
            db.execute("create table trajectory_meta(cascade_id text)")
            db.execute("insert into trajectory_meta values(?)", (sid,))
            db.execute("create table steps(message text)")
            db.execute("insert into steps values('first turn')")
        return sid

    def body(self, n, imported=False):
        return (self.target if imported else self.source) / "conversations" / (ident(n) + ".db")

    def run_import(self):
        return import_missing(self.source, self.target)

    def test_conversations_and_artifacts_are_independent_and_incremental(self):
        sid = self.history(1)
        self.history(2, archived=True)
        self.history(3, parent=2)
        self.history(4, active=True)
        self.history(5, parent=1)
        with sqlite3.connect(self.index) as db:
            db.execute("insert into conversations_fts values(?,1)", (sid,))
        brain = self.source / "brain" / sid
        brain.mkdir()
        (brain / "notes.md").write_text("original")
        (brain / "external").symlink_to(Path(__file__))
        (self.source / "annotations" / (sid + ".pbtxt")).write_text('title: "one"')
        self.assertEqual(self.run_import(), (2, 0))
        local = self.target / "brain" / sid
        self.assertEqual((local / "notes.md").read_text(), "original")
        self.assertFalse((local / "external").is_symlink())
        self.assertEqual((self.target / "annotations" / (sid + ".pbtxt")).read_text(), 'title: "one"')
        (local / "notes.md").write_text("my edit")
        self.assertEqual((brain / "notes.md").read_text(), "original")
        self.assertTrue(self.body(5, True).exists())
        for n in (2, 3, 4):
            self.assertFalse(self.body(n, True).exists())
        with sqlite3.connect(self.body(1, True)) as db:
            db.execute("insert into steps values('continued locally')")
        with sqlite3.connect(self.body(1)) as db:
            self.assertEqual(db.execute("select count(*) from steps").fetchone(), (1,))
        self.body(5, True).unlink()
        self.history(6)
        self.assertEqual(self.run_import(), (1, 0))
        self.assertFalse(self.body(5, True).exists())
        self.assertEqual(self.run_import(), (0, 0))

    def test_committed_wal_pages_and_existing_id_are_preserved(self):
        self.history(1)
        self.history(2)
        (self.target / "conversations").mkdir(parents=True)
        self.body(2, True).write_bytes(b"owned by ModelDesk")
        with sqlite3.connect(self.body(1)) as source:
            source.execute("pragma journal_mode=WAL")
            source.execute("pragma wal_autocheckpoint=0")
            source.execute("insert into steps values('committed in WAL')")
            source.commit()
            self.assertTrue(Path(str(self.body(1)) + "-wal").exists())
            self.assertEqual(self.run_import(), (1, 0))
        with sqlite3.connect(self.body(1, True)) as imported:
            self.assertEqual(imported.execute("select count(*) from steps").fetchone(), (2,))
        self.assertEqual(self.body(2, True).read_bytes(), b"owned by ModelDesk")

    def test_incomplete_file_is_retried_on_next_launch(self):
        self.history(1)
        good = self.body(1).read_bytes()
        self.body(1).write_bytes(b"incomplete database")
        self.assertEqual(self.run_import(), (0, 1))
        self.assertFalse(self.body(1, True).exists())
        self.body(1).write_bytes(b"")
        self.assertEqual(self.run_import(), (0, 1))
        self.body(1).write_bytes(good)
        self.assertEqual(self.run_import(), (1, 0))
