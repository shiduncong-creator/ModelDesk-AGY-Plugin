#!/usr/bin/env python3
"""Build the private ModelDesk desktop app from the matching Electron SDK and installed UI."""

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = Path("/Applications/Antigravity.app")
DISPLAY_NAME = "吉米奈的工作台"
DEST = Path.home() / "Applications" / (DISPLAY_NAME + ".app")
LEGACY = DEST.with_name("ModelDesk.app")
BUNDLE_ID = "org.modeldesk.antigravity.desktop"
SDK_VERSION = "44.9.1"
SDK_HASH = "ff597552c9c7b0b16c39a7fb93a346ee7148afbd372ebcf0c18415482c49fbea"
DEFAULT_SDK = Path.home() / f"Library/Caches/ModelDeskBuild/electron-v{SDK_VERSION}-darwin-arm64.zip"


def run(*args):
    subprocess.run([str(s) for s in args], check=True)


def read_plist(path):
    with path.open("rb") as f:
        return plistlib.load(f)


def set_plist(path, changes):
    data = read_plist(path)
    data.update(changes)
    path.write_bytes(plistlib.dumps(data))


def extract_app(archive, dest):
    """Materialize distribution files only. Verify every packed file with the source ASAR manifest."""
    with archive.open("rb") as src:
        head = src.read(16)
        _, packed, _, length = struct.unpack("<4I", head)
        directory = json.loads(src.read(length))["files"]
        def copy_members(items, folder, relative):
            folder.mkdir(exist_ok=True, parents=True)
            for name, meta in items.items():
                if name in ("", ".", "..") or "/" in name:
                    raise ValueError("Unexpected archive member")
                out = folder / name
                if "files" in meta:
                    copy_members(meta["files"], out, relative / name)
                    continue
                if "link" in meta:
                    raise ValueError(f"Unsupported archive link: {name}")
                if meta.get("unpacked"):
                    data = (archive.with_suffix(".asar.unpacked") / relative / name).read_bytes()
                else:
                    src.seek(8 + packed + int(meta["offset"]))
                    data = src.read(meta["size"])
                if len(data) != meta["size"] or sha256(data).hexdigest() != meta["integrity"]["hash"]:
                    raise ValueError(f"Incomplete source asset: {relative / name}")
                out.write_bytes(data)
                if meta.get("executable"):
                    out.chmod(0o755)
        copy_members(directory, dest, Path())


def replace_once(path, before, after):
    data = path.read_text()
    if data.count(before) != 1:
        raise ValueError(f"Host integration point changed: {path.name}")
    path.write_text(data.replace(before, after))


def configure_host(app, version):
    manifest = app / "package.json"
    package = json.loads(manifest.read_text())
    if package["version"] != version:
        raise ValueError("上游资源与应用的版本不一致。")
    package.update(name="modeldesk-antigravity-desktop", productName=DISPLAY_NAME)
    manifest.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")
    main = app / "dist/main.js"
    after_log = "    Object.assign(console, main_1.default.functions);"
    replace_once(main, after_log, after_log + '\n    await require("./modeldesk-history.cjs").prepare();')
    register = "    const ipc = (0, ipcHandlers_1.registerIpcHandlers)(storageManager, {"
    replace_once(main, register, '    require("./modeldesk-hud.cjs").register();\n' + register)
    native = "    electron_1.contextBridge.exposeInMainWorld('electronNative', electronNativeAPI);"
    replace_once(app / "dist/preload.js", native, native + """
    if (process.isMainFrame) {
        const gestures = new Set(['app_save_prefs','app_test_api','app_retry_thought','app_task_action','app_file_action','app_translate']);
        electron_1.contextBridge.exposeInMainWorld('modelDeskHUD', {
            call: (method, args) => {
                // Only explicit interaction may write preferences, operate on a file or run a task.
                if (gestures.has(method) && !navigator.userActivation.isActive)
                    return Promise.reject(new Error('请直接点击此操作。'));
                return electron_1.ipcRenderer.invoke('modeldesk:native-hud', method, args);
            },
        });
    }""")
    replace_once(main, 'const electron_1 = require("electron");', '''const electron_1 = require("electron");
const profile = require("node:path").join(electron_1.app.getPath("appData"), "ModelDesk Desktop");
require("node:fs").mkdirSync(profile, { recursive: true, mode: 0o700 });
electron_1.app.setPath("userData", profile);
require("./modeldesk-appearance.cjs").restore();''')
    replace_once(app / "dist/menu.js", '    configureViewZoomMenu(menu);',
                 '    configureViewZoomMenu(menu);\n    require("./modeldesk-appearance.cjs").addMenu(menu);')
    menu = app / "dist/menu.js"
    code = menu.read_text()
    first = code.index('    // Add "Check for Updates" to the application menu on macOS.')
    last = code.index('    // Adds Docs to the Help menu.', first)
    menu.write_text(code[:first] + code[last:])
    # Local and SSH sign-in callbacks must use the same registered URL scheme after renaming.
    replace_once(app / "dist/remote/signInReturn.js",
                 "    return appName\n        .toLowerCase()\n        .replace(/[^a-z0-9]+/g, '-')\n        .replace(/^-|-$/g, '');",
                 "    return 'modeldesk-agy';")
    # ModelDesk is locally built. Only Google's separate application should run Google's updater.
    replace_once(main, '    (0, updater_1.initAutoUpdater)(HEADLESS, settingsService);', '')
    paths = app / "dist/paths.js"
    replace_once(paths, "return electron_1.app.getName().toLowerCase().replace(/\\s+/g, '');",
                 "return 'antigravity-modeldesk';")
    flags = app / "dist/lsDefaults.js"
    replace_once(flags, "        '--standalone',",
                 """        '--standalone',
        '--web_bundle_path',
        require('node:path').join(process.resourcesPath, 'modeldesk-host-ui.zip'),""")


