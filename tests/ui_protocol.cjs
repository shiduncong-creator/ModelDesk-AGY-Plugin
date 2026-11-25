'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync('ui/dist/workbench.html', 'utf8');
const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1]);
const source = scripts[0];
const strip = fs.readFileSync('ui/dist/task-strip.html', 'utf8');
const stripScripts = Array.from(strip.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1]);

function fixture(entrypoint = 'aux_pane', manualTools = false) {
  const frames = [];
  const origin = 'https://host.example';
  let listener;
  const parent = {
    postMessage(message, target) {
      frames.push({ ...message, target });
      const reply = (result, error) => emit({ id: message.id, ...(error ? { error } : { result }) });
      if (message.method === 'ui/initialize') {
        assert.equal(message.params.protocolVersion, '2026-01-26');
        assert.equal(message.params.appInfo.name, 'modeldesk-workbench');
        emit({ method: 'ui/notifications/tool-input', params: { arguments: { conversation_id: 'injected' } } });
        emit({ method: 'ui/notifications/tool-result', params: { structuredContent: { ready: true } } });
        reply({
          protocolVersion: '2026-01-26', hostCapabilities: { message: {}, updateModelContext: {} },
          hostContext: { theme: 'light', 'com.google.antigravity/ui': { entrypoint }, displayMode: 'inline' },
        });
      }
      if (message.method === 'tools/call' && !manualTools) reply({ content: [], structuredContent: { name: message.params.name } });
      if (['ui/message', 'ui/update-model-context', 'ping'].includes(message.method)) reply({});
      if (message.method === 'com.google.antigravity/toggle-aux-pane') {
        reply(null, { code: -32601, message: 'Method not found' });
      }
    },
  };
  const win = { parent, addEventListener(type, handler) { assert.equal(type, 'message'); listener = handler; } };
  function emit(data, from = parent, fromOrigin = origin) {
    listener({ source: from, origin: fromOrigin, data: { jsonrpc: '2.0', ...data } });
  }
  const context = vm.createContext({ window: win, setTimeout, clearTimeout, Error });
  vm.runInContext(source + '\nglobalThis.api = { WorkbenchHost, applyHostTheme, isGlobalView, previewInHost };', context);
  return { api: context.api, frames, emit, origin };
}

test('all inline scripts compile and the document has a restrictive CSP', () => {
  for (const [document, sources] of [[html, scripts], [strip, stripScripts]]) {
    for (const script of sources) new vm.Script(script);
    const sections = document.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(sections, /default-src 'none'/);
    assert.match(sections, /connect-src 'none'/);
    assert.match(sections, /img-src data: blob:/);
    assert.doesNotMatch(document, /<(?:script|link)\b[^>]*(?:src|href)=/);
    assert.doesNotMatch(document, /\b(?:localStorage|IndexedDB|fetch)\s*(?:\.|\()/);
  }
});

test('SEP-1865 handshake registers handlers before initialize, and dispatches bidirectionally', async () => {
  const { api, frames, emit, origin } = fixture();
  const host = new api.WorkbenchHost();
  const heard = [];
  host.on('ui/notifications/tool-result', data => heard.push(data.structuredContent.ready));
  host.on('ui/notifications/tool-input', data => heard.push(data.arguments.conversation_id));
  host.on('ui/notifications/host-context-changed', () => heard.push(host.getHostContext().theme));
  await host.connect();
  assert.deepEqual(heard, ['injected', true]);
  assert.equal(frames[0].target, '*');
  assert.equal(frames[1].method, 'ui/notifications/initialized');
  assert.equal(frames[1].target, origin);
  assert(Object.hasOwn(host.getHostCapabilities(), 'message'));
  assert(Object.hasOwn(host.getHostCapabilities(), 'updateModelContext'));
  emit({ id: 77, method: 'ping' });
  assert.equal(frames.at(-1).id, 77);
  assert(Object.hasOwn(frames.at(-1), 'result'));
  await host.request('ping');
  emit({ id: 78, method: 'wrong' });
  assert.equal(frames.at(-1).error.code, -32601);
  emit({ method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } }, {});
  assert.equal(host.getHostContext().theme, 'light');
  emit({ method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } });
  assert.deepEqual(heard, ['injected', true, 'dark']);
  assert.equal(host.getHostContext().displayMode, 'inline');
  const response = await host.callServerTool('app_dashboard', {});
  assert.equal(response.name, 'app_dashboard');
  assert.equal(frames.at(-1).method, 'tools/call');
  await host.sendMessage('/compact');
  assert.equal(frames.at(-1).params.role, 'user');
  assert.equal(frames.at(-1).params.content[0].text, '/compact');
  await host.updateModelContext('attach existing task');
  assert.equal(frames.at(-1).method, 'ui/update-model-context');
  assert.equal(frames.at(-1).params.content[0].text, 'attach existing task');
});

