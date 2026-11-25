'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname,'../ui/host/native-activity.js'),'utf8');
const rows = state => [
    ...state.backgroundTasks.map(task => ({...task.taskSnapshot,isRunning:true})),
    ...state.history.filter(row => !state.backgroundTasks.some(task=>task.taskSnapshot.taskId===row.taskId)),
];
const context = {yd:Object.is, Jg:{selector:rows}, sea:row=>row.taskId, $ca:step=>step.step.value,
    K:{CascadeRunStatus:{IDLE:1,RUNNING:2,CANCELING:3,BUSY:4},CortexStepStatus:{RUNNING:2}}};
vm.createContext(context);
vm.runInContext(src,context);
const command = 'export PATH="/test/bin:$PATH" && "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex" exec -m gpt-6.2-sol "review the project"';
const cli = context.modelDeskCliInvocation;
assert.equal(cli(command).model,'gpt-6.2-sol');
assert.equal(cli(JSON.stringify(command)).engine,'codex');
assert.equal(cli(JSON.stringify(command).slice(0,-5)+' <truncated 4786 bytes>').engine,'codex');
assert.equal(cli('/usr/bin/env X=1 gemini --model=gemini-4').model,'gemini-4');
assert.equal(cli('bash -lc "qodercli --model qoder-1"').engine,'qoder');
for (const s of ['which codex','echo "hello; codex exec"','cat path/codex',"cat <<'END'\ncodex exec\nEND",'read a report on Codex','constructor']) assert.equal(cli(s),null,s);
const commandTask = {taskSnapshot:{taskId:'task-850',summary:'Dispatch Codex GPT-6.2-Sol',description:'后台执行委派'},step:{step:{value:{commandLine:command}}}};
const history = [{taskId:'task-850',summary:commandTask.taskSnapshot.summary,description:command,isRunning:false}];
const live=context.modelDeskTaskRows({backgroundTasks:[commandTask],history});
assert.equal(live.length,1);
assert.equal(live[0].engine,'codex');
assert.equal(live[0].state,'running');
assert(!JSON.stringify(live).includes('/Applications'));
assert.equal(context.modelDeskTaskRows({backgroundTasks:[],history})[0].state,'completed');
const textOnly = {...commandTask,step:{step:{value:{commandLine:'echo codex'}}}};
assert.equal(context.modelDeskTaskRows({backgroundTasks:[textOnly],history:[]})[0].engine,null);
const named = {taskSnapshot:{taskId:'task-2',summary:'Dispatch Codex to review',description:'Dispatch Codex to review'}};
assert.equal(context.modelDeskTaskRows({backgroundTasks:[named],history:[]})[0].engine,'codex');
for (const [input,result] of [[2,'running'],[1,'idle'],[3,'cancelling'],[0,'unknown']]) assert.equal(context.modelDeskRunState(input),result);
console.log('Native activity attribution, transitions, identity and safe display passed.');
