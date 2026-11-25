/* ModelDesk browser-side Antigravity context menu. Loaded as a classic, deferred script. */
(() => {
  'use strict';
  if (window.top !== window || document.documentElement.hasAttribute('data-modeldesk-menu-ready')) return;
  document.documentElement.setAttribute('data-modeldesk-menu-ready', '');

  const conversation = '[data-testid="conversation-view"], [data-media-drop-scope]';
  const messageInput = '[contenteditable="true"][aria-label="Message input"], textarea[aria-label="Message input"]';
  let opened = null;
  let nativeOnce = false;
  let toastTimer = 0;
  let notice = null;

  function toast(message) {
    if (!notice?.isConnected) {
      notice = document.createElement('div');
      notice.dataset.modeldeskHostToast = '';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      document.body.append(notice);
    }
    clearTimeout(toastTimer);
    notice.textContent = message;
    notice.hidden = false;
    toastTimer = setTimeout(() => { notice.hidden = true; }, 4000);
  }

  function shown(element) {
    return element?.isConnected && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden],[inert],[aria-hidden="true"]');
  }

  function elementAt(event) {
    return event.composedPath().find(node => node instanceof HTMLElement) ?? event.target?.parentElement;
  }

  function scopeOf(source) {
    return source.closest('dialog,[role="dialog"]') || source.closest(conversation) || document;
  }

  function composerFor(source) {
    const inputs = Array.from(scopeOf(source).querySelectorAll(messageInput)).filter(shown);
    return inputs.length === 1 ? inputs[0] : null;
  }

  function localFile(value) {
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
    let path;
    if (value.startsWith('/') && !value.startsWith('//')) path = value;
    else {
      if (!/^file:\/\/(?:localhost)?\//i.test(value) || /%2f|%5c/i.test(value)) return null;
      const rawPath = value.replace(/^file:\/\/(?:localhost)?/i, '').split(/[?#]/)[0];
      try {
        const url = new URL(value);
        if (url.search || (url.hash && !/^#L\d+(?:[-:]L?\d+)?$/i.test(url.hash))) return null;
        path = decodeURIComponent(rawPath);
      } catch { return null; }
    }
    if (path === '/' || path.startsWith('//') || path.endsWith('/') ||
        /[\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) return null;
    return { path, uri: 'file://' + path.split('/').map(encodeURIComponent).join('/') };
  }

  function editorOf(target) {
    if (target instanceof HTMLTextAreaElement) return target;
    if (target instanceof HTMLInputElement && ['text', 'url', 'search', 'tel'].includes(target.type)) return target;
    if (target.isContentEditable) return target.closest('[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""]');
    return null;
  }

  function selectionAt(target, editor) {
    if (editor && 'selectionStart' in editor) {
      const start = editor.selectionStart, end = editor.selectionEnd;
      return { text: editor.value.slice(start, end), start, end, value: editor.value };
    }
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0).cloneRange();
      if (range.intersectsNode(target) && (!editor || editor.contains(range.commonAncestorContainer))) {
        return { text: range.toString(), range };
      }
    }
    return { text: '' };
  }

  function restore(editor, saved) {
    editor?.focus({ preventScroll: true });
    if (editor && 'start' in saved) {
      if (editor.value !== saved.value) throw Error('输入内容已变化，请重新选择。');
      editor.setSelectionRange(saved.start, saved.end);
    } else if (saved.range?.commonAncestorContainer.isConnected) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(saved.range.cloneRange());
    }
  }

  function fileAt(target, selection) {
    const owner = target.closest('[data-file-uri]');
    const link = target.closest('a[href]');
    const tree = target.closest('[role="treeitem"]');
    const treeFile = tree?.querySelector('[data-testid="file-tree-node-icon"]') && !tree.hasAttribute('aria-expanded') ? tree : null;
    const linkFile = localFile(link?.getAttribute('href'));
    let file = localFile(owner?.getAttribute('data-file-uri')) || linkFile;
    if (!file) {
      const label = target.closest('[title],[aria-label]');
      file = localFile(selection.text) || localFile(label?.title) || localFile(label?.getAttribute('aria-label'));
      if (!file && !target.isContentEditable && target.childElementCount === 0 &&
          !target.matches('input,textarea')) file = localFile(target.textContent);
    }
    const row = owner?.closest('[data-testid="changed-file-row"]');
    const changed = row && owner.getAttribute('data-file-uri') === row.getAttribute('data-file-uri') ? row : null;
    const title = owner?.querySelector('[data-testid="file-title-name"].cursor-pointer');
    const preview = changed || title || owner?.querySelector('[data-md-workshop-preview]') || (linkFile ? link : null) || treeFile;
    return { file, owner, preview, changed };
  }

  function displayedRelativePath(target, owner, file) {
    if (owner?.matches('[data-md-workshop-file]') && owner.dataset.mdRelative) return owner.dataset.mdRelative;
    const relative = new Set();
    const name = file.path.split('/').pop();
    const candidates = owner ? [owner] : [];
    for (const row of scopeOf(target).querySelectorAll('[data-testid="changed-file-row"][data-file-uri]')) {
      if (row !== owner && shown(row) && localFile(row.getAttribute('data-file-uri'))?.path === file.path) candidates.push(row);
    }
    for (const row of candidates) {
      const filename = row.querySelector('[data-testid="file-title-name"]');
      const direction = filename?.nextElementSibling;
      let directory;
      // FileTitle renders the full computed relative directory in an RTL ellipsis wrapper.
      // Only the CSS truncates it. An absolute string is the host's "no workspace" fallback.
      if (filename?.textContent === name && direction?.style.direction === 'rtl' &&
          direction.firstElementChild?.style.direction === 'ltr') directory = direction.textContent;
      else if (row.matches('[data-testid="changed-file-row"]')) {
        // PanelItemRow uses the same host-computed directory as its detail column.
        directory = row.querySelector('.basis-0.truncate.text-muted-foreground')?.textContent;
      }
      if (directory === undefined || directory === null || directory.startsWith('/') ||
          /[\u0000-\u001f\u007f]/.test(directory) || directory.split('/').some(part => part === '..')) continue;
      const value = !directory || directory === '.' ? name : directory + '/' + name;
      if (file.path.endsWith('/' + value)) relative.add(value);
    }
    return relative.size === 1 ? [...relative][0] : null;
  }

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const temporary = document.createElement('textarea');
    temporary.value = text;
    temporary.style.cssText = 'position:fixed;left:-10000px;top:0';
    document.body.append(temporary);
    const focus = document.activeElement;
    const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0).cloneRange() : null;
    try {
      temporary.select();
      if (!document.execCommand('copy')) throw Error('系统未允许写入剪贴板。');
    } finally {
      temporary.remove();
      focus?.focus?.({ preventScroll: true });
      if (range) restore(null, { range });
    }
  }

  function replaceText(editor, saved, text) {
    if (!editor?.isConnected || editor.readOnly || editor.disabled) throw Error('此输入框已不可编辑。');
    restore(editor, saved);
    if (document.execCommand(text ? 'insertText' : 'delete', false, text)) return;
    if ('setRangeText' in editor) {
      editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertReplacementText' }));
      return;
    }
    throw Error('当前编辑器未接受修改，请使用原生编辑菜单。');
  }

  function insertInDraft(composer, text) {
    if (!shown(composer)) throw Error('对话输入框已变化，请重新打开菜单。');
    composer.focus({ preventScroll: true });
    let saved = selectionAt(composer, composer);
    if (!('start' in saved) && !saved.range) {
      const range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(false);
      saved = { range };
    }
    replaceText(composer, saved, text);
  }

  function draftReview(composer, text) {
    if (!shown(composer)) throw Error('对话输入框已变化，请重新打开菜单。');
    const before = 'value' in composer ? composer.value : composer.textContent;
    let atEnd;
    if ('value' in composer) {
      atEnd = { start: before.length, end: before.length, value: before };
    } else {
      const range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(false);
      atEnd = { range };
    }
    replaceText(composer, atEnd, (before.trim() ? '\n\n' : '') + text);
  }

  function attachFile(composer, file) {
    if (!shown(composer)) throw Error('对话输入框已变化，请重新打开菜单。');
    composer.focus({ preventScroll: true });
    const data = new DataTransfer();
    data.setData('text/uri-list', file.uri);
    // The shipped message editor accepts the same public URI-list format as a Finder drag.
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data });
    if (composer.dispatchEvent(drop)) throw Error('输入框未接收文件拖放，可使用「插入路径文字」。');
  }

  function hostButton(owner, names) {
    if (!owner) return null;
    return Array.from(owner.querySelectorAll('button,[role="button"],[role="menuitem"]')).find(node =>
      shown(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true' &&
      names.some(name => [node.getAttribute('aria-label'), node.title, node.textContent?.trim()]
        .some(label => label === name || label === (window.ModelDeskLocale?.chrome(name) ?? name))));
  }

  function commands(target) {
    const groups = [];
    const editor = editorOf(target);
    const selection = selectionAt(target, editor);
    const { file, owner, preview, changed } = fileAt(target, selection);
    const workshopGroups = owner && window.ModelDeskWorkshop?.fileCommands(owner);
    const composer = composerFor(target);
    const add = (group, id, label, run) => group.push({ id, label, run });
    // SSH windows also expose openExternal, and ship a no-op Finder stub. The local
    // preload alone exposes getPathForFile. Check its presence without reading any file.
    const localNative = typeof window.electronNative?.getPathForFile === 'function' ? window.electronNative : null;
    const files = [];
    if (preview) add(files, 'preview', changed ? '在宿主查看文件差异' : '在宿主打开文件', () => {
      if (!shown(preview)) throw Error('原文件控件已变化，请重新选择。');
      preview.click();
    });
    if (file) {
      add(files, 'copy-path', '复制绝对路径', () => writeClipboard(file.path));
      const relative = displayedRelativePath(target, owner, file);
      if (relative) add(files, 'copy-relative', '复制工作区相对路径', () => writeClipboard(relative));
      const finder = hostButton(owner, ['Reveal in Finder', '在访达中显示', '在 Finder 中显示']);
      if (finder || typeof localNative?.revealInFilePicker === 'function')
        add(files, 'finder', '在访达中显示', () => finder ? finder.click() : localNative.revealInFilePicker(file.uri));
      if (composer) {
        if (typeof DragEvent === 'function' && typeof DataTransfer === 'function')
          add(files, 'attach-file', '附加文件到当前对话', () => attachFile(composer, file));
        add(files, 'insert-path', '插入路径文字', () => insertInDraft(composer, file.path));
      }
    }
    if (files.length) groups.push(files);
    if (file && composer) {
      const reviews = [];
      const name = JSON.stringify(file.path);
      add(reviews, 'review-codex', '起草 Codex 验收请求', () => draftReview(composer,
        '请用 ModelDesk 的 dispatch_cli_agent 把文件 ' + name + ' 交给 Codex 只读验收，报告发现与证据。'));
      add(reviews, 'review-qoder', '起草 Qoder 润色请求', () => draftReview(composer,
        '请用 ModelDesk 的 dispatch_cli_agent 把文件 ' + name + ' 交给 Qoder CN 只读复核，提供润色建议。'));
      groups.push(reviews);
    }
    if (workshopGroups) groups.push(...workshopGroups);
    if (!workshopGroups && file && typeof localNative?.openExternal === 'function') {
      const documents = [];
      const choices = [
        ...(!displayedRelativePath(target, owner, file) ? [['copy_relative', '复制工作区相对路径…']] : []),
        ['diff', '查看 Git Diff…'], ['translate', '翻译此文件…'],
        ['rename', '给文件改名…'], ['trash', '移到废纸篓…'],
      ];
      for (const [action, label] of choices) {
        if (action === 'diff' && changed) continue;
        const request = new URL('modeldesk-document://file/' + action);
        request.searchParams.set('path', file.path);
        add(documents, 'document-' + action, label, event => {
          if (!event.isTrusted) throw Error('请亲自点选文件操作或按回车确认。');
          return localNative.openExternal(request.href);
        });
      }
      groups.push(documents);
    }
    const editing = [];
    if (selection.text) {
      add(editing, 'copy-selection', '复制所选文本', () => writeClipboard(selection.text));
      if (!editor && composer) add(editing, 'quote', '将选文引用到对话草稿', () =>
        insertInDraft(composer, selection.text.split(/\r?\n/).map(line => '> ' + line).join('\n') + '\n'));
    }
    if (editor) {
      if (!editor.readOnly && !editor.disabled) {
        if (selection.text) add(editing, 'cut', '剪切', async () => {
          await writeClipboard(selection.text);
          replaceText(editor, selection, '');
        });
        if (navigator.clipboard?.readText) add(editing, 'paste', '粘贴文字', async () => {
          const text = await navigator.clipboard.readText();
          if (text) replaceText(editor, selection, text);
        });
      }
      add(editing, 'select-all', '全选输入内容', () => {
        if (!shown(editor)) return;
        editor.focus({ preventScroll: true });
        if ('select' in editor) editor.select();
        else {
          const range = document.createRange();
          range.selectNodeContents(editor);
          restore(editor, { range });
        }
      });
    }
    if (editing.length) groups.push(editing);
    const general = [];
    if (composer && composer !== editor) add(general, 'focus-input', '定位对话输入框', () => composer.focus());
    add(general, 'native', '下次打开宿主原生菜单', () => {
      nativeOnce = true;
      toast('请在目标处再次右击或按 Shift+F10。按住 Option 右击也可直接打开原生菜单。');
    });
    groups.push(general);
    return { groups, heading: file ? file.path : preview ? '文件' : editor ? '编辑' : selection.text ? '所选文本' : 'Antigravity' };
  }

  function dismiss(returnFocus = false) {
    if (!opened) return;
    const { menu, prior } = opened;
    opened = null;
    menu.remove();
    if (returnFocus && shown(prior)) prior.focus({ preventScroll: true });
  }

  function open(target, x, y) {
    dismiss();
    const { groups, heading } = commands(target);
    const menu = document.createElement('div');
    menu.dataset.modeldeskHostMenu = '';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '吉米奈的工作台 · ' + heading);
    menu.setAttribute('popover', 'manual');
    menu.style.cssText = 'position:fixed;inset:auto;margin:0;max-height:calc(100dvh - 12px);max-width:calc(100vw - 12px);overflow:auto';
    const label = document.createElement('div');
    label.dataset.modeldeskMenuLabel = '';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = heading;
    label.title = heading;
    menu.append(label);
    const activate = new Map();
    for (const [index, group] of groups.entries()) {
      if (index) {
        const divider = document.createElement('div');
        divider.setAttribute('role', 'separator');
        menu.append(divider);
      }
      for (const command of group) {
        const button = document.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.setAttribute('role', 'menuitem');
        button.dataset.modeldeskAction = command.id;
        button.textContent = command.label;
        const invoke = event => {
          event.preventDefault();
          dismiss(true);
          try { Promise.resolve(command.run(event)).catch(error => toast(error.message || String(error))); }
          catch (error) { toast(error.message || String(error)); }
        };
        activate.set(button, invoke);
        button.addEventListener('click', invoke);
        menu.append(button);
      }
    }
    const prior = document.activeElement;
    (target.closest('dialog:modal') || document.body).append(menu);
    if (menu.showPopover) menu.showPopover();
    else menu.style.display = 'block';
    const width = menu.offsetWidth, height = menu.offsetHeight;
    menu.style.left = Math.max(6, Math.min(x, innerWidth - width - 6)) + 'px';
    menu.style.top = Math.max(6, Math.min(y, innerHeight - height - 6)) + 'px';
    opened = { menu, prior, target, activate };
    menu.querySelector('[role="menuitem"]').focus({ preventScroll: true });
  }

  function bypass(event, target) {
    return event.altKey || !target || !!target.closest('input[type="password"],[data-modeldesk-host-menu],[role="menu"],[role="menubar"]');
  }

  window.addEventListener('contextmenu', event => {
    const target = elementAt(event);
    if (nativeOnce || bypass(event, target)) { nativeOnce = false; dismiss(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    open(target, event.clientX, event.clientY);
  }, true);

  window.addEventListener('keydown', event => {
    if (event.isComposing) return;
    const target = elementAt(event);
    if (opened) {
      const { menu } = opened;
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      const current = items.indexOf(document.activeElement);
      const keys = { ArrowDown: (current + 1) % items.length, ArrowUp: (current - 1 + items.length) % items.length,
                     Home: 0, End: items.length - 1 };
      if (event.key === 'Tab') { dismiss(true); return; }
      if (!(event.key in keys) && !['Escape','Enter',' '].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') dismiss(true);
      else if (event.key in keys) items[keys[event.key]].focus();
      else if (current >= 0) opened.activate.get(items[current])(event);
      return;
    }
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      // Allow the browser's ensuing native contextmenu event to consume nativeOnce.
      if (nativeOnce || bypass(event, target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = target.getBoundingClientRect();
      open(target, rect.left + 10, rect.top + 12);
    }
  }, true);

  window.ModelDeskHostMenu = Object.freeze({
    showFileMenu(row, x, y) { if (row?.isConnected && window.ModelDeskWorkshop?.fileCommands(row)) open(row, x, y); },
    dismissFor(root) { if (opened && root.contains(opened.target)) dismiss(); },
  });
  window.addEventListener('pointerdown', event => {
    if (opened && !event.composedPath().includes(opened.menu)) dismiss();
  }, true);
  window.addEventListener('resize', () => dismiss());
  window.addEventListener('blur', () => { dismiss(); nativeOnce = false; });
  window.addEventListener('pagehide', () => { dismiss(); nativeOnce = false; });
})();
