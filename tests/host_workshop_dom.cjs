'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function exercise() {
  const checks = [];
  const check = (message, condition) => { if (!condition) throw Error(message); checks.push(message); };
  const frame = document.getElementById('workshop');
  const $ = selector => frame.querySelector(selector);
  const visibleDialog = () => $('dialog[open]');
  const click = (target, text) => {
    const button = Array.from(target.querySelectorAll('button')).find(v => (v.getAttribute('aria-label') || v.textContent).includes(text));
    if (!button) throw Error('按钮缺失 ' + text);
    button.click();
  };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const calls = [], previewed = [];
  const task = { id: 't1', conversation_id: 'chat', status: 'review', engine: 'codex', title: '样本验收',
    cwd: '/project', updated_at: 5, created_at: 1, changed_files: ['sample.md'] };
  const file = { name: 'sample.md', path: '/project/sample.md', uri: 'file:///project/sample.md', relative: 'sample.md',
    workspace: '/project', exists: true, size: 10, change: '新增' };
  const snapshot = { session: {id:'chat',workspaces:['/project']},tasks:[task,{...task,id:'old',title:'别的会话',conversation_id:'old'}],
    files:[file],theme:'light',prefs:{},adapters:[] };
  const call = async (method,args) => {
    calls.push({method,args});
    if (method === 'app_get_task_logs') return {task, text:'真实结构的日志', before:0, end:1};
    if (method === 'app_task_action') { task.status = 'accepted'; return task; }
    if (method === 'app_list_files') return {files:[file],total:1,editors:['Zed']};
    if (method === 'app_file_action') return file;
    if (method === 'app_save_prefs') return {prefs:args.patch};
    throw Error(method);
  };
  const sizeControl = document.createElement('button'); sizeControl.textContent = '放大工坊';
  const ui = window.ModelDeskWorkshop.mount(frame, {call, conversationId:'chat',mode:'chat',sizeControl,openFile: value => {previewed.push(value);return true;}});
  ui.update(snapshot);
  check('opens without any write, read or credential calls',calls.length === 0);
  check('lead and three agent stations are keyboard accessible',frame.querySelectorAll('.mdw-seats button').length === 4);
  check('resize and scene settings are adjacent in the workshop title', sizeControl.closest('.mdw-bar') &&
    sizeControl.nextElementSibling === $('[data-mdw-scene]'));
  const canvas = $('canvas');
  for (const width of [300,520,660]) {
    frame.style.width = width + 'px';
    const bounds = canvas.getBoundingClientRect(), roomBounds = $('.office-room').getBoundingClientRect();
    check('whole 16:9 canvas meets both room edges at '+width, bounds.left === roomBounds.left &&
      bounds.right === roomBounds.right && Math.abs(bounds.height - bounds.width * 360 / 640) < 0.02);
    canvas.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:bounds.left+110*bounds.width/640,
      clientY:bounds.top+277*bounds.height/360}));
    check('scaled first desk receives clicks at '+width,visibleDialog()?.getAttribute('aria-label') === 'Codex · 工位');
    click(visibleDialog(),'关闭');
  }
  frame.style.width = '520px';
  const layout = canvas.getBoundingClientRect();
  check('visible pixel canvas',layout.width > 180 && layout.height > 140);
  const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  const colors = new Set(); for (let i=0; i<pixels.length; i+=84) colors.add(pixels[i]*65536+pixels[i+1]*256+pixels[i+2]);
  check('native scene painted in real Chromium',colors.size > 75);
  check('interaction buttons and feedback are visible with settings closed',
    $('[data-office-action=greet]').checkVisibility() && $('.office-ticker').checkVisibility() && $('#scene-tools').hidden);
  const greetHit = {bubbles:true,clientX:layout.left + 248 * layout.width / 640,clientY:layout.top + 164 * layout.height / 360};
  canvas.dispatchEvent(new MouseEvent('click',greetHit));
  check('clicking a visible seated sprite greets without hiding the animation',
    !visibleDialog() && $('.office-ticker').textContent.includes('吉米奈') && canvas.dataset.motion === 'active');
  $('[data-office-action=garden]').click();
  check('idle walkers answer the garden command', $('.office-ticker').textContent.includes('前往木廊'));
  $('[data-office-action=feed]').click();
  check('idle workers gather at the pond', $('.office-ticker').textContent.includes('锦鲤'));
  $('[data-office-action=ensemble]').click();
  check('idle workers gather to play handbells', $('.office-ticker').textContent.includes('手铃'));
  $('[data-office-action=demo]').click();
  check('simulated work is identified on the control', $('[data-office-action=demo]').textContent.includes('演示·') && !calls.length);
  for (let n=0;n<4;n++) $('[data-office-action=demo]').click();
  check('can return to actual desk states', $('[data-office-action=demo]').getAttribute('aria-pressed') === 'false');
  const hit = {bubbles:true,clientX:layout.left + 116 * layout.width / 640,clientY:layout.top + 278 * layout.height / 360};
  canvas.dispatchEvent(new PointerEvent('pointermove',hit));
  canvas.dispatchEvent(new MouseEvent('click',hit));
  check('clicking the visible first station on the canvas opens its actual agent',visibleDialog()?.getAttribute('aria-label') === 'Codex · 工位');
  click(visibleDialog(),'关闭');
  const leadHit = {bubbles:true,clientX:layout.left + 248 * layout.width / 640,clientY:layout.top + 186 * layout.height / 360};
  canvas.dispatchEvent(new PointerEvent('pointermove',leadHit));
  check('central host desk hover identifies the actual Gemini sprite',canvas.title.includes('吉米奈'));
  canvas.dispatchEvent(new MouseEvent('click',leadHit));
  check('central host desk opens the team lead',visibleDialog()?.getAttribute('aria-label') === '吉米奈 · 主控台');
  click(visibleDialog(),'关闭');
  click(frame,'Codex ·'); check('station opens and hides unrelated tasks',visibleDialog().textContent.includes('样本验收') && !visibleDialog().textContent.includes('别的会话'));
  click(visibleDialog(),'样本验收'); await tick();
  check('task logs include true conversation',calls.at(-1).args.conversation_id === 'chat' && visibleDialog().textContent.includes('真实结构的日志'));
  click(visibleDialog(),'独立验收');
  check('approval is a separate step',!calls.some(r=>r.method==='app_task_action'));
  click(visibleDialog(),'确认通过'); await tick();
  check('one independent acceptance',calls.filter(r=>r.method==='app_task_action'&&r.args.action==='accept').length===1);
  click(visibleDialog(),'关闭');
  click(frame,'Qoder CN ·'); click(visibleDialog(),'工位配置与换装');
  check('all eleven original appearances',visibleDialog().querySelector('select[name=sprite]').options.length === 11);
  click(visibleDialog(),'取消'); await tick();
  click(frame,'场景设置'); check('real weather controls',!$('#scene-tools').hidden && !!$('[data-office-weather=rain]'));
  $('[data-office-weather=rain]').click(); await tick();
  check('weather stored only after clicking',calls.some(r=>r.method==='app_save_prefs'&&r.args.patch.office_scene.weather==='rain'));
  click(frame,'本轮产物'); await tick();
  click(frame,'sample.md'); await tick();
  check('native fileView receives validated URI',previewed.length === 1 && previewed[0].uri === file.uri);
  $('[aria-haspopup=menu]').click(); await tick();
  const menu = document.querySelector('[data-modeldesk-host-menu]');
  check('complete native file menu', ['preview','copy-path','workshop-markdown','workshop-copy-text','workshop-translate','workshop-rename','workshop-trash','workshop-export','workshop-diff','workshop-editor-0','review-codex','review-qoder','attach-file'].every(id=>menu?.querySelector('[data-modeldesk-action="'+id+'"]')));
  menu.querySelector('[data-modeldesk-action=workshop-trash]').click(); await tick();
  check('trash requires confirmation',!!visibleDialog() && !calls.some(r=>r.args.action==='trash'));
  click(visibleDialog(),'关闭');
  click(frame,'互动工坊'); await tick();
  const delegated = {id:'terminal-849',engine:'codex',model:'gpt-6.2-sol',label:'原生派单',state:'running'};
  const helper = {id:'subagent-1',engine:null,model:'Gemini Flash',label:'代码检查',state:'waiting'};
  const activity = {conversationId:'chat',lead:{state:'idle',model:'Gemini Pro'},assistants:[helper],tasks:[delegated]};
  ui.update({...snapshot, tasks:[], hostActivity:activity});
  check('native terminal dispatch drives Codex station',!!$('.mdw-seats [aria-label="Codex · 执行中"]'));
  check('the delegated CLI model is visible without opening its station',$('.mdw-models').textContent.includes('Codexgpt-6.2-sol执行中'));
  check('child and lead have distinct live model states',$('.mdw-models').textContent.includes('主模型Gemini Pro空闲') &&
    $('.mdw-models').textContent.includes('助手Gemini Flash等待中'));
  $('[data-office-action=ensemble]').click();
  check('native working Codex stays at his desk when the other three join the ensemble',
    $('.office-ticker').textContent.startsWith('3 位') && !!$('.mdw-seats [aria-label="Codex · 执行中"]'));
  const area = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:area.left+area.width*250/640,clientY:area.top+area.height*92/360}));
  check('the animated scene reports the same working Codex as its label',$('.office-ticker').textContent.includes('Codex:开工'));
  click(frame,'Codex · 执行中');
  check('native task details show the engine model and no local cancellation action',
    visibleDialog().textContent.includes('gpt-6.2-sol') && !visibleDialog().textContent.includes('终止'));
  delegated.state='completed'; helper.state='running'; activity.lead.state='waiting';
  ui.update({...snapshot,tasks:[],hostActivity:activity});
  check('native completion refreshes an open desk and releases the actor',
    !!$('.mdw-seats [aria-label="Codex · 已完成"]') && visibleDialog().textContent.includes('已完成') &&
    $('.mdw-models').textContent.includes('助手Gemini Flash执行中'));
  click(visibleDialog(),'关闭');
  ui.update({...snapshot,tasks:[],hostActivity:{...activity,conversationId:'old',tasks:[{...delegated,state:'running'}]}});
  check('a stale native event cannot mark the current desk busy',!!$('.mdw-seats [aria-label="Codex · 空闲"]') && $('.mdw-models').hidden);
  ui.destroy(); check('route unmount removed all workbench controls',!frame.querySelector('canvas,dialog'));
  const next = window.ModelDeskWorkshop.mount(frame,{call,conversationId:null,mode:'home'});
  next.update({session:{},tasks:[task],files:[],prefs:{}});
  check('a past accepted task never appears as current at the new conversation home',!!$('.mdw-seats [aria-label="Codex · 空闲"]'));
  click(frame,'本轮产物'); await tick();
  check('new home has empty artifacts without requesting a historical session',frame.textContent.includes('开启对话后'));
  next.destroy();
  return checks;
}
const chrome = process.env.MODELDESK_TEST_CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/google-chrome'].find(fs.existsSync);
if (!chrome) throw Error('Chromium binary required.');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'modeldesk-workshop-dom-'));
try {
  const base = path.resolve(__dirname,'../ui');
  const sources = ['src/office/pixel-office-sprites.js','src/office/pixel-office-scene.js','src/office/pixel-office-events.js',
    'src/office/pixel-office-motion.js','src/office/pixel-office.js','host/menu.js','host/workshop.js'];
  const html = path.join(tmp,'fixture.html');
  fs.writeFileSync(html,'<!doctype html><meta charset="utf-8"><style>'+fs.readFileSync(path.join(base,'host/workshop.css'),'utf8')+
    '</style><main data-testid="conversation-view"><div data-testid="message-input" aria-label="Message input" role="textbox" contenteditable="true">draft</div><section id="workshop" style="width:520px"></section></main><pre id="result"></pre>'+
    sources.map(s=>'<script src="'+pathToFileURL(path.join(base,s)).href+'"></script>').join('')+
    '<script>('+exercise.toString()+')().then(checks=>result.textContent=JSON.stringify({checks})).catch(e=>result.textContent=JSON.stringify({error:e.stack}));</script>');
  const result = spawnSync(chrome,['--headless','--disable-extensions','--no-first-run','--disable-background-networking',
    '--user-data-dir='+path.join(tmp,'profile'),'--virtual-time-budget=2000','--dump-dom',pathToFileURL(html).href],
    {encoding:'utf8',maxBuffer:3*1024*1024,timeout:35000});
  assert.equal(result.status,0,result.error?.message || result.stderr);
  const payload = JSON.parse(result.stdout.match(/<pre id="result">([^<]*?)<\/pre>/)[1]);
  assert.ok(!payload.error,payload.error);
  console.log('Chromium native workshop:',payload.checks.length,'checks passed.');
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
