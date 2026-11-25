'use strict';

class WorkbenchHost {
  constructor(frame = window) {
    this.frame = frame;
    this.peer = frame.parent;
    this.origin = '*';
    this.context = {};
    this.capabilities = {};
    this.pending = new Map();
    this.activeTools = 0;
    this.waitingTools = [];
    this.closed = false;
    this.handlers = new Map();
    this.sequence = 0;
    frame.addEventListener('message', event => this.receive(event));
  }

  on(method, callback) {
    this.handlers.set(method, callback);
  }

  post(message) {
    this.peer.postMessage({ jsonrpc: '2.0', ...message }, this.origin);
  }

  receive(event) {
    if (event.source !== this.peer || (this.origin !== '*' && event.origin !== this.origin)) return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0' || Array.isArray(message)) return;
    if ('method' in message) {
      if ('id' in message) {
        if (message.method === 'ping' || message.method === 'ui/resource-teardown') {
          if (message.method === 'ui/resource-teardown') {
            this.closed = true;
            const error = new Error('工作台已关闭');
            for (const pending of this.pending.values()) {
              clearTimeout(pending.timer);
              pending.reject(error);
            }
            this.pending.clear();
            for (const pending of this.waitingTools.splice(0)) pending.reject(error);
            this.handlers.get(message.method)?.();
          }
          this.post({ id: message.id, result: {} });
        } else {
          this.post({ id: message.id, error: { code: -32601, message: 'Method not found' } });
        }
      } else {
        if (message.method === 'ui/notifications/host-context-changed') {
          this.mergeContext(message.params || {});
        }
        this.handlers.get(message.method)?.(message.params || {});
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(Object.assign(new Error(message.error.message || '宿主请求失败'), { code: message.error.code }));
    } else if ('result' in message) {
      if (pending.method === 'ui/initialize' && /^https?:\/\//.test(event.origin)) this.origin = event.origin;
      pending.resolve(message.result);
    } else {
      pending.reject(new Error('宿主回包缺少结果'));
    }
  }

  mergeContext(patch) {
    this.context = { ...this.context, ...patch };
  }

  request(method, params = {}, timeout = 25000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.post({ method: 'notifications/cancelled', params: { requestId: id, reason: 'timeout' } });
        reject(new Error(method + '：宿主请求超时'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.post({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.post({ method, params });
  }

  async connect() {
    if (this.peer === this.frame) throw new Error('请在 Antigravity 中打开工作台');
    const result = await this.request('ui/initialize', {
      protocolVersion: '2026-01-26',
      appInfo: { name: 'modeldesk-workbench', version: '2.0.0' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    });
    if (result.protocolVersion !== '2026-01-26') throw new Error('宿主 MCP App 协议版本不兼容');
    this.capabilities = result.hostCapabilities || {};
    this.mergeContext(result.hostContext || {});
    this.notify('ui/notifications/initialized');
  }

  getHostCapabilities() { return this.capabilities; }
  getHostContext() { return this.context; }

  static resultData(reply, label) {
    const text = (reply?.content || []).filter(item => item.type === 'text').map(item => item.text);
    if (reply?.isError) throw new Error(text.join('\n') || label + '失败');
    let data = reply?.structuredContent;
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    for (const block of text) {
      try { data = JSON.parse(block); } catch { continue; }
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    }
    throw new Error(label + '：宿主回包缺少结构化数据');
  }

  async callServerTool(name, args = {}) {
    if (this.closed) throw new Error('工作台已关闭');
    if (this.activeTools >= 4) await new Promise((resolve, reject) => this.waitingTools.push({ resolve, reject }));
    else this.activeTools++;
    try {
      if (this.closed) throw new Error('工作台已关闭');
      const reply = await this.request('tools/call', { name, arguments: args }, name.includes('translate') ? 600000 : 30000);
      return WorkbenchHost.resultData(reply, name);
    } finally {
      const next = this.waitingTools.shift();
      if (next) next.resolve();
      else this.activeTools--;
    }
  }

  sendMessage(content) {
    return this.request('ui/message', { role: 'user', content: [{ type: 'text', text: content }] });
  }

  updateModelContext(content) {
    const block = typeof content === 'string' ? { type: 'text', text: content } : content;
    return this.request('ui/update-model-context', { content: [block] });
  }
}

function applyHostTheme(hostContext, root = document.documentElement, mode = 'auto') {
  const theme = mode === 'light' || mode === 'dark' ? mode : hostContext.theme === 'dark' ? 'dark' : 'light';
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  const incoming = hostContext.styles?.variables || {};
  const previous = (root.dataset.hostVariables || '').split(' ').filter(Boolean);
  const allowed = Object.entries(incoming).filter(([name, value]) =>
    /^--(?:color-(?:background|text|border)-[a-z0-9-]+|font-sans)$/.test(name) && typeof value === 'string');
  const current = new Set(allowed.map(([name]) => name));
  for (const name of previous) if (!current.has(name)) root.style.removeProperty(name);
  for (const [name, value] of allowed) root.style.setProperty(name, value);
  root.dataset.hostVariables = [...current].join(' ');
}

function isGlobalView(context) {
  const agy = context['com.google.antigravity/ui'] || {};
  return context.displayMode === 'fullscreen' || [context.entrypoint, context.viewType, agy.entrypoint, agy.type]
    .some(entry => entry === 'global' || entry?.type === 'global');
}

async function previewInHost(host, file, fallback) {
  if (!isGlobalView(host.getHostContext())) {
    try {
      const reply = await host.request('com.google.antigravity/toggle-aux-pane', { tabType: 'fileView', uri: file.uri });
      if (!reply?.isError) return;
    } catch (error) {
      if (error.code !== -32601) throw error;
    }
  }
  return fallback();
}
