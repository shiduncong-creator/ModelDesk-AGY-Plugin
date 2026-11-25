"""Verify the 2.35 display bindings against the public, installed host bytes."""

from pathlib import Path
import io
import plistlib
import runpy
import subprocess
import tempfile
import unittest
import zipfile

from scripts.desktop_runtime235 import bind_runtime, runtime235


ROOT = Path(__file__).resolve().parents[1]
BUILD = runpy.run_path(str(ROOT / 'scripts/build-host-bundle.py'))
CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
SOURCE = BUILD['DEFAULT_SOURCE']


def is_235():
    info = SOURCE.parents[2] / 'Info.plist'
    if not SOURCE.is_file() or not info.is_file():
        return False
    return plistlib.loads(info.read_bytes())['CFBundleShortVersionString'].startswith('2.35.')


class RuntimeBindingsTests(unittest.TestCase):
    def test_lexical_boundaries_preserve_properties_and_longer_names(self):
        self.assertEqual(runtime235('YBc(); $ca(step); view.$ca(); testYBc(); zy.createPortal();'),
                         '$Gc(); ada(step); view.$ca(); testYBc(); hz.createPortal();')

    @unittest.skipUnless(is_235() and CHROME.is_file(), 'requires installed 2.35 and Chrome')
    def test_replay_in_upstream_react_and_state_selectors(self):
        with zipfile.ZipFile(io.BytesIO(BUILD['original_bundle'](SOURCE))) as web:
            upstream = web.read('main.js').decode()
        assets = ROOT / 'ui/host'
        snippets = '\n'.join((assets / name).read_text() for name in (
            'native-activity.js', 'native-slots.js', 'inline-thoughts.js'))
        # Associate the subscriptions with their declaring module, as in the desktop build.
        bound = bind_runtime(snippets, upstream)
        with self.assertRaisesRegex(ValueError, 'inline thought conversation'):
            bind_runtime(snippets, upstream.replace('return a?.conversationId}function lea', 'return null}function lea'))
        anchor = 'function bhc(a,b,c='
        self.assertEqual(upstream.count(anchor), 1)
        replay = (ROOT / 'tests/host_runtime235.js').read_text()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'main.js').write_text(upstream.replace(anchor, '\n'+bound+'\n'+replay+'\n'+anchor))
            page = path / 'index.html'
            page.write_text('''<!doctype html><meta charset="utf-8">
                <meta http-equiv="Content-Security-Policy" content="connect-src 'none'; frame-src 'none'; img-src data:">
                <div id="root"></div><div id="runtime-fixture"></div><output id="runtime-result"></output>
                <script src="main.js"></script>''')
            run = subprocess.run([str(CHROME), '--headless', '--no-first-run', '--disable-background-networking',
                                  '--disable-extensions', f'--user-data-dir={path / "profile"}',
                                  '--virtual-time-budget=1500', '--dump-dom', page.as_uri()],
                                 check=True, capture_output=True, timeout=30, text=True)
            outcome = run.stdout.partition('<output id="runtime-result">')[2].partition('</output>')[0]
            self.assertEqual(outcome, 'passed')
