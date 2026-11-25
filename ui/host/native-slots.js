// Components compiled into the independent desktop's React tree.
const ModelDeskOverviewDock = E.createContext(null);
function modelDeskGreetingItems(items) {
    if (items?.length !== 1 || items[0].chunk?.case !== 'text') return items;
    const item = items[0];
    const greeting = window.ModelDeskChineseGreeting.chat(item.chunk.value);
    return greeting ? [{...item, chunk:{...item.chunk, value:greeting}}] : items;
}
function modelDeskOverviewDock(slot, conversationId, breakpoint) {
    return slot && slot.dataset.mdOverviewFor === conversationId && breakpoint !== 'small' ? slot : null;
}
function modelDeskPlaceOverview(slot, panel) {
    return slot ? zy.createPortal(panel, slot) : panel;
}

// Use the same Cloud Code quota summary and protobuf fields as Models & Usage.
// Only display fields leave the host's React tree.
function modelDeskQuotaGroups(groups) {
    const names = {'Gemini Models':'Gemini 模型', 'Claude and GPT models':'Claude 与 GPT 模型'};
    return (groups || []).map(group => ({
        label: names[group.displayName] || group.displayName || '模型额度',
        windows: (group.buckets || []).filter(bucket => bucket.displayName || bucket.window).map(bucket => {
            const period = (bucket.window || '').trim().toLowerCase();
            const label = period === 'weekly' || bucket.displayName === 'Weekly Limit Remaining' ? '每周' :
                period === '5h' || bucket.displayName === 'Five Hour Limit Remaining' ? '5 小时' :
                period === 'daily' ? '每日' : bucket.displayName || bucket.window;
            const value = bucket.remaining?.case === 'remainingFraction' ? bucket.remaining.value : null;
            const remaining = !bucket.disabled && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
            const date = bucket.resetTime ? gf(bucket.resetTime) : null;
            const reset = date && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', {
                month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit',
            }) : '';
            return {label, remaining, reset, disabled: Boolean(bucket.disabled)};
        }),
    })).filter(group => group.windows.length);
}

// The responsive home and chat surfaces may mount concurrently. Coalesce their
// quota reads for one signed-in account while preserving manual force-refresh.
const modelDeskQuotaCache = new WeakMap();
async function modelDeskReadQuota(service, auth, force) {
    if (auth?.state !== 'signedIn' || !service?.retrieveUserQuotaSummary) return [];
    let cache = modelDeskQuotaCache.get(service);
    if (!cache || cache.auth !== auth) {
        cache = {auth, groups:[], refreshed:0};
        modelDeskQuotaCache.set(service, cache);
    }
    if (cache.pending && (!force || cache.forced)) return cache.pending;
    if (!force && Date.now() - cache.refreshed < 60000) return cache.groups;
    const request = service.retrieveUserQuotaSummary(Boolean(force)).then(result => {
        if (cache.pending !== request) return cache.pending || cache.groups;
        const groups = modelDeskQuotaGroups(result?.response?.groups);
        cache.groups = groups;
        cache.refreshed = Date.now();
        return groups;
    }).catch(error => {
        if (cache.pending !== request) return cache.pending || cache.groups;
        cache.refreshed = 0;
        cache.groups = [];
        throw error;
    }).finally(() => { if (cache.pending === request) cache.pending = null; });
    cache.pending = request;
    cache.forced = force;
    return request;
}

function ModelDeskNativeSurface({mode, conversationId}) {
    const overview = E.useContext(ModelDeskOverviewDock);
    const ref = E.useRef(null);
    const cloud = ql(), auth = el(Xk);
    const quotaSource = E.useRef(null), mounted = E.useRef(null);
    const activity = E.useRef(null);
    const onActivity = E.useCallback(next => {
        activity.current = next;
        mounted.current?.setActivity?.(next);
    },[]);
    const readQuota = E.useCallback(force => modelDeskReadQuota(cloud, auth, force), [cloud, auth]);
    quotaSource.current = readQuota;
    const openPane = YBc();
    const pane = E.useRef(openPane);
    pane.current = openPane;
    E.useEffect(() => {
        let surface;
        function mount() {
            if (!ref.current || surface || !window.ModelDeskNativeLayout) return;
            surface = window.ModelDeskNativeLayout.mount(ref.current, {
                mode, conversationId: conversationId || null,
                readQuota: quotaSource.current,
                openFile: file => pane.current({
                    tabType: 'fileView', uri: file.uri, targetConversationId: conversationId || undefined,
                }),
            });
            mounted.current = surface;
            if (activity.current) surface.setActivity?.(activity.current);
        }
        window.addEventListener('modeldesk-layout-ready', mount);
        mount();
        return () => {
            window.removeEventListener('modeldesk-layout-ready', mount);
            surface?.destroy();
            mounted.current = null;
        };
    }, [mode, conversationId]);
    E.useEffect(() => { mounted.current?.setQuotaSource?.(readQuota); }, [readQuota]);
    if (mode === 'home') {
        return E.createElement('section', {ref, 'data-md-surface':mode, 'aria-label':'像素工坊与实时翻译'});
    }
    return E.createElement('section', {'data-md-surface':mode, 'aria-label':'会话工坊与实时翻译'},
        conversationId && E.createElement(ModelDeskNativeActivity,{key:conversationId,conversationId,onActivity}),
        E.createElement('div', {
            ref: overview?.id === conversationId ? overview?.attach : null,
            'data-md-overview-for': conversationId,
        }),
        E.createElement('div', {ref, className:'md-native-panels'}));
}
