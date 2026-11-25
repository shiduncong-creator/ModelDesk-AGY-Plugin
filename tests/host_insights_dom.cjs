/* Run with node tests/host_insights_dom.cjs; exercises the actual browser components in an isolated profile. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../ui/host');

async function exercise() {
  const checks = [];
  const check = (label, condition) => { if (!condition) throw Error(label); checks.push(label); };
  const $ = s => document.querySelector(s);
  const label = (node, name) => [...node.querySelectorAll('label')].find(e => e.textContent.includes(name)).querySelector('input,select');
  const click = name => [...document.querySelectorAll('button')].find(e => e.textContent === name).click();
  const wait = () => new Promise(resolve => setTimeout(resolve, 30));
  const slots = { usage:$('#usage'),translation:$('#translation') };
  const ids = { current:'session-A', stale:'session-B' };
  const presets = {
    'gpt-6-luna':{model:'gpt-6-luna',base_url:'https://api.openai.com/v1'},
    custom:{model:'',base_url:''},ollama:{model:'qwen',base_url:'http://localhost:11434/v1'}
  };
  let activePreset = 'gpt-6-luna';
  let saved = false, submitted = false, compact = 0;
  const calls = [], prefs = {thought_auto_translate:false,thought_bilingual:false};
  const service = key => ({selected_preset:key,preset:activePreset,presets,api_key_mask:saved?'已保存':'',config:presets[key]});
  const rows = {conversation_id:ids.current,entries:[{step:5,hash:'record',model:'model',text:'Original display summary',
    translation:'这是一条已译摘要',status:'translated'}, {step:6,kind:'reply',hash:'pending',text:'next source',status:'pending'}]};
  const context = {conversation_id:ids.current,context:{used_tokens:18000,window_tokens:200000,window_basis:'estimate',
    model:'model',ratio:.09,cache_hit_rate:.85,top:[{step:2,type:'tool',summary:'file read',estimated_tokens:1000}]},
    tokens:{main:{input_tokens:3000,output_tokens:20,cache_read_tokens:20},subagents:{count:1},
      today:{model:{input_tokens:12000}},week:{model:{input_tokens:90123}}},
    codex:{buckets:[{id:'codex',windows:[{window_minutes:300,remaining_percent:85},{window_minutes:10080,remaining_percent:70}]}]}};
  const accountQuota = [
    {label:'Gemini 模型',windows:[{label:'5 小时',remaining:.48,reset:'11月25日 12:00'},{label:'每周',remaining:.63}]},
    {label:'Claude 和 GPT 模型',windows:[{label:'5 小时',remaining:null,disabled:true},{label:'每周',remaining:0}]},
  ];
  let quotaRefresh = 0;
  const snapshot = () => ({session:{id:ids.current},prefs:{...prefs},translation:service(activePreset),context,accountQuota,thoughts:rows});
  async function call(name,args) {
    calls.push([name,args]);
    if (name === 'app_provider_status') return service(args.preset || activePreset);
    if (name === 'app_context_usage') return context;
    if (name === 'app_thoughts') return rows;
    if (name === 'app_retry_thought') return {status:'translating'};
    if (name === 'app_save_prefs') {
      if (args.patch.translation) {
        activePreset = args.patch.translation.preset; saved = !!args.api_key; submitted = args.api_key === 'example-input';
        return {prefs:{...prefs},translation:service(activePreset)};
      }
      Object.assign(prefs,args.patch);
      return {prefs:{...prefs}};
    }
    if (name === 'app_test_api') return {ok:true,model:activePreset,latency_ms:72};
    throw Error('Unexpected method '+name);
  }
  const main = ModelDeskInsights.mount(slots,{mode:'conversation',conversationId:ids.current,call,refreshAccountQuota:async () => {quotaRefresh++;},compact:() => {compact++;return {sent:true};}});
  main.update(snapshot());
  const fold = $('[aria-label="收起实时翻译卷轴"]');
  check('keyboard focusable fold button precedes settings', fold?.type === 'button' && fold.tabIndex === 0 &&
    fold.nextElementSibling.textContent === '设置');
  fold.focus(); fold.click();
  const body = document.getElementById(fold.getAttribute('aria-controls'));
  check('fold hides just the scroll body and keeps focus on its control', body.hidden &&
    !body.checkVisibility() && fold.getAttribute('aria-expanded') === 'false' && document.activeElement === fold);
  main.update({...snapshot(),thoughts:{...rows,entries:[{...rows.entries[0],hash:'fold',translation:'收起期间已更新'}]}});
  fold.click();
  check('unfold reveals fresh translations without changing preferences', !body.hidden &&
    body.innerText.includes('收起期间已更新') && calls.length === 0);
  fold.click(); main.openSettings();
  check('settings entry reveals collapsed scroll', !body.hidden && !$('.mdi-settings').hidden);
  fold.nextElementSibling.click();
  main.update(snapshot());
  check('reply and summary each show their own source label', slots.translation.textContent.includes('助手回复 · 步骤 6') &&
    slots.translation.textContent.includes('思考摘要 · 步骤 5'));
  check('initial snapshot makes no calls and auto is opt in', calls.length === 0 && !label(slots.translation,'自动翻译').checked);
  check('estimated capacity, real usage and cache rate visible', slots.usage.textContent.includes('已用 18,000 / 窗口 200,000（估算）') &&
    slots.usage.textContent.includes('85%'));
  const mp = $('.mdi-mp'), hp = $('.mdi-hp');
  const mpFill = $('.mdi-mp .mdi-meter-fill');
  check('MP shows remaining rather than consumed tokens', mp.innerText.includes('剩余 91%') && mpFill.style.width === '91%');
  check('HP independently shows native account group and both windows', hp.innerText.includes('Gemini 模型') &&
    hp.innerText.includes('48%') && hp.innerText.includes('63%') && hp.querySelectorAll('.mdi-meter-track').length === 2);
  const showModel = model => main.update({context:{...context,context:{...context.context,model}}});
  for (const model of ['Claude Sonnet','gpt-6-luna']) {
    showModel(model);
    check('HP shows only the matching shared account group for '+model, $('.mdi-hp-group').textContent==='Claude 和 GPT 模型' &&
      hp.innerText.includes('不适用') && !hp.innerText.includes('48%'));
  }
  main.update({session:{id:ids.current,model:'Claude Sonnet'}});
  showModel('Gemini 4 Neon High');
  check('recognized context model takes priority over session fallback', $('.mdi-hp-group').textContent==='Gemini 模型' && hp.innerText.includes('48%'));
  showModel('未知模型');
  check('known session model can resolve the quota when the context has no name', $('.mdi-hp-group').textContent==='Claude 和 GPT 模型');
  main.update({session:{id:ids.stale,model:'Claude Sonnet'}});
  check('unknown model and stale session fall back to the explicitly named first group', $('.mdi-hp-group').textContent==='Gemini 模型');
  main.update(snapshot());
  check('separate pixel potion and heart are drawn', $('canvas.mdi-potion').getContext('2d').getImageData(10,20,1,1).data[3] === 255 &&
    getComputedStyle($('.mdi-heart')).clipPath !== 'none');
  for (const [ratio,width,level] of [[0,'100%','low'],[.65,'35%','medium'],[.8,'20%','high'],[1,'0%','high'],[1.2,'0%','high']]) {
    main.update({context:{...context,context:{...context.context,used_tokens:ratio*200000,ratio}}});
    check('MP capacity threshold and range at '+ratio, Math.abs(parseFloat(mpFill.style.width)-parseFloat(width))<.001 &&
      mpFill.parentNode.dataset.level === level);
  }
  main.update({context:{...context,context:{...context.context,used_tokens:0,ratio:null}}});
  check('unknown context renders as unreported independently of zero account balance',mp.innerText.includes('待上报') &&
    mpFill.parentNode.dataset.level === 'unknown' && hp.innerText.includes('48%'));
  main.update(snapshot());
  check('unconfigured provider explained', $('.mdi-service').textContent.includes('未配置'));
  const meter = $('.mdi-meter'), popup = $('.mdi-usage-body'), composer = $('#fixture-composer');
  const before = [meter.getBoundingClientRect().y,composer.getBoundingClientRect().y];
  meter.click(); await wait();
  check('open native popover does not displace its anchor or original composer',
    popup.matches(':popover-open') && before[0]===meter.getBoundingClientRect().y && before[1]===composer.getBoundingClientRect().y);
  check('near the viewport top the panel opens below the meter and receives focus',
    popup.dataset.placement === 'below' && document.activeElement===popup && popup.getBoundingClientRect().top >= meter.getBoundingClientRect().bottom);
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  check('Escape closes the dialog, returns to its opener and clears ARIA state',
    !popup.matches(':popover-open') && document.activeElement === meter && meter.getAttribute('aria-expanded')==='false');
  meter.click(); composer.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true}));
  check('a pointer press outside closes immediately', !popup.matches(':popover-open'));
  slots.usage.style.cssText='position:fixed;bottom:24px;left:8px;width:280px';
  meter.click(); await wait();
  const rect = popup.getBoundingClientRect();
  check('near the lower edge it flips above and stays inside the viewport', popup.dataset.placement==='above' &&
    rect.top>=0 && rect.bottom<=meter.getBoundingClientRect().top && rect.left>=0 && rect.right<=innerWidth);
  slots.usage.style.cssText=''; window.dispatchEvent(new Event('resize')); await wait();
  check('changing anchor geometry repositions an open popup', popup.dataset.placement==='below');
  click('关闭'); await wait();
  check('explicit close restores keyboard focus', document.activeElement===meter && !popup.matches(':popover-open'));
  meter.click(); await wait();
  check('expanded MP covers date windows, context remaining, delegation and top step', ['主会话与子代理','近 7 天','今日','剩余 182,000 Token','file read'].every(s => popup.textContent.includes(s)));
  hp.click();await wait();
  const hpPanel = $('.mdi-hp-details');
  check('HP has its own dialog and closes MP', hpPanel.matches(':popover-open') && !popup.matches(':popover-open') &&
    hp.getAttribute('aria-expanded')==='true' && mp.getAttribute('aria-expanded')==='false');
  check('all account groups, reset time, inherited weekly restriction and separate CLI quota appear in HP',
    ['Gemini 模型','Claude 和 GPT 模型','11月25日 12:00','不适用','0%','本机 Codex CLI 账户','70%'].every(t => hpPanel.innerText.includes(t)) &&
    hpPanel.querySelectorAll('.mdi-quota-window .mdi-meter-track').length === 6);
  click('刷新账户额度');await wait();
  check('HP refresh uses the native account reader without a context request', quotaRefresh === 1 && calls.length === 0);
  hpPanel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  check('HP dismiss restores focus to the HP button', !hpPanel.matches(':popover-open') && document.activeElement===hp);
  main.update({accountQuota:[]});
  check('missing host quota leaves HP unknown even when CLI reports 85%', hp.innerText.includes('等待宿主上报') && !hp.innerText.includes('85%'));
  main.update(snapshot());
  mp.click();await wait();
  click('压缩上下文 /compact'); await wait();
  check('compact only calls host callback on a click', compact === 1 && $('.mdi-usage-body').textContent.includes('已发送'));
  click('刷新用量'); await wait();
  check('quota refresh is scoped to active conversation', calls.some(([name,a]) => name === 'app_context_usage' && a.conversation_id===ids.current && a.force));
  const windowSize = label(slots.usage,'上下文窗口');
  windowSize.value = '240000'; windowSize.dispatchEvent(new Event('input')); click('应用窗口'); await wait();
  check('manual context window is validated and saved', prefs.context_window === 240000);
  click('恢复自动'); await wait();
  check('window reset restores automatic model handling', prefs.context_window === null);
  main.openSettings(); const form = $('.mdi-settings');
  check('file translation settings entry opens the form and dismisses the usage popup',
    !form.hidden && form.contains(document.activeElement) && !popup.matches(':popover-open'));
  const key = label(form,'API 密钥'); key.value = 'example-input'; key.dispatchEvent(new Event('input'));
  key.focus(); main.openSettings(); main.openSettings();
  check('repeat settings calls preserve an open form, field focus and draft', !form.hidden && document.activeElement===key && key.value==='example-input');
  main.update(snapshot());
  check('poll preserves an unsaved secret draft', key.value === 'example-input');
  click('测试连接'); await wait();
  check('unsaved input prevents testing stale configuration', !calls.some(([n]) => n === 'app_test_api') && slots.translation.textContent.includes('请先保存'));
  click('保存配置'); await wait();
  check('explicit save sends typed secret once and clears the input', submitted && key.value === '' && !slots.translation.textContent.includes('example-input'));
  click('测试连接'); await wait();
  check('tested saved model and elapsed time visible', slots.translation.textContent.includes('72 ms'));
  const pair = label(slots.translation,'双语对照');pair.click();await wait();
  check('bilingual renders original and translation', $('.mdi-entries').textContent.includes('这是一条已译摘要') && $('.mdi-entries').textContent.includes('Original display summary'));
  const auto = label(slots.translation,'自动翻译');auto.click();await wait();
  check('auto saves only after user toggles, then reloads current records', prefs.thought_auto_translate && calls.some(([n,a]) => n === 'app_thoughts' && a.conversation_id===ids.current));
  click('翻译这条');await wait();
  check('individual translation uses exact session and hash', calls.some(([n,a]) => n === 'app_retry_thought' && a.conversation_id===ids.current && a.step_hash==='pending'));
  const select = label(form,'翻译服务'); select.value='ollama'; select.dispatchEvent(new Event('change')); await wait();
  check('provider selection requests only that named preset', calls.some(([n,a]) => n === 'app_provider_status' && a.preset === 'ollama') && label(form,'模型名称').value==='qwen');
  check('local custom provider can be edited without a new credential', !label(form,'服务地址').closest('label').hidden);
  check('300px layout uses flow roots and wraps both panels', [...Object.values(slots)].every(e => e.scrollWidth <= e.clientWidth) &&
    ['.mdi-usage','.mdi-translation'].every(sel => !['fixed','absolute'].includes(getComputedStyle($(sel)).position)));
  main.update({...snapshot(),context:{...context,conversation_id:ids.stale},thoughts:{...rows,conversation_id:ids.stale}});
  check('prior conversation content never appears in current session', !slots.usage.textContent.includes('18,000') && !slots.translation.textContent.includes('next source'));
  main.destroy();check('destroy removes only owned components', slots.usage.children.length === 0 && slots.translation.children.length === 0);
  const home = ModelDeskInsights.mount(slots,{mode:'home',conversationId:ids.current,call});
  home.update(snapshot());
  check('home always stays empty even when a stale snapshot contains data', slots.translation.textContent.includes('新会话暂无原文与译文') &&
    !slots.usage.textContent.includes('18,000') && !slots.translation.textContent.includes('next source'));
  $('.mdi-hp').click();await wait();
  check('home exposes account windows before a session exists', $('.mdi-hp-details').matches(':popover-open') &&
    $('.mdi-hp-details').innerText.includes('48%') && $('.mdi-mp').innerText.includes('待上报'));
  home.destroy();
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:240px;height:320px;border:0';
  const source = document.querySelector('script[src]').src;
  const css = document.querySelector('link[href$="insights.css"]').href;
  const ready = new Promise(resolve => {frame.onload = resolve;});
  frame.srcdoc = '<link rel="stylesheet" href="'+css+'"><div id="usage"></div><div id="translation"></div><script src="'+source+'"><'+'/script>';
  document.body.append(frame); await ready;
  const narrow = frame.contentWindow, narrowDoc = narrow.document;
  const small = narrow.ModelDeskInsights.mount({usage:narrowDoc.querySelector('#usage'),translation:narrowDoc.querySelector('#translation')},
    {mode:'conversation',conversationId:ids.current,call});
  small.update(snapshot());
  narrowDoc.querySelector('.mdi-meter').click();
  const smallBounds = narrowDoc.querySelector('.mdi-usage-body').getBoundingClientRect();
  check('240px visual viewport keeps the entire panel inside both edges', smallBounds.width > 0 &&
    smallBounds.x >= 0 && smallBounds.right <= narrow.innerWidth && smallBounds.bottom <= narrow.innerHeight);
  check('narrow 240px surface retains visible MP and HP gauges', [...narrowDoc.querySelectorAll('.mdi-meter .mdi-meter-track')].every(t =>
    t.getBoundingClientRect().width >= 12 && t.getBoundingClientRect().height > 0) &&
    narrowDoc.querySelector('.mdi-usage').scrollWidth <= narrowDoc.querySelector('.mdi-usage').clientWidth);
  small.destroy();
  check('destroy an open panel removes its top layer', !narrowDoc.querySelector(':popover-open'));
  frame.remove();
  return checks;
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'modeldesk-insights-test-'));
try {
  const fixture = path.join(temporary, 'test.html');
  const uri = file => pathToFileURL(path.join(root,file)).href;
  const text = `<!DOCTYPE html><meta charset="utf-8"><link rel="stylesheet" href="${uri('theme.css')}"><link rel="stylesheet" href="${uri('insights.css')}">
    <body class="theme-light"><div style="width:300px"><div id="usage"></div><textarea id="fixture-composer">现有草稿</textarea><div id="translation"></div></div><pre id="output"></pre>
    <script src="${uri('insights.js')}"></script><script>(${exercise})().then(a=>output.textContent=JSON.stringify({checks:a})).catch(e=>output.textContent=JSON.stringify({error:e.stack}))</script>`;
  fs.writeFileSync(fixture,text);
  const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const run = spawnSync(chrome,['--headless','--disable-background-networking','--no-first-run','--user-data-dir='+path.join(temporary,'profile'),
    '--virtual-time-budget=4000','--dump-dom',pathToFileURL(fixture).href],{encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.error?.message || run.stderr);
  const content = run.stdout.match(/<pre id="output">([^<]+)<\/pre>/);
  assert.ok(content,'test did not finish');
  const result = JSON.parse(content[1]);assert.ifError(result.error && Error(result.error));
  console.log('Chromium host insights:',result.checks.length,'checks passed.');
} finally { fs.rmSync(temporary,{recursive:true,force:true}); }
