// Offline replay inside the locally installed 2.35 renderer. These fixtures
// notify real React, Redux and trajectory selectors through their normal APIs.
window.addEventListener('load', async () => {
    const output = document.querySelector('#runtime-result');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    function feed(state) {
        const listeners = new Set();
        return {
            getState: () => state,
            subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
            onDidChange(listener) { return {dispose: this.subscribe(listener)}; },
            send(next) { state = next; for (const listener of listeners) listener(next); },
        };
    }
    try {
        const parent = 'replay-parent', child = 'replay-helper';
        const ids = {stepIndex:29,taskId:'task-29'};
        const command = 'codex exec -m replay-codex "offline case"';
        const active = {
            taskSnapshot:{...ids,description:command,toolSummary:'Dispatch Codex'},
            step:{step:{case:'runCommand',value:{commandLine:command}}},
        };
        const finished = {key:'background_tasks',items:[{id:ids.taskId,renderInfo:{
            label:'Dispatch Codex',icon:'check_circle',content:{case:'taskView',value:{header:command}},
        }}]};
        const trajectory = (id, model) => ({
            conversationId:id, status:K.CascadeRunStatus.RUNNING, backgroundTasks:[], accumulatedSections:[],
            trajectorySlice:{generatorMetadatasInSlice:[{plannerConfig:{modelName:model}}]},
        });
        const main = feed({...trajectory(parent,'lead-model'),backgroundTasks:[active],accumulatedSections:[finished]});
        const helper = feed(trajectory(child,'assistant-model'));
        const registry = {listen:() => () => {},peek:id => id===parent ? main : helper};
        const helperSummary = {status:K.CascadeRunStatus.RUNNING,waitingSteps:[],trajectoryMetadata:{
            subagentSpec:{role:'Offline Fixture',typeName:'Helper'},
        }};
        const store = feed({userStatus:{cascadeModelConfigData:{clientModelConfigs:[]}},
            trajectorySummaries:{summaries:{[child]:helperSummary},indexes:{byParent:{[parent]:{[child]:true}}}},
        });
        let latest;
        const capture = activity => { latest = activity; };
        const react = E.createElement;
        const target = document.getElementById('runtime-fixture');
        const root = hz.createRoot(target);
        const thought = 'Public summary for the renderer test';
        const translation = '渲染测试的公开摘要';
        window.ModelDeskInlineThoughts.update(parent,{session:{id:parent},
            prefs:{thought_auto_translate:true,thought_bilingual:false},
            translation:{configured:true},thoughts:{conversation_id:parent,entries:[
                {kind:'summary',text:thought,translation,status:'translated'},
            ]}});
        const redux = {store,subscription:{addNestedSub:store.subscribe.bind(store)}};
        const cascade = {cascadeContext:{state:{agentStateProvider:main}}};
        hz.flushSync(() => root.render(react(nl.Provider,{value:redux},react(TJ.Provider,{value:registry},
            react(xK.Provider,{value:cascade},
                react(ModelDeskNativeActivity,{conversationId:parent,onActivity:capture}),
                react('article',{'data-md-chat-shell':parent},react(ModelDeskInlineThought,{
                    source:thought,step:$X({sourceTrajectoryStepInfo:{stepIndex:29}}),markdown:'span',
                })))))));
        // Let React apply model identity from the separate child subscription.
        await new Promise(resolve => setTimeout(resolve,40));
        check(latest?.lead.model==='lead-model' && latest.lead.state==='running','lead subscription');
        check(latest.assistants[0]?.model==='assistant-model' && latest.assistants[0].state==='running','child subscription');
        check(latest.tasks.length===1 && latest.tasks[0].engine==='codex' &&
            latest.tasks[0].state==='running' && latest.tasks[0].model==='replay-codex','live command and deduplication');
        check(target.querySelector('[data-md-thought="translated"]')?.textContent===translation,'inline replacement');
        hz.flushSync(() => {
            main.send({...main.getState(),status:K.CascadeRunStatus.IDLE,backgroundTasks:[]});
            const old = store.getState();
            store.send({...old,trajectorySummaries:{...old.trajectorySummaries,summaries:{[child]:{
                ...helperSummary,status:K.CascadeRunStatus.IDLE,
            }}}});
        });
        check(latest.lead.state==='idle' && latest.assistants[0].state==='completed' &&
            latest.tasks.length===1 && latest.tasks[0].state==='completed','completion transition');
        const turn = [{step:{case:'userInput',value:{}}}];
        function publishSteps(steps, backgroundTasks=[], accumulatedSections=[]) {
            hz.flushSync(() => main.send({...main.getState(),status:K.CascadeRunStatus.RUNNING,
                backgroundTasks,accumulatedSections,trajectorySlice:{...main.getState().trajectorySlice,
                    stepsSlice:{startIndex:28},stepsInSlice:steps,totalStepsLength:28+steps.length}}));
        }
        const plan = {step:{case:'plannerResponse',value:{toolCalls:[{
            name:'run_command',argumentsJson:JSON.stringify({CommandLine:command})}]}}};
        publishSteps([...turn,plan]);
        check(latest.tasks.length===1 && latest.tasks[0].state==='dispatching','structured dispatch before launch');
        const foreground = {status:K.CortexStepStatus.RUNNING,step:{case:'runCommand',value:{commandLine:command}}};
        publishSteps([...turn,foreground]);
        check(latest.tasks.length===1 && latest.tasks[0].state==='running','foreground Codex before background promotion');
        publishSteps([...turn,{...foreground,taskDetails:{}}]);
        check(latest.tasks.length===1 && latest.tasks[0].state==='running','command remains live during background promotion');
        publishSteps([...turn,foreground],[active],[finished]);
        check(latest.tasks.length===1 && latest.tasks[0].state==='running','foreground promotion deduplication');
        publishSteps([...turn,{...foreground,taskDetails:{} }],[],[finished]);
        check(latest.tasks.length===1 && latest.tasks[0].state==='completed','stale detached step cannot override completion');
        publishSteps([...turn,{...foreground,status:K.CortexStepStatus.DONE},...turn]);
        check(latest.tasks.length===0,'previous turn foreground state cleared');
        // This quota object uses exactly the fields consumed by Models & Usage.
        const result = await modelDeskReadQuota({async retrieveUserQuotaSummary() { return {response:{groups:[{
            displayName:'Gemini Models',buckets:[
                {window:'weekly',remaining:{case:'remainingFraction',value:0.73}},
                {window:'5h',remaining:{case:'remainingFraction',value:0.91},resetTime:{seconds:123,nanos:0}},
            ],
        }]}}; }},{state:'signedIn'},false);
        const [weekly,short] = result[0].windows;
        check(weekly.label==='每周' && weekly.remaining===0.73 &&
            short.label==='5 小时' && short.remaining===0.91 && short.reset,'quota windows and protobuf time');
        root.unmount();
        output.textContent = 'passed';
    } catch (error) { output.textContent = 'failed '+String(error); }
});
