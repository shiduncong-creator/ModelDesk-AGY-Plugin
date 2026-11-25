import os
from pathlib import Path
import unittest
from unittest.mock import patch

from server.deliverables import Deliverables, TEXT_LIMIT
from server.storage import Store, atomic_json

from .support import git, register, sandbox


class DeliverablesTest(unittest.TestCase):
    def setUp(self):
        self.root = self.enterContext(sandbox())
        self.workspace = self.root / "project"
        self.artifact = self.root / "artifacts"
        self.workspace.mkdir()
        self.artifact.mkdir()
        self.store = Store(self.root / "data")
        register(self.store, self.workspace, self.artifact)
        self.files = Deliverables(self.store)
        self.document = self.workspace / "原文 #1.md"
        self.document.write_text("Hello\n", encoding="utf-8")

    def test_aggregation_includes_git_artifact_and_task_and_excludes_host_internal(self):
        git(self.workspace, "init", "-q")
        (self.artifact / "note.png").write_bytes(b"some image")
        (self.artifact / ".DS_Store").write_bytes(b"Finder metadata")
        (self.artifact / ".system_generated").mkdir()
        (self.artifact / ".system_generated/log.jsonl").write_text("internal")
        task = {"cwd": str(self.workspace), "engine": "qoder", "changed_files": [self.document.name]}
        rows = self.files.rows([task])
        by_name = {row["name"]: row for row in rows}
        self.assertEqual(set(by_name), {"note.png", self.document.name})
        self.assertEqual(by_name[self.document.name]["sources"], ["git", "qoder"])
        self.assertEqual(by_name[self.document.name]["git_status"], "??")
        self.assertEqual(len(self.files.rows([task], query="NOTE")), 1)

    def test_rejects_parent_traversal_outside_path_and_symlink_escape(self):
        outside = self.root / "private.md"
        outside.write_text("outside")
        alias = self.workspace / "alias"
        alias.symlink_to(outside)
        for value in ["../private.md", str(outside), str(alias), "/etc/passwd", "missing/../ok.txt"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.files.action("read_text", value)

    def test_current_session_delivery_orders_before_newer_unrelated_changes_and_filters_workspace(self):
        git(self.workspace, "init", "-q")
        other = self.root / "other"
        other.mkdir()
        git(other, "init", "-q")
        (other / "recent.txt").write_text("change in another project")
        (self.workspace / "unrelated.txt").write_text("unrelated change")
        os.utime(self.document, (10, 10))
        state = self.store.sessions()
        sid = state["active"]
        state["sessions"][sid]["workspacePaths"].append(str(other))
        atomic_json(self.store.root / "sessions.json", state)
        tasks = [{"cwd": str(self.workspace), "engine": "codex", "status": "review",
                  "conversation_id": sid, "changed_files": [self.document.name]}]
        rows = self.files.rows(tasks)
        self.assertEqual(rows[0]["name"], self.document.name)
        self.assertEqual(rows[0]["change"], "交付")
        self.assertEqual({row["name"]: row["change"] for row in rows[1:]},
                         {"unrelated.txt": "新增", "recent.txt": "新增"})
        self.assertEqual([row["name"] for row in self.files.rows(tasks, workspace=str(other))], ["recent.txt"])
        with self.assertRaises(ValueError):
            self.files.rows(tasks, workspace=str(self.root))

    def test_cross_root_alias_cannot_make_an_unregistered_target_look_local(self):
        alias = self.workspace / "alias"
        target = self.artifact / "note.txt"
        target.write_text("text")
        alias.symlink_to(target)
        with self.assertRaises(ValueError):
            self.files.action("info", str(alias))
        self.assertEqual(self.files.action("read_text", str(target))["text"], "text")

    def test_rejects_symlink_and_traversal_at_write_destinations(self):
        outside = self.root / "external"
        outside.mkdir()
        alias = self.workspace / "alias"
        alias.symlink_to(outside)
        for destination in (str(alias), "../external"):
            with self.assertRaises(ValueError):
                self.files.action("export_copy", self.document.name, destination=destination)
        for destination in ("../moved.md", "/moved.md", str(alias.name)):
            with self.assertRaises(ValueError):
                self.files.action("rename", self.document.name, destination=destination)
        self.assertEqual(list(outside.iterdir()), [])

    def test_rename_export_copy_and_clipboard_values(self):
        relative = self.files.action("copy_relative", self.document.name)
        self.assertEqual(relative["text"], self.document.name)
        self.assertIn("%20%231.md", self.files.action("copy_markdown", self.document.name)["text"])
        copied = self.files.action("export_copy", self.document.name, destination="exports/nested")
        self.assertEqual(Path(copied["path"]).read_bytes(), self.document.read_bytes())
        with self.assertRaises(ValueError):
            self.files.action("export_copy", self.document.name, destination="exports/nested")
        renamed = self.files.action("rename", self.document.name, destination="renamed.md")
        self.assertFalse(self.document.exists())
        self.assertEqual(Path(renamed["path"]).read_text(), "Hello\n")

    def test_finder_trash_requires_confirmation_and_uses_osascript(self):
        with patch.object(self.files, "desktop") as desktop:
            with self.assertRaises(ValueError):
                self.files.action("trash", self.document.name)
            desktop.assert_not_called()
            self.files.action("trash", self.document.name, confirmed=True)
            command = desktop.call_args.args[0]
            self.assertEqual(command[0], "/usr/bin/osascript")
            self.assertIn('application "Finder" to delete', command[2])
            self.assertEqual(command[-1], str(self.document))

    def test_preview_rejects_binary_or_oversized_and_allows_images(self):
        image = self.workspace / "local.png"
        image.write_bytes(b"\x89PNG\x00")
        self.assertEqual(self.files.action("read_preview", image.name)["mime"], "image/png")
        with self.assertRaises(ValueError):
            self.files.action("read_text", image.name)
        archive = self.workspace / "files.zip"
        archive.write_bytes(b"PK\0\1")
        fallback = self.files.action("read_preview", archive.name)
        self.assertEqual(fallback["file"]["name"], "files.zip")
        self.assertIn("二进制", fallback["preview_reason"])
        self.document.write_bytes(b"x" * TEXT_LIMIT)
        with self.assertRaises(ValueError):
            self.files.action("read_text", self.document.name)

    def test_git_diff_includes_modified_deleted_and_untracked_files(self):
        git(self.workspace, "init", "-q")
        git(self.workspace, "add", ".")
        git(self.workspace, "commit", "-qm", "initial")
        self.document.write_text("new line\n")
        self.assertIn("+new line", self.files.action("git_diff", self.document.name)["text"])
        self.document.unlink()
        self.assertIn("-Hello", self.files.action("git_diff", self.document.name)["text"])
        new = self.workspace / "new file"
        new.write_text("untracked\n")
        self.assertIn("+untracked", self.files.action("git_diff", new.name)["text"])
