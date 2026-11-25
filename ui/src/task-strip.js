(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = $('task-strip');
  const host = new WorkbenchHost();
  const running = new Set(['queued', 'dispatching', 'running']);
  const done = new Set(['completed', 'review', 'accepted']);
  const engines = { codex: 'Codex', qoder: 'Qoder CN', gemini: 'Gemini' };
  const sprites = { codex: 'gpt-dragon', qoder: 'dayu', gemini: 'gemini' };
  let task, ready = false, closed = false, working = false, timer, polling = false, generation = 0;
  let lines = [], snapshot, spriteName, review;
  let prefs = {}, observer, followUp = '';

  function notifyError(message = '') {
    $('strip-error').textContent = message;
    $('strip-error').hidden = !message;
  }

  function clock(row) {
    const seconds = Math.max(0, Math.floor(Date.now() / 1000 - (row.started_at || row.created_at || Date.now() / 1000)));
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }

  function drawAvatar() {
    const name = prefs.office_desks?.find(row => row.endpoint === task.engine)?.sprite || sprites[task.engine];
    if (name === spriteName) return;
    spriteName = name;
    const sheet = window.ModelDeskOfficeSprites[name];
    if (!sheet) return;
    const image = new Image();
    image.onload = () => {
      const context = $('avatar').getContext('2d');
      if (spriteName !== name || !context) return;
      context.clearRect(0, 0, 36, 36);
      context.imageSmoothingEnabled = false;
      const scale = 32 / Math.max(sheet.w, sheet.h);
      const width = Math.round(sheet.w * scale), height = Math.round(sheet.h * scale);
      context.drawImage(image, 0, 0, sheet.w, sheet.h, Math.round((36 - width) / 2), 34 - height, width, height);
    };
    image.src = sheet.src;
  }

  function render() {
    root.dataset.visible = String(!document.hidden && !closed);
    if (!task) return;
    const status = task.status;
    const active = running.has(status);
    root.dataset.state = active ? 'active' : done.has(status) ? 'done' : status;
    $('engine').textContent = engines[task.engine] || task.engine;
    $('task-title').textContent = task.title || task.id;
    $('task-title').title = task.title || task.id;
    $('task-state').textContent = active ? '[RUN ' + clock(task) + ']' : status === 'recovery_pending' ? '[PAUSED · 可续接]' :
      status === 'review' ? '[待验收]' : status === 'accepted' ? '[已验收 ✓]' :
      done.has(status) ? '[DONE ✓]' : status === 'failed' ? '[FAILED]' : status === 'cancelled' ? '[CANCELLED]' : '';
    $('latest-log').textContent = task.error || lines.at(-1) || '等待执行日志';
    $('tail').textContent = lines.join('\n') || '暂无日志';
    $('toggle-log').disabled = false;
    const action = $('task-action');
    action.hidden = !active && status !== 'recovery_pending';
    action.disabled = working || Boolean(task.stop_reason && active) || Boolean(review);
    action.textContent = active ? (task.stop_reason ? '停止中…' : '暂停') :
      task.native_session_id ? '原会话续接' : '核对断点';
    drawAvatar();
  }

  function accept(next) {
    if (!next?.id || !next.status || !next.engine) return;
    if (task?.id !== next.id) {
      generation++;
      lines = [];
      snapshot = null;
      clearReview();
    } else if (task.updated_at > next.updated_at) return;
    task = next;
    render();
  }

  function schedule() {
    clearTimeout(timer);
    if (ready && !closed && !document.hidden && !working && !polling && running.has(task?.status)) {
      timer = setTimeout(readLogs, 2000);
    }
  }

  async function readLogs() {
    if (!ready || !task || closed || document.hidden || polling || working) return;
    const current = generation;
    polling = true;
    try {
      const data = await host.callServerTool('app_get_task_logs', { task_id: task.id, limit: 15 });
      if (closed || current !== generation || !data.task || data.task.id !== task.id) return;
      lines = (data.text || '').trimEnd().split(/\r?\n/).slice(-15);
      snapshot = data.snapshot;
      accept(data.task);
      notifyError();
    } catch (error) {
      if (!closed && current === generation) notifyError(error.message || '日志读取失败');
    } finally {
      polling = false;
      schedule();
    }
  }

  function clearReview() {
    review = null;
    $('resume-review').hidden = true;
  }

  function showReview(data, action, confirmed) {
    const evidence = data.snapshot || snapshot;
    review = { action, confirmed: action === 'checkpoint' || confirmed, token: data.conflict_token || null };
    $('tail').hidden = true;
    $('toggle-log').setAttribute('aria-expanded', 'false');
    $('resume-diff').textContent = [data.files?.join('\n'), evidence?.diff || evidence?.log || '暂无 Git 差异']
      .filter(Boolean).join('\n\n');
    $('resume-confirm').textContent = action === 'native' ? '确认续接' : '确认断点续跑';
    $('resume-review').hidden = false;
    render();
  }

  async function command(action, confirmed = false, conflict_token = null) {
    if (!task || working || closed || document.hidden) return;
    working = true;
    clearTimeout(timer);
    const current = ++generation;
    render();
    try {
      const data = await host.callServerTool('app_task_action', {
        task_id: task.id, action, confirmed, conflict_token, prompt: followUp,
      });
      if (closed || current !== generation) return;
      if (data.status === 'conflict' || data.status === 'confirmation_required') {
        showReview(data, action, confirmed);
      } else {
        followUp = '';
        clearReview();
        accept(data);
      }
      notifyError();
    } catch (error) {
      if (current === generation && !closed) notifyError(error.message || '任务操作失败');
    } finally {
      working = false;
      render();
      schedule();
    }
  }

  $('toggle-log').addEventListener('click', () => {
    if (review) clearReview();
    $('tail').hidden = !$('tail').hidden;
    $('toggle-log').setAttribute('aria-expanded', String(!$('tail').hidden));
    render();
  });
  $('task-action').addEventListener('click', () => command(running.has(task.status) ? 'pause' :
    task.native_session_id ? 'native' : 'checkpoint'));
  $('resume-confirm').addEventListener('click', () => {
    if (review) command(review.action, review.confirmed, review.token);
  });
  $('resume-dismiss').addEventListener('click', () => { clearReview(); render(); });

  const theme = () => applyHostTheme(host.getHostContext(), document.documentElement, prefs.hud_theme);
  host.on('ui/notifications/host-context-changed', theme);
  host.on('ui/notifications/tool-input', params => {
    followUp = typeof params.arguments?.follow_up_prompt === 'string' ? params.arguments.follow_up_prompt : '';
  });
  host.on('ui/notifications/tool-result', params => {
    let next;
    try { next = WorkbenchHost.resultData(params, '任务回执'); }
    catch (error) { notifyError(error.message); return; }
    if (next?.status === 'conflict' || next?.status === 'confirmation_required') {
      if (next.task) {
        accept(next.task);
        showReview(next, next.resume_mode === 'native' ? 'native' : 'checkpoint', false);
      } else {
        $('task-title').textContent = '续接前需要在工作台核对';
        notifyError('请在工位对话框确认现场后续接。');
      }
      return;
    }
    followUp = '';
    accept(next);
    if (ready && task && !document.hidden) {
      if (running.has(task.status)) schedule();
      else readLogs();
    }
  });
  host.on('ui/notifications/tool-cancelled', () => notifyError('宿主已取消工具调用'));
  host.on('ui/resource-teardown', () => {
    closed = true;
    clearTimeout(timer);
    observer?.disconnect();
    render();
  });
  document.addEventListener('visibilitychange', () => {
    render();
    if (document.hidden) clearTimeout(timer);
    else schedule();
  });

  async function init() {
    await host.connect();
    if (closed) return;
    ready = true;
    theme();
    render();
    if (task && !running.has(task.status)) readLogs();
    else schedule();
    if (typeof ResizeObserver !== 'undefined') {
      let last;
      observer = new ResizeObserver(() => {
        const height = Math.ceil(root.getBoundingClientRect().height);
        const width = document.documentElement.clientWidth;
        const key = width + ':' + height;
        if (!closed && key !== last && height > 0) {
          last = key;
          host.notify('ui/notifications/size-changed', { width, height });
        }
      });
      observer.observe(root);
    }
    try {
      const data = await host.callServerTool('app_dashboard', { conversation_id: task?.conversation_id });
      if (!closed) { prefs = data.prefs || {}; theme(); render(); }
    } catch { /* Initial host theme and default sprite remain available. */ }
  }

  init().catch(error => notifyError(error.message));
})();