test('normalizes text and structured MCP results and reports errors for malformed replies', () => {
  const { api } = fixture();
  const data = api.WorkbenchHost.resultData;
  assert.equal(data({ content: [{ type: 'text', text: '{"ready":true}' }] }, 'read').ready, true);
  assert.equal(data({ structuredContent: { ready: false }, content: [{ type: 'text', text: '{"ready":true}' }] }, 'read').ready, false);
  assert.throws(() => data({ content: [{ type: 'text', text: 'OK' }] }, 'read'), /缺少结构化数据/);
  assert.throws(() => data({ isError: true, content: [{ type: 'text', text: 'permission_denied' }] }, 'read'), /permission_denied/);
});

test('limits concurrent tool calls to the host ceiling and cancels queued work on teardown', async () => {
  const { api, emit, frames } = fixture('aux_pane', true);
  const host = new api.WorkbenchHost();
  await host.connect();
  const jobs = Array.from({ length: 7 }, (_, i) => host.callServerTool('tool_' + i));
  const results = Promise.allSettled(jobs);
  const called = () => frames.filter(frame => frame.method === 'tools/call');
  assert.equal(called().length, 4);
  emit({ id: called()[1].id, result: { content: [{ type: 'text', text: '{"observed":true}' }] } });
  await settled();
  assert.deepEqual(called().map(frame => frame.params.name), ['tool_0', 'tool_1', 'tool_2', 'tool_3', 'tool_4']);
  emit({ id: 99, method: 'ui/resource-teardown' });
  const ended = await results;
  assert.equal(ended[1].value.observed, true);
  assert.equal(ended.filter(row => row.status === 'rejected').length, 6);
  assert.equal(called().length, 5);
});

test('host theme disables stale variables and file previews gracefully fall back', async () => {
  const { api, frames } = fixture();
  const host = new api.WorkbenchHost();
  await host.connect();
  let fallback = 0;
  await api.previewInHost(host, { uri: 'file:///project/a%20b.md' }, () => ++fallback);
  assert.equal(frames.at(-1).method, 'com.google.antigravity/toggle-aux-pane');
  assert.equal(frames.at(-1).params.tabType, 'fileView');
  assert.equal(frames.at(-1).params.uri, 'file:///project/a%20b.md');
  assert.equal(fallback, 1);

  const global = fixture('global');
  const globalHost = new global.api.WorkbenchHost();
  await globalHost.connect();
  await global.api.previewInHost(globalHost, { uri: 'file:///some.md' }, () => ++fallback);
  assert.equal(fallback, 2);
  assert.equal(global.frames.at(-1).method, 'ui/notifications/initialized');

  const themed = new Map();
  const root = { dataset: {}, style: {
    setProperty: (name, value) => themed.set(name, value), removeProperty: name => themed.delete(name),
  } };
  api.applyHostTheme({ theme: 'dark', styles: { variables: {
    '--font-sans': 'Example', '--color-background-primary': '#123', '--irrelevant': 'no',
  } } }, root);
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(themed.get('--color-background-primary'), '#123');
  assert(!themed.has('--irrelevant'));
  api.applyHostTheme({ theme: 'light' }, root);
  assert.equal(root.dataset.theme, 'light');
  assert.equal(themed.size, 0);
});

