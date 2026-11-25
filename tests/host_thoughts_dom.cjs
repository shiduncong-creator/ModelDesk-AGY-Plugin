'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');

// Run this component with the same React/ReactDOM shipped by the signed host.
const bundle = process.env.MODELDESK_UI_ZIP || path.join(os.homedir(),'Applications/吉米奈的工作台.app/Contents/Resources/modeldesk-host-ui.zip');
const extracted = spawnSync('unzip',['-p',bundle,'main.js'],{encoding:'utf8',maxBuffer:25*1024*1024});
assert.equal(extracted.status,0);
const code = extracted.stdout;
function library(marker, exportedGlobal) {
    const license = code.indexOf(marker);
    assert.ok(license >= 0, 'Missing host library ' + marker);
    const start = code.indexOf('(function(){', license);
    assert.ok(start >= 0, 'Missing library wrapper for ' + marker);
    // The minified local binding changes across releases. The exported global is stable.
    const declaration = new RegExp('var [\\w$]+=globalThis\\.' + exportedGlobal + ';');
    const match = declaration.exec(code.slice(start));
    assert.ok(match && match.index > 0, 'Missing host export ' + exportedGlobal);
    return code.slice(start, start + match.index);
}
async function testView() {
    const results = [];
    const check = (name,valid) => { if (!valid) throw Error(name); results.push(name); };
    const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
    const article = document.querySelector('article');
    let sid = 'chat-a', pending, calls = 0;
    window.x_ = () => sid;
    const root = ReactDOM.createRoot(article);
    const draw = (source,step=12) => ReactDOM.flushSync(() => root.render(
        React.createElement(ModelDeskInlineThought,{source,step,markdown:({children})=>React.createElement('p',null,children)})));
    const publish = (rows=[],on=true,pair=false) => ModelDeskInlineThoughts.update(sid,{
        session:{id:sid},thoughts:{conversation_id:sid,entries:rows,preset:'fixture'},
        prefs:{thought_auto_translate:on,thought_bilingual:pair},translation:{configured:true,config:{model:'fixture'}},
    });
    const row = (text,kind='summary') => ({kind,text,status:'translated',translation:'已有译文',step:12});
    const source = 'A public sample.';
    window.modelDeskHUD = {call:async (method,args) => {
        calls++;
        check('scoped request only carries render identifiers',method === 'app_thoughts' && !('visible_text' in args) && args.conversation_id===sid);
        check('retrieves exact visible revision',ModelDeskInlineThoughts.readVisible(sid,args.visible_step,args.visible_revision)===article.querySelector('p').textContent);
        check('wrong conversation cannot retrieve the source',ModelDeskInlineThoughts.readVisible('other',args.visible_step,args.visible_revision)===null);
        return new Promise(resolve => { pending=txt=>resolve({conversation_id:sid,revision:args.visible_revision,status:'translated',translation:txt}); });
    }};
    draw(source);
    publish([row(source)]);
    await wait(30);
    check('translated in place',article.textContent==='已有译文' && !article.innerHTML.includes(source));
    publish([row(source)],true,true); await wait(30);
    check('bilingual retains the original',article.textContent.includes(source)&&article.textContent.includes('已有译文'));
    publish([row(source)],false); await wait(30);
    check('auto off restores the original',article.textContent===source);
    publish([row(source,'reply')]); await wait(1000);
    check('reply does not replace a thought with identical source',article.textContent===source);
    check('visible historical summary gets a lazy request',calls===1 && pending);
    const old=pending; draw('Updated public sample.');
    old('旧版本'); await wait(4150);
    check('expired translation cannot overwrite streamed text',article.textContent==='Updated public sample.');
    pending('新的译文'); await wait(40);
    check('fresh translation appears',article.textContent==='新的译文');
    sid='chat-b'; article.setAttribute('data-md-chat-shell',sid); draw(source); publish([],false); await wait(40);
    check('new conversation shows its own original',article.textContent===source);
    draw('placeholder',0); ReactDOM.flushSync(()=>root.unmount()); await wait(30);
    check('unmount releases disclosure registration',modelDeskThoughtViews.size===0);
    return results;
}
async function testScopedBridge() {
    const vm = require('node:vm');
    const sid='11111111-1111-4111-a111-111111111111', other='22222222-2222-4222-a222-222222222222';
    const source='Visible fixture.',local='https://local.invalid';
    let handler, forwarded;
    const fakeElectron={app:{on() {}},ipcMain:{handle(_,fn) { handler=fn; }}};
    const context={Object,URL,module:{},fixtureQuery:(_,args)=>{forwarded=args;return Promise.resolve(args);},
        require: name=> name==='electron' ? fakeElectron : name==='./utils' ? {isLocalHubTopFrame:()=>true} :
            name==='./authBootstrap' ? {getActiveLsBaseUrl:()=>local} : require(name)};
    const ipc=fs.readFileSync(path.resolve(__dirname,'../macos/desktop-hud.cjs'),'utf8');
    vm.runInNewContext(ipc+'\nquery=fixtureQuery; register();',context);
    const event={sender:{},senderFrame:{url:local+'/chat/'+sid,executeJavaScript: async script =>
        vm.runInNewContext(script,{window:{ModelDeskInlineThoughts:{readVisible:(id,step,rev)=>id===sid&&step===8&&rev===3?source:null}}})}};
    const request={conversation_id:sid,visible_step:8,visible_revision:3};
    await assert.rejects(handler(event,'app_thoughts',{...request,visible_text:'unverified'}));
    await assert.rejects(handler(event,'app_thoughts',{...request,conversation_id:other}));
    assert.equal((await handler(event,'app_thoughts',{...request,visible_revision:4})).status,'unavailable');
    assert.equal(forwarded,undefined);
    await handler(event,'app_thoughts',request);
    assert.equal(forwarded.visible_text,source);
    console.log('Native inline thought IPC: 5 scope and visibility checks passed.');
}
testScopedBridge().catch(error=>{console.error(error);process.exitCode=1;});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'md-inline-thoughts-'));
try {
    fs.writeFileSync(path.join(tmp,'react.js'),library('react.production.min.js','React'));
    fs.writeFileSync(path.join(tmp,'react-dom.js'),library('react-dom.production.min.js','ReactDOM'));
    const file=path.join(tmp,'view.html');
    fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><script>window.safevalues_raw={dom:{}};window.onerror=e=>document.querySelector("pre").textContent=e</script>'+
      '<script src="react.js"></script><script src="react-dom.js"></script><script>const E=window.React</script>'+
      '<script src="'+pathToFileURL(path.resolve(__dirname,'../ui/host/inline-thoughts.js')).href+'"></script>'+
      '<article data-md-chat-shell="chat-a"></article><pre id="result"></pre><script>('+testView.toString()+')().then(x=>result.textContent=JSON.stringify({checks:x})).catch(e=>result.textContent=JSON.stringify({error:e.stack}))</script>');
    const chrome=process.env.MODELDESK_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const result=spawnSync(chrome,['--headless','--disable-extensions','--disable-background-networking','--no-first-run',
        '--user-data-dir='+path.join(tmp,'profile'),'--virtual-time-budget=8000','--dump-dom',pathToFileURL(file).href],
        {encoding:'utf8',timeout:20000,maxBuffer:512*1024});
    assert.equal(result.status,0);
    const payload=JSON.parse(result.stdout.match(/<pre id="result">([^<]+)<\/pre>/)[1]);
    assert.ok(!payload.error,payload.error);
    console.log('Chromium native inline thoughts:',payload.checks.length,'checks passed.');
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
