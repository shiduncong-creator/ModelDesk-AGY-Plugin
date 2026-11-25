import json
from pathlib import Path
import tempfile
import unittest

from server.host_menu import perform
from server.storage import Store, atomic_json


class HostMenuTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[1] / ".test-scratch"
        scratch.mkdir(exist_ok=True)
        temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.projects = self.root / "projects"
        self.projects.mkdir()
        self.project = self.root / "带 空格的项目"
        self.project.mkdir()
        self.file = self.project / "example.md"
        self.file.write_text("draft", encoding="utf-8")
        self.store = Store(self.root / "private")
        data = {"projectResources": {"resources": [{"folderUri": self.project.as_uri()}]}}
        (self.projects / "one.json").write_text(json.dumps(data))
        atomic_json(self.store.root / "sessions.json", {"active": "other", "sessions": {
            "other": {"workspacePaths": [str(self.projects)]}}})

    def action(self, action, path=None, **kwargs):
        return perform({"action": action, "path": str(path or self.file), **kwargs}, self.store, self.projects)

    def test_exact_path_across_projects(self):
        self.assertEqual(self.action("copy_relative")["text"], "example.md")
        self.assertEqual(self.action("info")["uri"], self.file.as_uri())

    def test_requires_registered_direct_path_and_confirmation(self):
        outside = self.root / "outside.txt"
        outside.touch()
        shortcut = self.project / "shortcut"
        shortcut.symlink_to(outside)
        for path in (outside, shortcut, Path("example.md")):
            with self.assertRaises(ValueError):
                self.action("info", path)
        with self.assertRaises(ValueError):
            self.action("rename", destination="changed.md")
        with self.assertRaises(ValueError):
            self.action("trash", confirmed="true")
        self.assertTrue(self.file.is_file())

    def test_explicit_rename_never_overwrites(self):
        other = self.project / "existing.md"
        other.write_text("keep")
        with self.assertRaises(ValueError):
            self.action("rename", destination=other.name, confirmed=True)
        self.assertEqual(other.read_text(), "keep")
        result = self.action("rename", destination="changed.md", confirmed=True)
        self.assertEqual(Path(result["path"]).read_text(), "draft")

    def test_artifact_has_no_invented_relative_path(self):
        artifact = self.root / "artifact"
        artifact.mkdir()
        file = artifact / "delivered.md"
        file.touch()
        atomic_json(self.store.root / "sessions.json", {"sessions": {"x": {"artifactDirectoryPath": str(artifact)}}})
        self.assertIsNone(self.action("info", file)["relative"])
        with self.assertRaises(ValueError):
            self.action("copy_relative", file)
