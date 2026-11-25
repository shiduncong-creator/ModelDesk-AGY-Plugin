'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

function checkLayout() {
  const host = document.querySelector('main');
  const view = host.querySelector('[data-testid=conversation-view]');
  const editor = view.querySelector('textarea');
  const slot = host.querySelector('[data-md-overview-for]');
  const workshop = host.querySelector('.md-native-scene');
  const rect = element => element.getBoundingClientRect();
  const normal = rect(editor);
  const checks = [];
  const check = (name, ok) => { if (!ok) throw Error(name); checks.push(name); };
  for (const type of ['medium', 'large']) {
    const dock = modelDeskOverviewDock(slot, 'farm', type);
    check(type + ' uses this conversation’s workshop', dock === slot);
    const panel = document.createElement('div');
    panel.dataset.testid = type === 'medium' ? 'overview-panel-host-sibling' : 'overview-panel-host-gutter';
    Object.assign(panel.style, {width:'320px',height:'150px'});
    modelDeskPlaceOverview(dock, panel);
    check(type + ' Overview fits above workshop', rect(panel).bottom <= rect(workshop).top);
    check(type + ' panel aligns with workshop edges', rect(panel).left === rect(workshop).left && rect(panel).right === rect(workshop).right);
    check(type + ' both states leave the same chat width', rect(editor).width === normal.width && rect(editor).x === normal.x);
    slot.replaceChildren();
  }
  check('switching conversations excludes old slot', modelDeskOverviewDock(slot, 'other', 'medium') === null);
  check('a narrow window uses the native modal', modelDeskOverviewDock(slot, 'farm', 'small') === null);
  const modal = document.createElement('div');
  check('native fallback preserves original panel', modelDeskPlaceOverview(null, modal) === modal && !slot.children.length);
  return checks.length;
}

function checkProvider(create) {
  // Run the installed host provider itself with controlled hook state.
  const preferences = new Map();
  let hooks = [], index = 0;
  E.useContext = () => undefined;
  E.useState = initial => {
    const position = index++;
    if (!(position in hooks)) hooks[position] = initial;
    return [hooks[position], next => {
      hooks[position] = typeof next === 'function' ? next(hooks[position]) : next;
    }];
  };
  E.useMemo = make => make();
  E.useCallback = fn => fn;
  E.useRef = value => ({current:value});
  E.createElement = (_, {value}) => value;
  const Provider = create(id => [preferences.get(id), open => preferences.set(id,open)]);
  const render = (id='farm',presentation='inline') => {
    index=0;
    return Provider({cascadeId:id,presentation,detectMode:'always',useOverviewContent:() => ({hasContent:true,hydrated:true})});
  };
  let count=0;
  const check = (ok,description) => { if (!ok) throw Error(description); count++; };
  for (const [breakpoint,presentation] of [['large','inline'],['medium','inline'],['small','inline'],['large','dropdown']]) {
    hooks=[]; preferences.clear();
    let provider=render('farm',presentation);
    provider.setBreakpoint(breakpoint);
    provider=render('farm',presentation);
    check(!provider.isPanelVisible, breakpoint+' starts closed with activities');
    provider.togglePanel();
    provider=render('farm',presentation);
    check(provider.isPanelVisible, breakpoint+' native toggle opens');
    provider.togglePanel();
    check(!render('farm',presentation).isPanelVisible,breakpoint+' native toggle closes');
    provider=render('farm',presentation);
    provider.togglePanel();
    check(!render('new-chat',presentation).isPanelVisible,breakpoint+' new conversation starts closed');
  }
  return count;
}

const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const assets = path.resolve(__dirname, '../ui/host');
const url = name => pathToFileURL(path.join(assets,name)).href;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'modeldesk-overview-'));
try {
  const providerCommand = `from pathlib import Path
import io, json, os, runpy, zipfile
from scripts.desktop_layout import modern_layout, workshop_overview
build=runpy.run_path('scripts/build-host-bundle.py')
paths=[Path(os.environ.get('MODELDESK_TEST_HOST', build['DEFAULT_SOURCE'])),
       build['INSTALLED_DESKTOP_SOURCE'], Path.home()/'Applications/ModelDesk.app/Contents/Resources/bin/language_server']
factories={}
for path in dict.fromkeys(paths):
    if path.is_file():
        raw=zipfile.ZipFile(io.BytesIO(build['original_bundle'](path))).read('main.js').decode()
        modern=modern_layout(raw)
        if modern in factories:
            continue
        provider, context, pref, end=('ZXc','D4','TXc','$Xc') if modern else ('hDc','S2','bDc','iDc')
        code=workshop_overview(raw)
        start=code.index('function '+provider+'({cascadeId:')
        body=code[start:code.index(';const '+end+'=',start)]
        factories[modern]='('+pref+')=>{const '+context+'={Provider:{}};'+body+';return '+provider+';}'
if not factories:
    raise RuntimeError('需要原版宿主资源才能验证原生切换')
print(json.dumps(list(factories.values())))`;
  const provider=spawnSync('python3',['-c',providerCommand],{cwd:path.join(__dirname,'..'),encoding:'utf8'});
  assert.equal(provider.status,0,provider.stderr);
  const factories = JSON.parse(provider.stdout);
  const file = path.join(tmp,'overview.html');
  fs.writeFileSync(file,`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${url('native-layout.css')}">
    <style>*{box-sizing:border-box}main{width:1120px;height:650px}textarea{width:100%}
      [data-testid^="overview-panel-host-"]{position:absolute;top:8px;right:8px}
      .md-native-scene{height:180px}</style>
    <main data-md-chat-shell><div data-testid="conversation-view"><textarea></textarea></div>
      <section data-md-surface="chat"><div data-md-overview-for="farm"></div><div class="md-native-panels"><div class="md-native-scene"></div></div></section></main>
    <script>const E={createContext:()=>null},zy={createPortal:(node,to)=>to.appendChild(node)};</script>
    <script src="${url('native-slots.js')}"></script><output></output>
    <script>const providers=[${factories.join(',')}];</script>
    <script>onload=()=>{try{document.querySelector('output').textContent=(${checkLayout.toString()})()+providers.reduce((count,factory)=>count+(${checkProvider.toString()})(factory),0);}catch(e){document.querySelector('output').textContent=e.message}}</script>`);
  const run = spawnSync(chrome,['--headless','--disable-extensions','--no-first-run','--disable-background-networking',
    '--user-data-dir='+path.join(tmp,'profile'),'--window-size=1300,800','--dump-dom',pathToFileURL(file).href],
    {encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.error?.message || run.stderr);
  const result = run.stdout.match(/<output>([^<]*)<\/output>/)?.[1];
  assert.equal(result,String(11+16*factories.length),result || 'Chromium did not render the fixture');
  console.log(`Chromium Overview layout and ${factories.length} host provider(s): ${result} checks passed.`);
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
