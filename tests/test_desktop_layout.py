"""Exercise the desktop adapter against the locally installed upstream distribution."""
import base64
import hashlib
import io
import os
from html.parser import HTMLParser
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
import zipfile

from scripts import desktop_layout

ROOT = Path(__file__).resolve().parents[1]
BUILD = runpy.run_path(str(ROOT / "scripts/build-host-bundle.py"))
SOURCE = Path(os.environ.get("MODELDESK_TEST_HOST", BUILD["DEFAULT_SOURCE"]))
if not SOURCE.is_file():
    SOURCE = BUILD["INSTALLED_DESKTOP_SOURCE"]


class Tags(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.tags = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


class DesktopLayoutTests(unittest.TestCase):
    @unittest.skipUnless(SOURCE.is_file() and Path("/Applications/Google Chrome.app").is_dir(), "needs the local desktop UI and Chromium")
    def test_full_host_entry_initializes_on_cold_load(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            with zipfile.ZipFile(io.BytesIO(BUILD["original_bundle"](SOURCE))) as web:
                main = desktop_layout.integrate(web.read("main.js"), ROOT / "ui/host")
            (path / "main.js").write_bytes(main)
            page = path / "index.html"
            page.write_text("""<!doctype html><meta charset="utf-8">
                <meta http-equiv="Content-Security-Policy" content="connect-src 'none'; frame-src 'none'; img-src data:">
                <div id="root"></div><output id="boot"></output>
                <script>window.addEventListener('error', event => {
                    if (event.message) document.getElementById('boot').textContent = 'error';
                });</script><script src="main.js"></script>
                <script>const boot = document.getElementById('boot');
                if (!boot.textContent && window.ModelDeskInlineThoughts && window.ModelDeskLocale?.chrome('Overview') === '概览')
                    boot.textContent = 'ready';</script>""")
            app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            run = subprocess.run([app, "--headless", "--no-first-run", "--disable-background-networking",
                                  f"--user-data-dir={path / 'profile'}", "--virtual-time-budget=500", "--dump-dom",
                                  page.as_uri()], capture_output=True, text=True, check=True, timeout=25)
            self.assertIn('<output id="boot">ready</output>', run.stdout)

    @unittest.skipUnless(Path("/Applications/Google Chrome.app").is_dir(), "needs local Chromium")
    def test_chinese_display_after_rerender_preserves_editable_and_user_supplied_text(self):
        assets = ROOT / "ui/host"
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            (path / "locale.js").write_text(desktop_layout.locale_script(assets))
            page = path / "fixture.html"
            page.write_text('''<!doctype html><meta charset="utf-8"><script defer src="locale.js"></script>
                <div data-md-settings><button id="page">General</button><code>General</code>
                <input value="General"><span class="md-user-label">General</span></div>
                <div data-testid="agent-input-box"><div contenteditable="true" aria-label="Message input">Settings</div></div>
                <div data-testid="agent-response"><p>General</p></div><output id="result"></output>
                <script>addEventListener('load',async () => {
                  const button = document.querySelector('#page');
                  const initial = button.textContent;
                  button.firstChild.data = 'Appearance';
                  await new Promise(resolve => setTimeout(resolve, 20));
                  const preserved = [...document.querySelectorAll('code,.md-user-label,[data-testid="agent-response"] p')]
                    .every(node => node.textContent === 'General');
                  const editor = document.querySelector('[contenteditable]');
                  const greetings = ModelDeskChineseGreeting;
                  const passed = initial === '常规' && button.textContent === '外观' && preserved &&
                    document.querySelector('input').value === 'General' && editor.textContent === 'Settings' &&
                    editor.getAttribute('aria-label') === 'Message input' && ModelDeskLocale.ago('11m') === '11 分钟前' &&
                    greetings.home('Welcome back, Ada. Where should we pick up?').includes('Ada') &&
                    greetings.chat('Hello! How can I help you today?') === '你好！今天有什么可以帮你的吗？' &&
                    greetings.chat('hello.py') === null;
                  document.querySelector('output').textContent = passed ? 'passed' : 'failed';
                })</script>''')
            app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            run = subprocess.run([app, "--headless", "--no-first-run", "--disable-background-networking",
                                  f"--user-data-dir={path / 'profile'}", "--virtual-time-budget=1000", "--dump-dom",
                                  page.as_uri()], capture_output=True, text=True, check=True, timeout=25)
            self.assertIn('<output id="result">passed</output>', run.stdout)

    @unittest.skipUnless(SOURCE.is_file(), "needs installed Antigravity desktop UI")
    def test_signed_assets_bind_home_chat_composer_and_filter_only_the_workbench(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "site.zip"
            BUILD["build"](SOURCE, out, desktop=desktop_layout)
            with zipfile.ZipFile(out) as web:
                main = web.read("main.js").decode()
                tags = Tags(web.read("index.html").decode()).tags
                entries = [tag for name, tag in tags if name == "script" and tag.get("src") == "/main.js"]
                digest = base64.b64encode(hashlib.sha384(main.encode()).digest()).decode()
                self.assertEqual([entry["integrity"] for entry in entries], ["sha384-" + digest])
                self.assertEqual(main.count('E.createElement(ModelDeskNativeSurface,{mode:"home"})'), 2)
                self.assertEqual(main.count('key:a,mode:"chat",conversationId:a'), 1)
                self.assertEqual(main.count('"data-md-usage":""'), 1)
                self.assertIn('view.key!=="mcp-app/modeldesk-workbench_modeldesk_workbench/open_workbench"', main)
                self.assertIn('mdDock=modelDeskOverviewDock(mdSlot,c,b?.breakpoint)', main)
                modern = desktop_layout.modern_layout(main)
                visible, breakpoint = ('B', 'C') if modern else ('C', 'B')
                self.assertIn(f'H={visible}&&!mdDock&&{breakpoint}==="medium",I={visible}&&!mdDock&&{breakpoint}==="large"', main)
                self.assertIn('.mounted&&modelDeskPlaceOverview(mdDock,E.createElement(', main)
                toggle = 'O=q===!0,P=b==="dropdown"?F:n==="small"?D:O' if modern else 'R=q===!0,O=b==="dropdown"?G:n==="small"?D:R'
                self.assertIn(toggle, main)
                expected_thought = 'source:a,step:$X(c),markdown:g,animate:m' if modern else 'source:q,step:KY(c),markdown:g,animate:t&&m'
                self.assertIn('E.createElement(ModelDeskInlineThought,{'+expected_thought+'})', main)
                self.assertNotIn('b.payload.overviewPanelOpen&&(a.overviewPanelOpen=', main)
                self.assertIn('label:window.ModelDeskLocale.chrome("Review"),detail:', main)
                self.assertIn('sectionId:"backgroundTasks",title:window.ModelDeskLocale.chrome("Background Tasks")', main)
                addon = next(attrs["src"] for tag, attrs in tags if tag == 'script'
                             and attrs.get("src", "").startswith("/modeldesk-host/"))
                js = web.read(addon.lstrip("/")).decode()
                for api in ("window.ModelDeskCreateOffice", "window.ModelDeskWorkshop",
                            "window.ModelDeskInsights", "window.ModelDeskNativeLayout"):
                    self.assertIn(api, js)