def make_icon(stage, resources):
    icons = stage / "ModelDesk.iconset"
    icons.mkdir()
    for base in (16, 32, 128, 256, 512):
        for retina in (False, True):
            size = str(base * (2 if retina else 1))
            name = f"icon_{base}x{base}" + ("@2x" if retina else "") + ".png"
            subprocess.run(["/usr/bin/sips", "-s", "format", "png", "-z", size, size, str(ROOT / "assets/logo.svg"),
                            "--out", str(icons / name)], stdout=subprocess.DEVNULL, check=True)
    run("/usr/bin/iconutil", "-c", "icns", "-o", resources / "modeldesk.icns", icons)


def entitlements(app):
    result = subprocess.run(["/usr/bin/codesign", "-d", "--entitlements", ":-", app], capture_output=True, check=True)
    return plistlib.loads(result.stdout) if result.stdout else {}


def signature_timestamp(identity):
    return "--timestamp" if identity.startswith("Developer ID Application:") else "--timestamp=none"


def sign_app(app, rights, stage, identity):
    path = stage / "entitlements.plist"
    path.write_bytes(plistlib.dumps(rights))
    run("/usr/bin/codesign", "--force", "--sign", identity, signature_timestamp(identity), "--options", "runtime",
        "--entitlements", path, app)


