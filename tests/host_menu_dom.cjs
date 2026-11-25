/* Run with node tests/host_menu_dom.cjs. Uses an isolated, headless Chromium profile. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function exercise() {
  const passed = [];
  const check = (label, actual) => { if (!actual) throw Error(label); passed.push(label); };
  const $ = s => document.querySelector(s);
  const menu = () => $('[data-modeldesk-host-menu]');
  const item = id => menu()?.querySelector('[data-modeldesk-action="' + id + '"]');
  const click = id => { const node = item(id); if (!node) throw Error('missing action: ' + id); node.click(); };
  const context = (target, init = {}) => target.dispatchEvent(new MouseEvent('contextmenu',
    { bubbles: true, cancelable: true, clientX: 2000, clientY: 2000, ...init }));
  const key = (target, key, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown',
    { bubbles: true, cancelable: true, key, ...init }));
  const fixture = document.querySelector('main');
  const editor = $('#draft'), tree = $('#row'), file = $('#line'), changed = $('#changed');
  let lastCopied;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async text => { lastCopied = text; }, readText: async () => '粘贴' } });
  let revealed;
  window.electronNative = {getPathForFile() { throw Error("unexpected file read"); }, revealInFilePicker: uri => { revealed = uri; }};
  let dropped;
  editor.addEventListener('drop', e => { e.preventDefault(); dropped = e.dataTransfer.getData('text/uri-list'); });
  let previewCount = 0;
  changed.addEventListener('click', () => previewCount++);
  tree.addEventListener('click', () => previewCount++);

  const original = context(file);
  check('capture real host-shaped file row', !original && item('copy-path') && item('attach-file'));
  const rect = menu().getBoundingClientRect();
  check('menu fits viewport', rect.right <= innerWidth && rect.bottom <= innerHeight);
  click('copy-path');
  check('decode local paths', lastCopied === '/tmp/A B.md');
  context(file);
  click('attach-file');
  check('attachment uses URI-list and draft consumes it', dropped === 'file:///tmp/A%20B.md');
  context(file);
  click('finder');
  check('native Finder receives local file URI', revealed === 'file:///tmp/A%20B.md');
  editor.textContent = '保留原草稿';
  for (const [id, engine] of [['review-codex', 'Codex'], ['review-qoder', 'Qoder CN']]) {
    context(file);
    click(id);
    check(engine + ' draft preserves prior text and never sends', editor.textContent.startsWith('保留原草稿') &&
      editor.textContent.includes(engine) && editor.textContent.includes('只读') &&
      editor.textContent.includes('"/tmp/A B.md"') && !editor.closest('form').dataset.sent);
  }
  editor.textContent = '';
  const actions = ['copy_relative', 'diff', 'translate', 'rename', 'trash'];
  context(file);
  check('no system document items without local host API', actions.every(action => !item('document-' + action)));
  key(menu(), 'Escape');
  const launches = [], links = [], BrowserURL = window.URL;
  window.electronNative.openExternal = uri => { launches.push(uri); };
  window.URL = class extends BrowserURL {
    constructor(...args) {
      super(...args);
      if (this.protocol === 'modeldesk-document:') links.push(this);
    }
  };
  const unusual = $('#unusual');
  for (const action of actions) {
    context(unusual);
    const expected = links.find(link => link.pathname === '/' + action);
    check(action + ' document route uses one exact absolute path', item('document-' + action) &&
      expected.host === 'file' && expected.searchParams.get('path') === '/tmp/A & + #稿.md' &&
      [...expected.searchParams.keys()].join(',') === 'path' && !expected.hash);
    click('document-' + action);
    check(action + ' synthetic click cannot launch external program', launches.length === 0);
  }
  context(unusual);
  item('document-trash').focus();
  key(document.activeElement, 'Enter');
  check('synthetic keyboard activation cannot launch document operation', launches.length === 0);
  context(changed);
  check('existing native diff takes precedence', item('preview') && !item('document-diff'));
  key(menu(), 'Escape');
  context(tree);
  check('bare filename cannot launch helper', actions.every(action => !item('document-' + action)));
  key(menu(), 'Escape');
  delete window.electronNative.getPathForFile;
  context(file);
  check('SSH host with external API and no-op Finder never operates on laptop paths',
    !item('finder') && actions.every(action => !item('document-' + action)));
  key(menu(), 'Escape');
  delete window.electronNative.openExternal;
  window.URL = BrowserURL;
  context(changed);
  click('copy-relative');
  check('copies exact host-computed relative path', lastCopied === 'docs/changed.txt');
  context(file);
  check('no relative path guessed for unrelated file', !item('copy-relative'));
  key(menu(), 'Escape');
  context(changed);
  click('preview');
  context(tree);
  check('tree file without path exposes preview only', item('preview') && !item('copy-path'));
  click('preview');
  check('file opens through existing host click', previewCount === 2);
  context($('#external'));
  check('nonlocal file URI rejected', !item('copy-path'));
  key(menu(), 'Escape');
  context($('#traversal'));
  check('path traversal rejected', !item('copy-path'));
  key(menu(), 'Escape');
  context($('#remoteLink'));
  check('web URL never opens as a local file', !item('preview') && !item('copy-path'));
  key(menu(), 'Escape');

  const input = $('#input');
  input.value = 'hello world';
  input.focus();
  input.setSelectionRange(0, 5);
  key(input, 'F10', { shiftKey: true });
  check('keyboard open and first item focused', menu()?.contains(document.activeElement) && item('cut'));
  key(document.activeElement, 'End');
  check('accessible End key', document.activeElement === item('native'));
  key(document.activeElement, 'Home');
  key(document.activeElement, 'Escape');
  check('Escape restores trigger focus', !menu() && document.activeElement === input);
  input.setSelectionRange(0, 5);
  context(input);
  click('cut');
  await new Promise(resolve => setTimeout(resolve, 0));
  check('cuts original target selection', lastCopied === 'hello' && input.value === ' world');
  input.setSelectionRange(0, 0);
  context(input);
  click('paste');
  await new Promise(resolve => setTimeout(resolve, 0));
  check('pastes into original target', input.value === '粘贴 world');
  const quote = $('#quote');
  const range = document.createRange();
  range.selectNodeContents(quote);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  context(quote);
  click('quote');
  check('selection quoted into message draft', editor.textContent.includes('> quoted example'));
  check('no send or form submission', document.querySelector('form').dataset.sent === undefined);

  check('Option preserves host native event', context(file, { altKey: true }) && !menu());
  context(fixture);
  click('native');
  check('explicit one-shot native fallback', context(fixture) && !menu() && !context(fixture) && menu());
  key(menu(), 'Escape');
  check('password keeps native actions', context($('#secret')) && !menu());
  context(fixture);
  check('background offers draft focus', item('focus-input'));
  click('focus-input');
  check('focus goes to explicit message editor', document.activeElement === editor);
  return passed;
}

const chrome = process.env.MODELDESK_TEST_CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium', '/usr/bin/google-chrome'].find(location => fs.existsSync(location));
if (!chrome) throw Error('Chromium binary required; set MODELDESK_TEST_CHROME.');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'modeldesk-menu-dom-'));
try {
  fs.copyFileSync(path.resolve(__dirname, '../ui/host/menu.js'), path.join(temp, 'menu.js'));
  const fixture = path.join(temp, 'fixture.html');
  fs.writeFileSync(fixture, `<!doctype html><meta charset="utf-8">
  <main data-testid="conversation-view" data-media-drop-scope="">
    <div id="line" data-file-uri="file:///tmp/A%20B.md#L2">line text</div>
    <div id="unusual" data-file-uri="file:///tmp/A%20%26%20%2B%20%23%E7%A8%BF.md">source</div>
    <div id="changed" data-testid="changed-file-row" data-file-uri="file:///tmp/docs/changed.txt" role="button"><span data-testid="file-title-name">changed.txt</span><div style="direction:rtl"><span style="direction:ltr">docs</span></div></div>
    <div id="row" role="treeitem"><i data-testid="file-tree-node-icon"></i>hello.txt</div>
    <div id="external" data-file-uri="file://remote/tmp/no.txt">external</div>
    <a href="https://example.org" id="remoteLink">web</a><p id="traversal" title="/tmp/../x">other</p>
    <p id="quote">quoted example</p><textarea id="input"></textarea><input id="secret" type="password">
    <form onsubmit="event.preventDefault(); this.dataset.sent='true'"><div id="draft" role="textbox" aria-label="Message input" data-lexical-editor="true" contenteditable="true"></div></form>
  </main><pre id="result"></pre><script src="menu.js"></script>
  <script>(${exercise})().then(passed => result.textContent = JSON.stringify({passed})).catch(e => result.textContent = JSON.stringify({error:e.message}));</script>`);
  const result = spawnSync(chrome, ['--headless', '--no-first-run', '--disable-default-apps', '--disable-extensions',
    '--disable-background-networking', '--user-data-dir=' + path.join(temp, 'profile'), '--dump-dom', pathToFileURL(fixture).href],
  { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const payload = result.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
  assert.ok(payload, 'Fixture failed to return its browser results.');
  const { passed, error } = JSON.parse(payload[1]);
  assert.ok(!error, error);
  console.log('Chromium DOM menu:', passed.length, 'checks passed.');
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
