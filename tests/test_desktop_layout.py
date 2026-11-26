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
    def test_background_activity_stays_inside_reply_card(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            with zipfile.ZipFile(io.BytesIO(BUILD["original_bundle"](SOURCE))) as web:
                for name in ("jetbox.css", "compiled_tailwind.css"):
                    (path / name).write_bytes(web.read(name))
            theme = (ROOT / "ui/host/theme.css").as_uri()
            page = path / "activity.html"
            page.write_text(f'''<!doctype html><meta charset="utf-8">
                <link rel="stylesheet" href="jetbox.css">
                <link rel="stylesheet" href="compiled_tailwind.css">
                <link rel="stylesheet" href="{theme}">
                <div data-testid="conversation-view">
                  <div class="flex flex-col gap-0.5 w-full" data-turn-content="latest">
                    <div data-md-reply-card>
                    <div data-testid="agent-response">正在独立编译并验证修复。</div>
                    <fieldset aria-label="Response actions" class="min-w-0"><div>
                      <div class="flex flex-col px-2" data-testid="cascade-system-message-toolbar">
                        <button type="button" data-testid="idle-status-text"
                          class="flex items-center gap-1.5 text-muted-foreground min-w-0 max-w-full border-none bg-transparent outline-none text-left truncate self-start -mt-1 mb-1">
                          <span class="animate-shimmer-text truncate"><span class="shimmer-text-mask"><span class="shimmer-text-content">1 个后台任务正在运行</span></span></span>
                        </button>
                        <div class="-mx-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 pt-3"><button>复制</button></div>
                      </div>
                    </div></fieldset>
                    </div>
                  </div>
                </div>
                <output></output>
                <script>addEventListener("load", () => {{
                  const get = id => document.querySelector('[data-testid="' + id + '"]');
                  const view = get("conversation-view"), reply = get("agent-response");
                  const toolbar = get("cascade-system-message-toolbar"), status = get("idle-status-text");
                  const card = reply.closest("[data-md-reply-card]"), footer = status.closest("fieldset");
                  const actions = toolbar.querySelector(".flex-wrap");
                  let checks = 0;
                  for (const dark of [false, true]) {{
                    document.body.classList.toggle("dark", dark);
                    for (const width of [185, 360, 760]) {{
                      view.style.width = width + "px";
                      status.querySelector(".shimmer-text-content").textContent = width < 200
                        ? "18 个子代理和后台任务正在运行，2 个子代理受阻" : "1 个后台任务正在运行";
                      const box = status.getBoundingClientRect(), content = reply.getBoundingClientRect();
                      const frame = card.getBoundingClientRect(), buttons = actions.getBoundingClientRect();
                      if (box.top - content.bottom >= 12 && box.left === content.left
                        && box.right <= content.right && box.bottom < buttons.top && buttons.bottom < frame.bottom
                        && (width >= 200 || status.firstElementChild.getBoundingClientRect().height > 30)
                        && getComputedStyle(footer).borderTopWidth === "1px"
                        && getComputedStyle(card).backgroundColor !== "rgba(0, 0, 0, 0)"
                        && [reply, status, toolbar].every(node =>
                          getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)")) checks++;
                    }}
                  }}
                  status.focus();
                  if (document.activeElement === status && status.tabIndex === 0) checks++;
                  document.querySelector("output").textContent = checks + "/7";
                }});</script>''')
            app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            run = subprocess.run([app, "--headless", "--no-first-run", "--disable-background-networking",
                                  f"--user-data-dir={path / 'profile'}", "--virtual-time-budget=500", "--dump-dom",
                                  page.as_uri()], capture_output=True, text=True, check=True, timeout=25)
            self.assertIn('<output>7/7</output>', run.stdout)

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
                self.assertIn('{"data-md-reply-card":""},E.createElement("div",{"data-testid":"agent-response","data-quotable":"true"}', main)
                boundary = 'isLatest:a.isLatest&&xa}))),pa(ba)' if modern else 'isLatest:a.isLatest&&ua}))),Da(pa)'
                self.assertIn(boundary, main)
                addon = next(attrs["src"] for tag, attrs in tags if tag == 'script'
                             and attrs.get("src", "").startswith("/modeldesk-host/"))
                js = web.read(addon.lstrip("/")).decode()
                for api in ("window.ModelDeskCreateOffice", "window.ModelDeskWorkshop",
                            "window.ModelDeskInsights", "window.ModelDeskNativeLayout"):
                    self.assertIn(api, js)
