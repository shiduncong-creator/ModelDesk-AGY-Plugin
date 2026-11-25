/* Classic script used by the standalone desktop host. All data travels through
   the owning host's fixed local methods. Only the scroll's fold preference is stored here. */
(() => {
  'use strict';
  const count = new Intl.NumberFormat('zh-CN');
  let nextPanelId = 0;
  const number = value => typeof value === 'number' && Number.isFinite(value) ? count.format(value) : '—';
  const percent = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(100 * value) + '%' : '—';
  const basis = { reported: '宿主报告', model_label: '模型标注', estimate: '估算', manual: '手动设置' };
  const rowLabels = { pending: '待译', translating: '翻译中', translated: '已译', error: '翻译失败', unconfigured: '待配置' };
  const providerNames = { 'gpt-6-luna': 'OpenAI · GPT-6 Luna', 'gemini-2.5-flash-lite': 'Google · Gemini Flash Lite',
    'qwen-flash': '通义 · Qwen Flash', 'deepseek-chat': 'DeepSeek', ollama: '本机 Ollama', custom: '自定义兼容 API' };
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function button(text, action) {
    const node = el('button', 'mdi-button', text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  function group(label, control) {
    const wrap = el('label', 'mdi-field');
    wrap.append(el('span', '', label), control);
    return wrap;
  }
  function table(caption, columns, rows) {
    const scroll = el('div', 'mdi-table-scroll');
    const grid = el('table');
    const heading = el('thead');
    const head = el('tr');
    for (const title of columns) {
      const cell = el('th', '', title);
      cell.scope = 'col';
      head.append(cell);
    }
    heading.append(head);
    const body = el('tbody');
    for (const values of rows) {
      const tr = el('tr');
      values.forEach(value => tr.append(el('td', '', value)));
      body.append(tr);
    }
    grid.append(el('caption', '', caption), heading, body);
    scroll.append(grid);
    return scroll;
  }
  function localDate(value) {
    if (!value) return '';
    const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
  }
  const fraction = value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;

  function gauge() {
    const track = el('span','mdi-meter-track');
    track.setAttribute('aria-hidden','true');
    track.append(el('span','mdi-meter-fill'));
    return track;
  }
  function setGauge(track, remaining) {
    const ratio = fraction(remaining);
    track.dataset.level = ratio === null ? 'unknown' : ratio <= .2 ? 'high' : ratio <= .35 ? 'medium' : 'low';
    track.firstChild.style.width = (ratio ?? 0) * 100 + '%';
  }

  function drawPotion(canvas, remaining, level) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const draw = (color,x,y,w,h) => { ctx.fillStyle = color; ctx.fillRect(x,y,w,h); };
    ctx.clearRect(0,0,22,28);
    draw('#543722',7,2,8,7); draw('#cc9052',8,3,6,4); draw('#f7c880',8,3,5,1);
    draw('#442942',8,8,6,4); draw('#442942',6,11,10,15); draw('#442942',4,14,14,10);
    draw('#e0c4ef',9,8,4,5); draw('#f4def5',7,12,8,12); draw('#f4def5',5,15,12,8);
    if (remaining > 0) {
      const [shade,light] = level === 'high' ? ['#a23a52','#ff8d9e'] :
        level === 'medium' ? ['#ab6318','#ffd278'] : ['#6748a8','#c4a6ff'];
      const height = Math.ceil(11 * remaining);
      draw(shade,7,24-height,8,height);
      if (height > 2) draw(shade,6,Math.max(15,24-height),10,23-Math.max(15,24-height));
      draw(light,7,24-height,8,1);
    }
    draw('#fffaf7',7,14,1,3);
  }

  function quotaGroup(group) {
    const section = el('section','mdi-quota-group');
    section.append(el('h4','mdi-subheading',group.label));
    for (const window of group.windows) {
      const line = el('div','mdi-quota-window');
      const track = gauge();
      setGauge(track,window.remaining);
      line.append(el('span','',window.label),track,el('strong','',window.disabled ? '不适用' : percent(fraction(window.remaining))));
      if (window.reset) line.append(el('small','mdi-note','重置 · '+window.reset));
      section.append(line);
    }
    return section;
  }
  function providerConfigured(provider) {
    if (!provider) return false;
    const conf = provider.config;
    if (!conf?.model || !conf.base_url) return false;
    if (provider.api_key_mask) return true;
    try {
      const url = new URL(conf.base_url);
      return provider.selected_preset === 'ollama' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    } catch { return false; }
  }

  function mount(slots, options = {}) {
    let active = true;
    let prefs = {}, usage = null, accountQuota = [], lastQuota = '', lastPotion = '', thoughts = [], provider = null, selectedProvider = null;
    let sessionModel = '';
    let lastTables = '', lastRows = '', selectedPreset = '', dirty = false, providerRequest = 0;
    let prefsBusy = false, usageBusy = false, providerBusy = false;
    const id = typeof options.conversationId === 'string' && options.mode !== 'home' ? options.conversationId : null;
    const canCall = typeof options.call === 'function';
    const rpc = (name, args) => {
      if (!active || !canCall) throw Error('本地组件尚未连接');
      return options.call(name, args);
    };
    const scoped = () => ({ conversation_id:id });
    const fresh = state => !!id && state?.conversation_id === id;
    const status = el('p', 'mdi-note');
    status.setAttribute('role','status');
    const tell = text => { if (active) status.textContent = text || ''; };
    const usageNote = el('p','mdi-note');
    usageNote.setAttribute('role','status');
    let popupEvents = null, popupObserver = null, anchorFrame = 0, activePanel = null;
    const usageBox = el('div','mdi-insights mdi-usage');
    usageBox.dataset.mdInsights = 'usage';
    function makePanel(kind, title) {
      const trigger = el('button','mdi-meter mdi-'+kind);
      trigger.type = 'button';
      trigger.setAttribute('aria-haspopup','dialog');
      trigger.setAttribute('aria-expanded','false');
      const panel = el('section','mdi-insights mdi-usage-body mdi-'+kind+'-details');
      panel.id = 'md-insights-'+kind+'-'+ ++nextPanelId;
      panel.tabIndex = -1;
      panel.hidden = true;
      panel.setAttribute('popover','manual');
      panel.setAttribute('role','dialog');
      panel.setAttribute('aria-label',title);
      trigger.setAttribute('aria-controls',panel.id);
      const header = el('header','mdi-popup-title');
      const close = button('关闭',() => hideUsage(true));
      close.setAttribute('aria-label','关闭'+title);
      header.append(el('h3','mdi-pixel',title),close);
      panel.append(header);
      const pair = {trigger,panel};
      trigger.addEventListener('click',() => activePanel === pair ? hideUsage(true) : showUsage(pair));
      return pair;
    }
    const mp = makePanel('mp','MP · 会话上下文详情');
    const hp = makePanel('hp','HP · 模型账户剩余额度');
    const {trigger:summary, panel:details} = mp;
    const potion = el('canvas','mdi-potion');
    potion.width = 22; potion.height = 28; potion.setAttribute('aria-hidden','true');
    const track = gauge();
    const mpValue = el('strong','mdi-remaining');
    const tokens = el('span','mdi-tokens');
    const cache = el('span','mdi-cache');
    const meta = el('span','mdi-meter-meta'); meta.append(tokens,cache);
    const mpLine = el('span','mdi-meter-line');
    mpLine.append(el('b','mdi-pixel','MP'),el('span','mdi-stat-name','上下文'),track,mpValue);
    const mpReadout = el('span','mdi-readout'); mpReadout.append(mpLine,meta);
    const caret = () => {
      const icon = el('span','mdi-caret','▾'); icon.setAttribute('aria-hidden','true'); return icon;
    };
    summary.append(potion,mpReadout,caret());
    const heart = el('span','mdi-heart'); heart.setAttribute('aria-hidden','true');
    const hpLine = el('span','mdi-meter-line');
    const modelGroup = el('span','mdi-hp-group');
    hpLine.append(el('b','mdi-pixel','HP'),el('span','mdi-stat-name','账户额度'),modelGroup);
    const hpWindows = el('span','mdi-hp-windows');
    const hpReadout = el('span','mdi-readout'); hpReadout.append(hpLine,hpWindows);
    hp.trigger.append(heart,hpReadout,caret());
    const quotaDetails = el('div','mdi-quota-details');
    let refreshingAccount = false;
    const quotaStatus = el('p','mdi-note');
    quotaStatus.setAttribute('role','status');
    const refreshAccount = button('刷新账户额度',async () => {
      if (refreshingAccount) return;
      refreshingAccount = refreshAccount.disabled = true;
      quotaStatus.textContent = '正在刷新账户额度…';
      try {
        await options.refreshAccountQuota();
        if (active) quotaStatus.textContent = '已刷新账户额度。';
      } catch {
        if (active) quotaStatus.textContent = '账户额度刷新失败，请稍后重试。';
      } finally {
        refreshingAccount = false;
        if (active) refreshAccount.disabled = false;
      }
    });
    refreshAccount.hidden = typeof options.refreshAccountQuota !== 'function';
    hp.panel.append(refreshAccount,quotaStatus,quotaDetails);
    const tables = el('div','mdi-tables');
    const actions = el('div','mdi-actions');
    const refresh = button('刷新用量', async () => {
      if (usageBusy || !id) return;
      usageBusy = refresh.disabled = true;
      usageNote.textContent = '正在读取本地用量…';
      try {
        const state = await rpc('app_context_usage',{...scoped(),force:true});
        if (active && fresh(state)) { usage = state; renderQuota(); renderUsage(); usageNote.textContent = '用量已刷新'; }
      } catch (error) { if (active) usageNote.textContent = error.message; }
      finally { usageBusy = false; if (active) refresh.disabled = !id || !canCall; }
    });
    refresh.disabled = !id || !canCall;
    actions.append(refresh);
    if (typeof options.compact === 'function' && id) {
      const compact = button('压缩上下文 /compact',async () => {
        compact.disabled = true;
        try {
          const result = await options.compact();
          if (active) usageNote.textContent = typeof result === 'string' ? result :
            result?.message || (result?.sent ? '已发送 /compact' : '已将 /compact 交给宿主输入框');
        } catch (error) { if (active) usageNote.textContent = error.message; }
        finally { if (active) compact.disabled = false; }
      });
      actions.append(compact);
    }
    const windowForm = el('form','mdi-window');
    const windowSize = el('input');
    windowSize.type = 'number'; windowSize.min = '1'; windowSize.max = '20000000'; windowSize.step = '1';
    windowSize.placeholder = '自动'; windowSize.inputMode = 'numeric';
    let windowDirty = false;
    windowSize.addEventListener('input',() => { windowDirty = true; });
    const setWindow = el('button','mdi-button','应用窗口'); setWindow.type = 'submit';
    const resetWindow = button('恢复自动',() => setWindowSize(null));
    windowForm.append(group('上下文窗口',windowSize),setWindow,resetWindow);
    windowForm.hidden = !id;
    windowForm.addEventListener('submit',event => {
      event.preventDefault();
      const value = windowSize.valueAsNumber;
      if (Number.isInteger(value) && value > 0 && value <= 20000000) setWindowSize(value);
      else usageNote.textContent = '请输入 1 至 20,000,000 的整数。';
    });
    async function setWindowSize(value) {
      if (usageBusy || prefsBusy || !canCall || !id) return;
      usageBusy = prefsBusy = true; lock();
      try {
        const saved = await rpc('app_save_prefs',{patch:{context_window:value}});
        if (!active) return;
        prefs = saved.prefs; windowDirty = false; windowSize.value = prefs.context_window ?? '';
        const state = await rpc('app_context_usage',{...scoped(),force:false});
        if (active && fresh(state)) {
          usage = state; renderUsage();
          usageNote.textContent = value === null ? '已恢复自动判断窗口。' : '已应用手动窗口。';
        }
      } catch (error) { if (active) usageNote.textContent = error.message; }
      finally { usageBusy = prefsBusy = false; if (active) lock(); }
    }
    details.append(actions,usageNote,tables,windowForm);
    usageBox.append(summary,hp.trigger,details,hp.panel);

    function renderQuota() {
      const codex = usage?.codex;
      const familyOf = model => typeof model === 'string' &&
        model.match(/(?:^|[^a-z0-9])(gemini|claude|gpt)(?=$|[^a-z])/i)?.[1].toLowerCase();
      const family = familyOf(usage?.context?.model) || familyOf(sessionModel);
      const key = JSON.stringify([accountQuota,codex,family]);
      if (key === lastQuota) return;
      lastQuota = key;
      const groups = accountQuota.filter(group => group.label && Array.isArray(group.windows) && group.windows.length);
      const matches = family ? groups.filter(group => group.label.toLowerCase().split(/[^a-z]+/).includes(family)) : [];
      const displayed = matches.length === 1 ? matches[0] : groups[0];
      modelGroup.textContent = displayed?.label || '';
      const short = (displayed?.windows || []).map(window => {
        const line = el('span','mdi-hp-window');
        const track = gauge();
        setGauge(track,window.remaining);
        line.append(el('span','',window.label),track,el('strong','',window.disabled ? '不适用' : percent(fraction(window.remaining))));
        return line;
      });
      hpWindows.replaceChildren(...(short.length ? short : [el('span','mdi-note','等待宿主上报')]));
      const content = groups.length ? groups.map(quotaGroup) : [el('p','mdi-empty','宿主尚未提供模型账户额度。')];
      const buckets = codex?.buckets || [];
      const windows = (buckets.find(group => group.id === 'codex') || buckets[0])?.windows || [];
      if (windows.length) {
        const codexWindow = (label,win) => ({label,remaining:Number.isFinite(win?.remaining_percent) ?
          win.remaining_percent / 100 : null,reset:localDate(win?.resets_at)});
        content.push(quotaGroup({label:'本机 Codex CLI 账户',windows:[
          codexWindow('5 小时',windows.find(w => w.window_minutes === 300 || w.window_minutes == null && w.slot === 'primary')),
          codexWindow('每周',windows.find(w => w.window_minutes >= 8640 || w.window_minutes == null && w.slot === 'secondary'))]}));
      }
      quotaDetails.replaceChildren(...content);
    }
    function renderUsage() {
      const current = usage?.context;
      const measured = Number.isFinite(current?.ratio) && Number.isFinite(current.used_tokens);
      const remaining = measured ? fraction(1-current.ratio) : null;
      const used = measured ? number(current.used_tokens) : '—';
      const limit = current?.window_tokens != null ? number(current.window_tokens) : '—';
      const approximation = current?.window_basis === 'estimate' ? '（估算）' : '';
      tokens.textContent = id ? '已用 ' + used + ' / 窗口 ' + limit + approximation : '新会话 · 等待用量';
      tokens.title = '已用 / 上限（Token）';
      cache.textContent = '缓存命中 ' + percent(current?.cache_hit_rate);
      setGauge(track,remaining);
      mpValue.textContent = remaining === null ? '待上报' : '剩余 '+percent(remaining);
      const potionState = track.dataset.level + ':' + Math.ceil(11 * (remaining || 0));
      if (potionState !== lastPotion) {
        lastPotion = potionState;
        drawPotion(potion,remaining,track.dataset.level);
      }
      if (!windowDirty && document.activeElement !== windowSize) windowSize.value = prefs.context_window ?? '';
      if (activePanel !== mp) {
        if (!usage && lastTables) { lastTables = ''; tables.replaceChildren(); }
        return;
      }
      const key = JSON.stringify([usage, id]);
      if (lastTables === key) return;
      lastTables = key;
      if (!usage || !id) {
        tables.replaceChildren(el('p','mdi-empty',id ? '等待宿主记录本会话的用量。' : '新会话暂无用量记录。'));
        return;
      }
      const parts = [];
      if (current) {
        parts.push(el('p','mdi-emphasis',(current.model || '当前模型') + ' · ' + (basis[current.window_basis] || '窗口') +
          ' ' + limit + ' Token'));
        parts.push(el('p','mdi-note','剩余 ' + (measured ? number(Math.max(0,current.window_tokens-current.used_tokens)) : '—') +
          ' Token · 已用 ' + used + ' Token · 占比 ' + percent(current.ratio) + ' · ' + cache.textContent +
          (current.book?.label && measured ? ' · ' + current.book.label : '')));
        if (current.advice) parts.push(el('p','mdi-note',current.advice));
      }
      const bucket = usage.tokens || {};
      const counts = row => [number(row?.input_tokens),number(row?.cache_read_tokens),number(row?.output_tokens)];
      parts.push(table('主会话与子代理', ['会话','输入','缓存','输出'],[
        ['主会话',...counts(bucket.main)],['子代理（'+number(bucket.subagents?.count)+'）',...counts(bucket.subagents)]]));
      for (const [name,label] of [['today','今日'],['week','近 7 天']]) {
        const rows = Object.entries(bucket[name] || {});
        parts.push(rows.length ? table(label + ' · 全部本地会话',['模型','输入','缓存','输出'],rows.map(([model,c]) => [model,...counts(c)]))
          : el('p','mdi-note',label + '暂无模型用量'));
      }
      if (current?.top?.length) {
        const list = el('ol','mdi-top');
        for (const row of current.top.slice(0,5)) list.append(el('li','',
          '#' + row.step + ' ' + (row.tool || row.type || '') + ' · 估算 ' + number(row.estimated_tokens) + ' Token ' + (row.summary || '')));
        parts.push(el('h4','mdi-subheading','占用最高的步骤'),list);
      }
      tables.replaceChildren(...parts);
    }
    function hideUsage(returnFocus = false) {
      if (!popupEvents) return;
      const {trigger:summary,panel:details} = activePanel;
      activePanel = null;
      popupEvents.abort();
      popupEvents = null;
      popupObserver?.disconnect();
      popupObserver = null;
      cancelAnimationFrame(anchorFrame);
      anchorFrame = 0;
      if (details.hidePopover && details.matches(':popover-open')) details.hidePopover();
      details.hidden = true;
      summary.setAttribute('aria-expanded','false');
      if (returnFocus && summary.isConnected) summary.focus({preventScroll:true});
    }

    function placeUsage() {
      if (!popupEvents) return;
      const {trigger:summary,panel:details} = activePanel;
      const anchor = summary.getBoundingClientRect();
      const viewport = window.visualViewport;
      const gap = 6, margin = 6;
      const left = (viewport?.offsetLeft || 0) + margin;
      const top = (viewport?.offsetTop || 0) + margin;
      const right = left + (viewport?.width || document.documentElement.clientWidth) - margin * 2;
      const bottom = top + (viewport?.height || document.documentElement.clientHeight) - margin * 2;
      if (!summary.isConnected || anchor.bottom < top - margin || anchor.top > bottom + margin ||
          anchor.right < left - margin || anchor.left > right + margin) { hideUsage(); return; }

      const width = Math.max(1, Math.min(Math.max(anchor.width, 300), 550, right - left));
      details.style.width = width + 'px';
      details.style.left = Math.max(left,Math.min(anchor.left,right-width)) + 'px';
      const above = Math.max(0, anchor.top - gap - top);
      const below = Math.max(0, bottom - anchor.bottom - gap);
      const desired = Math.min(details.scrollHeight + details.offsetHeight - details.clientHeight, 450, bottom - top);
      const flipUp = above >= desired || above > below;
      details.dataset.placement = flipUp ? 'above' : 'below';
      details.style.maxHeight = Math.max(1,Math.min(450,flipUp ? above : below)) + 'px';
      const y = flipUp ? anchor.top-gap-details.offsetHeight : anchor.bottom+gap;
      details.style.top = Math.max(top,Math.min(y,bottom-details.offsetHeight)) + 'px';
    }
    function deferPlacement() {
      if (popupEvents && !anchorFrame) anchorFrame = requestAnimationFrame(() => {
        anchorFrame = 0;
        placeUsage();
      });
    }
    function showUsage(pair) {
      hideUsage();
      activePanel = pair;
      const {trigger:summary,panel:details} = pair;
      popupEvents = new AbortController();
      const signal = popupEvents.signal;
      details.hidden = false;
      if (details.showPopover) details.showPopover();
      else document.body.append(details);
      summary.setAttribute('aria-expanded','true');
      renderUsage();
      placeUsage();
      if (!popupEvents) return;
      details.focus({preventScroll:true});
      const onOutside = event => {
        const path = event.composedPath();
        if (!path.includes(summary) && !path.includes(details)) hideUsage();
      };
      document.addEventListener('pointerdown',onOutside,{capture:true,signal});
      document.addEventListener('focusin',onOutside,{capture:true,signal});
      document.addEventListener('keydown',event => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        hideUsage(true);
      },{capture:true,signal});
      // Check the anchor when the surrounding conversation or the visual viewport moves.
      document.addEventListener('scroll',event => {
        if (!details.contains(event.target)) deferPlacement();
      },{capture:true,passive:true,signal});
      window.addEventListener('resize',placeUsage,{passive:true,signal});
      window.addEventListener('pagehide',() => hideUsage(),{once:true,signal});
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize',placeUsage,{passive:true,signal});
        window.visualViewport.addEventListener('scroll',deferPlacement,{passive:true,signal});
      }
      popupObserver = new ResizeObserver(deferPlacement);
      popupObserver.observe(usageBox);
      popupObserver.observe(details);
    }

    const scroll = el('section','mdi-insights mdi-translation');
    scroll.dataset.mdInsights = 'translation';
    const banner = el('header','mdi-banner');
    banner.append(el('h3','mdi-pixel','实时翻译卷轴'));
    const scrollBody = el('div','mdi-scroll-body');
    scrollBody.id = 'md-translation-body-' + ++nextPanelId;
    const fold = button('收起',() => {
      setFolded(!scrollBody.hidden);
      toggleSettings.setAttribute('aria-expanded',String(!scrollBody.hidden && !settings.hidden));
    });
    fold.setAttribute('aria-controls',scrollBody.id);
    const foldKey = 'modeldesk.translation-scroll.folded';
    function setFolded(value, save = true) {
      scrollBody.hidden = value;
      scroll.toggleAttribute('data-md-folded',value);
      fold.textContent = value ? '展开' : '收起';
      fold.setAttribute('aria-label',value ? '展开实时翻译卷轴' : '收起实时翻译卷轴');
      fold.setAttribute('aria-expanded',String(!value));
      if (save) {
        try { localStorage.setItem(foldKey,String(value)); } catch {}
      }
    }
    let initiallyFolded = false;
    try { initiallyFolded = localStorage.getItem(foldKey) === 'true'; } catch {}
    setFolded(initiallyFolded,false);
    function openSettings() {
      if (!active) return false;
      if (scrollBody.hidden) setFolded(false);
      settings.hidden = false;
      toggleSettings.setAttribute('aria-expanded','true');
      if (!selectedProvider && !providerBusy && canCall) loadProvider(provider?.preset);
      if (!settings.contains(document.activeElement)) {
        settings.scrollIntoView({block:'nearest',inline:'nearest'});
        (preset.disabled ? toggleSettings : preset).focus({preventScroll:true});
      }
      return true;
    }
    const toggleSettings = button('设置',() => {
      if (settings.hidden || scrollBody.hidden) { openSettings(); return; }
      settings.hidden = true;
      clear.textContent = '移除密钥'; removalArmed = false;
      toggleSettings.setAttribute('aria-expanded','false');
    });
    toggleSettings.setAttribute('aria-expanded','false');
    const scrollControls = el('div','mdi-scroll-controls');
    scrollControls.append(fold,toggleSettings);
    banner.append(scrollControls);
    const availability = el('p','mdi-service');
    const switches = el('div','mdi-switches');
    const auto = el('input'); auto.type = 'checkbox';
    const pair = el('input'); pair.type = 'checkbox';
    switches.append(group('自动翻译',auto),group('双语对照',pair));
    const transcript = el('div','mdi-entries');
    transcript.setAttribute('aria-label','当前会话的翻译记录');
    const settings = el('form','mdi-settings'); settings.hidden = true;
    const preset = el('select');
    const base = el('input'); base.type = 'url'; base.autocomplete = 'off';
    const model = el('input'); model.type = 'text'; model.autocomplete = 'off';
    const secret = el('input'); secret.type = 'password'; secret.autocomplete = 'new-password'; secret.spellcheck = false;
    const address = group('服务地址',base), modelField = group('模型名称',model);
    const save = el('button','mdi-button','保存配置'); save.type = 'submit';
    const test = button('测试连接',async () => {
      if (dirty) { tell('请先保存填写的配置，再测试连接。'); return; }
      providerBusy = true; lock();
      tell('正在测试翻译服务…');
      try {
        const data = await rpc('app_test_api',{preset:preset.value});
        tell(data.ok ? '连接成功 · '+(data.model || preset.value)+' · '+number(data.latency_ms)+' ms' : data.error || '连接失败');
      } catch (error) { tell(error.message); }
      finally { providerBusy = false; if (active) lock(); }
    });
    let removalArmed = false;
    const clear = button('移除密钥',async () => {
      if (!removalArmed) {
        removalArmed = true; clear.textContent = '确认移除密钥';
        tell('再次点选即可移除所选服务保存的 API 密钥。'); return;
      }
      providerBusy = true; lock();
      const chosen = preset.value;
      try {
        const result = await rpc('app_save_prefs',{patch:{},key_preset:chosen,remove_key:true});
        if (!active) return;
        provider = result.translation; prefs = result.prefs || prefs;
        selectedProvider = provider;
        if (provider?.selected_preset !== chosen) await loadProvider(chosen);
        if (!active) return;
        paintProvider(); summarizeService(); renderThoughts(); tell('此服务的 API 密钥已移除。');
      } catch (error) { tell(error.message); }
      finally { providerBusy = false; if (active) lock(); }
    });
    const formActions = el('div','mdi-actions'); formActions.append(save,test,clear);
    settings.append(group('翻译服务',preset), address,modelField,group('API 密钥',secret),formActions);
    scrollBody.append(availability,switches,settings,status,transcript);
    scroll.append(banner,scrollBody);

    function lock() {
      for (const node of [auto,pair]) node.disabled = !canCall || prefsBusy || providerBusy;
      for (const node of [windowSize,setWindow,resetWindow]) node.disabled = !canCall || usageBusy || prefsBusy || !id;
      for (const node of [preset,base,model,secret,save,test,clear]) node.disabled = !canCall || providerBusy || prefsBusy || !selectedProvider;
    }
    function paintProvider(reset = true) {
      if (!selectedProvider) { lock(); return; }
      const known = selectedProvider.presets || {};
      const chosen = selectedProvider.selected_preset || selectedProvider.preset;
      if ([...preset.options].map(o => o.value).join('|') !== Object.keys(known).join('|')) {
        const options = Object.keys(known).map(key => {
          const opt = el('option','',providerNames[key] || key); opt.value = key; return opt;
        });
        preset.replaceChildren(...options);
      }
      preset.value = chosen;
      const custom = chosen === 'ollama' || chosen === 'custom';
      address.hidden = modelField.hidden = !custom;
      clear.hidden = !selectedProvider.api_key_mask;
      if (reset) {
        clear.textContent = '移除密钥'; removalArmed = false;
        selectedPreset = chosen; dirty = false;
        const cfg = selectedProvider.config || known[chosen] || {};
        base.value = cfg.base_url || ''; model.value = cfg.model || ''; secret.value = '';
        secret.placeholder = selectedProvider.api_key_mask ? '已保存 · 留空保留' : chosen === 'ollama' ? '本机地址可留空' : '输入 API 密钥';
      }
      lock();
    }
    async function loadProvider(chosen) {
      const order = ++providerRequest;
      providerBusy = true; lock();
      try {
        const data = await rpc('app_provider_status',chosen ? {preset:chosen} : {});
        if (!active || order !== providerRequest) return;
        selectedProvider = data; paintProvider();
        if (!provider || data.selected_preset === data.preset) provider = data;
        summarizeService();
      } catch (error) { if (order === providerRequest) { tell(error.message); if (active) preset.value = selectedPreset; } }
      finally { if (order === providerRequest) { providerBusy = false; if (active) lock(); } }
    }
    preset.addEventListener('change',() => { secret.value = ''; tell(''); loadProvider(preset.value); });
    for (const node of [base,model,secret]) node.addEventListener('input',() => { dirty = true; });
    settings.addEventListener('submit',async event => {
      event.preventDefault();
      if (providerBusy || prefsBusy || !preset.value) return;
      providerBusy = true; lock();
      const selected = preset.value;
      const patch = {preset:selected};
      if (selected === 'custom' || selected === 'ollama') { patch.base_url = base.value.trim(); patch.model = model.value.trim(); }
      const params = {patch:{translation:patch}};
      if (secret.value.trim()) { params.key_preset = selected; params.api_key = secret.value.trim(); }
      try {
        const data = await rpc('app_save_prefs',params);
        if (!active) return;
        prefs = data.prefs || prefs; provider = selectedProvider = data.translation;
        paintProvider(); summarizeService(); renderThoughts(); tell('翻译服务设置已保存。');
      } catch (error) { tell(error.message); }
      finally { providerBusy = false; if (active) lock(); }
    });
    function summarizeService() {
      auto.checked = prefs.thought_auto_translate === true;
      pair.checked = prefs.thought_bilingual === true;
      const name = provider?.config?.model || provider?.preset;
      availability.textContent = !provider ? '正在读取本机翻译配置…' : !providerConfigured(provider) ?
        '翻译服务未配置 · '+(name || '请在设置中选择服务') :
        (auto.checked ? '自动翻译已开启' : '手动翻译')+' · '+name;
      availability.dataset.ready = providerConfigured(provider) ? 'true' : 'false';
    }
    async function switchPreference(key,value) {
      if (prefsBusy || providerBusy) return;
      prefsBusy = true; lock();
      try {
        const data = await rpc('app_save_prefs',{patch:{[key]:value}});
        if (!active) return;
        prefs = data.prefs; summarizeService(); renderThoughts();
        if (key === 'thought_auto_translate') {
          tell(value ? '已开启自动翻译，新记录将交给所选翻译服务。' : '已关闭自动翻译。');
          if (id) await loadThoughts();
        }
      } catch (error) { if (active) { summarizeService(); tell(error.message); } }
      finally { prefsBusy = false; if (active) lock(); }
    }
    auto.addEventListener('change',() => switchPreference('thought_auto_translate',auto.checked));
    pair.addEventListener('change',() => switchPreference('thought_bilingual',pair.checked));
    async function loadThoughts() {
      const state = await rpc('app_thoughts',{...scoped(),limit:20});
      if (active && fresh(state)) { thoughts = state.entries || []; renderThoughts(); }
    }
    function renderThoughts() {
      const bilingual = prefs.thought_bilingual === true;
      const key = JSON.stringify([id,thoughts,bilingual,providerConfigured(provider)]);
      if (lastRows === key) return;
      lastRows = key;
      if (!id || !thoughts.length) {
        transcript.replaceChildren(el('p','mdi-empty',id ? '等待此对话出现助手回复或思考摘要。' : '新会话暂无原文与译文。'));
        return;
      }
      const scrollOffset = transcript.scrollTop;
      const articles = [];
      for (const row of thoughts.slice(-20).reverse()) {
        const article = el('article','mdi-entry');
        const head = el('header','mdi-meta');
        const kind = row.kind === 'reply' ? '助手回复' : '思考摘要';
        head.append(el('strong','',row.step == null ? kind : kind+' · 步骤 '+row.step),
          el('span','',rowLabels[row.status] || '原文'));
        const meta = [row.model,localDate(row.timestamp)].filter(Boolean).join(' · ');
        if (meta) head.append(el('small','',meta));
        article.append(head);
        const showText = (label,value) => article.append(el('b','mdi-key',label),el('p','mdi-text',value));
        if (bilingual || !row.translation) showText('原文',row.text || '—');
        if (row.translation) showText('译文',row.translation);
        if (row.error || row.truncated) article.append(el('p','mdi-note',[row.error,row.truncated && '原文已截取，最多 6,000 字符'].filter(Boolean).join(' · ')));
        if (!row.translation && row.hash && row.status !== 'translating' && providerConfigured(provider) && canCall) {
          const translate = button(row.status === 'error' ? '重试翻译' : '翻译这条',async () => {
            translate.disabled = true;
            try {
              const data = await rpc('app_retry_thought',{...scoped(),step_hash:row.hash});
              if (!active) return;
              if (data.error) tell(data.error); else tell('翻译已排队。');
              await loadThoughts();
            } catch (error) { tell(error.message); }
            finally { if (active) translate.disabled = false; }
          });
          article.append(translate);
        }
        articles.push(article);
      }
      transcript.replaceChildren(...articles);
      transcript.scrollTop = scrollOffset;
    }
    function update(snapshot = {}) {
      if (!active) return;
      if (snapshot.prefs && !prefsBusy && !providerBusy) prefs = snapshot.prefs;
      if (snapshot.translation && !providerBusy) {
        provider = snapshot.translation;
        if (!selectedProvider || !dirty && settings.hidden) {
          selectedProvider = provider; paintProvider();
        }
      }
      if ('accountQuota' in snapshot) accountQuota = Array.isArray(snapshot.accountQuota) ? snapshot.accountQuota : [];
      if ('session' in snapshot) sessionModel = id && snapshot.session?.id === id ? snapshot.session.model : '';
      if ('context' in snapshot) usage = fresh(snapshot.context) ? snapshot.context : null;
      if ('thoughts' in snapshot) thoughts = fresh(snapshot.thoughts) ? snapshot.thoughts.entries || [] : [];
      summarizeService(); renderQuota(); renderUsage(); renderThoughts(); lock(); deferPlacement();
    }
    slots.usage.append(usageBox);
    slots.translation.append(scroll);
    update();
    return {update,openSettings,destroy() {
      active = false; providerRequest++; hideUsage(); details.remove(); hp.panel.remove();
      secret.value = ''; usageBox.remove(); scroll.remove();
    }};
  }
  window.ModelDeskInsights = Object.freeze({mount});
})();
