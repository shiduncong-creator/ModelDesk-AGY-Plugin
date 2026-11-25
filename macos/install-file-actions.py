#!/usr/bin/env python3
"""Build and install the on-demand ModelDesk document URL handler for this macOS user."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
APP = Path.home() / "Applications/ModelDesk File Actions.app"
IDENTIFIER = "local.modeldesk.file-actions"
REGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def check_backend(helper):
    with tempfile.TemporaryDirectory(prefix="modeldesk-file-check-") as folder:
        home = Path(folder).resolve()
        workspace = home / "sample project"
        workspace.mkdir()
        project = home / ".gemini/config/projects/check.json"
        project.parent.mkdir(parents=True)
        project.write_text(json.dumps({"projectResources": {"resources": [{"folderUri": workspace.as_uri()}]}}))
        source = workspace / "测试 + copy.txt"
        source.write_text("temporary sample\n")

        def action(kind, **fields):
            result = run(helper, env=dict(os.environ, HOME=str(home)),
                         input=json.dumps(dict(action=kind, path=str(source), **fields)),
                         capture_output=True, text=True)
            return json.loads(result.stdout)

        run("/usr/bin/git", "init", "-q", str(workspace))
        run("/usr/bin/git", "-C", str(workspace), "add", "--", source.name)
        patch = action("git_diff")
        if not patch.get("ok") or "+temporary sample" not in patch.get("text", ""):
            raise ValueError("Bundled helper failed to read the fixture diff")
        if action("rename", destination="changed.txt").get("ok"):
            raise ValueError("Bundled helper accepted an unconfirmed rename")
        if not action("rename", destination="changed.txt", confirmed=True).get("ok"):
            raise ValueError("Bundled helper failed to rename the test file")
        if source.exists() or (workspace / "changed.txt").read_text() != "temporary sample\n":
            raise ValueError("Wrong destination or contents after test rename")


def build(bundle, identity=None):
    contents = bundle / "Contents"
    binary = contents / "MacOS/ModelDeskFileActions"
    resources = contents / "Resources"
    binary.parent.mkdir(parents=True)
    package = resources / "server"
    package.mkdir(parents=True)
    for name in ("__init__", "storage", "deliverables", "translator", "host_menu"):
        shutil.copy2(ROOT / "server" / (name + ".py"), package)
    shutil.copy2(ROOT / "macos/host-action", resources)
    info = {
        "CFBundleIdentifier": IDENTIFIER, "CFBundleName": "ModelDesk File Actions",
        "CFBundleDisplayName": "ModelDesk 文件操作", "CFBundleExecutable": binary.name,
        "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0",
        "CFBundleURLTypes": [{"CFBundleURLName": IDENTIFIER, "CFBundleTypeRole": "Viewer",
                              "CFBundleURLSchemes": ["modeldesk-document"]}],
        "NSHighResolutionCapable": True,
        "NSAppleEventsUsageDescription": "按你在本机窗口中的确认，请访达将指定文件移到废纸篓。",
    }
    (contents / "Info.plist").write_bytes(plistlib.dumps(info))
    run("/usr/bin/xcrun", "swiftc", "-O", "-target", "arm64-apple-macos13.0", ROOT / "macos/FileActions.swift", "-o", binary)
    if identity:
        from release_support import sign
        sign(bundle, identity)
    else:
        run("/usr/bin/codesign", "--force", "--sign", "-", bundle)
    run("/usr/bin/codesign", "--verify", "--strict", bundle)
    run(binary, "--self-test")
    check_backend(resources / "host-action")


def check_ownership():
    if APP.is_symlink():
        raise SystemExit(f"Existing destination is a symbolic link: {APP}")
    if APP.exists():
        info = APP / "Contents/Info.plist"
        if not info.is_file() or plistlib.loads(info.read_bytes()).get("CFBundleIdentifier") != IDENTIFIER:
            raise SystemExit(f"Existing destination belongs to another application: {APP}")


def install():
    APP.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".modeldesk-document-", dir=APP.parent) as folder:
        directory = Path(folder)
        bundle = directory / APP.name
        backup = directory / "previous.app"
        build(bundle)
        check_ownership()
        if APP.exists():
            APP.rename(backup)
        try:
            bundle.rename(APP)
            run(REGISTER, "-f", APP)
        except BaseException:
            if APP.exists():
                APP.rename(bundle)
            if backup.exists():
                backup.rename(APP)
                run(REGISTER, "-f", APP)
            raise
    print(APP)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--self-test", action="store_true", help="compile and test in a temporary directory")
    group.add_argument("--uninstall", action="store_true", help="remove this application's scheme registration and bundle")
    args = parser.parse_args()
    if args.self_test:
        with tempfile.TemporaryDirectory() as temp:
            build(Path(temp) / APP.name)
    elif args.uninstall:
        check_ownership()
        if APP.exists():
            run(REGISTER, "-u", APP)
            shutil.rmtree(APP)
    else:
        install()
