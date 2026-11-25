import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "host-theme.py"
spec = importlib.util.spec_from_file_location("host_theme", SCRIPT)
host_theme = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host_theme)


class HostThemeTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.config = Path(folder.name) / "config.json"
        self.state = Path(folder.name) / "state"
        self.original = {"userSettings": {"themeMode": "THEME_MODE_INHERIT", "customThemeSeedsLight": {}}}
        self.config.write_text(json.dumps(self.original))
        self.config.chmod(0o640)

    def run_action(self, action):
        return host_theme.configure(action, self.config, self.state)

    def test_apply_both_palettes_then_restore_only_owned_keys(self):
        self.run_action("apply")
        cfg = json.loads(self.config.read_text())
        self.assertEqual(cfg["userSettings"]["customThemeSeedsLight"]["background"], "#F2E5C9")
        self.assertEqual(cfg["userSettings"]["customThemeSeedsDark"]["background"], "#191623")
        self.assertEqual(cfg["userSettings"]["themeMode"], "THEME_MODE_INHERIT")
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o640)
        backup = self.state / "previous.json"
        before = backup.read_bytes()
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        self.run_action("apply")
        self.assertEqual(backup.read_bytes(), before)

        cfg["userSettings"]["otherPreference"] = True
        self.config.write_text(json.dumps(cfg))
        self.run_action("restore")
        self.original["userSettings"]["otherPreference"] = True
        self.assertEqual(json.loads(self.config.read_text()), self.original)
        self.assertFalse(backup.exists())

    def test_restore_respects_a_palette_edited_in_appearance(self):
        self.run_action("apply")
        cfg = json.loads(self.config.read_text())
        cfg["userSettings"]["customThemeSeedsDark"]["primary"] = "#008080"
        self.config.write_text(json.dumps(cfg))
        with self.assertRaisesRegex(ValueError, "edited independently"):
            self.run_action("restore")
        self.assertEqual(json.loads(self.config.read_text()), cfg)
        self.assertTrue((self.state / "previous.json").exists())