test('pixel office has all 11 embedded sprites and migration features in the bundle', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(scripts[1], context);
  assert.equal(Object.keys(context.window.ModelDeskOfficeSprites).length, 11);
  for (const row of Object.values(context.window.ModelDeskOfficeSprites)) {
    assert.match(row.src, /^data:image\//);
    assert.match(row.sit.src, /^data:image\//);
  }
  for (const feature of ['prefers-reduced-motion', 'office-weather', 'office-time', 'summonGardenStroll',
    'PAIR_BANTER', 'office-action="demo"', 'hearthLit', 'musicOn', 'data-office-settings']) {
    assert(html.includes(feature), feature);
  }
});

test('workbench includes context menu and keyboard paths for deliverable actions', () => {
  for (const action of ['reveal_finder', 'open_default', 'open_app', 'copy_path', 'copy_relative', 'copy_markdown',
    'read_text', 'git_diff', 'export_copy', 'rename', 'trash', 'app_translate', 'app_save_prefs']) {
    assert(html.includes(action), action);
  }
  for (const event of ['contextmenu', 'ContextMenu', 'ArrowDown', 'Escape']) assert(html.includes(event));
});

class Element {
  constructor(tag, document) {
    this.tag = tag;
    this.document = document;
    this.children = [];
    this.events = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.hidden = false;
    this.value = '';
    this.textContent = '';
    this.scrollTop = 0;
    this.scrollHeight = this.clientHeight = 80;
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => (child.tag === selector ? [child] : []).concat(child.querySelectorAll(selector)));
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  get options() { return this.children; }
  getBoundingClientRect() { return { width: 220, height: 240, right: 390, bottom: 710 }; }
  getContext() { return { fillRect() {}, clearRect() {}, drawImage() {} }; }
  addEventListener(name, callback) { this.events.set(name, callback); }
  fire(name, details = {}) {
    this.events.get(name)?.({ target: this, preventDefault() {}, ...details });
  }
  focus() { this.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
}

function appFixture(markup, source, { entrypoint = 'aux_pane', capabilities = {}, handlers, task } = {}) {
  const frames = [];
  const nodes = new Map();
  const timers = new Map();
  const listeners = new Map();
  let timerId = 0, resized, listener;
  const document = {
    hidden: false,
    createElement(tag) { return new Element(tag, this); },
    getElementById(id) { return nodes.get(id); },
    addEventListener(name, handler) { listeners.set(name, handler); },
  };
  for (const match of markup.matchAll(/<([a-z-]+)\b([^<>]*\bid="([a-z-]+)"[^<>]*)>/g)) {
    const node = document.createElement(match[1]);
    node.hidden = /\bhidden\b/.test(match[2]);
    for (const attr of match[2].matchAll(/([a-z-]+)="([^"]+)"/g)) {
      if (attr[1].startsWith('data-')) node.dataset[attr[1].slice(5)] = attr[2];
      else node.attributes.set(attr[1], attr[2]);
    }
    nodes.set(match[3], node);
  }
  document.documentElement = document.createElement('html');
  document.documentElement.clientWidth = 400;
  document.body = document.createElement('body');
  const parent = {
    postMessage(message) {
      frames.push(message);
      const respond = (result, error) => queueMicrotask(() => emit({ id: message.id, ...(error ? { error } : { result }) }));
      if (message.method === 'ui/initialize') {
        if (task) emit({ method: 'ui/notifications/tool-result', params: { structuredContent: task } });
        return respond({ protocolVersion: '2026-01-26', hostCapabilities: capabilities,
          hostContext: { 'com.google.antigravity/ui': { entrypoint }, theme: 'dark' } });
      }
      if (message.method === 'com.google.antigravity/toggle-aux-pane') {
        return respond(null, { code: -32601, message: 'Unsupported method' });
      }
      if (message.method === 'ui/message' || message.method === 'ui/update-model-context') return respond({});
      if (message.method !== 'tools/call') return;
      const handler = handlers[message.params.name];
      assert(handler, message.params.name);
      try { return respond({ structuredContent: handler(message.params.arguments), content: [] }); }
      catch (error) { return respond(null, { code: -32000, message: error.message }); }
    },
  };
  function emit(data) {
    listener({ source: parent, origin: 'null', data: { jsonrpc: '2.0', ...data } });
  }
  const office = {
    configurePersistence() {}, applyPreferences() {}, hide() {}, render() {}, wake() {},
  };
  const window = {
    parent, ModelDeskPixelOffice: office, ModelDeskOfficeSprites: {},
    addEventListener(name, callback) { if (name === 'message') listener = callback; },
  };
  const context = vm.createContext({
    window, document, navigator: { clipboard: { writeText: async () => {} } },
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame() { return 2; }, cancelAnimationFrame() {},
    matchMedia() { return { matches: false, addEventListener() {} }; },
    ResizeObserver: class {
      constructor(callback) { resized = callback; }
      observe() {}
      disconnect() { resized = undefined; }
    },
    URL, performance, innerWidth: 400, innerHeight: 720, Error,
  });
  vm.runInContext(scripts[0], context);
  vm.runInContext(source, context);
  return {
    nodes, frames, document, emit,
    visible(value) { document.hidden = !value; listeners.get('visibilitychange')(); },
    scheduled(delay) { return Array.from(timers.values()).filter(item => item.delay === delay).length; },
    tick(delay) {
      const scheduled = [...timers.entries()].find(([, item]) => item.delay === delay);
      assert(scheduled, 'expected a timer for ' + delay);
      timers.delete(scheduled[0]);
      return scheduled[1].callback();
    },
    resize() { resized?.(); },
  };
}

function dashboardFixture(entrypoint, capabilities = {}) {
  const file = { path: '/project/document.md', uri: 'file:///project/document.md', name: 'document.md',
    workspace: '/project', relative: 'document.md', exists: true, category: '文档', size: 12, updated_at: 10,
    git_status: ' M', change: '修改' };
  const preferences = {};
  const presets = {
    'gpt-6-luna': { model: 'gpt-6-luna', base_url: 'https://api.openai.com/v1' },
    ollama: { model: 'qwen2.5:7b', base_url: 'http://localhost:11434/v1', keyless_local: true },
  };
  let active = 'gpt-6-luna';
  const provider = preset => ({ preset: active, selected_preset: preset || active, presets, config: presets[preset || active] });
  const tasks = [{ id: 'task-1', status: 'running', cwd: '/project', engine: 'codex', title: 'Implement HUD',
    changed_files: [], conversation_id: 'session', updated_at: 1 }];
  const sessions = [{ id: 'session', model: 'Gemini 4 Neon', workspaces: ['/project'] },
    { id: 'other', model: 'Codex', workspaces: ['/other'] }];
  const fixture = appFixture(html, scripts.at(-1), { entrypoint, capabilities, handlers: {
    app_dashboard: params => ({
      tasks, session: sessions.find(row => row.id === params.conversation_id) || sessions[0], sessions,
      adapters: [], prefs: { ...preferences }, translation: params.settings ? provider(params.settings_preset) : undefined,
    }),
    app_context_usage: () => ({
      context: { model: 'Gemini 4 Neon', used_tokens: 390000, window_tokens: 512000, ratio: .761,
        cache_hit_rate: .56, window_source: 'auto', book: { label: '《三体》×1.9' }, top: [] },
      tokens: { main: { input_tokens: 150 }, subagents: { count: 2 }, today: {}, week: {} },
      recent_sessions: sessions, codex: { buckets: [] },
    }),
    app_thoughts: () => ({
      entries: [{ step: 1, hash: 'step', model: 'Gemini', text: 'Original', status: 'translated', translation: '译文' }],
    }),
    app_list_files: () => ({ files: [file], editors: ['Zed'], total: 1 }),
    app_file_action: params => params.action === 'info' ? file : { text: 'Hello world' },
    app_translate: () => ({ bilingual: 'Hello world\n你好', translation: '你好' }),
    app_test_api: () => ({ ok: true, model: 'qwen2.5:7b', latency_ms: 37 }),
    app_task_action: () => ({ id: tasks[0].id }),
    app_get_task_logs: () => ({ task: tasks[0], end: 1, text: 'Live CLI log' }),
    app_save_prefs: params => {
      Object.assign(preferences, params.patch);
      if (params.patch.translation) active = params.patch.translation.preset;
      return { prefs: { ...preferences }, translation: provider() };
    },
  } });
  return { ...fixture, preferences };
}

const settled = () => new Promise(resolve => setImmediate(resolve));
const toolCalls = (frames, name) => frames.filter(frame => frame.params?.name === name).map(frame => frame.params.arguments);
const fileRow = nodes => nodes.get('files').children.find(child => child.className === 'file-row');
const action = (parent, text) => parent.children.find(child => child.textContent === text);

test('workbench shows first-paint desks, persistent read errors, retry and honest empty-profile data', async () => {
  let blocked = true;
  const empty = { tasks: [], adapters: [], prefs: {}, session: {}, sessions: [], projects: [
    { id: 'project', name: 'Registered project', workspaces: ['/project'], conversation_id: null },
  ] };
  const { nodes, frames } = appFixture(html, scripts.at(-1), { handlers: {
    app_dashboard: () => {
      if (blocked) throw new Error('permission_denied');
      return empty;
    },
    app_context_usage: () => ({ context: null, recent_sessions: [] }),
    app_thoughts: () => ({ entries: [] }),
    app_list_files: () => ({ files: [], editors: [], total: 0 }),
  } });
  assert.equal(nodes.get('squad').children.length, 3);
  assert.match(nodes.get('office-status').textContent, /等待宿主数据/);
  await settled();
  assert.equal(nodes.get('connection').hidden, false);
  assert.match(nodes.get('connection-status').textContent, /permission_denied/);
  blocked = false;
  nodes.get('connection-retry').fire('click');
  await settled();
  assert.equal(toolCalls(frames, 'app_dashboard').length, 2);
  assert.equal(frames.filter(frame => frame.method === 'ui/initialize').length, 1);
  assert.equal(nodes.get('connection').hidden, true);
  assert.match(nodes.get('office-status').textContent, /尚无会话记录/);
  assert.equal(nodes.get('projects').children[0].textContent, 'Registered project · 暂无会话');
});

test('auxiliary workbench sends a file resource link when the host advertises that content type', async () => {
  const { nodes, frames } = dashboardFixture('aux_pane', { updateModelContext: { resourceLink: {}, text: {} } });
  await settled();
  fileRow(nodes).fire('contextmenu', { clientX: 20, clientY: 20 });
  action(nodes.get('context-menu'), '附加为 @上下文').fire('click');
  await settled();
  const block = frames.find(frame => frame.method === 'ui/update-model-context').params.content[0];
  assert.equal(block.type, 'resource_link');
  assert.equal(block.name, 'document.md');
  assert.equal(block.uri, 'file:///project/document.md');
  assert(!toolCalls(frames, 'app_file_action').some(item => item.action === 'read_text'));
});

test('desktop layout uses the required container states and absolutely positioned MP attributes', () => {
  assert.match(html, /container: hud \/ inline-size/);
  assert.match(html, /\.hud-bar\s*\{[^}]*height: 42px/);
  assert.match(html, /\.hud-float\s*\{[^}]*position: absolute; top: 42px/);
  assert.match(html, /grid-template: "office" auto "switch" auto "body"/);
  assert.match(html, /@container hud \(width >= 620px\)[\s\S]*?grid-template: "office thoughts" auto "files thoughts"/);
  assert.match(html, /@container hud \(width >= 900px\)[\s\S]*?grid-template: "rail office thoughts" auto "rail files thoughts"[^;]*196px/);
  assert.doesNotMatch(html, />新建派单</);
  assert.match(strip, /max-height: 240px/);
  assert.doesNotMatch(strip, /id="pixel-office"/);
});

test('workbench opens MP attributes without changing the pane, switches thoughts and uses inline API settings', async () => {
  const { document, nodes, frames, preferences } = dashboardFixture('aux_pane', { message: {} });
  await settled();
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(nodes.get('mp-toggle').dataset.level, 'amber');
  assert.equal(nodes.get('mp-value').textContent, '390K/512K');
  assert.equal(nodes.get('attributes').hidden, true);
  nodes.get('mp-toggle').fire('click');
  await settled();
  assert.equal(nodes.get('attributes').hidden, false);
  assert.equal(nodes.get('layout').dataset.view, 'thoughts');
  assert.equal(nodes.get('mp-toggle').attributes.get('aria-expanded'), 'true');
  assert(nodes.get('context-data').children.some(child => child.textContent.includes('自动窗口')));
  nodes.get('window-auto').fire('click');
  nodes.get('compact').fire('click');
  await settled();
  assert.equal(preferences.context_window, null);
  assert(frames.some(frame => frame.method === 'ui/message'));
  const renderedText = () => nodes.get('thoughts').children[0].children.filter(child => child.tag === 'pre').map(child => child.textContent);
  assert.deepEqual(renderedText(), ['译文']);
  nodes.get('bilingual').fire('click');
  await settled();
  assert.deepEqual(renderedText(), ['Original', '译文']);
  assert.equal(preferences.thought_bilingual, true);
  nodes.get('api-toggle').fire('click');
  nodes.get('translation-preset').value = 'ollama';
  nodes.get('translation-preset').fire('change');
  await settled();
  assert.equal(nodes.get('api-custom').hidden, false);
  assert.equal(nodes.get('api-key').placeholder, '本机免密');
  nodes.get('api-test').fire('click');
  await settled();
  assert.match(nodes.get('api-feedback').textContent, /37 ms/);
  assert.equal(toolCalls(frames, 'app_test_api')[0].preset, 'ollama');
  nodes.get('squad').children[0].fire('click');
  await settled();
  assert.equal(nodes.get('detail').open, true);
  assert.equal(toolCalls(frames, 'app_get_task_logs')[0].task_id, 'task-1');
});

test('file menu preserves pointer and keyboard actions, validates native preview and opens a translation dialog', async () => {
  const { nodes, frames } = dashboardFixture('aux_pane', { updateModelContext: {} });
  await settled();
  nodes.get('view-files').fire('click');
  await settled();
  const row = fileRow(nodes);
  const menu = nodes.get('context-menu');
  row.fire('contextmenu', { clientX: 396, clientY: 719 });
  assert.equal(menu.hidden, false);
  assert.equal(menu.style.left, '175px');
  assert.equal(menu.style.top, '475px');
  for (const label of ['右侧原生预览', '访达中显示', '复制绝对路径', '复制相对路径', '附加为 @上下文', '翻译此文件',
    '查看 Git Diff', '改名', '移到废纸篓']) assert(action(menu, label), label);
  action(menu, '用外部编辑器打开').fire('click');
  assert(action(menu, 'Zed'));
  action(menu, '返回上一级').fire('click');
  action(menu, '右侧原生预览').fire('click');
  await settled();
  assert.equal(nodes.get('dialog-body').children[1].textContent, 'Hello world');
  assert(frames.some(frame => frame.method === 'com.google.antigravity/toggle-aux-pane'));
  nodes.get('detail').close();
  row.fire('keydown', { key: 'F10', shiftKey: true });
  action(menu, '翻译此文件').fire('click');
  await settled();
  assert.equal(nodes.get('detail').open, true);
  assert.equal(toolCalls(frames, 'app_translate')[0].path, '/project/document.md');
  assert.equal(nodes.get('dialog-body').children[5].textContent, 'Hello world\n你好');
  nodes.get('detail').close();
  row.fire('contextmenu', { clientX: 20, clientY: 20 });
  action(menu, '移到废纸篓').fire('click');
  assert.equal(toolCalls(frames, 'app_file_action').filter(args => args.action === 'trash').length, 0);
  action(nodes.get('dialog-body'), '确认移到废纸篓').fire('click');
  await settled();
  assert.equal(toolCalls(frames, 'app_file_action').find(args => args.action === 'trash').confirmed, true);
});

test('global rail switches the observed project and hides unavailable host actions', async () => {
  const { nodes, frames, preferences } = dashboardFixture('global');
  await settled();
  fileRow(nodes).fire('contextmenu', { clientX: 40, clientY: 40 });
  const menu = nodes.get('context-menu');
  assert(!action(menu, '附加为 @上下文'));
  action(menu, '在工坊预览').fire('click');
  await settled();
  assert(!frames.some(frame => frame.method === 'com.google.antigravity/toggle-aux-pane'));
  assert.equal(nodes.get('dialog-body').children[1].textContent, 'Hello world');
  nodes.get('detail').close();
  action(nodes.get('projects'), 'other').fire('click');
  await settled();
  assert.equal(toolCalls(frames, 'app_list_files').at(-1).workspace, '/other');
  assert.equal(toolCalls(frames, 'app_thoughts').at(-1).conversation_id, 'other');
  nodes.get('rail-toggle').fire('click');
  await settled();
  assert.equal(preferences.projects_rail_collapsed, true);
  assert.equal(nodes.get('rail-content').hidden, true);
});

test('a file review dispatches the chosen agent read-only after explicit confirmation', async () => {
  for (const [choice, engine, label] of [['交给 Codex 验收', 'codex', 'Codex'], ['交给 Qoder 润色', 'qoder', 'Qoder CN']]) {
    const { nodes, frames } = dashboardFixture('aux_pane');
    await settled();
    fileRow(nodes).fire('contextmenu', { clientX: 32, clientY: 48 });
    const menu = nodes.get('context-menu');
    action(menu, '转交其他 Agent 复核').fire('click');
    action(menu, choice).fire('click');
    await settled();
    const body = nodes.get('dialog-body');
    assert.equal(body.children[1].textContent, '/project/document.md');
    assert.equal(body.querySelector('select').value, '/project');
    body.querySelector('textarea').value = '检查示例';
    assert.equal(toolCalls(frames, 'app_task_action').length, 0);
    const confirm = action(body, '确认交给 ' + label);
    confirm.fire('click');
    confirm.fire('click');
    await settled();
    const calls = toolCalls(frames, 'app_task_action');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].engine, engine);
    assert.equal(calls[0].conversation_id, 'session');
    assert.equal(calls[0].write, false);
    assert.equal(calls[0].declared_files[0], '/project/document.md');
    assert(calls[0].prompt.includes('/project/document.md') && calls[0].prompt.includes('检查示例'));
  }
});

