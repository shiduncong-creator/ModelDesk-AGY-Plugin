// The build supplies both dictionaries from the same version of the desktop UI.
(() => {
    'use strict';
    const settings = /* MODELDESK_SETTINGS_ZH */ {};
    const chrome = /* MODELDESK_CHROME_ZH */ {};
    const fixed = (table, key) => Object.hasOwn(table, key) ? table[key] : null;
    const settingsArea = '[data-md-settings],[data-testid="settings-sidebar"]';
    const menus = '[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],.agy-overlay,[data-bottom-sheet-popup],.react-tooltip';
    const chromeArea = [
        menus, '[data-testid="sidebar-navigation-items"]','[data-testid="settings-button"]',
        '[data-testid="new-conversation-button"]','[data-testid="agent-input-box"]',
        '[data-testid="suggested-actions-section"]','[data-testid="post-onboarding-welcome-modal"]',
        '[data-testid="plugin-suggested-prompt-list"]','[data-testid="overview-panel-host-header"]',
        '[data-testid="overview-panel"]','[role="toolbar"]','[data-testid="app-icon-new-conversation-button"]',
        '[data-testid="conversation-list-sidebar"] :is(h1,h2,h3,[role="heading"])',
    ].join(',');
    const verbatim = [
        'script','style','code','pre','kbd','textarea','input','[contenteditable]:not([contenteditable=false])',
        '.md-user-label','[data-testid="settings-nav-item-Account"]','[data-testid="settings-app-version-details"]',
        '[data-testid="settings-error-messages-card"]','[data-testid="project-header"]','[data-project-label]',
        '[data-testid="project-selector-trigger"]','[data-testid="project-selector-item"]',
        '[data-testid="user-message"]','[data-testid="agent-response"]','[data-md-surface]','[data-md-usage]',
        '[data-testid="tab-file-tree-sidebar"]','.monaco-editor','.xterm','[data-md-verbatim]',
        '.font-medium.truncate[data-tooltip-id]','.line-clamp-2.mt-1',
    ].join(',');
    const tipAttributes = ['title','placeholder','data-placeholder','aria-placeholder','aria-label'];

    function settingsText(text) {
        const exact = fixed(settings, text);
        if (exact) return exact;
        let match = /^(?:(Remove shortcut|Shortcut) (.+) for (.+)|Add shortcut for (.+))$/.exec(text);
        if (match) {
            const action = fixed(settings, match[3] || match[4]);
            if (!action) return null;
            if (match[4]) return '为“'+action+'”添加快捷键';
            return (match[1] === 'Shortcut' ? action+'的快捷键' : '移除“'+action+'”的快捷键')+' '+match[2];
        }
        match = /^Available AI Credits:\s*([\d,.]+)$/.exec(text);
        if (match) return '可用 AI 点数：'+match[1];
        const quotaForms = [
            ['You have used some of your 5-hour limit, it will fully refresh in ', '.', '五小时额度已使用一部分，将在', '后完全恢复。'],
            ['You have used some of your weekly limit, it will fully refresh in ', '.', '本周额度已使用一部分，将在', '后完全恢复。'],
            ['You have hit your weekly limit, it refreshes in ', '. If on a supported paid plan, you can use AI credits in the interim or upgrade to a higher tier.', '本周额度已用完，将在', '后恢复。支持的付费方案可在此期间使用 AI 点数，也可以升级方案。'],
            ['You have hit your weekly limit, the 5-hour limit does not currently apply. Your weekly limit will fully refresh in ', '.', '本周额度已用完，当前不适用 5 小时限额。本周额度将在', '后完全恢复。'],
        ];
        for (const [before, after, prefix, suffix] of quotaForms) {
            if (!text.startsWith(before) || !text.endsWith(after)) continue;
            const duration = text.slice(before.length, -after.length);
            if (!/^\d+ (?:days?|hours?|minutes?|seconds?)(?:, \d+ (?:days?|hours?|minutes?|seconds?))*$/.test(duration)) continue;
            const units = {day:'天',hour:'小时',minute:'分钟',second:'秒'};
            return prefix+duration.replace(/(\d+) (day|hour|minute|second)s?/g, (_, n, unit) => n+' '+units[unit]).replaceAll(', ', ' ')+suffix;
        }
        return null;
    }

    // Native controls keep their keys, selected values and editable contents.
    // Work on existing text nodes so the host still owns each element and listener.
    function translate(raw, element) {
        if (!raw || !/[A-Za-z]/.test(raw) || raw.length > 4096) return null;
        const key = raw.trim();
        // Local display of the greeting conversation title. The saved title and search key stay with the host.
        if (key === 'Conversation: General Greeting' && element.matches('button,[role="button"]')) return '会话：日常问候';
        if (key === 'General Greeting' &&
            (element.closest('[aria-label="Conversation: General Greeting"],[aria-label="会话：日常问候"]') ||
             (element.closest('a,[role="link"]') && element.closest('[data-testid="conversation-list-sidebar"],[data-sidebar-scroll-container]')))) {
            return '日常问候';
        }
        const inSettings = element.closest(settingsArea) ||
            (element.closest(menus) && document.querySelector(settingsArea));
        if (!inSettings && !element.closest(chromeArea)) return null;
        const value = (inSettings && settingsText(key)) || fixed(chrome, key);
        return value && value !== key ? raw.replace(key, () => value) : null;
    }
    function textNode(node) {
        const el = node.parentElement;
        if (!el || el.closest(verbatim)) return;
        const value = translate(node.data, el);
        if (value) node.data = value;
    }
    function attributes(el) {
        if (el.parentElement?.closest(verbatim)) return;
        if (el.matches(verbatim) && !el.matches('textarea,input,[contenteditable]')) return;
        for (const name of tipAttributes) {
            if (!el.hasAttribute(name)) continue;
            // The host uses this exact accessible name to find the native editor.
            if (name === 'aria-label' && (el.matches('[contenteditable],input,textarea') || el.getAttribute(name) === 'Message input')) continue;
            const value = translate(el.getAttribute(name), el);
            if (value) el.setAttribute(name, value);
        }
    }
    function visit(node) {
        if (node.nodeType === Node.TEXT_NODE) { textNode(node); return; }
        if (node.nodeType !== Node.ELEMENT_NODE || node.parentElement?.closest(verbatim)) return;
        attributes(node);
        if (node.matches(verbatim)) return;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(n) {
                if (n.nodeType === Node.ELEMENT_NODE && n.matches(verbatim)) {
                    if (n.matches('input,textarea,[contenteditable]')) attributes(n);
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        while (walker.nextNode()) {
            const n = walker.currentNode;
            if (n.nodeType === Node.TEXT_NODE) textNode(n); else attributes(n);
        }
    }
    function mount() {
        const observer = new MutationObserver(records => {
            for (const record of records) {
                if (record.type === 'childList') { for (const n of record.addedNodes) visit(n); }
                else if (record.type === 'characterData') textNode(record.target);
                else attributes(record.target);
            }
        });
        observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:tipAttributes});
        visit(document.body);
    }
    function ago(text) {
        if (text === 'now') return '刚刚';
        const units = {s:'秒',m:'分钟',h:'小时',d:'天',w:'周',mo:'个月',y:'年'};
        const match = /^(\d+)\s*(mo|[smhdwy])$/.exec(text);
        return match ? match[1]+' '+units[match[2]]+'前' : text+'前';
    }
    window.ModelDeskLocale = {
        chrome: text => fixed(chrome, text) ?? text,
        conversationTitle: text => text === 'General Greeting' ? '日常问候' : text,
        ago
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
    else mount();
})();
