#!/usr/bin/env python3
"""Create a redistributable Apple Silicon installer and a clean source snapshot."""
import argparse
import os
from pathlib import Path
import plistlib
import re
import runpy
import shutil
import subprocess
import tempfile
import zipfile

from release_support import ROOT, copy_items, make_runtime, sign, swift

desktop = runpy.run_path(str(ROOT / "macos/install-desktop.py"))
release = runpy.run_path(str(ROOT / "macos/install-release.py"))
VERSION = release["VERSION"]
TITLE = "吉米奈的工作台"
SOURCES = ["README.md", "LICENSE", "THIRD_PARTY.md", ".gitignore", "pyproject.toml", "plugin.json", "hooks.json", "mcp_config.json",
           "assets", "docs", "hooks", "macos", "rules", "scripts", "server", "skills", "tests", "themes", "ui"]
RECIPE = ["macos/install-desktop.py", "macos/appearance.cjs", "macos/desktop-history.cjs", "macos/desktop-hud.cjs",
          "scripts/build-host-bundle.py", "scripts/desktop_layout.py", "scripts/desktop_runtime235.py",
          "scripts/desktop_thoughts.py", "ui/host", "ui/src/office"]


def run(*args):
    subprocess.run(list(map(str, args)), check=True)


def choose_identity():
    output = subprocess.check_output(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"], text=True)
    choices = re.findall(r'"((?:Developer ID Application|Apple Development): [^"]+)"', output)
    if len(choices) != 1:
        raise ValueError("请使用 --identity 指定签名证书的完整名称。")
    return choices[0]


def build_installer(stage, image, sdk, prefix, identity):
    if not release["compatible"](desktop["UPSTREAM"]):
        raise ValueError("发布机需要安装签名和版本匹配的 Google Antigravity " + VERSION)
    installer = image / ("安装" + TITLE + ".app")
    contents = installer / "Contents"
    resources = contents / "Resources"
    binary = contents / "MacOS/InstallWorkbench"
    binary.parent.mkdir(parents=True)
    resources.mkdir()
    runtime = resources / "Python"
    make_runtime(prefix, runtime, identity)
    swift("ReleaseInstaller.swift", binary)
    swift("PinDesktop.swift", resources / "pin-desktop")
    sign(resources / "pin-desktop", identity)
    work = stage / "desktop"
    work.mkdir()
    app = desktop["build"](work, sdk, identity, portable_python=runtime)
    res = app / "Contents/Resources"
    shutil.copy2(res / "modeldesk.icns", resources)
    # Use the upstream deployment target as well as the requirements of our own runtime.
    minimum = plistlib.loads((app / "Contents/Info.plist").read_bytes()).get("LSMinimumSystemVersion", "13.0")
    spec = dict(CFBundleIdentifier="org.modeldesk.antigravity.installer", CFBundleName="安装" + TITLE,
                CFBundleDisplayName="安装" + TITLE, CFBundleExecutable=binary.name, CFBundleIconFile="modeldesk.icns",
                CFBundlePackageType="APPL", CFBundleVersion=VERSION, CFBundleShortVersionString=VERSION,
                LSMinimumSystemVersion=minimum, NSHighResolutionCapable=True)
    (contents / "Info.plist").write_bytes(plistlib.dumps(spec))
    # Google files are restored on the recipient's Mac. Python is stored only once on the image.
    for name in ("app", "bin", "modeldesk-python"):
        shutil.rmtree(res / name)
    (res / "modeldesk-host-ui.zip").unlink()
    run("/usr/bin/ditto", "-c", "-k", app, resources / "Desktop.zip")
    with zipfile.ZipFile(resources / "Desktop.zip") as archive:
        if "Contents/Info.plist" not in archive.namelist():
            raise ValueError("工作台模板目录错误。")
    copy_items(ROOT, resources / "recipe", RECIPE)
    shutil.copy2(ROOT / "macos/install-release.py", resources)
    sign(installer, identity)
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", installer)


def export_sources(image, stage):
    source = image / "源码"
    copy_items(ROOT, source, SOURCES)
    shutil.copy2(source / "docs/简明使用说明.txt", image)
    archive = stage / f"{TITLE}-{VERSION}-源码.zip"
    # Explicit UTF-8 ZIP names also work in non-macOS tools; preserve Unix executable bits.
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                package.write(path, path.relative_to(image))
    return archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--electron-zip", type=Path, default=desktop["DEFAULT_SDK"])
    parser.add_argument("--python-prefix", type=Path, help="relocatable CPython 3.12.14 prefix from uv")
    parser.add_argument("--identity", help="full certificate name")
    args = parser.parse_args()
    dest = args.output.expanduser().resolve()
    if dest == ROOT or ROOT in dest.parents:
        raise ValueError("请选择源码目录之外的交付目录。")
    dest.mkdir(parents=True, exist_ok=True)
    if any(dest.iterdir()):
        raise ValueError("请选择空的交付目录。")
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    prefix = args.python_prefix
    if not prefix:
        exe = subprocess.check_output(["uv", "python", "find", "--managed-python", "3.12.14"], text=True).strip()
        prefix = Path(exe).parent.parent
    with tempfile.TemporaryDirectory(prefix=".build-release-", dir=dest.parent) as tmp:
        stage = Path(tmp)
        image = stage / "volume"
        image.mkdir()
        build_installer(stage, image, args.electron_zip, prefix, args.identity or choose_identity())
        archive = export_sources(image, stage)
        dmg = stage / f"{TITLE}-{VERSION}-Apple-Silicon.dmg"
        run("/usr/bin/hdiutil", "create", "-quiet", "-format", "UDZO", "-volname", f"{TITLE} {VERSION}",
            "-srcfolder", image, dmg)
        run("/usr/bin/hdiutil", "verify", "-quiet", dmg)
        checksums = stage / "SHA256SUMS.txt"
        checksums.write_text("".join(f"{release['digest'](p)}  {p.name}\n" for p in [dmg, archive]))
        shutil.copy2(image / "简明使用说明.txt", dest)
        for p in (archive, dmg, checksums):
            p.rename(dest / p.name)
    print(dest)


if __name__ == "__main__":
    main()
