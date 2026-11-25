"""Verify the mounted release using a disposable home. Does not touch the real Dock."""
import argparse
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile


def verify(resources, home):
    if not (home / ".release-smoke-home").is_file() or Path.home().resolve() != home:
        raise RuntimeError("此验收只使用新建的临时用户目录。")
    if Path(sys.executable).resolve() != (resources / "Python/bin/python3.12").resolve():
        raise RuntimeError("验收必须从外层入口使用独立用户目录和镜像中的 Python 启动。")
    install = runpy.run_path(str(resources / "install-release.py"))["install_files"]
    app = install(resources, upstream=home / "missing.app")  # Exercises the official download branch.
    plugin = home / ".gemini/config/plugins/modeldesk-workbench"
    contents = app / "Contents"
    assets = contents / "Resources"
    assert plugin.is_symlink() and plugin.resolve() == assets / "modeldesk-plugin"
    prefs = home / ".gemini/antigravity-modeldesk/plugin_data/modeldesk-workbench/prefs.json"
    prefs.parent.mkdir(parents=True)
    initial = '{"release_smoke":true,"translation_preset":"ollama"}'
    prefs.write_text(initial)
    inode = app.stat().st_ino
    assert install(resources) == app
    assert app.stat().st_ino == inode and prefs.read_text() == initial
    spec = json.loads((assets / "modeldesk-service/runtime.json").read_text())
    python = (assets / "modeldesk-service" / spec["python"]).resolve()
    assert python == assets / "modeldesk-python/bin/python3.12"
    subprocess.run([contents / "Helpers/ModelDesk File Actions.app/Contents/MacOS/ModelDeskFileActions",
                    "--self-test"], check=True)
    reply = subprocess.run([python, "-B", "-m", "server.desktop_hud"], cwd=assets / "modeldesk-service",
                           input='{"id":1,"method":"snapshot","args":{}}\n', text=True, capture_output=True,
                           check=True, timeout=45)
    snapshot = json.loads(reply.stdout)
    assert snapshot["ok"] and snapshot["result"]["context"] is None
    # The protocol client keeps stdin open until the server has answered tools/list.
    import asyncio
    from datetime import timedelta
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    async def verify_plugin():
        spec = StdioServerParameters(command=str(plugin / "scripts/run-server.sh"),
                                     args=["--data-dir", str(home / "test-mcp")], env=dict(os.environ))
        async with stdio_client(spec) as (reader, writer):
            async with ClientSession(reader, writer, read_timeout_seconds=timedelta(seconds=25)) as session:
                await session.initialize()
                result = await session.list_tools()
                required = {"dispatch_cli_agent", "resume_cli_task", "open_workbench"}
                assert required <= {t.name for t in result.tools}
                print(f"已发现 {len(result.tools)} 项 MCP 工具。")
    asyncio.run(verify_plugin())
    subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", app], check=True)
    print("首次下载、再次安装、数据保留、组件签名、HUD、文件助手及 MCP 检查通过。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("installer", type=Path, help="mounted 安装吉米奈的工作台.app")
    parser.add_argument("--isolated-home", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    installer = args.installer.resolve()
    resources = installer / "Contents/Resources"
    if args.isolated_home:
        verify(resources, args.isolated_home)
        return
    subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", installer], check=True)
    with tempfile.TemporaryDirectory(prefix="modeldesk-release-test-") as tmp:
        home = Path(tmp).resolve()
        (home / ".release-smoke-home").touch()
        env = {"HOME": str(home), "CFFIXED_USER_HOME": str(home), "LANG": "en_US.UTF-8",
               "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1"}
        subprocess.run([resources / "Python/bin/python3.12", "-I", "-B", Path(__file__).resolve(), installer,
                        "--isolated-home", home], env=env, check=True, timeout=1350)


if __name__ == "__main__":
    main()
