const { app, MenuItem, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const modes = new Map([['system', '跟随系统'], ['light', '暖日农庄'], ['dark', '星夜农庄']]);
const settings = () => path.join(app.getPath('userData'), 'farm-appearance');

function restore() {
    try {
        const mode = fs.readFileSync(settings(), 'utf8').trim();
        if (modes.has(mode)) nativeTheme.themeSource = mode;
    } catch (error) {
        if (error.code !== 'ENOENT') console.warn('无法读取 ModelDesk 外观设置。');
    }
}

function addMenu(menu) {
    if (menu.getMenuItemById('modeldesk-farm-appearance')) return;
    const submenu = Array.from(modes, ([mode, label]) => ({
        label, type: 'radio', checked: nativeTheme.themeSource === mode,
        click: () => {
            nativeTheme.themeSource = mode;
            const pending = settings() + '.new';
            fs.writeFileSync(pending, mode, { mode: 0o600 });
            fs.renameSync(pending, settings());
        },
    }));
    menu.append(new MenuItem({ id: 'modeldesk-farm-appearance', label: '农庄外观', submenu }));
}

module.exports = { restore, addMenu };
