(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const host = new WorkbenchHost();
  const office = window.ModelDeskPixelOffice;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const labels = {
    queued: '排队', dispatching: '派单中', running: '运行', review: '待验收', completed: '已完成',
    accepted: '已验收', recovery_pending: '可续接', failed: '失败', cancelled: '已终止',
  };
  const engines = { codex: 'Codex', qoder: 'Qoder CN', gemini: 'Gemini' };
  const DEFAULT_DESKS = Object.keys(engines).map(endpoint => ({ endpoint }));
  const RUNNING = new Set(['queued', 'dispatching', 'running']);
  const call = (name, args) => host.callServerTool(name, args);
  let dashboard = { tasks: [], session: {}, adapters: [], prefs: {}, sessions: [] };
  let receivedDashboard = false, reconnecting = false;
  let initialized = false, boundConversation = null, observedConversation = null, workspace = null;
  let noticeTimer, menuInvoker, menuAnchor, filesRequest = 0, contextRequest = 0, thoughtRequest = 0;
  let refreshRequest = 0, observation = 0, polling = false, pollTimer, pollCount = 0;
  let fileState = { rows: [], total: 0, editors: [] }, officeMarkup = '', officeState = '', railMarkup = '';
  let providerState, providerRequest = 0, detailTask, detailRequest = 0, taskLog, taskDesk;
  let prefsQueue = Promise.resolve(), pendingPrefs = 0, prefsRevision = 0;
  let thoughtRows = [], thoughtMarkup = '', usageState = null;
  let awakeUntil = 0, potionFrame = 0, potionDraw = -1, meterState = '', disposed = false;

  function el(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function button(label, handler, className) {
    const item = el('button', label, className);
    item.type = 'button';
    if (handler) item.addEventListener('click', () => safe(handler));
    return item;
  }

  function option(value, text) {
    const item = el('option', text);
    item.value = value;
    return item;
  }

  function summaryText(text, type = 'p') {
    return el(type, text, 'muted');
  }

  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = value => new Intl.NumberFormat().format(value ?? 0);
  const percent = value => value == null ? '—' : (value * 100).toFixed(1) + '%';
  const dateTime = value => value ? new Date(value * 1000).toLocaleString() : '—';
  const baseName = path => (path || '').split('/').filter(Boolean).at(-1) || '';
  const scopeArgs = () => ({ conversation_id: observedConversation || dashboard.session.id || boundConversation || null });
  const capable = kind => Object.hasOwn(host.getHostCapabilities(), kind) && host.getHostCapabilities()[kind] !== false;

  function tell(text) {
    clearTimeout(noticeTimer);
    const notice = $($('detail').open ? 'dialog-notice' : 'notice');
    notice.textContent = text;
    notice.hidden = false;
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 6400);
  }

  async function safe(action) {
    try { return await action(); }
    catch (error) { tell(error.message || '操作失败'); }
  }

  function savePreferences(patch, extra = {}) {
    pendingPrefs++;
    const saved = prefsQueue.then(() => call('app_save_prefs', { patch, ...extra }));
    prefsQueue = saved.then(() => {}, () => {}).finally(() => { pendingPrefs--; });
    return saved;
  }

  office.configurePersistence(persist, error => tell(error.message));

  function renderOffice() {
    const iso = value => value ? new Date(value * 1000).toISOString() : undefined;
    const tasks = scopedTasks().map(row => ({
      ...row, workbenchStatus: row.status, status: ['review', 'accepted'].includes(row.status) ? 'completed' : row.status,
      project: row.cwd, created_at: iso(row.created_at), ended_at: iso(row.updated_at),
      last_progress_at: iso(row.last_heartbeat_at),
    }));
    for (const row of dashboard.passive || []) {
      if (Date.now() - row.at * 1000 > 60000) continue;
      if (workspace && workspace !== dashboard.session.workspaces?.[0]) continue;
      tasks.push({ id: 'passive-' + row.at + '-' + row.step, engine: row.engine,
        status: row.status, workbenchStatus: row.status, source: 'hook', title: '终端 CLI',
        project: dashboard.session.workspaces?.[0], created_at: iso(row.at), ended_at: iso(row.at) });
    }
    const nextState = JSON.stringify([tasks, dashboard.adapters, dashboard.prefs.office_desks, dashboard.prefs.office_scene,
      dashboard.session.status, scopeArgs().conversation_id, workspace, receivedDashboard]);
    if (nextState === officeState) return;
    officeState = nextState;
    const summary = row => ({ code: row.workbenchStatus === 'review' ? 'awaiting_review' : row.workbenchStatus,
      label: labels[row.workbenchStatus] });
    const accepted = row => row.workbenchStatus === 'accepted';
    office.render({
      canvas: $('office-room-canvas'), tasks, endpoints: dashboard.adapters, sync: initialized ? 'ready' : 'loading',
      observedAt: new Date().toISOString(), complete: true, summary, accepted, projectName: baseName, escapeText,
      compact: true, roomScope: scopeArgs().conversation_id || 'modeldesk', onActor: (engine, position) => safe(() => openDesk(engine, position)), leadActive: dashboard.session.status === 'running',
      leadName: dashboard.session.status === 'running' ? '吉米奈 · 对话中' : '吉米奈 · 主控台',
    });
    const desks = dashboard.prefs.office_desks || DEFAULT_DESKS;
    const status = desks.map(desk => [desk.endpoint, tasks.find(row => row.engine === desk.endpoint && RUNNING.has(row.workbenchStatus))?.workbenchStatus ||
      tasks.find(row => row.engine === desk.endpoint)?.workbenchStatus || 'idle']);
    const next = JSON.stringify(status);
    if (next !== officeMarkup) {
      officeMarkup = next;
      $('squad').replaceChildren(...status.map(([engine, state], index) => {
        const control = button(engines[engine] + ' · ' + (labels[state] || '空闲'), () => openDesk(engine, 'desk-' + (index + 1)));
        control.dataset.state = state;
        control.setAttribute('aria-haspopup', 'dialog');
        return control;
      }));
      wake();
    }
    const busy = tasks.filter(row => RUNNING.has(row.workbenchStatus)).length;
    const review = tasks.filter(row => row.workbenchStatus === 'review').length;
    const idle = !receivedDashboard ? '等待宿主数据' : dashboard.session.id ? '空闲' : '尚无会话记录';
    $('office-status').textContent = '像素工坊 · ' + ([busy && busy + ' 执行', review && review + ' 待验收'].filter(Boolean).join(' · ') || idle);
  }

  async function attach(text) {
    if (!capable('updateModelContext')) throw new Error('当前视图没有可附加的对话');
    const reply = await host.updateModelContext(text);
    if (reply?.isError) throw new Error('宿主未接受上下文');
    tell('已附加到当前对话');
  }

  async function attachTask(task) {
    const data = await call('app_get_task_logs', { task_id: task.id, limit: 20 });
    await attach([
      `ModelDesk 任务 ${task.id} · ${engines[task.engine]} · ${labels[task.status]}`,
      task.title, '工作区 ' + task.cwd, '变更文件 ' + (task.changed_files.join('、') || '无'),
      '执行结果摘要', data.text.slice(-12000),
    ].join('\n'));
  }

  function showDialog(title, nodes) {
    const close = button('关闭', () => $('detail').close(), 'icon-button');
    const header = el('header', undefined, 'section-head');
    const heading = el('h2', title);
    heading.id = 'dialog-title';
    header.append(heading, close);
    $('dialog-notice').hidden = true;
    $('dialog-body').replaceChildren(header, ...nodes);
    if (!$('detail').open) $('detail').showModal();
  }

  function field(label, input) {
    const node = el('label', label);
    node.append(input);
    return node;
  }

  function textInput(value = '', type = 'text') {
    const input = el('input');
    input.type = type;
    input.value = value;
    return input;
  }

  function confirmedDialog(title, message, confirm, action) {
    detailTask = null;
    const submit = button(confirm, async () => {
      submit.disabled = true;
      try { await action(); } finally { submit.disabled = false; }
    }, 'primary');
    showDialog(title, [el('p', message), submit]);
  }

  function diffView(text) {
    const pre = el('pre');
    for (const line of text.split('\n')) {
      const kind = line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : line.startsWith('@') ? 'diff-range' : '';
      pre.append(el('span', line || ' ', 'diff-line ' + kind));
    }
    return pre;
  }

  async function openTask(id, desk = null) {
    taskDesk = desk;
    detailTask = id;
    taskLog = null;
    await loadTask(id);
    schedulePoll();
  }

  async function loadTask(id, quiet = false, before = null) {
    const request = ++detailRequest;
    const data = await call('app_get_task_logs', { task_id: id, limit: 50, before });
    if (detailTask !== id || request !== detailRequest) return;
    const task = data.task;
    const previousTask = taskLog?.data.task;
    if (quiet && taskLog?.data.end === data.end && previousTask?.status === task.status &&
        previousTask.stop_reason === task.stop_reason && previousTask.native_session_id === task.native_session_id) return;
    taskLog = { data, paging: before !== null };
    const actions = el('div', undefined, 'actions');
    const command = async (action, extra = {}) => {
      const answer = await call('app_task_action', { action, task_id: id, ...extra });
      if (answer.status === 'conflict') {
        detailTask = null;
        showDialog('续接前核对外部变更', [
          el('p', '以下文件或 Git HEAD 发生变化。请核对差异后确认续接。'),
          el('pre', answer.files.join('\n')), diffView(answer.snapshot.diff),
          button('确认续接', () => command(action, { ...extra, conflict_token: answer.conflict_token }), 'primary'),
          button('返回任务', () => openTask(id, taskDesk)),
        ]);
      } else {
        await refresh();
        await openTask(id, taskDesk);
      }
    };
    if (RUNNING.has(task.status)) {
      const pause = button(task.stop_reason ? '停止中…' : '暂停', () => command('pause'));
      pause.disabled = Boolean(task.stop_reason);
      actions.append(pause, button('终止', () =>
        confirmedDialog('终止任务', '将停止当前 CLI 进程组。', '确认终止', () => command('cancel'))));
    }
    if (task.status === 'recovery_pending') {
      if (task.native_session_id) actions.append(button('原会话续接', () => command('native'), 'primary'));
      actions.append(button('带断点上下文续跑', () => confirmedDialog(
        '确认断点续跑', '将依据当前任务目标、变更摘要和日志开始一次新的执行。', '确认续跑',
        () => command('checkpoint', { confirmed: true }))));
      actions.append(button('终止', () => confirmedDialog('终止任务', '将结束这项中断任务。', '确认终止', () => command('cancel'))));
    }
    if (['review', 'completed'].includes(task.status)) {
      actions.append(button('标记已验收', () => confirmedDialog(
        '独立验收', '请确认已核对交付文件与验证证据。', '确认通过', () => command('accept'))));
    }
    if (capable('updateModelContext') && task.conversation_id !== dashboard.session.id) {
      actions.append(button('接回当前对话', () => attachTask(task)));
    }
    const desk = taskDesk;
    actions.append(button('Git Diff', async () => {
      const view = await call('app_get_task_logs', { task_id: id, limit: 1, include_diff: true });
      detailTask = null;
      showDialog('Git Diff', [diffView(view.snapshot?.diff || '暂无差异'), button('返回日志', () => openTask(id, desk))]);
    }));
    if (desk?.position) actions.append(button('换装', () => {
      $('detail').close();
      office.openSettings(desk.position, renderOffice);
    }));
    if (desk) actions.append(button('工位任务', () => openDesk(desk.engine, desk.position, true)), button('场景天气', showScene));
    const content = el('div', undefined, 'dialog-content');
    content.append(el('p', task.title), summaryText(
      [engines[task.engine], labels[task.status], task.cwd, task.error || task.recovery_reason].filter(Boolean).join(' · ')), actions);
    if (task.changed_files.length) content.append(el('h3', '变更文件'), el('pre', task.changed_files.join('\n')));
    if (data.snapshot) {
      const snapshot = data.snapshot;
      content.append(el('h3', '中断现场'),
        summaryText(`Git HEAD ${snapshot.git_head_before || '—'} → ${snapshot.git_head_now || '—'}`),
        el('pre', Object.entries(snapshot.git_status).map(([path, status]) => status + ' ' + path).join('\n') || '工作区无 Git 变更'),
        diffView(snapshot.diff || '无可显示的 Git 差异'));
    }
    const logHeader = el('header', undefined, 'section-head');
    logHeader.append(el('h3', '执行日志'));
    if (data.before) logHeader.append(button('更早', () => loadTask(id, false, data.before)));
    if (before !== null) logHeader.append(button('回到最新', () => loadTask(id)));
    const log = el('pre', data.text || '暂无输出');
    content.append(logHeader, log);
    const previous = $('task-log-tail');
    const pinned = !previous || previous.scrollTop + previous.clientHeight >= previous.scrollHeight - 12;
    log.id = 'task-log-tail';
    const dialog = $('detail');
    const top = dialog.scrollTop;
    showDialog(engines[task.engine] + ' · 工位任务', [content]);
    if (quiet) dialog.scrollTop = top;
    log.scrollTop = pinned && before === null ? log.scrollHeight : previous?.scrollTop || 0;
  }

  function formatBytes(size) {
    if (size < 1024) return size + ' B';
    if (size < 1024 ** 2) return (size / 1024).toFixed(1) + ' KiB';
    return (size / 1024 ** 2).toFixed(1) + ' MiB';
  }

  function fileAction(action, file, extra = {}) {
    return call('app_file_action', {
      action, path: file.path, conversation_id: file.conversation ?? scopeArgs().conversation_id, ...extra,
    });
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        tell('已复制');
        return;
      } catch { /* Sandboxed hosts may require the legacy clipboard path. */ }
    }
    const input = el('textarea');
    input.value = text;
    input.className = 'sr-only';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (copied) tell('已复制');
    else {
      detailTask = null;
      input.className = '';
      input.rows = 9;
      input.readOnly = true;
      showDialog('复制内容', [input]);
      input.select();
    }
  }

  async function openPreview(file) {
    if (!file.exists && file.git_status) return openDiff(file);
    const safeFile = await fileAction('info', file);
    await previewInHost(host, safeFile, async () => {
      const preview = await fileAction('read_preview', file);
      if (preview.file) {
        detailTask = null;
        showDialog(file.name, [el('p', preview.preview_reason),
          summaryText([preview.file.mime, formatBytes(preview.file.size), preview.file.path].join(' · ')),
          button('用默认应用打开', () => fileAction('open_default', file), 'primary')]);
        return;
      }
      const content = preview.image ? el('img', undefined, 'preview-img') : el('pre', preview.text);
      if (preview.image) {
        content.src = `data:${preview.mime};base64,${preview.image}`;
        content.alt = file.name;
      }
      detailTask = null;
      showDialog(file.name, [content]);
    });
  }

  async function openDiff(file) {
    const data = await fileAction('git_diff', file);
    detailTask = null;
    showDialog('Git Diff · ' + file.name, [diffView(data.text || '暂无差异')]);
  }

  async function reviewFile(file, engine) {
    const conversation = file.conversation || scopeArgs().conversation_id;
    const info = await fileAction('info', file);
    const roots = dashboard.session.workspaces || [];
    detailTask = null;
    if (dashboard.session.read_only || !conversation || !roots.length) {
      showDialog('转交其他 Agent 复核', [el('p', '请在这个项目的 Antigravity 会话中打开工坊，登记工作区后即可派单。')]);
      return;
    }
    const goal = el('textarea');
    goal.rows = 3;
    goal.value = engine === 'codex' ? '核查内容完整性与正确性，列出问题、依据和验收结论。' :
      '给出语言润色建议与修改示例，保留事实、语义和作者风格。';
    const cwd = el('select');
    const options = info.workspace ? [info.workspace] : roots;
    cwd.replaceChildren(...options.map(path => option(path, path)));
    cwd.value = options[0];
    const submit = button('确认交给 ' + engines[engine], async () => {
      const instructions = goal.value.trim();
      if (!instructions) throw new Error('请填写复核要求');
      if (submit.disabled) return;
      submit.disabled = true;
      let row;
      try {
        const checked = await fileAction('info', file);
        row = await call('app_task_action', { action: 'dispatch', engine, cwd: cwd.value, conversation_id: conversation,
          write: false, declared_files: checked.workspace === cwd.value ? [checked.path] : [],
          prompt: '请只读复核以下文件，将结论写入任务回复。\n' + checked.path + '\n\n' + instructions });
      } catch (error) {
        submit.disabled = false;
        throw error;
      }
      $('detail').close();
      tell('已交给 ' + engines[engine] + ' · ' + row.id);
      await openTask(row.id);
    }, 'primary');
    showDialog('转交其他 Agent 复核', [el('p', info.path), field('执行工作区', cwd),
      field('复核要求', goal), summaryText('执行端将只读查看该文件，结果可在工位任务中查看。'), submit]);
  }

  function closeMenu(restore = false) {
    $('context-menu').hidden = true;
    if (restore) menuInvoker?.focus();
    menuInvoker = null;
  }

  function openMenu(file, x, y, trigger) {
    closeAttributes();
    const menu = $('context-menu');
    menuInvoker = trigger;
    menuAnchor = { x, y };
    const run = handler => { closeMenu(true); return handler(); };
    const act = (action, extra) => () => fileAction(action, file, extra);
    const copy = action => async () => copyText((await fileAction(action, file)).text);
    const groups = [];
    if (file.exists) {
      const external = fileState.editors.map(editor => [editor, act('open_app', { editor })]);
      groups.push([
        [isGlobalView(host.getHostContext()) ? '在工坊预览' : '右侧原生预览', () => openPreview(file), '↵'],
        ['访达中显示', act('reveal_finder')], ['用默认应用打开', act('open_default')],
        ...(external.length ? [['用外部编辑器打开', external, '›']] : []),
      ], [
        ['复制绝对路径', copy('copy_path')],
        ...(file.relative ? [['复制相对路径', copy('copy_relative')]] : []),
        ['复制 Markdown 链接', copy('copy_markdown')],
        ...(file.size < 512 * 1024 ? [['复制文件文本内容', copy('read_text')]] : []),
      ], [
        ['翻译此文件', () => beginFileTranslation(file)],
        ['转交其他 Agent 复核', [
          ['交给 Codex 验收', () => reviewFile(file, 'codex')],
          ['交给 Qoder 润色', () => reviewFile(file, 'qoder')],
        ], '›'],
        ...(capable('updateModelContext') ? [['附加为 @上下文', async () => {
          const info = await fileAction('info', file);
          if (host.getHostCapabilities().updateModelContext?.resourceLink && info.uri) {
            return attach({ type: 'resource_link', uri: info.uri, name: info.name || baseName(info.path), mimeType: info.mime });
          }
          let text = info.path;
          if (info.size < 512 * 1024) {
            try { text += '\n\n' + (await fileAction('read_text', file)).text; } catch { /* Attach the validated path for binary files. */ }
          }
          await attach(text.slice(0, 48000));
        }]] : []),
      ]);
    }
    if (file.workspace) groups.push([['查看 Git Diff', () => openDiff(file)]]);
    groups.push([
      ...(file.exists && !dashboard.session.read_only ? [
        ['复制导出到工作区', () => destinationDialog(file, 'export_copy', '导出副本', '工作区子目录')],
        ['改名', () => destinationDialog(file, 'rename', '改名', '新文件名', file.name)],
        ['移到废纸篓', () => confirmedDialog('移到废纸篓', file.path, '确认移到废纸篓', async () => {
          await fileAction('trash', file, { confirmed: true });
          $('detail').close();
          await loadFiles();
        })],
      ] : []),
    ]);
    function paint(sections) {
      const items = [];
      sections.filter(group => group.length).forEach((group, index) => {
        if (index) items.push(el('hr'));
        for (const [label, handler, hint] of group) {
          const item = button(label, () => {
            if (Array.isArray(handler)) paint([[['返回上一级', () => paint(groups), '‹']], handler]);
            else if (label === '返回上一级') handler();
            else return run(handler);
          });
          if (hint) item.append(el('kbd', hint));
          if (Array.isArray(handler)) item.setAttribute('aria-haspopup', 'menu');
          item.setAttribute('role', 'menuitem');
          items.push(item);
        }
      });
      menu.replaceChildren(...items);
      menu.hidden = false;
      menu.style.left = '0px';
      menu.style.top = '0px';
      const box = menu.getBoundingClientRect();
      menu.style.left = Math.max(4, Math.min(menuAnchor.x, innerWidth - box.width - 5)) + 'px';
      menu.style.top = Math.max(4, Math.min(menuAnchor.y, innerHeight - box.height - 5)) + 'px';
      menu.querySelector('button')?.focus();
    }
    paint(groups);
  }

  function destinationDialog(file, action, title, label, initial = '') {
    detailTask = null;
    const input = textInput(initial);
    input.required = true;
    let value = () => input.value.trim();
    const form = el('form');
    if (action === 'export_copy') {
      const root = el('select');
      root.append(...(dashboard.session.workspaces || []).map(path => option(path, path)));
      form.append(field('目标工作区', root));
      value = () => root.value + '/' + input.value.trim().replace(/^\/+/, '');
    }
    const submit = el('button', '确认', 'primary');
    form.append(field(label, input), submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      submit.disabled = true;
      safe(async () => {
        try {
          await fileAction(action, file, { destination: value() });
          $('detail').close();
          await loadFiles();
        } finally { submit.disabled = false; }
      });
    });
    showDialog(title, [form]);
  }

  function table(headers, rows, numeric = []) {
    const result = el('table');
    const head = el('thead'), headline = el('tr'), body = el('tbody');
    headers.forEach((item, index) => headline.append(el('th', item, numeric.includes(index) ? 'number' : '')));
    head.append(headline);
    for (const row of rows) {
      const line = el('tr');
      row.forEach((item, index) => line.append(el('td', item, numeric.includes(index) ? 'number' : '')));
      body.append(line);
    }
    result.append(head, body);
    const wrap = el('div', undefined, 'scroll');
    wrap.append(result);
    return wrap;
  }

  function scopedTasks() {
    return workspace ? dashboard.tasks.filter(task => task.cwd === workspace || task.cwd?.startsWith(workspace + '/')) :
      dashboard.tasks;
  }

  function showScene() {
    $('detail').close();
    togglePanel('scene-toggle', 'scene-tools', true);
    $('scene-toggle').focus();
  }

  async function openDesk(engine, position, list = false) {
    const rows = engine === 'antigravity' ? scopedTasks() : scopedTasks().filter(task => task.engine === engine);
    const current = rows.find(task => RUNNING.has(task.status)) || rows.find(task => task.status === 'recovery_pending') ||
      rows.find(task => task.status === 'review') || rows[0];
    if (current && !list && engine !== 'antigravity') return openTask(current.id, { engine, position });
    detailTask = null;
    const adapter = dashboard.adapters.find(row => row.id === engine);
    const actions = el('div', undefined, 'actions');
    if (position) actions.append(button('换装', () => {
      $('detail').close();
      office.openSettings(position, renderOffice);
    }));
    actions.append(button('场景天气', showScene));
    const nodes = [actions];
    if (adapter) nodes.push(summaryText([adapter.ready === true ? '执行端就绪' : adapter.detail,
      adapter.version].filter(Boolean).join(' · ')));
    nodes.push(...rows.map(task => {
      const row = el('div', undefined, 'task-row');
      const control = button(task.title || task.id, () => openTask(task.id, { engine, position }));
      control.append(el('small', [labels[task.status], baseName(task.cwd)].filter(Boolean).join(' · ')));
      row.append(control);
      return row;
    }));
    if (!rows.length) nodes.push(summaryText('暂无协作任务。可在 Antigravity 对话中派单。'));
    showDialog(engine === 'antigravity' ? '吉米奈 · 主控台' : (engines[engine] || '主模型') + ' · 工位', nodes);
  }

  async function loadFiles(more = false, quiet = false) {
    const request = ++filesRequest;
    const offset = more ? fileState.rows.length : 0;
    const conversation = scopeArgs().conversation_id;
    const response = await call('app_list_files', {
      conversation_id: conversation, workspace, offset, query: $('file-search').value.trim(),
      limit: quiet ? Math.max(100, fileState.rows.length) : 100,
    });
    if (request !== filesRequest) return;
    if (quiet && (!$('context-menu').hidden || $('detail').open)) return;
    const rows = (more ? fileState.rows : []).concat(response.files.map(file => ({ ...file, conversation })));
    const previous = fileState;
    fileState = { rows, total: response.total, editors: response.editors };
    if (quiet && previous.total === response.total && JSON.stringify(previous.rows) === JSON.stringify(rows)) return;
    $('file-count').textContent = '(' + num(response.total) + ')';
    $('file-total').textContent = '(' + num(response.total) + ')';
    $('more-files').hidden = rows.length >= response.total;
    $('files').replaceChildren(...(rows.length ? rows.map(fileRow) : [el('p', '暂无匹配产物', 'empty')]));
  }

  function fileRow(file) {
    const row = el('div', undefined, 'file-row');
    const icon = { 图片: '▧', 文档: '▤', 压缩包: '▣' }[file.category] || '◇';
    const preview = button(icon + ' ' + file.name, () => openPreview(file));
    preview.title = file.path;
    preview.append(el('small', [file.relative || file.path, file.size == null ? '已删除' : formatBytes(file.size)]
      .join(' · '), 'file-meta'));
    const more = button('⋮', () => menuAtButton(), 'icon-button');
    more.setAttribute('aria-label', file.name + ' 的操作');
    more.setAttribute('aria-haspopup', 'menu');
    const menuAtButton = () => {
      const rect = more.getBoundingClientRect();
      openMenu(file, rect.right, rect.bottom, more);
    };
    row.append(preview);
    if (file.change) {
      const badge = el('span', file.change, 'badge file-change');
      badge.dataset.change = file.change;
      row.append(badge);
    }
    row.append(more);
    row.addEventListener('contextmenu', event => {
      event.preventDefault();
      openMenu(file, event.clientX, event.clientY, more);
    });
    row.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
        event.preventDefault();
        menuAtButton();
      }
    });
    return row;
  }

  async function beginFileTranslation(file) {
    detailTask = null;
    const target = el('select');
    target.append(option('auto', '自动中英互译'), option('zh', '简体中文'), option('en', 'English'));
    target.value = 'auto';
    const format = el('select');
    format.append(option('bilingual', '双语对照'), option('translation', '仅译文'));
    format.value = 'bilingual';
    const output = el('pre');
    output.hidden = true;
    let translation;
    const copy = button('复制', () => copyText(output.textContent));
    const save = button('旁存', () => run(true));
    copy.disabled = save.disabled = true;
    const translate = button('翻译', () => run(false), 'primary');
    const actions = el('div', undefined, 'actions');
    actions.append(translate, copy, save);
    format.addEventListener('change', () => {
      if (translation) output.textContent = translation[format.value];
    });
    async function run(saving) {
      translate.disabled = save.disabled = true;
      try {
        translation = await call('app_translate', { path: file.path, conversation_id: file.conversation,
          target: target.value, save: saving, save_token: saving ? translation?.save_token : null, save_format: format.value });
        output.textContent = translation[format.value];
        output.hidden = false;
        copy.disabled = false;
        if (translation.saved_path) {
          tell('已旁存 ' + baseName(translation.saved_path));
          await loadFiles();
        }
      } finally {
        translate.disabled = false;
        save.disabled = !translation || Boolean(translation.saved_path);
      }
    }
    showDialog('翻译 · ' + file.name, [el('div', file.relative || file.path, 'muted'),
      field('目标语言', target), field('显示', format), actions, output]);
    await run(false);
  }

  function tokenLabel(value) {
    if (value >= 1000) return Number((value / 1000).toFixed(value < 10000 ? 1 : 0)) + 'K';
    return num(value);
  }

  function paintPotion(time = 0, animate = false) {
    const context = $('mp-potion').getContext('2d');
    if (!context) return;
    const level = $('mp-toggle').dataset.level;
    const colors = level === 'red' ? ['#9d2947', '#fc7594'] : level === 'amber' ?
      ['#ad570e', '#ffd278'] : ['#633cce', '#ba9bff'];
    const draw = (color, x, y, w, h) => { context.fillStyle = color; context.fillRect(x, y, w, h); };
    context.clearRect(0, 0, 22, 28);
    draw('#543722', 7, 2, 8, 7); draw('#cc9052', 8, 3, 6, 4); draw('#f7c880', 8, 3, 5, 1);
    draw('#442942', 8, 8, 6, 4); draw('#442942', 6, 11, 10, 15); draw('#442942', 4, 14, 14, 10);
    draw('#e0c4ef', 9, 8, 4, 5); draw('#f4def5', 7, 12, 8, 12); draw('#f4def5', 5, 15, 12, 8);
    const ratio = Math.min(1, Math.max(0, usageState?.context?.ratio || 0));
    const height = 3 + Math.round(8 * ratio);
    draw(colors[0], 6, 24 - height, 10, height - 1);
    draw(colors[1], 6, 24 - height, 10, 1);
    draw('#fff5ef', 7, 14, 1, 3);
    if (animate) draw('#fff2ff', 9 + Math.floor(time / 190) % 4, 23 - Math.floor(time / 130) % Math.max(2, height), 1, 1);
  }

  function animatePotion(time) {
    potionFrame = 0;
    if (disposed || document.hidden || reducedMotion.matches ||
        time >= awakeUntil && !dashboard.tasks.some(task => RUNNING.has(task.status))) {
      paintPotion();
      return;
    }
    if (time - potionDraw >= 120) {
      paintPotion(time, true);
      potionDraw = time;
    }
    potionFrame = requestAnimationFrame(animatePotion);
  }

  function wake() {
    if (disposed || document.hidden) return;
    awakeUntil = performance.now() + 2000;
    office.wake();
    if (!potionFrame && !reducedMotion.matches) potionFrame = requestAnimationFrame(animatePotion);
  }

  function updateMeter(context) {
    const current = JSON.stringify([context?.ratio, context?.cache_hit_rate, context?.used_tokens,
      context?.window_tokens, context?.window_basis]);
    if (current === meterState) return;
    meterState = current;
    const ratio = context?.ratio || 0;
    $('mp-toggle').dataset.level = ratio >= .8 ? 'red' : ratio >= .65 ? 'amber' : 'purple';
    $('mp-fill').style.width = Math.min(100, ratio * 100) + '%';
    $('mp-value').textContent = context?.ratio == null ? '—' : tokenLabel(context.used_tokens) + '/' +
      (context.window_basis === 'estimate' ? '≈' : '') + tokenLabel(context.window_tokens);
    const cache = context?.cache_hit_rate;
    $('cache-value').textContent = cache == null ? '—' : Math.round(cache * 100) + '%';
    paintPotion();
  }

  function renderUsage() {
    if (!usageState || $('attributes').hidden) return;
    const state = usageState;
    const context = state.context;
    const picker = $('context-session');
    if (document.activeElement !== picker) {
      picker.replaceChildren(option('', '宿主当前会话'), ...state.recent_sessions.map(row =>
        option(row.id, [row.title || row.id.slice(0, 8), row.model, dateTime(row.updated_at)].filter(Boolean).join(' · '))));
      picker.value = observedConversation || '';
    }
    const windowLabels = { reported: '宿主报告窗口', model_label: '模型标注窗口', estimate: '估算窗口', manual: '自定义窗口' };
    const rows = context ? [el('h3', context.model + ' · ' + tokenLabel(context.window_tokens) + ' · ' +
      (windowLabels[context.window_basis] || (context.window_source === 'manual' ? '自定义窗口' : '自动窗口'))),
    summaryText('已用 / 上限 ' + num(context.used_tokens) + ' / ' + num(context.window_tokens) +
      ' · Cache ' + percent(context.cache_hit_rate) + ' · ' + (context.book?.label || '—'))] :
      [summaryText('等待本地用量记录')];
    if (context?.advice) rows.push(el('p', context.advice, 'muted'));
    const counts = row => [num(row?.input_tokens), num(row?.cache_read_tokens), num(row?.output_tokens)];
    rows.push(table(['会话', '输入', '缓存', '输出'], [
      ['主会话', ...counts(state.tokens.main)],
      ['子代理 ' + (state.tokens.subagents?.count || 0), ...counts(state.tokens.subagents)],
    ], [1, 2, 3]));
    for (const [key, label] of [['today', '今日'], ['week', '近 7 天']]) {
      const period = Object.entries(state.tokens[key]);
      rows.push(el('h3', label), period.length ? table(['模型', '输入', '缓存', '输出'],
        period.map(([model, value]) => [model, ...counts(value)]), [1, 2, 3]) : summaryText('暂无用量'));
    }
    rows.push(el('h3', 'Codex 配额'));
    const buckets = state.codex.buckets || [];
    const windows = (buckets.find(bucket => bucket.id === 'codex') || buckets[0])?.windows || [];
    for (const [label, match] of [['5 小时', row => row.window_minutes === 300 || row.window_minutes == null && row.slot === 'primary'],
      ['周度', row => row.window_minutes >= 6 * 24 * 60 || row.window_minutes == null && row.slot === 'secondary']]) {
      const quota = windows.find(match);
      const line = el('div', undefined, 'quota');
      const slot = el('progress');
      slot.max = 100;
      slot.value = quota?.remaining_percent ?? 0;
      slot.setAttribute('aria-label', 'Codex ' + label + '剩余额度');
      line.append(el('span', label), slot, el('span', quota?.remaining_percent == null ?
        (state.codex.refreshing ? '同步中' : '—') : quota.remaining_percent + '% 剩余'));
      if (quota?.resets_at) line.title = '重置时间 ' + dateTime(quota.resets_at);
      rows.push(line);
    }
    if (context?.top?.length) {
      const top = el('ol', undefined, 'steps');
      top.append(...context.top.slice(0, 5).map(row => el('li', '#' + row.step + ' ' + (row.tool || row.type) +
        ' · ≈' + num(row.estimated_tokens) + ' · ' + row.summary)));
      rows.push(el('h3', '占用最高的 5 个步骤'), top);
    }
    $('context-data').replaceChildren(...rows);
    if (document.activeElement !== $('window-size')) $('window-size').value = dashboard.prefs.context_window ?? '';
  }

  async function loadContext(force = false) {
    const request = ++contextRequest;
    const state = await call('app_context_usage', { ...scopeArgs(), force });
    if (request !== contextRequest) return;
    usageState = state;
    updateMeter(state.context);
    renderUsage();
    renderRail();
  }

  function renderThoughts() {
    const bilingual = dashboard.prefs.thought_bilingual === true;
    const renderKey = JSON.stringify([bilingual, thoughtRows]);
    if (renderKey === thoughtMarkup) return;
    thoughtMarkup = renderKey;
    const parent = $('thoughts');
    const pinned = parent.scrollTop + parent.clientHeight >= parent.scrollHeight - 16;
    const labels = { translated: '已译', translating: '翻译中', pending: '原文', error: '翻译失败', unconfigured: '待配置 API' };
    parent.replaceChildren(...(thoughtRows.length ? thoughtRows.map(row => {
      const item = el('article', undefined, 'thought');
      const header = el('header');
      const kind = row.kind === 'reply' ? '助手回复' : '思考摘要';
      header.append(el('b', kind + ' · 步骤 ' + row.step), el('small', row.model), el('small', formatTimestamp(row.timestamp)),
        el('span', labels[row.status], 'badge'));
      if (row.status === 'error' || row.status === 'pending' && !row.translation) {
        header.append(button(row.status === 'error' ? '重试' : '翻译', async () => {
          const reply = await call('app_retry_thought', { step_hash: row.hash, ...scopeArgs() });
          if (reply.error) tell(reply.error);
          await loadThoughts();
        }));
      }
      item.append(header);
      if (bilingual && row.translation) item.append(el('pre', row.text));
      item.append(el('pre', row.translation || row.text));
      if (row.error || row.truncated) item.append(el('p', [row.error, row.truncated && '原文已截取，最多 6,000 字符']
        .filter(Boolean).join(' · '), 'thought-note'));
      return item;
    }) : [el('p', '等待此对话出现助手回复或思考摘要。', 'empty')]));
    if (pinned) parent.scrollTop = parent.scrollHeight;
  }

  function formatTimestamp(value) {
    if (!value) return '';
    const date = new Date(typeof value === 'number' ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
  }

  async function loadThoughts() {
    const request = ++thoughtRequest;
    const state = await call('app_thoughts', { ...scopeArgs() });
    if (request !== thoughtRequest) return;
    thoughtRows = state.entries;
    renderThoughts();
  }

  function renderRail() {
    const byId = new Map(dashboard.sessions.map(row => [row.id, row]));
    for (const row of usageState?.recent_sessions || []) {
      const entry = byId.get(row.id);
      byId.set(row.id, { ...row, ...entry, model: entry?.model || row.model });
    }
    const sessions = [...byId.values()].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    const projects = (dashboard.projects || []).map(project => ({ label: project.name, roots: project.workspaces || [],
      id: project.conversation_id }));
    const knownRoots = new Set(projects.flatMap(project => project.roots));
    for (const row of sessions) {
      for (const root of row.workspaces || []) {
        if (!knownRoots.has(root)) {
          projects.push({ label: baseName(root), roots: [root], id: row.id });
          knownRoots.add(root);
        }
      }
    }
    const sid = scopeArgs().conversation_id;
    const key = JSON.stringify([projects, sessions, workspace, sid, observedConversation]);
    if (key === railMarkup) return;
    railMarkup = key;
    const choose = (label, title, selected, action) => {
      const node = button(label, action);
      node.title = title;
      if (selected) node.setAttribute('aria-current', 'true');
      return node;
    };
    $('projects').replaceChildren(...(projects.length ? projects.map(project => {
      const root = project.roots.length === 1 ? project.roots[0] : null;
      const label = project.label || baseName(root) || '项目';
      const title = project.roots.join('\n');
      if (!project.id) {
        const empty = summaryText(label + ' · 暂无会话');
        empty.title = title;
        return empty;
      }
      return choose(label, title, root ? root === workspace : project.id === sid,
        () => observeSession(project.id, root));
    }) :
      [summaryText('暂无已登记项目')]));
    $('sessions').replaceChildren(choose('宿主当前会话', '跟随 Antigravity 会话', !observedConversation,
      () => observeSession(null)), ...sessions.slice(0, 16).map(row => choose(
      [row.title || row.workspaces?.map(baseName).join(' / ') || row.id.slice(0, 8), row.model].filter(Boolean).join(' · '),
      row.id + ' · ' + dateTime(row.updated_at), Boolean(observedConversation) && row.id === sid,
      () => observeSession(row.id))));
  }

  async function observeSession(sid, root = null) {
    observedConversation = sid;
    workspace = root;
    closeMenu();
    observation++;
    filesRequest++;
    contextRequest++;
    thoughtRequest++;
    fileState = { rows: [], total: 0, editors: [] };
    $('files').replaceChildren(el('p', '正在读取产物…', 'empty'));
    thoughtRows = [];
    usageState = null;
    updateMeter(null);
    renderThoughts();
    renderRail();
    await refresh({ data: true });
  }
  function togglePanel(triggerId, panelId, show) {
    const panel = $(panelId);
    const next = show ?? panel.hidden;
    panel.hidden = !next;
    $(triggerId).setAttribute('aria-expanded', String(next));
    return next;
  }

  function closeAttributes() {
    togglePanel('mp-toggle', 'attributes', false);
  }

  function renderPrefs() {
    const prefs = dashboard.prefs;
    const mode = prefs.hud_theme || 'auto';
    applyHostTheme(host.getHostContext(), document.documentElement, mode);
    $('theme-toggle').textContent = mode === 'auto' ? (document.documentElement.dataset.theme === 'dark' ? '☾' : '☀') + '·' :
      mode === 'dark' ? '☾' : '☀';
    $('theme-toggle').title = '主题 · ' + ({ auto: '跟随宿主', dark: '夜空', light: '暖日' }[mode]);
    $('theme-toggle').setAttribute('aria-label', $('theme-toggle').title + '，点击切换');
    const collapsed = prefs.projects_rail_collapsed === true;
    $('layout').dataset.railCollapsed = $('projects-rail').dataset.collapsed = String(collapsed);
    $('rail-content').hidden = collapsed;
    $('rail-toggle').setAttribute('aria-expanded', String(!collapsed));
    $('rail-toggle').textContent = collapsed ? '›' : '‹';
    $('rail-toggle').title = collapsed ? '展开项目栏' : '折叠项目栏';
    const bilingual = prefs.thought_bilingual === true;
    for (const control of [$('bilingual'), $('scroll-bilingual')]) {
      control.textContent = bilingual ? '双语' : '纯中文';
      control.setAttribute('aria-pressed', String(bilingual));
    }
    $('auto-translate').checked = prefs.thought_auto_translate === true;
    renderThoughts();
  }

  async function persist(patch, extra) {
    const revision = ++prefsRevision;
    try {
      const answer = await savePreferences(patch, extra);
      if (revision === prefsRevision) {
        dashboard.prefs = answer.prefs;
        office.applyPreferences(answer.prefs);
        renderPrefs();
      }
      return answer;
    } catch (error) {
      if (revision === prefsRevision) renderPrefs();
      throw error;
    }
  }

  function apiFeedback(text) {
    $('api-feedback').textContent = text;
    $('api-feedback').hidden = !text;
  }

  function renderProvider(reset = true) {
    const select = $('translation-preset');
    const preset = providerState.selected_preset || providerState.preset;
    const config = providerState.config || providerState.presets[preset];
    if (!select.dataset.loaded) {
      select.replaceChildren(...Object.keys(providerState.presets).map(key => option(key, key)));
      select.dataset.loaded = 'true';
      for (const id of ['translation-preset', 'api-key', 'api-save', 'api-test']) $(id).disabled = false;
    }
    select.value = preset;
    const extended = preset === 'custom' || preset === 'ollama';
    $('api-custom').hidden = !extended;
    if (reset) {
      $('api-base').value = config.base_url || '';
      $('api-model').value = config.model || '';
      $('api-key').value = '';
    }
    let hostname;
    try { hostname = new URL($('api-base').value).hostname; } catch { /* Draft URL may be incomplete. */ }
    const local = preset === 'ollama' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
    $('api-key').placeholder = providerState.api_key_mask || (local ? '本机免密' : 'API Key');
    $('api-clear').hidden = !providerState.api_key_mask;
  }

  async function loadProvider(preset) {
    const request = ++providerRequest;
    const answer = await call('app_dashboard', { conversation_id: scopeArgs().conversation_id,
      settings: true, settings_preset: preset || null });
    if (request !== providerRequest) return;
    providerState = answer.translation;
    renderProvider();
  }

  async function saveApi({ remove = false } = {}) {
    const preset = $('translation-preset').value;
    if (!preset) return;
    const patch = { preset };
    if (preset === 'custom' || preset === 'ollama') {
      patch.base_url = $('api-base').value.trim();
      patch.model = $('api-model').value.trim();
    }
    const key = $('api-key').value.trim();
    const response = await persist(remove ? {} : { translation: patch },
      remove ? { key_preset: preset, remove_key: true } : key ? { key_preset: preset, api_key: key } : {});
    if (remove && response.translation.selected_preset !== preset) await loadProvider(preset);
    else {
      providerState = response.translation;
      renderProvider();
    }
    apiFeedback(remove ? '已清除密钥' : '已保存 API 设置');
    await loadThoughts();
  }

  function acceptDashboard(state, prefsAtStart = prefsRevision) {
    if (!state?.session || !Array.isArray(state.tasks) || !Array.isArray(state.adapters) || !state.prefs) {
      throw new Error('工作台回包缺少会话、任务、工位或偏好数据');
    }
    receivedDashboard = true;
    const sessionChanged = state.session.id !== dashboard.session.id;
    const prefs = pendingPrefs || prefsAtStart !== prefsRevision ? dashboard.prefs : state.prefs;
    dashboard = { ...dashboard, ...state, prefs, sessions: state.sessions || (sessionChanged ? [] : dashboard.sessions) };
    if (workspace && !state.session.workspaces?.includes(workspace)) workspace = null;
    if (!pendingPrefs) office.applyPreferences(prefs);
    if (state.translation && !providerState) {
      providerState = state.translation;
      renderProvider();
    }
    renderPrefs();
    renderOffice();
    renderRail();
    if (dashboard.tasks.some(task => RUNNING.has(task.status)) && !potionFrame && !reducedMotion.matches && !document.hidden) {
      potionFrame = requestAnimationFrame(animatePotion);
    }
    return sessionChanged;
  }

  async function refresh({ settings = false, data = false, quiet = false } = {}) {
    if (disposed || document.hidden) return;
    const request = ++refreshRequest;
    const revision = observation;
    const prefsAtStart = prefsRevision;
    const selected = observedConversation || boundConversation;
    const state = await call('app_dashboard', { conversation_id: selected, settings });
    if (disposed || document.hidden || request !== refreshRequest || revision !== observation) return;
    const sessionChanged = acceptDashboard(state, prefsAtStart);
    if (sessionChanged && !data) {
      filesRequest++;
      contextRequest++;
      thoughtRequest++;
    }
    const updates = [];
    if (data || sessionChanged || quiet) {
      updates.push(loadContext(), loadThoughts());
      if (!quiet || sessionChanged || pollCount % 3 === 0 && $('context-menu').hidden && !$('detail').open) {
        updates.push(loadFiles(false, quiet && !sessionChanged));
      }
    }
    if (detailTask && $('detail').open && !taskLog?.paging &&
        (!quiet || RUNNING.has(taskLog?.data.task.status))) updates.push(loadTask(detailTask, true));
    const results = await Promise.allSettled(updates);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (disposed || document.hidden || polling || !initialized) return;
    const busy = dashboard.tasks.some(task => RUNNING.has(task.status)) || dashboard.session.status === 'running' ||
      usageState?.codex?.refreshing || thoughtRows.some(row => row.status === 'translating');
    pollTimer = setTimeout(async () => {
      if (document.hidden || disposed) return;
      polling = true;
      pollCount++;
      try { await safe(() => refresh({ quiet: true })); }
      finally { polling = false; schedulePoll(); }
    }, busy ? 2000 : 3600);
  }

  function bindHostContext() {
    renderPrefs();
    const context = host.getHostContext();
    const conversation = context.conversationId || context['com.google.antigravity/ui']?.conversationId;
    if (conversation && boundConversation !== conversation) {
      boundConversation = conversation;
      if (initialized && !observedConversation) safe(() => observeSession(null));
    }
  }

  function selectView(view) {
    $('layout').dataset.view = view;
    for (const id of ['thoughts', 'files']) $('view-' + id).setAttribute('aria-pressed', String(id === view));
    if (view === 'files') safe(() => loadFiles());
    else safe(loadThoughts);
  }

  const on = (id, event, handler) => $(id).addEventListener(event, handler);
  on('mp-toggle', 'click', () => {
    if (togglePanel('mp-toggle', 'attributes')) { renderUsage(); safe(loadContext); }
  });
  on('attributes-close', 'click', () => { closeAttributes(); $('mp-toggle').focus(); });
  on('context-session', 'change', event => safe(() => observeSession(event.target.value || null)));
  on('quota-refresh', 'click', () => safe(async () => { await loadContext(true); schedulePoll(); }));
  on('window-form', 'submit', event => {
    event.preventDefault();
    safe(async () => { await persist({ context_window: Number($('window-size').value) }); await loadContext(); });
  });
  on('window-auto', 'click', () => safe(async () => {
    await persist({ context_window: null });
    $('window-size').value = '';
    await loadContext();
  }));
  on('compact', 'click', () => safe(async () => {
    if (capable('message')) {
      try {
        const reply = await host.sendMessage('/compact');
        if (!reply?.isError) { tell('已向宿主发送 /compact'); return; }
      } catch (error) {
        if (error.code !== -32601) throw error;
      }
    }
    await copyText('/compact');
  }));
  on('theme-toggle', 'click', () => safe(() => {
    const mode = dashboard.prefs.hud_theme || 'auto';
    const hostTheme = host.getHostContext().theme === 'dark' ? 'dark' : 'light';
    const opposite = hostTheme === 'dark' ? 'light' : 'dark';
    const next = mode === 'auto' ? opposite : mode === opposite ? hostTheme : 'auto';
    return persist({ hud_theme: next });
  }));
  on('rail-toggle', 'click', () => safe(() => persist({ projects_rail_collapsed: !dashboard.prefs.projects_rail_collapsed })));
  on('scene-toggle', 'click', () => togglePanel('scene-toggle', 'scene-tools'));
  on('refresh', 'click', connectAndLoad);
  on('connection-retry', 'click', connectAndLoad);
  on('view-thoughts', 'click', () => selectView('thoughts'));
  on('view-files', 'click', () => selectView('files'));
  for (const id of ['bilingual', 'scroll-bilingual']) {
    on(id, 'click', () => safe(() => persist({ thought_bilingual: !dashboard.prefs.thought_bilingual })));
  }
  on('api-toggle', 'click', () => safe(async () => {
    if (togglePanel('api-toggle', 'api-bar')) {
      closeAttributes();
      if (!providerState) await loadProvider();
    }
  }));
  on('translation-preset', 'change', event => {
    apiFeedback('');
    $('api-key').value = '';
    safe(() => loadProvider(event.target.value));
  });
  on('api-base', 'input', () => { if (providerState) renderProvider(false); });
  on('api-bar', 'submit', event => {
    event.preventDefault();
    const submit = event.submitter;
    if (submit) submit.disabled = true;
    safe(async () => { try { await saveApi(); } finally { if (submit) submit.disabled = false; } });
  });
  on('api-clear', 'click', () => safe(() => saveApi({ remove: true })));
  on('api-test', 'click', () => safe(async () => {
    const preset = $('translation-preset').value;
    if (!preset || !providerState) return;
    const config = providerState.config;
    if ($('api-key').value || !$('api-custom').hidden && config && (
      $('api-base').value.trim() !== config.base_url || $('api-model').value.trim() !== config.model)) {
      apiFeedback('请先保存更改，再测试连通性。');
      return;
    }
    $('api-test').disabled = true;
    apiFeedback('正在测通…');
    try {
      const result = await call('app_test_api', { preset });
      if ($('translation-preset').value === preset) apiFeedback(result.ok ?
        result.model + ' · ' + result.latency_ms + ' ms' : result.error);
    } finally { $('api-test').disabled = false; }
  }));
  on('auto-translate', 'change', event => safe(async () => {
    await persist({ thought_auto_translate: event.target.checked });
    await loadThoughts();
    schedulePoll();
  }));
  on('more-files', 'click', () => safe(() => loadFiles(true)));
  let searchDebounce;
  on('file-search', 'input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => safe(() => loadFiles()), 140);
  });
  on('detail', 'close', () => {
    if ($('detail').open) return;
    detailTask = null;
    detailRequest++;
  });

  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('#context-menu') && event.target !== menuInvoker) closeMenu();
    if (!event.target.closest('#attributes, #mp-toggle')) closeAttributes();
    if (!event.target.closest('#scene-tools, #scene-toggle')) togglePanel('scene-toggle', 'scene-tools', false);
    wake();
  });
  document.addEventListener('pointermove', wake, { passive: true });
  document.addEventListener('keydown', event => {
    wake();
    if ($('context-menu').hidden) {
      if (event.key === 'Escape' && !$('attributes').hidden) {
        closeAttributes();
        $('mp-toggle').focus();
      }
      return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      closeMenu(event.key === 'Escape');
      return;
    }
    const items = [...$('context-menu').querySelectorAll('button')];
    const index = items.indexOf(document.activeElement);
    const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length,
      Home: 0, End: items.length - 1 }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    }
  });
  window.addEventListener('resize', () => closeMenu());
  function stopActivity() {
    clearTimeout(pollTimer);
    clearTimeout(searchDebounce);
    cancelAnimationFrame(potionFrame);
    potionFrame = 0;
    awakeUntil = 0;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopActivity();
    else if (initialized && !disposed) safe(async () => {
      await refresh({ data: true });
      schedulePoll();
    });
  });

  host.on('ui/notifications/tool-input', params => {
    if (params.arguments?.conversation_id) boundConversation = params.arguments.conversation_id;
  });
  host.on('ui/notifications/tool-result', params => {
    if (disposed || observedConversation) return;
    try {
      const state = WorkbenchHost.resultData(params, '打开工作台');
      acceptDashboard(state);
    } catch (error) {
      connectionError(error);
    }
  });
  host.on('ui/notifications/host-context-changed', bindHostContext);
  host.on('ui/resource-teardown', () => { disposed = true; stopActivity(); office.hide(); });
  host.on('ui/notifications/tool-cancelled', () => tell('宿主已取消工具调用'));

  function connectionError(error) {
    $('connection-status').textContent = (initialized ? '工作台数据读取失败：' : '宿主连接失败：') + error.message;
    $('connection').hidden = false;
  }

  async function connectAndLoad() {
    if (reconnecting || disposed) return;
    reconnecting = true;
    $('connection-retry').disabled = true;
    try {
      if (!initialized) {
        await host.connect();
        if (disposed) return;
        initialized = true;
        bindHostContext();
      }
      if (!document.hidden) {
        await refresh({ settings: true, data: true });
        $('connection').hidden = true;
        schedulePoll();
      }
    } catch (error) {
      connectionError(error);
    } finally {
      $('connection-retry').disabled = false;
      reconnecting = false;
    }
  }

  updateMeter(null);
  renderOffice();
  connectAndLoad();
})();
