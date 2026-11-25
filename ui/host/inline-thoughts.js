// This component only mounts inside the host's expanded, read-only thought body.
const modelDeskThoughtViews = new Map();
const modelDeskThoughtSessions = new Map();
const modelDeskThoughtListeners = new Map();
const modelDeskThoughtDefaults = Object.freeze({enabled:false, bilingual:false, provider:'', configured:false, rows:[]});
let modelDeskThoughtRevision = 0;

function modelDeskNotifyThoughts(id) {
    for (const listener of modelDeskThoughtListeners.get(id) || []) listener();
}
function modelDeskPublishThoughts(id, snapshot) {
    if (!id || snapshot?.session?.id !== id || snapshot.thoughts?.conversation_id !== id) return;
    const provider = snapshot.translation;
    const next = {
        enabled:snapshot.prefs?.thought_auto_translate === true,
        bilingual:snapshot.prefs?.thought_bilingual === true,
        provider:JSON.stringify([snapshot.thoughts.preset, provider?.config?.model, provider?.config?.base_url]),
        configured:provider?.configured === true,
        rows:(snapshot.thoughts.entries || []).filter(r => r.kind === 'summary' && !r.truncated && r.translation && r.status === 'translated')
            .map(r => [r.text,r.translation]),
    };
    const prior = modelDeskThoughtSessions.get(id);
    if (prior && prior.enabled === next.enabled && prior.bilingual === next.bilingual && prior.provider === next.provider &&
        prior.configured === next.configured && prior.rows.length === next.rows.length &&
        prior.rows.every(([text,tr],i) => next.rows[i][0] === text && next.rows[i][1] === tr)) return;
    modelDeskThoughtSessions.set(id,next);
    modelDeskNotifyThoughts(id);
}
function modelDeskVisibleThought(id, step, revision) {
    const view = modelDeskThoughtViews.get(revision);
    if (!view || view.id !== id || view.step !== step || document.hidden || !view.node.isConnected ||
        view.node.closest('[data-md-chat-shell]')?.getAttribute('data-md-chat-shell') !== id ||
        !view.node.checkVisibility({opacityProperty:true,visibilityProperty:true})) return null;
    const viewport = view.node.getBoundingClientRect();
    return viewport.bottom > 0 && viewport.right > 0 && viewport.left < innerWidth && viewport.top < innerHeight ? view.source : null;
}
Object.defineProperty(window,'ModelDeskInlineThoughts',{value:Object.freeze({
    update:modelDeskPublishThoughts,
    release(id) { if (modelDeskThoughtSessions.delete(id)) modelDeskNotifyThoughts(id); },
    readVisible:modelDeskVisibleThought,
})});

function ModelDeskInlineThought({source, step, markdown:Markdown, animate}) {
    const id = x_();
    const subscribe = E.useCallback(listener => {
        let set = modelDeskThoughtListeners.get(id);
        if (!set) modelDeskThoughtListeners.set(id,set=new Set());
        set.add(listener);
        return () => { set.delete(listener); if (!set.size) modelDeskThoughtListeners.delete(id); };
    },[id]);
    const read = E.useCallback(() => modelDeskThoughtSessions.get(id) || modelDeskThoughtDefaults,[id]);
    const {enabled,bilingual,provider,configured,rows} = E.useSyncExternalStore(subscribe,read);
    const revision = E.useMemo(() => ++modelDeskThoughtRevision,[id,step,source]);
    const [result,setResult] = E.useState(null);
    const [visible,setVisible] = E.useState(false);
    const lastRequest = E.useRef(null);
    const container = E.useRef(null);
    E.useEffect(() => {
        const node = container.current;
        if (!node || !id || !Number.isInteger(step) || step < 0 || typeof source !== 'string') return;
        modelDeskThoughtViews.set(revision,{id,step,source,node});
        setVisible(modelDeskVisibleThought(id,step,revision) !== null);
        const view = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
        view.observe(node);
        return () => { view.disconnect(); modelDeskThoughtViews.delete(revision); };
    },[id,step,source,revision]);
    const cached = rows.find(([text]) => text === source)?.[1];
    const exact = cached || (result?.revision === revision && result.provider === provider ? result.translation : null);
    E.useEffect(() => {
        if (!enabled || !configured || !visible || exact || !window.modelDeskHUD || !id || step < 0) return;
        let cancelled = false, timer;
        // Coalesce changing prefixes. An obsolete request can warm the cache, but can never replace a newer body.
        async function translate() {
            if (!modelDeskVisibleThought(id,step,revision)) return;
            try {
                if (lastRequest.current?.revision !== revision)
                    lastRequest.current = {id,step,revision,time:Date.now()};
                const data = await window.modelDeskHUD.call('app_thoughts',{conversation_id:id,visible_step:step,visible_revision:revision});
                if (cancelled || data?.conversation_id !== id || data.revision !== revision) return;
                if (data.status === 'translated') setResult({revision,provider,translation:data.translation});
                else if (['translating','pending'].includes(data.status)) timer = setTimeout(translate,1150);
            } catch { /* Preserve the host text if the window or local service has closed. */ }
        }
        function resume() {
            clearTimeout(timer);
            const previous = lastRequest.current;
            const delay = previous?.id === id && previous.step === step && previous.revision !== revision ?
                Math.max(850, previous.time + 4000 - Date.now()) : 850;
            if (!document.hidden) timer = setTimeout(translate,delay);
        }
        document.addEventListener('visibilitychange',resume);
        resume();
        return () => { cancelled=true; clearTimeout(timer); document.removeEventListener('visibilitychange',resume); };
    },[id,step,revision,visible,provider,enabled,configured,exact]);
    const translated = enabled && exact;
    return E.createElement('div',{ref:container,'data-md-thought':translated ? (bilingual ? 'bilingual' : 'translated') : 'original'},
        (!translated || bilingual) && E.createElement(Markdown,{animate},source),
        translated && E.createElement('div',{lang:'zh-CN','data-md-thought-translation':'',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},
            bilingual && E.createElement('strong',null,'译文 '),exact));
}
