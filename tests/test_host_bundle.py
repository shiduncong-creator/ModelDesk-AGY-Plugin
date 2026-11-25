from io import BytesIO
from pathlib import Path
import runpy
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUILD = runpy.run_path(str(ROOT / "scripts/build-host-bundle.py"))


class HostBundleTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        self.assets = self.folder / "host"
        self.assets.mkdir()
        (self.assets / "theme.css").write_text(":root { color: #381; }")
        (self.assets / "menu.js").write_text("document.documentElement.dataset.menuReady = '1'")
        self.html = ('<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"></head>'
                     '<body><script type="module" src="/main.js" integrity="sha384-example"></script></body></html>')
        stream = BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for name in ("main.js", "compiled_tailwind.css", "jetbox.css", "font/one.woff2"):
                z.writestr(name, name)
            z.writestr("index.html", self.html)
        self.source = self.folder / "fake-binary"
        self.source.write_bytes(b"header" + stream.getvalue() + b"postscript")
        self.out = self.folder / "host-ui.zip"

    def test_preserves_entry_and_upstream_assets(self):
        BUILD["build"](self.source, self.out, self.assets)
        with zipfile.ZipFile(self.out) as z:
            self.assertEqual(z.read("font/one.woff2"), b"font/one.woff2")
            result = z.read("index.html").decode()
            self.assertIn('content="script-src \'self\'"', result)
            self.assertIn('type="module" src="/main.js" integrity="sha384-example"', result)
            additions = [n for n in z.namelist() if n.startswith("modeldesk-host/")]
            self.assertEqual(len(additions), 2)
            for name in additions:
                self.assertEqual(result.count("/" + name), 1)
            self.assertIsNone(z.testzip())
        before = self.out.stat().st_mtime_ns
        BUILD["build"](self.source, self.out, self.assets)
        self.assertEqual(before, self.out.stat().st_mtime_ns)
        with self.assertRaises(ValueError):
            BUILD["build"](self.out, self.folder / "double.zip", self.assets)

    def test_art_is_shipped_under_the_url_referenced_by_the_hashed_stylesheet(self):
        art = self.assets / "art"
        art.mkdir()
        png = b"\x89PNG\r\n\x1a\n" + b"test"
        (art / "valley-day.png").write_bytes(png)
        (self.assets / "theme.css").write_text('body { background-image: url("art/valley-day.png") }')
        BUILD["build"](self.source, self.out, self.assets)
        with zipfile.ZipFile(self.out) as bundle:
            css_name = next(n for n in bundle.namelist() if n.startswith("modeldesk-host/theme."))
            css = bundle.read(css_name).decode()
            relative_url = css.split('url("')[1].split('"')[0]
            self.assertNotEqual(relative_url, "art/valley-day.png")
            self.assertEqual(bundle.read("modeldesk-host/" + relative_url), png)

    def test_local_font_is_shipped_with_its_notice(self):
        art = self.assets / "art"
        art.mkdir()
        (art / "fusion-pixel.woff2").write_bytes(b"wOF2font")
        notice = art / "fusion-pixel-license.txt"
        notice.write_bytes(b"Copyright test")
        (self.assets / "theme.css").write_text('@font-face { src: url("art/fusion-pixel.woff2") }')
        BUILD["build"](self.source, self.out, self.assets)
        with zipfile.ZipFile(self.out) as bundle:
            name = next(n for n in bundle.namelist() if n.startswith("modeldesk-host/art/fusion-pixel."))
            self.assertEqual(bundle.read(name), b"wOF2font")
            self.assertEqual(bundle.read("modeldesk-host/art/" + notice.name), notice.read_bytes())

    def test_release_outputs_can_be_recreated_for_signature_verification(self):
        other = self.folder / "reconstructed.zip"
        BUILD["build"](self.source, self.out, self.assets, reproducible=True)
        BUILD["build"](self.source, other, self.assets, reproducible=True)
        self.assertEqual(self.out.read_bytes(), other.read_bytes())
        with zipfile.ZipFile(other) as bundle:
            self.assertTrue(all(entry.compress_type == zipfile.ZIP_STORED for entry in bundle.infolist()))
            assets = [entry for entry in bundle.infolist() if entry.filename.startswith("modeldesk-host/")]
            self.assertTrue(assets)
            self.assertTrue(all(entry.date_time == (1980, 1, 1, 0, 0, 0) for entry in assets))

    def test_unexpected_input_leaves_previous_bundle_intact(self):
        BUILD["build"](self.source, self.out, self.assets)
        current = self.out.read_bytes()
        self.source.write_bytes(b"binary with no web bundle")
        with self.assertRaises(ValueError):
            BUILD["build"](self.source, self.out, self.assets)
        self.assertEqual(self.out.read_bytes(), current)
