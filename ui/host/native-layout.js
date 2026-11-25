// The host React tree creates these slots next to the real composer and conversation.
(() => {
    'use strict';
    function element(tag, className) {
        const node = document.createElement(tag);
        node.className = className;
        return node;
    }
    function mount(surface, {mode, conversationId, openFile, readQuota}) {
        const home = mode === 'home';
        const shell = home ? surface.closest('[data-media-drop-scope]') : surface.closest('[data-md-chat-shell]');
        if (!shell) return {destroy() {}};
        const scene = element('div', 'md-native-scene');
        const translation = element('div', 'md-native-scroll');
        const message = element('p', 'md-native-status');
        const recovery = element('button', 'md-native-retry');
        recovery.type = 'button';
        recovery.textContent = '重新连接';
        const status = element('div', 'md-native-feedback');
        status.setAttribute('role','status');
        status.hidden = true;
        status.append(message, recovery);
        surface.replaceChildren(scene, translation, status);
        let sizeObserver, resize;
        if (!home) {
            resize = element('button', 'md-native-size');
            resize.type = 'button';
            function reflectSize() {
                const expanded = shell.hasAttribute('data-md-expanded');
                resize.textContent = expanded ? '恢复大小' : '放大工坊';
                resize.setAttribute('aria-label',expanded ? '恢复工坊大小' : '放大工坊');
                resize.setAttribute('aria-expanded',String(expanded));
            }
            reflectSize();
            resize.addEventListener('click', () => {
                shell.toggleAttribute('data-md-expanded');
                reflectSize();
            });
            const measure = () => shell.toggleAttribute('data-md-stacked',shell.clientWidth <= 795);
            sizeObserver = new ResizeObserver(measure);
            sizeObserver.observe(shell);
            measure();
        }

        let alive = true, request, timer, insights, usage, snapshot, dirty = false;
        let accountQuota = [], quotaRevision = 0, quotaTimer;
        async function refreshAccountQuota(force = true) {
            if (!alive || !readQuota) return;
            const revision = ++quotaRevision;
            clearTimeout(quotaTimer);
            try {
                const groups = await readQuota(force);
                if (alive && revision === quotaRevision) {
                    accountQuota = groups;
                    insights?.update({accountQuota});
                }
            } catch {
                if (alive && revision === quotaRevision) {
                    accountQuota = [];
                    insights?.update({accountQuota});
                    if (force) throw new Error('宿主暂时无法读取模型账户额度。');
                }
            } finally {
                if (alive && revision === quotaRevision && !document.hidden) {
                    quotaTimer = setTimeout(() => refreshAccountQuota(false), 60000);
                }
            }
        }
        function setQuotaSource(next) {
            if (readQuota === next) return;
            readQuota = next;
            quotaRevision++;
            accountQuota = [];
            insights?.update({accountQuota});
            if (!document.hidden) refreshAccountQuota(false);
        }
        const call = (name, args = {}) => {
            if (!alive) return Promise.reject(new Error('会话已切换。'));
            if (!window.modelDeskHUD) return Promise.reject(new Error('本机数据服务未连接，请从 Dock 打开 ModelDesk。'));
            return window.modelDeskHUD.call(name, args);
        };
        async function compact() {
            const box = shell.querySelector('[data-testid="agent-input-box"]');
            const editor = box?.querySelector('[contenteditable=true][aria-label="Message input"]');
            if (!conversationId || !editor) throw new Error('当前会话没有可用的原生输入框。');
            if (editor.innerText.trim()) throw new Error('输入框已有草稿，请先处理草稿后再压缩。');
            editor.focus();
            if (!document.execCommand('insertText', false, '/compact')) throw new Error('原生输入框未接受压缩指令。');
            await new Promise(resolve => requestAnimationFrame(resolve));
            const send = box.querySelector('button[data-testid="send-button"]');
            if (send && !send.disabled && editor.innerText.trim() === '/compact') {
                send.click();
                return {sent:true};
            }
            return {message:'已将 /compact 填入原生输入框，可按回车发送。'};
        }

        function wireUsage() {
            const next = shell.querySelector('[data-md-usage]');
            if (usage === next && insights) return;
            insights?.destroy();
            // Preserve the scroll and settings even during native composer transitions.
            usage = next;
            insights = window.ModelDeskInsights.mount({usage: next || element('div','md-native-placeholder'), translation}, {
                call, conversationId, mode, compact, refreshAccountQuota,
            });
            insights.update({...snapshot, accountQuota});
        }
        function editProvider() {
            insights?.openSettings();
        }
        const workshop = window.ModelDeskWorkshop.mount(scene, {call, conversationId, mode, openFile, sizeControl:resize,
            openTranslationSettings:editProvider, onChange:refresh});
        wireUsage();

        function theme() {
            return document.body.matches('.theme-dark,.dark-theme,.dark') ||
                document.documentElement.matches('.theme-dark,.dark-theme,.dark') ||
                getComputedStyle(document.body).colorScheme === 'dark' ? 'dark' : 'light';
        }
        let hostActivity = null, activityTimer;
        let previousTasks = [];
        function showActivity(next, tasks) {
            hostActivity = {...next,tasks};
            workshop.update({...snapshot,hostActivity,theme:theme()});
        }
        function setActivity(next) {
            if (!alive || !conversationId || next?.conversationId !== conversationId) return;
            clearTimeout(activityTimer);
            const tasks = next.tasks || [];
            // Promotion from a foreground command to a native background task arrives in
            // two store updates. Keep the last observed state across that short gap.
            const now = Date.now();
            const missing = previousTasks.filter(({row,seen}) =>
                row.state === 'running' && row.engine && now-seen < 1500 &&
                !tasks.some(task => task.id === row.id ||
                    (Number.isInteger(row.stepIndex) && task.stepIndex === row.stepIndex)));
            previousTasks = [...tasks.map(row => ({row,seen:now})), ...missing];
            showActivity(next, [...tasks,...missing.map(item => item.row)]);
            if (missing.length) activityTimer = setTimeout(() => {
                if (alive) setActivity(next);
            }, Math.max(1,1500-(now-Math.min(...missing.map(item => item.seen)))));
        }
        function paint() {
            if (!snapshot || !alive) return;
            const view = {...snapshot, hostActivity, theme:theme()};
            workshop.update(view);
            insights.update(view);
            window.ModelDeskInlineThoughts?.update(conversationId, snapshot);
        }
        async function refresh() {
            if (!alive || document.hidden) return;
            if (request) { dirty = true; return; }
            clearTimeout(timer);
            try {
                request = call('snapshot', {conversation_id:conversationId});
                const data = await request;
                if (!alive) return;
                if (data.session?.id && data.session.id !== conversationId) throw new Error('正在切换当前会话。');
                snapshot = data;
                status.hidden = true;
                paint();
            } catch (error) {
                if (alive) { message.textContent = error.message || '本地数据读取失败。'; status.hidden = false; }
            } finally {
                request = null;
                if (alive && !document.hidden) {
                    const active = snapshot?.tasks?.some(t => ['running','queued','dispatching'].includes(t.status));
                    timer = setTimeout(refresh, dirty ? 100 : active || !home ? 2800 : 10000);
                    dirty = false;
                }
            }
        }
        const observeUsage = new MutationObserver(records => {
            if (!usage?.isConnected || records.some(r => [...r.addedNodes].some(n =>
                n.nodeType === 1 && (n.matches('[data-md-usage]') || n.querySelector('[data-md-usage]'))))) wireUsage();
        });
        observeUsage.observe(shell,{childList:true,subtree:true});
        const colors = new MutationObserver(paint);
        for (const node of [document.documentElement,document.body]) colors.observe(node,{attributes:true,attributeFilter:['class']});
        function visibility() {
            if (document.hidden) { clearTimeout(timer); clearTimeout(quotaTimer); }
            else { refresh(); refreshAccountQuota(false); }
        }
        document.addEventListener('visibilitychange',visibility);
        recovery.addEventListener('click',refresh);
        refresh();
        if (!document.hidden) refreshAccountQuota(false);
        return { setQuotaSource, setActivity, destroy() {
            alive = false;
            clearTimeout(activityTimer);
            clearTimeout(timer); clearTimeout(quotaTimer);
            document.removeEventListener('visibilitychange',visibility);
            observeUsage.disconnect(); colors.disconnect(); sizeObserver?.disconnect();
            window.ModelDeskInlineThoughts?.release(conversationId);
            insights?.destroy(); workshop.destroy(); surface.replaceChildren();
        }};
    }
    window.ModelDeskNativeLayout = {mount};
    window.dispatchEvent(new Event('modeldesk-layout-ready'));
})();