test('inline strip polls every two seconds, stops in the background, pauses and resumes the native session', async () => {
  let state = { id: 'task', engine: 'qoder', status: 'queued', title: 'Fixture', updated_at: 1 };
  const initial = state;
  const fixture = appFixture(strip, stripScripts.at(-1), { entrypoint: 'inline', task: initial, handlers: {
    app_dashboard: () => ({ prefs: { hud_theme: 'light' } }),
    app_get_task_logs: () => ({ task: state, text: Array.from({ length: 18 }, (_, i) => 'line ' + i).join('\n') }),
    app_task_action: ({ action }) => state = { ...state, updated_at: state.updated_at + 1,
      status: action === 'pause' ? 'recovery_pending' : 'queued', native_session_id: 'native' },
  } });
  const { nodes, frames, document } = fixture;
  await settled();
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.match(nodes.get('task-state').textContent, /^\[RUN /);
  assert.equal(fixture.scheduled(2000), 1);
  fixture.visible(false);
  assert.equal(fixture.scheduled(2000), 0);
  assert.equal(nodes.get('task-strip').dataset.visible, 'false');
  fixture.visible(true);
  await fixture.tick(2000);
  assert.deepEqual(toolCalls(frames, 'app_get_task_logs').map(args => args.limit), [15]);
  assert.equal(nodes.get('latest-log').textContent, 'line 17');
  nodes.get('toggle-log').fire('click');
  assert.equal(nodes.get('tail').hidden, false);
  assert.equal(nodes.get('tail').textContent.split('\n').length, 15);
  assert.match(nodes.get('tail').textContent, /^line 3\n/);
  nodes.get('task-action').fire('click');
  await settled();
  assert.equal(nodes.get('task-state').textContent, '[PAUSED · 可续接]');
  assert.equal(fixture.scheduled(2000), 0);
  nodes.get('task-action').fire('click');
  await settled();
  assert.deepEqual(toolCalls(frames, 'app_task_action').map(args => args.action), ['pause', 'native']);
  state = { ...state, status: 'review', updated_at: state.updated_at + 1 };
  await fixture.tick(2000);
  assert.equal(nodes.get('task-state').textContent, '[待验收]');
  assert.equal(fixture.scheduled(2000), 0);
  fixture.resize();
  fixture.resize();
  assert.deepEqual(frames.filter(frame => frame.method === 'ui/notifications/size-changed').map(frame => frame.params.height), [240]);
});

test('inline resume shows Git evidence and forwards the confirmed conflict token', async () => {
  const stopped = { id: 'task', engine: 'gemini', status: 'recovery_pending', title: 'Fixture', updated_at: 1 };
  const conflict = { id: stopped.id, status: 'conflict', resume_mode: 'checkpoint', conflict_token: 'evidence-token',
    snapshot: { diff: '+changed text' }, files: ['guide.md'], task: stopped };
  const app = appFixture(strip, stripScripts.at(-1), { entrypoint: 'inline', handlers: {
    app_dashboard: () => ({ prefs: {} }),
    app_get_task_logs: () => ({ task: stopped, text: 'paused output' }),
    app_task_action: () => ({ ...stopped, status: 'queued', updated_at: 2 }),
  } });
  app.emit({ method: 'ui/notifications/tool-input', params: { arguments: { follow_up_prompt: 'Continue the review' } } });
  app.emit({ method: 'ui/notifications/tool-result', params: { structuredContent: conflict } });
  await settled();
  assert.equal(app.nodes.get('resume-review').hidden, false);
  assert.match(app.nodes.get('resume-diff').textContent, /guide.md[\s\S]*\+changed text/);
  assert.equal(app.scheduled(2000), 0);
  app.nodes.get('resume-confirm').fire('click');
  await settled();
  const args = toolCalls(app.frames, 'app_task_action')[0];
  assert.equal(args.conflict_token, 'evidence-token');
  assert.equal(args.action, 'checkpoint');
  assert.equal(args.confirmed, true);
  assert.equal(args.prompt, 'Continue the review');
  assert.equal(app.nodes.get('resume-review').hidden, true);
  assert.equal(app.scheduled(2000), 1);
});

test('workshop greetings resume the same route without teleporting, including on a garden visit', () => {
  const motion = require('../ui/src/office/pixel-office-motion.js');
  const actor = {id:'gemini', x:380, deskY:278, status:'idle'};
  const garden = [{x:546,foot:242,activity:'pond',pause:4000}];
  for (const summon of [false,true]) {
    const baseline = motion.create(), played = motion.create();
    for (const scene of [baseline,played]) {
      scene.update([actor],0);
      if (summon) scene.summonIdle(['gemini'],garden,100);
    }
    const at = 2000, duration = 4200;
    const before = played.pose(actor,at);
    played.pauseActor('gemini',at,duration);
    const during = played.pose(actor,at+duration-1);
    assert.equal(during.x,before.x); assert.equal(during.foot,before.foot);
    played.update([actor],at+duration);
    assert.deepEqual(played.pose(actor,at+duration),baseline.pose(actor,at));
    assert.deepEqual(played.pose(actor,at+duration+400),baseline.pose(actor,at+400));
    if (summon) {
      let prior = played.pose(actor,at+duration);
      for (let t=at+duration+100; t<40000;t+=100) {
        const next = played.pose(actor,t);
        assert.ok(Math.hypot(next.x-prior.x,next.foot-prior.foot) < 10, 'garden departure and return are continuous');
        prior = next;
      }
      assert.equal(played.interacting(),false);
    }
  }
});

test('native idle, background, reduced motion and work use the appropriate frame clocks', () => {
  let now = 100, timer, delay, visibility, viewport, motionChanged;
  const media = { matches:false, addEventListener(_,cb) {motionChanged=cb;} };
  const panel = { hidden: false };
  const canvas = {
    width: 640, height: 360, dataset: {}, closest: selector => selector === '#pixel-office' ? panel : null,
    getContext: () => null, addEventListener() {},
  };
  const document = {
    hidden: false, body: { dataset: { officeProfile: 'workbench' } }, documentElement: {},
    addEventListener(name, callback) { if (name === 'visibilitychange') visibility = callback; },
  };
  const window = {};
  const context = vm.createContext({
    window, document, performance: { now: () => now },
    MutationObserver: class { observe() {} },
    IntersectionObserver: class { constructor(fn) {viewport=fn;} observe() {} },
    matchMedia: () => media,
    setInterval(callback, ms) { timer = callback; delay=ms; return 1; },
    clearInterval() { timer = null; },
  });
  for (const script of scripts.slice(2, -1)) vm.runInContext(script, context);
  const office = window.ModelDeskPixelOffice;
  const args = { canvas, tasks: [], endpoints: [], sync: 'ready', summary: () => ({}),
    accepted: () => false, projectName: x => x, escapeText: x => x, observedAt: new Date().toISOString() };
  office.render(args);
  assert.equal(timer, undefined);
  office.wake();
  assert.equal(canvas.dataset.motion, 'active');
  assert.equal(typeof timer, 'function');
  now += 2001;
  timer();
  assert.equal(canvas.dataset.motion, 'still');
  assert.equal(timer, null);
  office.wake();
  assert.equal(typeof timer, 'function');
  document.hidden = true;
  visibility();
  assert.equal(timer, null);
  assert.equal(canvas.dataset.motion, 'still');
  document.hidden = false;
  const native = window.ModelDeskCreateOffice({ambientIdle:true});
  native.render(args);
  assert.equal(canvas.dataset.motion,'active');
  assert.equal(delay,160);
  now += 9000; timer();
  assert.equal(typeof timer,'function');
  native.render({...args,leadActive:true});
  assert.equal(delay,65);
  viewport([{isIntersecting:false}]); assert.equal(timer,null);
  viewport([{isIntersecting:true}]); assert.equal(delay,65);
  media.matches=true; motionChanged(); assert.equal(timer,null);
  media.matches=false; motionChanged();
  document.hidden=true; visibility(); assert.equal(timer,null);
  document.hidden=false; visibility(); assert.equal(typeof timer,'function');
});
