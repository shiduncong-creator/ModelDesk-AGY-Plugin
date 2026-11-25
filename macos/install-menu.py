#!/usr/bin/env python3
"""Install the signed, per-user Antigravity context-menu companion on macOS."""

import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

IDENTIFIER = "org.modeldesk.antigravity.hostmenu"
ROOT = Path(__file__).resolve().parents[1]
APP = Path.home() / "Applications/ModelDesk Host Menu.app"
AGENT = Path.home() / "Library/LaunchAgents" / (IDENTIFIER + ".plist")
DOMAIN = f"gui/{os.getuid()}"


def plist(path):
    with path.open("rb") as stream:
        return plistlib.load(stream)


def check_ownership():
    if APP.is_symlink() or (APP.exists() and plist(APP / "Contents/Info.plist").get("CFBundleIdentifier") != IDENTIFIER):
        raise ValueError(f"安装位置已被其他程序占用：{APP}")
    if AGENT.is_symlink() or (AGENT.exists() and plist(AGENT).get("Label") != IDENTIFIER):
        raise ValueError(f"启动项名称已被其他程序占用：{AGENT}")


def build(bundle):
    contents = bundle / "Contents"
    binary = contents / "MacOS/ModelDeskHostMenu"
    resources = contents / "Resources"
    binary.parent.mkdir(parents=True)
    package = resources / "server"
    package.mkdir(parents=True)
    for name in ("__init__", "storage", "deliverables", "translator", "host_menu"):
        shutil.copy2(ROOT / "server" / (name + ".py"), package)
    shutil.copy2(ROOT / "macos/host-action", resources)
    info = {
        "CFBundleIdentifier": IDENTIFIER, "CFBundleName": "ModelDesk Host Menu",
        "CFBundleDisplayName": "ModelDesk 宿主菜单", "CFBundleExecutable": binary.name,
        "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0",
        "LSUIElement": True, "NSHighResolutionCapable": True,
        "NSAppleEventsUsageDescription": "按你的菜单选择，在访达中将指定文件移到废纸篓。",
    }
    (contents / "Info.plist").write_bytes(plistlib.dumps(info))
    subprocess.run(["/usr/bin/xcrun", "swiftc", "-O", str(ROOT / "macos/HostMenu.swift"), str(ROOT / "macos/PixelFrame.swift"),
                    "-o", binary], check=True)
    subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", bundle], check=True)
    subprocess.run(["/usr/bin/codesign", "--verify", "--strict", bundle], check=True)
    subprocess.run([binary, "--self-test"], check=True)


def job(*args, check=True):
    return subprocess.run(["/bin/launchctl", *args], check=check, capture_output=True, text=True)


def stop_if_loaded():
    if job("print", f"{DOMAIN}/{IDENTIFIER}", check=False).returncode == 0:
        job("bootout", f"{DOMAIN}/{IDENTIFIER}")


def install():
    APP.parent.mkdir(exist_ok=True, parents=True)
    AGENT.parent.mkdir(exist_ok=True, parents=True)
    with tempfile.TemporaryDirectory(prefix=".modeldesk-menu-", dir=APP.parent) as folder:
        stage = Path(folder)
        bundle = stage / APP.name
        build(bundle)
        executable = APP / "Contents/MacOS/ModelDeskHostMenu"
        launch_settings = {
            "Label": IDENTIFIER, "ProgramArguments": [str(executable)], "RunAtLoad": True,
            "KeepAlive": {"SuccessfulExit": False}, "LimitLoadToSessionType": "Aqua",
            "AssociatedBundleIdentifiers": [IDENTIFIER], "ProcessType": "Interactive",
        }
        old_app = stage / "previous.app"
        old_plist = AGENT.read_bytes() if AGENT.exists() else None
        stop_if_loaded()
        if APP.exists():
            APP.rename(old_app)
        try:
            bundle.rename(APP)
            with tempfile.NamedTemporaryFile(dir=AGENT.parent, delete=False) as tmp:
                tmp.write(plistlib.dumps(launch_settings))
            os.replace(tmp.name, AGENT)
            job("enable", f"{DOMAIN}/{IDENTIFIER}")
            res = job("bootstrap", DOMAIN, str(AGENT), check=False)
            if res.returncode:
                raise RuntimeError(res.stderr.strip())
        except BaseException:
            if APP.exists():
                APP.rename(stage / "failed.app")
            if old_app.exists():
                old_app.rename(APP)
            if old_plist is not None:
                AGENT.write_bytes(old_plist)
                job("bootstrap", DOMAIN, str(AGENT), check=False)
            else:
                AGENT.unlink(missing_ok=True)
            raise
        print(APP)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uninstall", action="store_true", help="remove this app and its login agent")
    args = parser.parse_args()
    check_ownership()
    if args.uninstall:
        stop_if_loaded()
        AGENT.unlink(missing_ok=True)
        if APP.exists():
            shutil.rmtree(APP)
    else:
        install()


if __name__ == "__main__":
    main()
