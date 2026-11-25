// Display-only adapters for the native conversation and its Overview subscriptions.
function modelDeskCliName(executable) {
    const name = executable.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd)$/, '');
    if (name === 'qodercli') return 'qoder';
    return ['codex','gemini','qoder'].includes(name) ? name : null;
}

// Tokenize just the command header. Quoted prompt arguments and heredoc bodies
// are data; a mention of an agent in either cannot assign a workstation.
function modelDeskCliInvocation(input, depth = 0) {
    if (typeof input !== 'string' || !input || depth > 2) return null;
    let command = input.slice(0, 16384);
    if (command.startsWith('"')) {
        // The transcript can supply a JSON-quoted preview truncated inside the prompt.
        const encoded = command.replace(/\s*<truncated \d+ bytes>$/, '"');
        try { const s = JSON.parse(encoded); if (typeof s === 'string') command = s; } catch {
            if (encoded !== command) {
                const header = encoded.substring(0,encoded.lastIndexOf(' '));
                try { command = JSON.parse(header + '"'); } catch {}
            }
        }
    }
    const parts = [];
    let words = [], word = '', quote = '', heredoc = false;
    function endWord() { if (word) words.push(word); word = ''; }
    function endCommand() { endWord(); if (words.length) parts.push(words); words = []; }
    for (let i=0; i<command.length; i++) {
        const char = command[i], next = command[i+1];
        if (char === '\\' && quote !== "'" && next !== undefined) {
            if (next !== '\n') word += next;
            i++;
        } else if (quote) {
            if (char === quote) quote = ''; else word += char;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '\n') { endCommand(); if (heredoc) break; }
        else if (char === ';' || char === '&' || char === '|') endCommand();
        else if (/\s/.test(char)) endWord();
        else if (char === '#' && !word) { const end = command.indexOf('\n',i); i=end<0?command.length:end-1; }
        else { if (char === '<' && next === '<') heredoc = true; word += char; }
    }
    endCommand();
    for (const segment of parts) {
        let i = 0;
        while (/^[A-Za-z_]\w*=/.test(segment[i] || '') ||
            ['env','command','exec','nohup'].includes((segment[i] || '').split('/').pop())) i++;
        if (!segment[i]) continue;
        const basename = segment[i].split('/').pop();
        if (['sh','bash','zsh'].includes(basename) && /^-[a-z]*c$/.test(segment[i+1] || '')) {
            const nested = modelDeskCliInvocation(segment[i+2],depth+1);
            if (nested) return nested;
        }
        const engine = modelDeskCliName(segment[i]);
        if (!engine) continue;
        let model = '';
        for (let j=i+1;j<segment.length;j++) {
            const arg = segment[j];
            const candidate = arg === '-m' || arg === '--model' ? segment[j+1] : arg.startsWith('--model=') ? arg.slice(8) : '';
            if (candidate && /^[\w.:/-]{1,96}$/.test(candidate)) { model=candidate; break; }
        }
        return {engine,model};
    }
    return null;
}

// Synchronous run_command calls appear on the trajectory before (and often without)
// a background task. Use the executable from structured tool data for attribution.
function modelDeskCommandStage(step) {
    const states = K.CortexStepStatus;
    switch (step.status) {
    case states.QUEUED: case states.PENDING: case states.GENERATING: return 'dispatching';
    case states.WAITING: return 'waiting';
    case states.RUNNING: return 'running';
    case states.ERROR: case states.INVALID: return 'failed';
    case states.CANCELED: case states.INTERRUPTED: return 'cancelled';
    case states.DONE: return 'completed';
    default: return null;
    }
}

function modelDeskTurnCommands(state, background) {
    const slice = state?.trajectorySlice, steps = slice?.stepsInSlice;
    if (!steps?.length) return [];
    const total = slice.totalStepsLength ?? steps.length;
    const from = slice.stepsSlice?.startIndex ?? 0;
    const start = Math.max(0,from < 0 ? total+from : from);
    const seen = new Set(background.map(row => row.stepIndex).filter(Number.isInteger));
    const runningTurn = [K.CascadeRunStatus.RUNNING,K.CascadeRunStatus.BUSY].includes(state.status);
    const lastUser = steps.findLastIndex(step => step?.step?.case === 'userInput');
    const rows = [];
    for (let i = steps.length-1; i > lastUser; i--) {
        const step = steps[i], index = start+i;
        if (!step?.step || seen.has(index)) continue;
        const body = $ca(step);
        const cli = modelDeskCliInvocation(body?.commandLine);
        if (cli) {
            let status = modelDeskCommandStage(step);
            if (!status) continue;
            if (['running','dispatching','waiting'].includes(status)) {
                // Detached steps keep RUNNING in the transcript after they exit.
                // Their live snapshot and completion receipt own that lifecycle.
                const handingOff = index === total-1 && runningTurn;
                if ((step.taskDetails && !handingOff) || !runningTurn || start+steps.length < total) continue;
            }
            if (status === 'completed' && body.exitCode) status = 'failed';
            rows.push({id:'step__'+index,stepIndex:index,...cli,label:'终端派单',state:status});
        } else if (runningTurn && index === total-1 && step.step.case === 'plannerResponse') {
            for (const call of step.step.value.toolCalls || []) {
                if (call.name !== 'run_command') continue;
                let args;
                try { args = JSON.parse(call.argumentsJson); } catch { continue; }
                const agent = modelDeskCliInvocation(args?.CommandLine || args?.commandLine);
                if (agent) rows.push({id:'dispatch-'+index+'-'+rows.length,stepIndex:index,...agent,
                    label:'正在派发终端任务',state:'dispatching'});
            }
        }
    }
    return rows;
}

