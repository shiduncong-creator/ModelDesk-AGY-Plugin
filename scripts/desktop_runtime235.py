"""React and trajectory bindings for the 2.35 desktop renderer."""

import re


# Each old spelling is used only in ModelDesk's own source. A known spelling in
# the host is insufficient: minification reuses names in unrelated scopes.
# Check the defining behaviour and its data flow before installing this profile.
BINDINGS = {
    "sea": "xea", "Jg": "Ng", "$ca": "ada", "scc": "bhc",
    "fl": "wl", "eJ": "UJ", "yd": "zd", "el": "vl", "sB": "aC",
    "Wl": "nm", "Ozb": "zBb", "zy": "hz", "gf": "jf",
    "ql": "Hl", "Xk": "ll", "YBc": "$Gc", "x_": "QZ",
}
_SYMBOL = re.compile(r"(?<![\w$.])(?:" + "|".join(map(re.escape, BINDINGS)) + r")(?![\w$])")

_CONTRACTS = {
    "React and portals": (
        'var E=globalThis.React;', 'var hz=globalThis.ReactDOM;',
    ),
    "live and historical background tasks": (
        'function xea(a){var b=a?.stepIndex;if(b!==void 0)return a?.taskId||`step__${b}`}',
        'var Ng={selector:function(a){var b=new Map;for(var c of a?.backgroundTasks??[]){var d=c.taskSnapshot,f=xea(d);',
        'summary:d?.toolSummary||void 0,iconName:"progress_activity",isRunning:!0,stepIndex:d?.stepIndex',
        'summary:d.label||void 0,iconName:d.icon||"check_circle",isRunning:!1,stepIndex:zea(g.id)',
        'return[...c,...a]},equalityFn:zd}',
        'function ada(a){if(a.step.case==="runCommand")return a.step.value;if(a.step.case==="generic")',
    ),
    "run status and model metadata": (
        'K.CascadeRunStatus={UNSPECIFIED:0,IDLE:1,RUNNING:2,CANCELING:3,BUSY:4}',
        'K.CortexStepStatus={UNSPECIFIED:0,GENERATING:8,QUEUED:11,PENDING:1,RUNNING:2,WAITING:9,DONE:3',
        'function bhc(a,b,c=ahc(a?.trajectorySlice?.generatorMetadatasInSlice),d=!1){var f=c?.plannerConfig?.modelName;',
        'return{modelName:f,modelLabel:(b??a)?.label}',
        'var wl=(a,b,...c)=>{var d=b.selector,f=b.equalityFn,',
        'UJ=a=>{var b=(0,E.useContext)(TJ);if(!b)throw Error("useAgentStateProvider must be used within a TrajectoriesContextProvider")',
        'var vl=function(a=nl){var b=a===nl?Lqa:Kqa(a),c=(d,f={})=>{({equalityFn:f=',
        'aC=a=>a.userStatus,', 'vl(aC)?.cascadeModelConfigData?.clientModelConfigs',
        'nm=(a,b)=>a?.trajectorySummaries?.summaries?.[b]??a?.trajectorySummaries?.externalSummaries?.[b]',
    ),
    "direct assistants": (
        'zBb=a=>vl(b=>WD(b,a),hS)', 'var WD=(a,b)=>{if(!b||!a.trajectorySummaries?.indexes?.byParent?.[b])',
        'f=bE(a,b).map(g=>cE(g,c[g]))',
        'function H6a(a){var b=a.trajectoryMetadata?.subagentSpec',
        'return{subagentName:b?.typeName||"Subagent",toolSummary:b?.role||b?.typeName||a||""}',
        'conversationId:a,...H6a(b),status:Rl(b)?K.CortexStepStatus.RUNNING:K.CortexStepStatus.DONE',
        'killed:c,needsAttention:d!==void 0,firstWaitingStep:',
    ),
    "account quota": (
        'll=a=>a.authState?.current', 'function Hl(){var a=ud().core.cloudCodeService,',
        'if(!b||!a.retrieveUserQuotaSummary)return a;var c=a.retrieveUserQuotaSummary.bind(a);',
        'retrieveUserQuotaSummary?.(D)?.then(F=>{p(F.response?.groups||[])',
        'a.remaining.case==="remainingFraction"?a.remaining.value:void 0,c=a.resetTime?jf(a.resetTime):void 0',
        'function jf(a){return new Date(kf(a))}',
        'function kf(a){return Number(a.seconds)*1E3+Math.round(a.nanos/1E6)}',
    ),
    "file pane": (
        'function $Gc(){var a=xU(),b=d0(),c=WGc(),{canOpenUrlInPreview:d,openUrlInBrowserPane:f}',
        'case "fileView":if(typeof u.uri!=="string"||!u.uri||!YGc(u.keepOpen)||!YGc(u.background))return!1;v=q(u.targetConversationId);',
    ),
    "inline thought conversation": (
        'var QZ=()=>{var {cascadeContext:{state:{agentStateProvider:a}}}=yK();return wl(a,{selector:Hg})}',
        'function Hg(a){return a?.conversationId}', 'function $X(a){return a?.sourceTrajectoryStepInfo?.stepIndex??-1}',
    ),
}


def runtime235(source: str) -> str:
    """Bind ModelDesk's own JS identifiers to the 2.35 lexical scope."""
    return _SYMBOL.sub(lambda match: BINDINGS[match.group()], source)


def bind_runtime(source: str, host_code: str) -> str:
    for group, witnesses in _CONTRACTS.items():
        for witness in witnesses:
            if host_code.count(witness) != 1:
                raise ValueError(f"宿主数据接口已变化（{group}）：{witness[:75]}")
    return runtime235(source)
