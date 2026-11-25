// Private pipe from the signed ModelDesk window to its installed service.
const { app, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { isLocalHubTopFrame } = require('./utils');
const { getActiveLsBaseUrl } = require('./authBootstrap');

const methods = new Set(['snapshot', 'app_context_usage', 'app_thoughts', 'app_retry_thought',
    'app_provider_status', 'app_save_prefs', 'app_test_api', 'app_get_task_logs',
    'app_task_action', 'app_list_files', 'app_file_action', 'app_translate']);
const taskMethods = new Set(['app_task_action', 'app_get_task_logs']);
const pending = new Map();
const homeTasks = new WeakMap();
let worker, sequence = 0;

function service() {
    if (worker) return worker;
    const directory = path.join(process.resourcesPath, 'modeldesk-service');
    const python = path.resolve(directory, JSON.parse(fs.readFileSync(path.join(directory, 'runtime.json'), 'utf8')).python);
    const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1' };
    delete env.PYTHONPATH;
    delete env.PYTHONHOME;
    const child = spawn(python, ['-m', 'server.desktop_hud'], {
        cwd: directory, env, stdio: ['pipe', 'pipe', 'ignore'],
    });
    worker = child;
    function disconnected() {
        if (worker !== child) return;
        worker = undefined;
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(new Error('ModelDesk 本地服务已退出，请重试。'));
        }
        pending.clear();
    }
    child.once('error', disconnected);
    child.once('close', disconnected);
    child.stdin.on('error', disconnected);
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
        if (worker !== child || line.length > 5 * 1024 * 1024) return;
        let reply;
        try { reply = JSON.parse(line); } catch { return; }
        const entry = pending.get(reply.id);
        if (!entry) return;
        pending.delete(reply.id);
        clearTimeout(entry.timer);
        if (reply.ok) entry.resolve(reply.result);
        else entry.reject(new Error(String(reply.error || '本地操作失败')));
    });
    return child;
}

function query(method, args) {
    if (pending.size >= 40) return Promise.reject(new Error('本地工作队列已满，请稍后重试。'));
    const child = service(), id = ++sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('ModelDesk 本地操作超时，请检查工位状态。'));
        }, method === 'snapshot' ? 25000 : 120000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, method, args }) + '\n');
    });
}

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function register() {
    ipcMain.handle('modeldesk:native-hud', async (event, method, args) => {
        if (!isLocalHubTopFrame(event) || !methods.has(method)) throw new Error('仅支持 ModelDesk 本机窗口。');
        const url = new URL(event.senderFrame.url);
        if (url.origin !== getActiveLsBaseUrl()) throw new Error('当前窗口不属于本机 ModelDesk 服务。');
        if (!args || Object.getPrototypeOf(args) !== Object.prototype || JSON.stringify(args).length > 128 * 1024)
            throw new Error('无效的操作参数。');
        const route = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : url;
        const selected = new Set(route.pathname.split('/').filter(part => uuid.test(part)));
        for (const field of ['cascadeId','focused']) {
            const value = route.searchParams.get(field);
            if (value && uuid.test(value)) selected.add(value);
        }
        const sid = args.conversation_id, additionalTask = taskMethods.has(method) &&
            homeTasks.get(event.sender)?.get(args.task_id) === sid && !!sid && selected.size === 0;
        if (sid && (!uuid.test(sid) || (!selected.has(sid) && !additionalTask)))
            throw new Error('当前会话已切换，请刷新后重试。');
        if (method === 'app_thoughts') {
            if (Object.hasOwn(args, 'visible_text')) throw new Error('仅可翻译当前窗口已展示的摘要。');
            if (Object.hasOwn(args, 'visible_step') || Object.hasOwn(args, 'visible_revision')) {
                const {visible_step:step, visible_revision:revision} = args;
                if (!sid || !selected.has(sid) || !Number.isSafeInteger(step) || step < 0 ||
                    !Number.isSafeInteger(revision) || revision < 1) throw new Error('摘要已切换。');
                // Only the expanded native presentation registers a readable source. The IPC caller supplies identifiers.
                const source = await event.senderFrame.executeJavaScript(
                    `window.ModelDeskInlineThoughts?.readVisible(${JSON.stringify(sid)},${step},${revision})`);
                if (typeof source !== 'string' || !source.trim() || source.length > 24000)
                    return {conversation_id:sid,revision,status:'unavailable'};
                args = {conversation_id:sid,visible_step:step,visible_revision:revision,visible_text:source};
            }
        }
        const data = await query(method, args);
        if (method === 'snapshot' && !sid) {
            homeTasks.set(event.sender, new Map((data.tasks || []).map(t => [t.id, t.conversation_id])));
        }
        return data;
    });
    app.on('will-quit', () => { if (worker) { worker.stdin.end(); worker.kill(); } });
}
module.exports = { register };