function modelDeskTaskRows(state) {
    const live = new Map((state?.backgroundTasks || []).map(task => [sea(task.taskSnapshot), task]));
    const background = Jg.selector(state).map(row => {
        const task = live.get(row.taskId);
        const step = task?.step;
        const body = step?.step && $ca(step);
        // Older history rows retain a terminal command header and optional title.
        const command = body?.commandLine || (row.description !== row.summary ? row.description : '');
        const cli = modelDeskCliInvocation(command);
        const summary = (row.summary || '').trim();
        // Some versions publish a dispatch title without command metadata.
        const dispatch = !cli && (!body?.commandLine && (!row.description || row.description === summary)) &&
            /^(?:dispatch(?:ing)?|launch(?:ing)?|start(?:ing)?|派发给|派单给)\s+(codex|gemini|qoder(?:cli)?)\b/i.exec(summary);
        const engine = cli?.engine || (dispatch && modelDeskCliName(dispatch[1])) || null;
        let status = 'completed';
        if (row.isRunning) status = 'running';
        else if (['error','error_outline','cancel','block'].includes(row.iconName)) status = row.iconName === 'cancel' ? 'cancelled' : 'failed';
        else if (body?.exitCode !== undefined && body.exitCode !== 0) status='failed';
        return {id:String(row.taskId), stepIndex:row.stepIndex ?? task?.taskSnapshot?.stepIndex, engine, model:cli?.model || '', label:summary.slice(0,220) || '后台任务', state:status};
    });
    return [...background, ...modelDeskTurnCommands(state,background)];
}

function modelDeskRunState(status) {
    switch (status) {
    case K.CascadeRunStatus.IDLE: return 'idle';
    case K.CascadeRunStatus.RUNNING:
    case K.CascadeRunStatus.BUSY: return 'running';
    case K.CascadeRunStatus.CANCELING: return 'cancelling';
    default: return 'unknown';
    }
}

function modelDeskReportedModel(state, configs) {
    const model = scc(state, configs);
    return model.modelLabel || model.modelName || '';
}

const modelDeskChildModelSelector = {selector:modelDeskReportedModel};
function ModelDeskChildModel({id, configs, report}) {
    const model = fl(eJ(id), modelDeskChildModelSelector, configs);
    E.useEffect(() => { if (model) report(id,model); }, [id,model,report]);
    return null;
}

const modelDeskTrajectoryActivity = {
    selector:(state,configs) => ({
        status:modelDeskRunState(state?.status), model:modelDeskReportedModel(state,configs),
        tasks:modelDeskTaskRows(state),
    }), equalityFn:yd,
};
function ModelDeskNativeActivity({conversationId,onActivity}) {
    const configs = el(store => sB(store)?.cascadeModelConfigData?.clientModelConfigs);
    const trajectory = fl(eJ(conversationId),modelDeskTrajectoryActivity,configs);
    const summary = el(store => Wl(store,conversationId));
    const children = Ozb(conversationId);
    const [models,setModels] = E.useState({});
    const reportModel = E.useCallback((id,model) => {
        setModels(prior => prior[id] === model ? prior : {...prior,[id]:model});
    },[]);
    const assistants = E.useMemo(() => children.map(child => {
        const state = child.killed ? 'cancelled' : child.needsAttention ? 'waiting' :
            child.status === K.CortexStepStatus.RUNNING ? 'running' : 'completed';
        return {id:child.conversationId, engine:modelDeskCliName(child.subagentName || ''),
            label:child.toolSummary || child.subagentName || '助手', model:models[child.conversationId] || '', state};
    }),[children,models]);
    E.useEffect(() => {
        const state = summary?.waitingSteps?.length ? 'waiting' :
            trajectory.status === 'unknown' ? modelDeskRunState(summary?.status) : trajectory.status;
        onActivity({conversationId,lead:{state,model:trajectory.model},assistants,tasks:trajectory.tasks});
    },[conversationId,onActivity,summary,trajectory,assistants]);
    return assistants.filter(a=>a.state === 'running' || a.state === 'waiting')
        .map(a=>E.createElement(ModelDeskChildModel,{key:a.id,id:a.id,configs,report:reportModel}));
}
