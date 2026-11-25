"""Build-time helpers for the Apple Silicon distribution."""
from pathlib import Path
import runpy
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store", "._*", ".git", ".venv", ".test-scratch", ".pytest_cache",
                                ".env*", "*.log", "*.pem", "*.p12", "node_modules", "secrets.json")


def copy_items(source, target, names):
    for name in names:
        src, dst = source / name, target / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, dst, ignore=IGNORE, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dst)


def sign(path, identity):
    stamp = "--timestamp" if identity.startswith("Developer ID Application:") else "--timestamp=none"
    subprocess.run(["/usr/bin/codesign", "--force", "--options", "runtime", stamp, "--sign", identity, path], check=True)


def swift(source, output):
    subprocess.run(["/usr/bin/xcrun", "swiftc", "-O", "-target", "arm64-apple-macos13.0",
                    ROOT / "macos" / source, "-o", output], check=True)


def make_runtime(prefix, dest, identity):
    """Use a clean, relocatable python-build-standalone prefix; install only locked wheels."""
    exe = prefix / "bin/python3.12"
    (dest / "bin").mkdir(parents=True)
    shutil.copy2(exe, dest / "bin/python3.12")
    shutil.copytree(prefix / "lib", dest / "lib", symlinks=True,
                    ignore=shutil.ignore_patterns("site-packages", "__pycache__", "*.pyc", ".DS_Store", "pkgconfig"))
    site = dest / "lib/python3.12/site-packages"
    subprocess.run(["uv", "pip", "install", "--only-binary", ":all:", "--require-hashes", "--link-mode", "copy", "--no-config",
                    "--python", str(exe), "--target", str(site), "-r", ROOT / "macos/requirements-arm64.txt"], check=True)
    # Console entry points emitted by pip contain build-time shebangs; the app calls modules directly.
    if (site / "bin").is_dir():
        shutil.rmtree(site / "bin")
    for cache in dest.rglob("__pycache__"):
        shutil.rmtree(cache)
    magics = {bytes.fromhex(x) for x in ("cffaedfe", "feedfacf", "cafebabe", "bebafeca", "cafebabf")}
    for path in sorted(dest.rglob("*")):
        if path.is_symlink():
            if not path.resolve().is_relative_to(dest.resolve()):
                raise ValueError(f"Python runtime link leaves its bundle: {path}")
        elif path.is_file():
            with path.open("rb") as f:
                magic = f.read(4)
            if magic in magics:
                sign(path, identity)
    subprocess.run([dest / "bin/python3.12", "-I", "-B", "-c",
                    "import sys, ssl; from pathlib import Path; from mcp.server.fastmcp import FastMCP; "
                    "assert Path(sys.prefix).resolve() == Path(sys.argv[1]).resolve()", str(dest)], check=True)


def add_desktop_extras(app, sdk_dir, identity):
    contents = app / "Contents"
    resources = contents / "Resources"
    copy_items(sdk_dir, resources / "Electron-Licenses", ["LICENSE", "LICENSES.chromium.html"])
    copy_items(ROOT, resources / "ModelDesk-Licenses",
               ["LICENSE", "THIRD_PARTY.md", "docs/third-party", "ui/host/art/fusion-pixel-license.txt"])
    plugin = resources / "modeldesk-plugin"
    copy_items(ROOT, plugin, ["assets", "plugin.json", "mcp_config.json", "hooks.json", "hooks", "rules", "skills",
                              "server", "ui/dist", "scripts/run-server.sh", "scripts/run-hook.sh"])
    helper = contents / "Helpers/ModelDesk File Actions.app"
    helper.parent.mkdir(exist_ok=True)
    file_actions = runpy.run_path(str(ROOT / "macos/install-file-actions.py"))
    file_actions["build"](helper, identity=identity)
