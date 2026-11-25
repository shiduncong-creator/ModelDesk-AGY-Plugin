import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import unittest

from ui.build import build

from .support import ROOT

BASELINE_SHA256 = {
    "pixel-office-sprites.js": "c6f5bfcbe648b7f1b07ba06b5af5d8462a88cb54a6770aeb55625830099c1b6c",
    "pixel-office-scene.js": "54695c941893d612de792affaeb94ca76ffe6d5653ff50dde3bb4ae608e93eaa",
    "pixel-office-events.js": "901249e139cd17459607380fdea1fffa9101e253d3750e3c914d38f581d0742b",
    "pixel-office-motion.js": "7654ae6e064c07bf1b8c7cdc3baaa7e41441a575c7562465011b4ddb8edb1026",
    "pixel-office.css": "3f735d1f18db9f58faac04b4a261731b2f7aa2cecbfa747aae5271af773d6513",
}


class UITest(unittest.TestCase):
    def test_deterministic_python_build_and_intact_baseline_assets(self):
        limits = {"workbench.html": 1536 * 1024, "task-strip.html": 600 * 1024}
        files = {name: ROOT / "ui/dist" / name for name in limits}
        before = {name: path.read_bytes() for name, path in files.items()}
        self.assertEqual(build(), {name: len(data) for name, data in before.items()})
        for name, path in files.items():
            self.assertEqual(before[name], path.read_bytes())
            self.assertLess(len(before[name]), limits[name])
        self.assertEqual({name: hashlib.sha256((ROOT / "ui/src/office" / name).read_bytes()).hexdigest()
                          for name in BASELINE_SHA256}, BASELINE_SHA256)

    def test_iframe_host_bridge_contract(self):
        node = os.environ.get("MODELDESK_TEST_NODE") or shutil.which("node") or (
            "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node")
        self.assertTrue(Path(node).is_file(), "Set MODELDESK_TEST_NODE to a Node.js 20+ binary for the UI protocol tests.")
        completed = subprocess.run([node, "--test", "tests/ui_protocol.cjs"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        print("\n" + completed.stdout.strip())
