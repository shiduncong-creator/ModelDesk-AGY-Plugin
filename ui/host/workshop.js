(() => {
  'use strict';
  const engineNames = { codex: 'Codex', qoder: 'Qoder CN', gemini: 'Gemini', antigravity: 'Antigravity' };
  const statuses = { queued: '排队', dispatching: '派单中', running: '执行中', review: '待验收', completed: '已完成',
    accepted: '已验收', recovery_pending: '等待续接', failed: '失败', cancelled: '已终止',
    waiting: '等待中', cancelling: '停止中', idle: '空闲', unknown: '状态待同步' };
  const running = new Set(['queued', 'dispatching', 'running']);
  const priority = { running: 6, dispatching: 5, queued: 4, waiting: 3, cancelling: 3, recovery_pending: 2, review: 1, completed: 1 };
  const stationPose = { running:'running', dispatching:'queued', queued:'queued', cancelling:'attention',
    waiting:'queued', review:'review', recovery_pending:'attention', failed:'attention', cancelled:'attention', unknown:'unavailable' };
  const pendingReview = new Set(['review', 'completed']);
  const fileMenus = new WeakMap();
  const defaultDesks = ['codex', 'qoder', 'gemini'].map(endpoint => ({ endpoint }));
  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iso = seconds => seconds ? new Date(seconds * 1000).toISOString() : undefined;
  const basename = value => String(value || '').split('/').filter(Boolean).at(-1) || '';

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function mount(element, { call, conversationId, mode, openTranslationSettings, openFile, onChange, sizeControl } = {}) {
    const root = node('section');
    root.dataset.mdWorkshop = '';
    root.dataset.mode = mode || (conversationId ? 'chat' : 'home');
    root.setAttribute('aria-label', '互动工坊');
    root.innerHTML = `<header class="mdw-bar"><div role="group" aria-label="工坊内容">
      <button type="button" data-mdw-tab="room" aria-pressed="true">互动工坊</button>
      <button type="button" data-mdw-tab="files" aria-pressed="false">本轮产物 <span data-mdw-count></span></button>
      </div><div class="mdw-view-controls"><button type="button" data-mdw-scene aria-expanded="false">场景设置</button></div></header>
      <div class="office-scene" id="pixel-office"><div id="scene-tools" hidden></div>
      <div class="office-room"><canvas width="640" height="360" aria-label="像素工坊木屋与庭院，点角色打招呼，点桌面查看工位"></canvas></div>
      <div class="mdw-seats" role="group" aria-label="小队工位"></div>
      <div class="mdw-models" aria-label="会话模型动态" hidden></div>
      <div class="mdw-interactions"></div></div>
      <section class="mdw-files" aria-label="本轮产物" hidden><input type="search" aria-label="搜索产物" placeholder="搜索文件名或路径"><div class="mdw-list"></div></section>
      <p class="mdw-status" role="status" hidden></p>`;
    element.append(root);
    const $ = selector => root.querySelector(selector);
    if (sizeControl) $('.mdw-view-controls').prepend(sizeControl);
    const room = $('.office-scene'), canvas = $('canvas'), tools = $('#scene-tools'), seats = $('.mdw-seats');
    const filesPanel = $('.mdw-files'), list = $('.mdw-list'), notice = $('.mdw-status');
    const office = window.ModelDeskCreateOffice({ workbenchRoom: true, ambientIdle: true, dialogParent: root, theme: () => state.theme });
    let state = { tasks: [], files: [], session: {}, prefs: {}, adapters: [] };
    let alive = true, dialog, dialogVersion = 0, lastOffice, lastSeats, lastFiles, currentTab = 'room', prefsQueue = Promise.resolve();
    let poll, searchToken = 0, fileQuery = '', searchRows, fileSeed = '', activeTask = null, currentLog = null;
    let lastModels, deskActivity;
    const sid = () => conversationId || null;
    const availableFiles = () => !sid() ? [] : (searchRows || state.files || []);
    const currentTasks = () => (state.tasks || []).filter(task => task.conversation_id && (sid() ?
      task.conversation_id === sid() : running.has(task.status) || pendingReview.has(task.status) || task.status === 'recovery_pending'));
    function nativeActivity() {
      return sid() && state.hostActivity?.conversationId === sid() ? state.hostActivity : null;
    }
    function hostRows(activity) {
      return [...(activity?.assistants || []).map(row => ({...row, kind:'助手'})),
        ...(activity?.tasks || []).map(row => ({...row, kind:'后台任务'}))];
    }
    const isLive = row => (priority[row.state] || 0) >= 3;
    function renderModelStatus(activity, rows, leadState) {
      const models = $('.mdw-models'), leadModel = activity?.lead?.model || state.session?.model;
      const assistants = rows.filter(row => row.kind === '助手');
      const active = assistants.filter(isLive);
      const shown = active.length ? active : assistants.slice(0,1);
      const labels = [];
      if (sid() && leadModel) labels.push(['主模型', leadModel, statuses[leadState] || leadState]);
      for (const row of shown) labels.push(['助手', row.model || row.label || engineNames[row.engine] || '模型', statuses[row.state] || '状态待同步']);
      for (const row of rows.filter(r => r.kind === '后台任务' && isLive(r))) {
        labels.push([engineNames[row.engine] || '后台', row.model || row.label || '后台任务', statuses[row.state]]);
      }
      const key = JSON.stringify(labels);
      if (lastModels === key) return;
      lastModels = key;
      models.replaceChildren(...labels.map(([kind,name,status]) => {
        const line = node('div');
        line.append(node('b',kind), node('span',name), node('small',status));
        line.title = [kind,name,status].join(' · ');
        return line;
      }));
      models.hidden = !labels.length;
    }
    function refreshDeskActivity(rows) {
      if (!deskActivity) return;
      const {panel,engine,empty} = deskActivity;
      const selected = rows.filter(row => engine === 'antigravity' || row.engine === engine);
      const active = selected.filter(isLive);
      const latest = selected.filter(row => !isLive(row)).slice(0,5);
      const key = JSON.stringify([...active, ...latest]);
      if (key === deskActivity.key) return;
      deskActivity.key = key;
      empty.hidden = selected.length > 0 || deskActivity.local;
      panel.hidden = !selected.length;
      panel.replaceChildren(node('h3','宿主派单与助手'), ...[...active,...latest].map(row => {
        const line = node('p');
        line.append(node('b',statuses[row.state] || '状态待同步'), document.createTextNode(' · ' +
          [...new Set([row.model, row.label || row.kind].filter(Boolean))].join(' · ')));
        return line;
      }));
    }
    function report(error) {
      if (!alive) return;
      const status = dialog?.open ? dialog.querySelector('[role=status]') : notice;
      if (!status) return;
      status.textContent = error.message || String(error);
      status.hidden = false;
    }
    function button(label, run, primary = false) {
      const control = node('button', label);
      control.type = 'button';
      if (primary) control.className = 'mdw-primary';
      control.addEventListener('click', async () => {
        if (control.disabled || !alive) return;
        control.disabled = true;
        try { await run(); } catch (error) { report(error); } finally { control.disabled = false; }
      });
      return control;
    }
    function closeDialog() {
      dialogVersion++;
      activeTask = null;
      currentLog = null;
      deskActivity = null;
      clearTimeout(poll);
      if (dialog) { const old = dialog; dialog = undefined; old.close(); old.remove(); }
    }
    function show(title, children) {
      closeDialog();
      if (!alive) return;
      const view = node('dialog', undefined, 'mdw-dialog');
      view.setAttribute('aria-label', title);
      const header = node('header');
      header.append(node('h2', title), button('关闭', closeDialog));
      const status = node('p', undefined, 'mdw-status'); status.setAttribute('role', 'status'); status.hidden = true;
      view.append(header, ...children, status);
      view.addEventListener('close', () => { if (dialog === view) closeDialog(); });
      root.append(view); dialog = view; view.showModal();
    }
    function confirmation(title, description, label, action) {
      show(title, [node('p', description), button(label, action, true)]);
    }
    function applySettings(patch) {
      const saved = prefsQueue.then(() => call('app_save_prefs', { patch }));
      prefsQueue = saved.catch(() => {});
      return saved.then(answer => {
        if (alive && answer.prefs) { state = { ...state, prefs: answer.prefs }; renderOffice(); }
        return answer;
      });
    }
    office.configurePersistence(applySettings, report);
    function showScene() {
      closeDialog();
      const visible = tools.hidden;
      tools.hidden = !visible; $('[data-mdw-scene]').setAttribute('aria-expanded', String(visible));
      if (visible) tools.querySelector('button')?.focus();
    }
    function renderOffice() {
      const all = currentTasks(), prefs = state.prefs || {}, adapters = state.adapters || [];
      const desks = prefs.office_desks || defaultDesks;
      const activity = nativeActivity(), rows = hostRows(activity);
      const leadState = activity?.lead?.state || (sid() && state.session?.status === 'running' ? 'running' :
        all.some(task => pendingReview.has(task.status)) ? 'review' : 'idle');
      const leadBusy = stationPose[leadState] === 'running';
      const nativePoses = {};
      const seatStates = desks.map(({ endpoint }) => {
        const local = all.filter(row => row.engine === endpoint).sort((a,b) => (priority[b.status] || 0) - (priority[a.status] || 0))[0];
        const assigned = rows.filter(row => row.engine === endpoint);
        const native = assigned.filter(isLive).sort((a,b) => priority[b.state] - priority[a.state])[0];
        if (native && priority[native.state] >= (priority[local?.status] || 0)) {
          nativePoses[endpoint] = stationPose[native.state];
          return [endpoint,native.state,native.model || native.label];
        }
        if (local) return [endpoint,local.status,local.title];
        // Keep the most recent receipt visible after the actor leaves its desk.
        const receipt = assigned.filter(row => ['completed','failed','cancelled'].includes(row.state))
          .sort((a,b) => (b.stepIndex ?? -1) - (a.stepIndex ?? -1))[0];
        return [endpoint,receipt?.state || 'idle',receipt?.model || receipt?.label];
      });
      renderModelStatus(activity, rows, leadState);
      refreshDeskActivity(rows);
      const seatKey = JSON.stringify([leadState,seatStates]);
      if (seatKey !== lastSeats) {
        lastSeats = seatKey;
        function tile(engine, position, name, state, label, detail) {
          const seat = button('', () => openDesk(engine, position));
          seat.dataset.state = state;
          seat.setAttribute('aria-label', name + ' · ' + label);
          seat.setAttribute('aria-haspopup', 'dialog');
          if (detail) seat.title = name + ' · ' + label + ' · ' + detail;
          seat.append(node('span', name), node('small', label));
          return seat;
        }
        seats.replaceChildren(tile('antigravity', 'lead', '吉米奈', leadState, '主控·' + (statuses[leadState] || '状态待同步')),
          ...seatStates.map(([engine, status, detail], i) => tile(engine, 'desk-' + (i + 1), engineNames[engine],
            status, statuses[status] || '状态待同步', detail)));
      }
      const key = JSON.stringify([all, adapters, prefs.office_desks, prefs.office_scene, state.theme, leadState, nativePoses, currentTab]);
      if (key === lastOffice) return;
      lastOffice = key;
      office.applyPreferences(prefs);
      if (currentTab !== 'room') { office.hide(); return; }
      const tasks = all.map(task => ({ ...task, actualStatus: task.status, status: pendingReview.has(task.status) || task.status === 'accepted' ? 'completed' : task.status,
        project: task.cwd, created_at: iso(task.created_at), ended_at: iso(task.updated_at), last_progress_at: iso(task.last_heartbeat_at) }));
      office.render({ canvas, tasks, endpoints: adapters, sync: 'ready', complete: true, compact: true,
        observedAt: new Date().toISOString(), roomScope: sid() || 'home', projectName: basename, escapeText,
        summary: task => ({ code: pendingReview.has(task.actualStatus) ? 'awaiting_review' : task.actualStatus, label: statuses[task.actualStatus] }),
        accepted: task => task.actualStatus === 'accepted', leadName: '吉米奈 · 主控台', leadActive: leadBusy,
        hostSeats: nativePoses, hostLead: activity?.lead ? (stationPose[leadState] || 'idle') : undefined,
        onActor: (engine, position) => openDesk(engine, position) });
    }
    function openDesk(engine, position) {
      if (!alive) return;
      const tasks = currentTasks().filter(task => engine === 'antigravity' || task.engine === engine);
      const adapter = (state.adapters || []).find(row => row.id === engine);
      const actions = node('div', undefined, 'mdw-actions');
      if (position?.startsWith('desk-')) actions.append(button('工位配置与换装', () => { closeDialog(); office.openSettings(position, renderOffice); }));
      actions.append(button('场景与天气', () => { if (!tools.hidden) tools.hidden = true; showScene(); }));
      const children = [actions];
      if (adapter) children.push(node('p', [adapter.detail, adapter.version].filter(Boolean).join(' · ')));
      children.push(...tasks.map(task => button([task.title || task.id, !sid() && basename(task.cwd), statuses[task.status] || task.status]
        .filter(Boolean).join(' · '), () => openTask(task))));
      const nativeRows = hostRows(nativeActivity());
      const panel = node('section', undefined, 'mdw-host-rows');
      children.push(panel);
      const empty = node('p', '当前没有分配给这个工位的任务。');
      children.push(empty);
      show(engine === 'antigravity' ? '吉米奈 · 主控台' : (engineNames[engine] || engine) + ' · 工位', children);
      deskActivity = {panel,engine,empty,local:tasks.length > 0};
      refreshDeskActivity(nativeRows);
    }
    async function openTask(task, before) {
      const version = dialogVersion;
      const args = { task_id: task.id, conversation_id: task.conversation_id };
      const data = await call('app_get_task_logs', { ...args, limit: 50, ...(before ? { before } : {}) });
      if (!alive || version !== dialogVersion) return;
      const row = data.task;
      if (row.id !== task.id || row.conversation_id !== task.conversation_id) throw Error('任务归属发生变化，请重新打开工位。');
      const actions = node('div', undefined, 'mdw-actions');
      async function act(action, options = {}) {
        const token = dialogVersion;
        const answer = await call('app_task_action', { ...args, action, ...options });
        if (!alive || token !== dialogVersion) return;
        if (answer.status === 'conflict') {
          show('续接前核对工作区', [node('pre', (answer.files || []).join('\n') + '\n' + (answer.snapshot?.diff || '')),
            button('确认续接', () => act(action, { ...options, confirmed: true, conflict_token: answer.conflict_token }), true)]);
        } else if (answer.status === 'confirmation_required') {
          confirmation('从断点续跑', '将使用已保存的任务目标、文件变化和日志新开一次执行。', '确认续跑', () => act('checkpoint', { confirmed: true }));
        } else {
          onChange?.();
          await openTask(task);
        }
      }
      if (running.has(row.status)) actions.append(button('暂停', () => act('pause')));
      if (row.status === 'recovery_pending') {
        if (row.native_session_id) actions.append(button('原会话续接', () => act('native')));
        actions.append(button('从断点续跑', () => confirmation('确认断点续跑', '根据最近日志、工作区变化和任务目标开启新执行。', '确认续跑', () => act('checkpoint', { confirmed: true }))));
      }
      if (running.has(row.status) || row.status === 'recovery_pending') actions.append(button('终止', () =>
        confirmation('终止任务', row.title || row.id, '确认终止', () => act('cancel', { confirmed: true }))));
      if (pendingReview.has(row.status)) actions.append(button('独立验收', () => confirmation('独立验收', '核对交付文件与验证证据后，将此任务标记为已验收。', '确认通过', () => act('accept'))));
      actions.append(button('Git Diff', async () => {
        const token = dialogVersion;
        const diff = await call('app_get_task_logs', { ...args, limit: 1, include_diff: true });
        if (alive && token === dialogVersion) show('任务变更', [node('pre', diff.snapshot?.diff || '暂无差异'), button('返回任务', () => openTask(task))]);
      }));
      const children = [node('p', [engineNames[row.engine], statuses[row.status], row.cwd, row.error || row.recovery_reason].filter(Boolean).join(' · ')), actions];
      if (row.changed_files?.length) children.push(node('h3', '交付与变更文件'), node('pre', row.changed_files.join('\n')));
      if (data.snapshot) children.push(node('h3', '中断现场'), node('pre', data.snapshot.diff || JSON.stringify(data.snapshot.git_status || {})));
      children.push(node('h3', '执行日志'));
      const log = node('pre', data.text || '暂无输出', 'mdw-log'); children.push(log);
      if (data.before) children.push(button('更早的日志', () => openTask(task, data.before)));
      if (before) children.push(button('回到最新', () => openTask(task)));
      show(row.title || '工位任务', children);
      activeTask = row.id; currentLog = log;
      if (running.has(row.status) && !before) {
        const owner = dialogVersion;
        const refresh = async () => {
          if (!alive || owner !== dialogVersion) return;
          if (document.hidden) { poll = setTimeout(refresh, 2500); return; }
          try {
            const next = await call('app_get_task_logs', { ...args, limit: 50 });
            if (!alive || owner !== dialogVersion || !currentLog || next.task.id !== activeTask) return;
            if (next.task.status !== row.status) { await openTask(task); return; }
            currentLog.textContent = next.text || '暂无输出';
          } catch (error) { report(error); }
          if (alive && owner === dialogVersion) poll = setTimeout(refresh, 2500);
        };
        poll = setTimeout(refresh, 2500);
      }
    }
    async function listFiles(query = fileQuery, append = false) {
      if (!sid()) return;
      const request = ++searchToken, offset = append ? availableFiles().length : 0;
      const answer = await call('app_list_files', { conversation_id: sid(), query, offset, limit: 100 });
      if (!alive || request !== searchToken || query !== fileQuery) return;
      searchRows = [...(append ? availableFiles() : []), ...(answer.files || [])];
      state = { ...state, editors: answer.editors || [], fileTotal: answer.total };
      lastFiles = null; renderFiles();
    }
    const fileCall = (file, action, values = {}) => call('app_file_action', { conversation_id: sid(), path: file.path, action, ...values });
    async function preview(file) {
      const version = dialogVersion;
      if (!file.exists) {
        const diff = await fileCall(file, 'git_diff');
        if (alive && version === dialogVersion) show(file.name, [node('pre', diff.text || '暂无差异')]);
        return;
      }
      if (typeof openFile === 'function') {
        const info = await fileCall(file, 'info');
        if (!alive || version !== dialogVersion) return;
        if (await openFile(info) !== false) return;
      }
      const data = await fileCall(file, 'read_preview');
      if (!alive || version !== dialogVersion) return;
      const content = data.image ? node('img') : node('pre', data.text ?? data.preview_reason ?? '暂无文本预览');
      if (data.image) { content.src = 'data:' + data.mime + ';base64,' + data.image; content.alt = file.name; }
      show(file.name || basename(file.path), [content]);
    }
    function renameOrExport(file, action) {
      const rename = action === 'rename', input = node('input');
      input.value = rename ? file.name : file.workspace || (state.session?.workspaces || [])[0] || '';
      const label = node('label', rename ? '新文件名' : '已存在的目标工作区目录'); label.append(input);
      show(rename ? '给文件改名' : '导出副本', [node('p', file.path), label, button('确认', async () => {
        const target = input.value.trim();
        if (!target) throw Error('请输入目标名称或目录');
        await fileCall(file, action, { destination: target, confirmed: true });
        closeDialog(); await listFiles(); onChange?.();
      }, true)]);
    }
    async function translate(file) {
      if (state.translation?.configured === false && openTranslationSettings) {
        openTranslationSettings();
        return;
      }
      const version = dialogVersion;
      const result = await call('app_translate', { conversation_id: sid(), path: file.path, target: 'auto', technical: true });
      if (!alive || version !== dialogVersion) return;
      const children = [node('pre', result.bilingual || result.translation || '')];
      if (result.save_token && !state.session?.read_only) {
        for (const [key, label] of [['translation', '旁存译文'], ['bilingual', '旁存双语版']]) children.push(button(label, async () => {
          const saved = await call('app_translate', { conversation_id: sid(), path: file.path, target: 'auto', technical: true,
            save: true, save_token: result.save_token, save_format: key });
          if (alive) { show('已保存译文', [node('p', saved.saved_path)]); await listFiles(); }
        }));
      }
      if (openTranslationSettings) children.push(button('配置 API', () => { closeDialog(); openTranslationSettings(); }));
      show('文件翻译 · ' + file.name, children);
    }
    function extraCommands(file) {
      const cmd = (id, label, action) => ({ id, label, run() {
        if (!alive || !availableFiles().some(row => row.path === file.path)) throw Error('产物已变化，请重新选择文件。');
        return action();
      } });
      const groups = [];
      if (file.exists) {
        groups.push([cmd('workshop-open-default', '用默认应用打开', () => fileCall(file, 'open_default')),
          ...(state.editors || []).map((editor, i) => cmd('workshop-editor-' + i, '用 ' + editor + ' 打开', () => fileCall(file, 'open_app', { editor })))]);
        const copy = action => async () => navigator.clipboard.writeText((await fileCall(file, action)).text);
        groups.push([cmd('workshop-markdown', '复制 Markdown 链接', copy('copy_markdown')),
          ...(file.size < 512 * 1024 ? [cmd('workshop-copy-text', '复制文件文本内容', copy('read_text'))] : [])]);
        groups.push([cmd('workshop-translate', '翻译此文件', () => translate(file))]);
      }
      if (file.workspace) groups.push([cmd('workshop-diff', '查看 Git Diff', async () => {
        const result = await fileCall(file, 'git_diff');
        if (alive) show('Git Diff · ' + file.name, [node('pre', result.text || '暂无差异')]);
      })]);
      if (file.exists && !state.session?.read_only) groups.push([
        cmd('workshop-export', '复制导出到工作区', () => renameOrExport(file, 'export_copy')),
        cmd('workshop-rename', '改名', () => renameOrExport(file, 'rename')),
        cmd('workshop-trash', '移到废纸篓', () => confirmation('移到废纸篓', file.path, '确认移到废纸篓', async () => {
          await fileCall(file, 'trash', { confirmed: true }); closeDialog(); await listFiles(); onChange?.();
        }))]);
      return groups;
    }
    function renderFiles() {
      const files = availableFiles();
      $('[data-mdw-count]').textContent = String(sid() ? state.fileTotal ?? state.files?.length ?? 0 : 0);
      if (currentTab !== 'files') return;
      const key = JSON.stringify([files, fileQuery, state.fileTotal, sid(), state.session?.read_only, state.editors]);
      if (lastFiles === key) return;
      lastFiles = key;
      const rows = files.map(file => {
        const row = node('div', undefined, 'mdw-file');
        row.dataset.mdWorkshopFile = ''; row.dataset.fileUri = file.uri; row.dataset.mdRelative = file.relative || '';
        const name = button(file.name || basename(file.path), () => preview(file)); name.dataset.mdWorkshopPreview = '';
        name.title = file.path;
        if (file.change) name.append(node('small', file.change));
        const menu = button('⋯', () => {
          const box = menu.getBoundingClientRect();
          window.ModelDeskHostMenu.showFileMenu(row, box.left, box.bottom);
        });
        menu.setAttribute('aria-label', file.name + ' 的操作'); menu.setAttribute('aria-haspopup', 'menu');
        row.append(name, menu);
        fileMenus.set(row, () => extraCommands(file));
        return row;
      });
      if (!rows.length) rows.push(node('p', sid() ? '暂无匹配产物' : '开启对话后可在这里查看本轮产物。'));
      if (sid() && Number(state.fileTotal) > files.length) rows.push(button('加载更多', () => listFiles(fileQuery, true)));
      list.replaceChildren(...rows);
    }
    function selectTab(tab) {
      currentTab = tab;
      room.hidden = tab !== 'room'; filesPanel.hidden = tab !== 'files'; $('[data-mdw-scene]').hidden = tab !== 'room';
      for (const item of root.querySelectorAll('[data-mdw-tab]')) item.setAttribute('aria-pressed', String(item.dataset.mdwTab === tab));
      renderOffice(); renderFiles();
      if (tab === 'files' && sid()) listFiles().catch(report);
    }
    for (const item of root.querySelectorAll('[data-mdw-tab]')) item.addEventListener('click', () => selectTab(item.dataset.mdwTab));
    $('[data-mdw-scene]').addEventListener('click', showScene);
    tools.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        showScene();
        $('[data-mdw-scene]').focus();
      }
    });
    let debounce;
    $('.mdw-files input').addEventListener('input', event => {
      fileQuery = event.target.value.trim(); searchToken++; clearTimeout(debounce);
      debounce = setTimeout(() => listFiles().catch(report), 150);
    });
    function update(snapshot) {
      if (!alive) return;
      if (sid() && snapshot.session?.id && snapshot.session.id !== sid()) return;
      const nextSeed = JSON.stringify(snapshot.files || []);
      const filesChanged = nextSeed !== fileSeed;
      fileSeed = nextSeed;
      state = { ...snapshot, fileTotal: snapshot.fileTotal ?? state.fileTotal, editors: snapshot.editors || state.editors };
      if (filesChanged && !fileQuery) {
        searchRows = undefined;
        state.fileTotal = snapshot.fileTotal ?? snapshot.files?.length ?? 0;
      }
      renderOffice(); renderFiles();
      if (filesChanged && currentTab === 'files' && fileQuery) listFiles().catch(report);
    }
    const resize = new ResizeObserver(() => {
      if (alive && currentTab === 'room' && canvas.getClientRects().length) office.wake();
    });
    resize.observe(root);
    const destroy = () => {
      alive = false; closeDialog(); clearTimeout(debounce); searchToken++;
      resize.disconnect();
      window.ModelDeskHostMenu?.dismissFor(root);
      for (const modal of root.querySelectorAll('dialog[open]')) modal.close();
      office.destroy(); root.remove();
    };
    renderOffice(); renderFiles();
    return { update, destroy };
  }
  window.ModelDeskWorkshop = Object.freeze({ mount, fileCommands: row => fileMenus.get(row)?.() || null });
})();
