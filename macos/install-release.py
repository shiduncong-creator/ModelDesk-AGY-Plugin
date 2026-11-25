"""Install the pre-signed desktop from its template and the matching Google distribution."""
from contextlib import contextmanager
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import plistlib
import runpy
import shutil
import subprocess
import sys
import tempfile

VERSION = "2.35.0"
UPSTREAM_URL = "https://storage.googleapis.com/antigravity-public/antigravity-hub/2.35.0-6394266482769920/darwin-arm/Antigravity.dmg"
DMG_HASH = "51105bc2227e41379c42358d01139c6eb9b66d63eee75de10f717208e8f1c672"
GOOGLE = ('identifier "com.google.antigravity" and anchor apple generic and certificate leaf[subject.OU] = "EQHXZ8M8AV"'
          ' and cdhash H"ddf5a6d3b675b6901f37bc12dce60588587bd16d"')
REGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
NAME = "吉米奈的工作台.app"


def check(*args):
    subprocess.run(list(map(str, args)), check=True)


def digest(path):
    with path.open("rb") as data:
        return sha256_file(data)


def sha256_file(data):
    h = sha256()
    for block in iter(lambda: data.read(1024 * 1024), b""):
        h.update(block)
    return h.hexdigest()


def compatible(app):
    info = app / "Contents/Info.plist"
    if not info.is_file():
        return False
    try:
        spec = plistlib.loads(info.read_bytes())
    except (OSError, ValueError, plistlib.InvalidFileException):
        return False
    if not isinstance(spec, dict) or spec.get("CFBundleShortVersionString") != VERSION:
        return False
    verified = subprocess.run(["/usr/bin/codesign", "--verify", "--strict", "--arch", "arm64",
                               "-R=" + GOOGLE, app], capture_output=True)
    return verified.returncode == 0


@contextmanager
def get_upstream(work, cache, installed):
    if compatible(installed):
        print("已找到 Google 签名的 Antigravity " + VERSION, flush=True)
        yield installed
        return
    image = cache / ("Antigravity-" + VERSION + "-arm64.dmg")
    if not image.is_file() or digest(image) != DMG_HASH:
        print("正在从 Google 下载 Antigravity " + VERSION + "，约 242 MB…", flush=True)
        temporary = cache / "Antigravity-download.part"
        check("/usr/bin/curl", "--disable", "--fail", "--location", "--silent", "--show-error", "--retry", "2",
              "--proto", "=https", "--proto-redir", "=https", "--connect-timeout", "20", "--max-time", "900",
              "--output", temporary, UPSTREAM_URL)
        if digest(temporary) != DMG_HASH:
            raise ValueError("Google 安装镜像校验失败，请稍后重新打开安装器。")
        os.replace(temporary, image)
    mount = work / "google"
    mount.mkdir()
    check("/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-quiet", "-mountpoint", mount, image)
    try:
        app = mount / "Antigravity.app"
        if not compatible(app):
            raise ValueError("此镜像的版本或 Google 开发者签名不匹配。")
        yield app
    finally:
        check("/usr/bin/hdiutil", "detach", "-quiet", mount)


def install_files(resources, upstream=Path("/Applications/Antigravity.app")):
    recipe = resources / "recipe"
    desktop = runpy.run_path(str(recipe / "macos/install-desktop.py"))
    target = desktop["DEST"]
    cache = Path.home() / "Library/Caches/ModelDeskBuild"
    cache.mkdir(parents=True, exist_ok=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    link = Path.home() / ".gemini/config/plugins/modeldesk-workbench"
    plugin = target / "Contents/Resources/modeldesk-plugin"
    with (cache / "installation.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("另一个安装窗口正在工作，请等待它完成。") from None
        previous_plugin = None
        if os.path.lexists(link) and not (link.is_symlink() and link.readlink() == plugin):
            meta = link / "plugin.json"
            if not meta.is_file() or json.loads(meta.read_text()).get("name") != "modeldesk-workbench":
                raise ValueError(f"插件目录已被其他文件占用，请先检查 {link}")
            previous_plugin = link.resolve()
        link.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=target.parent, prefix=".modeldesk-install-") as folder:
            work = Path(folder)
            app = work / NAME
            res = app / "Contents/Resources"
            with get_upstream(work, cache, upstream) as original:
                print("正在准备工作台和内置 Python…", flush=True)
                check("/usr/bin/ditto", "-x", "-k", resources / "Desktop.zip", app)
                check("/usr/bin/ditto", resources / "Python", res / "modeldesk-python")
                host = original / "Contents/Resources"
                desktop["extract_app"](host / "app.asar", res / "app")
                desktop["configure_host"](res / "app", VERSION)
                for src, name in [("appearance", "appearance"), ("desktop-history", "history"), ("desktop-hud", "hud")]:
                    shutil.copy2(recipe / f"macos/{src}.cjs", res / f"app/dist/modeldesk-{name}.cjs")
                check("/usr/bin/ditto", host / "bin", res / "bin")
                check(resources / "Python/bin/python3.12", "-B", recipe / "scripts/build-host-bundle.py", "--desktop",
                      "--source", res / "bin/language_server", "--reproducible", "--output", res / "modeldesk-host-ui.zip")
            print("正在校验完整应用签名…", flush=True)
            check("/usr/bin/codesign", "--verify", "--deep", "--strict",
                  '-R=identifier "org.modeldesk.antigravity.desktop"', app)
            expected = json.loads((res / "modeldesk-build.json").read_text())
            if expected["sourceVersion"] != VERSION or digest(res / "modeldesk-host-ui.zip") != expected["webBundleSHA256"]:
                raise ValueError("工作台资源与发布清单不一致。")
            desktop["install_verified"](app)
        if previous_plugin:
            print(f"沿用已有 ModelDesk 插件 {previous_plugin}。", flush=True)
        elif not link.is_symlink():
            link.symlink_to(plugin, target_is_directory=True)
    return target


def main():
    resources = Path(__file__).resolve().parent
    if os.uname().machine != "arm64":
        raise ValueError("此安装包适用于 Apple Silicon Mac。")
    target = install_files(resources)
    print("正在注册文件操作和 Dock 入口…", flush=True)
    check(REGISTER, "-f", target)
    check(REGISTER, "-f", target / "Contents/Helpers/ModelDesk File Actions.app")
    check(resources / "pin-desktop", target)
    check("/usr/bin/open", target)
    print("安装完成，可从 Dock 打开吉米奈的工作台。", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as err:
        print(f"安装未完成。{err}", file=sys.stderr)
        sys.exit(1)