def install_components(resources, portable_python=None):
    for source, destination in (("appearance", "appearance"), ("desktop-hud", "hud"), ("desktop-history", "history")):
        shutil.copy2(ROOT / f"macos/{source}.cjs", resources / f"app/dist/modeldesk-{destination}.cjs")
    service = resources / "modeldesk-service"
    if (service / "server").exists():
        shutil.rmtree(service / "server")  # This directory belongs to the staging copy.
    shutil.copytree(ROOT / "server", service / "server", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    if portable_python:
        python = "../modeldesk-python/bin/python3.12"
        run("/usr/bin/ditto", portable_python, resources / "modeldesk-python")
    else:
        runtimes = (ROOT / ".venv/bin/python", Path("/Applications/模型工作台.app/Contents/Resources/Python/bin/python3.12"),
                    shutil.which("python3.12"))
        python = next((Path(p) for p in runtimes if p and Path(p).is_file() and
                       subprocess.run([str(p), "-c", "import mcp; import sys; assert sys.version_info[:2] == (3,12)"],
                                      capture_output=True).returncode == 0), None)
        if python is None:
            raise ValueError("ModelDesk 需要已安装的 Python 3.12 和 MCP SDK。")
    (service / "runtime.json").write_text(json.dumps({"python": str(python)}))
    build_python = portable_python / "bin/python3.12" if portable_python else sys.executable
    run(build_python, "-B", ROOT / "scripts/build-host-bundle.py", "--desktop", "--source",
        resources / "bin/language_server", "--output", resources / "modeldesk-host-ui.zip",
        *(["--reproducible"] if portable_python else []))


def finish(stage, app, rights, identity, version):
    resources = app / "Contents/Resources"
    (resources / "modeldesk-build.json").write_text(json.dumps({
        "source": str(UPSTREAM), "sourceVersion": version, "sdkVersion": SDK_VERSION,
        "webBundleSHA256": sha256((resources / "modeldesk-host-ui.zip").read_bytes()).hexdigest()
    }))
    sign_app(app, rights, stage, identity)
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", app)
    return app


def upstream_version():
    version = read_plist(UPSTREAM / "Contents/Info.plist")["CFBundleShortVersionString"]
    framework = UPSTREAM / "Contents/Frameworks/Electron Framework.framework/Versions/Current/Resources/Info.plist"
    if read_plist(framework)["CFBundleVersion"] != SDK_VERSION:
        raise ValueError("上游 Electron 已更新，需要添加对应的 SDK 与校验值。")
    run("/usr/bin/codesign", "--verify", "--strict", UPSTREAM)
    return version


def check_compatibility():
    version = upstream_version()
    host = UPSTREAM / "Contents/Resources"
    with tempfile.TemporaryDirectory(prefix="modeldesk-compat-") as folder:
        stage = Path(folder)
        extract_app(host / "app.asar", stage / "app")
        configure_host(stage / "app", version)
        run(sys.executable, ROOT / "scripts/build-host-bundle.py", "--desktop", "--source",
            host / "bin/language_server", "--output", stage / "modeldesk-host-ui.zip")
    print(f"Antigravity {version} · Electron {SDK_VERSION} · 桌面入口与工坊、思考、用量接口通过结构检查")


def build(stage, sdk, identity, portable_python=None):
    version = upstream_version()
    if sha256(sdk.read_bytes()).hexdigest() != SDK_HASH:
        raise ValueError("Electron SDK checksum does not match the official arm64 release.")
    unpack = stage / "sdk"
    run("/usr/bin/ditto", "-x", "-k", sdk, unpack)
    app = stage / DEST.name
    (unpack / "Electron.app").rename(app)
    contents = app / "Contents"
    resources = contents / "Resources"
    host = UPSTREAM / "Contents/Resources"
    extract_app(host / "app.asar", resources / "app")
    configure_host(resources / "app", version)
    shutil.copytree(host / "bin", resources / "bin", copy_function=shutil.copy2)
    install_components(resources, portable_python)
    if portable_python:
        from release_support import add_desktop_extras
        add_desktop_extras(app, unpack, identity)
    make_icon(stage, resources)
    (contents / "MacOS/Electron").rename(contents / "MacOS" / DISPLAY_NAME)
    set_plist(contents / "Info.plist", {
        "CFBundleIdentifier": BUNDLE_ID, "CFBundleName": DISPLAY_NAME, "CFBundleDisplayName": DISPLAY_NAME,
        "CFBundleExecutable": DISPLAY_NAME, "CFBundleIconFile": "modeldesk.icns",
        "CFBundleShortVersionString": version, "CFBundleVersion": version,
        "CFBundleURLTypes": [{"CFBundleURLName": "ModelDesk", "CFBundleURLSchemes": ["modeldesk-agy"]}],
        "NSAppleEventsUsageDescription": "仅在你请求的桌面操作中使用 Apple 事件。",
        "NSMicrophoneUsageDescription": "用于你主动启用的语音输入。",
        "NSCameraUsageDescription": "用于你主动启用的摄像头功能。",
    })
    # Electron's binary ZIP is a development SDK. Seal its frameworks inside-out
    # as components of this newly packaged application.
    frameworks = contents / "Frameworks"
    for framework in sorted(frameworks.glob("*.framework")):
        framework_version = (framework / "Versions/Current").resolve()
        for lib in sorted((framework_version / "Libraries").glob("*.dylib")):
            run("/usr/bin/codesign", "--force", "--sign", identity, signature_timestamp(identity), lib)
        for tool in (framework_version / "Helpers").glob("*"):
            if tool.is_file() and os.access(tool, os.X_OK):
                run("/usr/bin/codesign", "--force", "--sign", identity, signature_timestamp(identity), "--options", "runtime", tool)
        run("/usr/bin/codesign", "--force", "--sign", identity, signature_timestamp(identity), "--options", "runtime", framework_version)
    helpers = list(frameworks.glob("Electron Helper*.app"))
    for helper in helpers:
        name = helper.stem.replace("Electron", DISPLAY_NAME, 1)
        # The SDK helpers are development binaries. V8 in the signed, hardened
        # distribution needs Apple's scoped JIT entitlement to initialize.
        rights = {"com.apple.security.cs.allow-jit": True}
        info = helper / "Contents/Info.plist"
        spec = read_plist(info)
        exe = helper / "Contents/MacOS" / spec.get("CFBundleExecutable", helper.stem)
        exe.rename(exe.with_name(name))
        set_plist(info, {"CFBundleName": name, "CFBundleDisplayName": name, "CFBundleExecutable": name,
                         "CFBundleIdentifier": BUNDLE_ID + ".helper" + name.removeprefix(DISPLAY_NAME + " Helper").strip().replace("(", ".").replace(")", "").lower()})
        renamed = helper.with_name(name + ".app")
        helper.rename(renamed)
        sign_app(renamed, rights, stage, identity)
    return finish(stage, app, entitlements(UPSTREAM), identity, version)


def install_verified(bundle):
    """Keep the app folder identity used by the Dock and the previous signed Contents."""
    import ctypes
    for installed in (DEST, LEGACY):
        if installed.is_symlink() or installed.exists() and read_plist(installed / "Contents/Info.plist").get("CFBundleIdentifier") != BUNDLE_ID:
            raise ValueError(f"Destination is occupied: {installed}")
    if DEST.exists() and LEGACY.exists():
        raise ValueError("新旧安装路径同时存在，请先确认要升级的应用。")
    running = subprocess.check_output(["/bin/ps", "-A", "-o", "comm="], text=True).splitlines()
    executables = {str(app / "Contents/MacOS" / read_plist(app / "Contents/Info.plist")["CFBundleExecutable"])
                   for app in (DEST, LEGACY) if app.exists()}
    if any(name.strip() in executables for name in running):
        raise ValueError("请先退出正在运行的工作台再替换。")
    current = DEST if DEST.exists() else LEGACY
    if not current.exists():
        bundle.rename(DEST)
        return
    cache = Path.home() / "Library/Caches/ModelDeskBuild"
    cache.mkdir(parents=True, exist_ok=True)
    previous = Path(tempfile.mkdtemp(prefix="previous-", dir=cache)) / "Contents"
    exchange = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True).renamex_np
    def swap():
        if exchange(os.fsencode(current / "Contents"), os.fsencode(bundle / "Contents"), 2):
            raise OSError(ctypes.get_errno(), "更新工作台失败")
    swap()
    try:
        if current != DEST:
            current.rename(DEST)
    except OSError:
        swap()
        raise
    (bundle / "Contents").rename(previous)
    print(f"上个版本保存在 {previous}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--electron-zip", type=Path, default=DEFAULT_SDK)
    parser.add_argument("--check-compatibility", action="store_true", help="在临时目录检查本机上游的版本与接口")
    parser.add_argument("--stage-only", type=Path, help="create a new bundle here for verification")
    parser.add_argument("--identity", help="local code signing identity; defaults to a unique Apple Development identity")
    args = parser.parse_args()
    if args.check_compatibility:
        check_compatibility()
        return
    identity = args.identity
    if not identity:
        inventory = subprocess.check_output(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"], text=True)
        candidates = re.findall(r'\b([0-9A-Fa-f]{40}) "Apple Development:', inventory)
        if len(candidates) != 1:
            raise ValueError("请通过 --identity 选择本地 Apple Development 签名身份。")
        identity = candidates[0]
    target = args.stage_only or DEST
    target.parent.mkdir(parents=True, exist_ok=True)
    if args.stage_only and (target.exists() or target.is_symlink()):
        raise ValueError(f"Destination is occupied: {target}")
    with tempfile.TemporaryDirectory(dir=target.parent, prefix=".modeldesk-build-") as folder:
        stage = Path(folder)
        bundle = build(stage, args.electron_zip, identity)
        if args.stage_only:
            bundle.rename(target)
        else:
            install_verified(bundle)
    print(target)


if __name__ == "__main__":
    main()
