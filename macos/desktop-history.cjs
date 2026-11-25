// Finish importing before the language server enumerates its native conversation files.
const { execFile } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
exports.prepare = async function prepare() {
    try {
        const cwd = path.join(process.resourcesPath, 'modeldesk-service');
        const python = path.resolve(cwd, JSON.parse(readFileSync(path.join(cwd, 'runtime.json'), 'utf8')).python);
        const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' };
        delete env.PYTHONPATH;
        delete env.PYTHONHOME;
        const { stdout } = await promisify(execFile)(python, ['-m', 'server.desktop_history'], { cwd, env });
        console.info(stdout.trim());
    } catch (error) {
        console.warn('ModelDesk history import could not finish.', error.code || 'import error');
    }
};
