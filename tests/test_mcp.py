import asyncio
import json
import os
from pathlib import Path
from datetime import timedelta
from contextlib import asynccontextmanager
import signal
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from server.main import MIME, STRIP_URI, URI
from server.storage import Store
from server.task_runner import Runner

from .support import ROOT, fake_environment, register, sandbox

MODEL_TOOLS = {"open_workbench", "dispatch_cli_agent", "resume_cli_task", "get_cli_task_status",
               "cancel_cli_task", "translate_text"}
APP_TOOLS = {"app_dashboard", "app_list_files", "app_file_action",
             "app_context_usage", "app_get_task_logs", "app_task_action",
             "app_translate", "app_save_prefs", "app_thoughts", "app_retry_thought", "app_test_api"}


@asynccontextmanager
async def connect(data, extra=None):
    env = {"PATH": os.environ.get("PATH", os.defpath), **(extra or {})}
    spec = StdioServerParameters(command="bash", args=[str(ROOT / "scripts/run-server.sh"), "--data-dir", str(data)],
                                 env=env, cwd=ROOT)
    with (Path(data) / "stdio.stderr").open("w+") as err:
        async with stdio_client(spec, errlog=err) as (read, write):
            async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=12)) as session:
                handshake = await session.initialize()
                yield session, handshake


async def read_status(session, task_id, predicate):
    for _ in range(65):
        reply = await session.call_tool("get_cli_task_status", {"task_id": task_id})
        assert not reply.isError, reply
        row = reply.structuredContent
        if predicate(row["task"]):
            return row
        await asyncio.sleep(.10)
    raise AssertionError(f"Task did not reach the expected state: {row}")


class MCPTest(unittest.IsolatedAsyncioTestCase):
    async def test_real_launcher_stdio_negotiates_tools_resources_and_open_empty(self):
        with sandbox() as root:
            data = root / "data"
            project = root / "project"
            project.mkdir()
            store = Store(data)
            register(store, project)
            async with connect(data) as (session, handshake):
                self.assertEqual(handshake.serverInfo.name, "modeldesk-workbench")
                tools = {tool.name: tool for tool in (await session.list_tools()).tools}
                self.assertEqual(set(tools), MODEL_TOOLS | APP_TOOLS)
                plugin = json.loads((ROOT / "plugin.json").read_text())["name"]
                server, = json.loads((ROOT / "mcp_config.json").read_text())["mcpServers"]
                for name in tools:
                    self.assertRegex(f"mcp_{plugin}_{server}_{name}", r"^[a-zA-Z0-9_-]{1,64}$")
                self.assertFalse(tools["open_workbench"].inputSchema.get("required"))
                self.assertEqual(tools["open_workbench"].meta["ui"]["resourceUri"], URI)
                self.assertEqual([r["type"] for r in tools["open_workbench"].meta["com.google.antigravity/ui"]["entrypoints"]],
                                 ["aux_pane", "global"])
                for name in ("dispatch_cli_agent", "resume_cli_task"):
                    self.assertEqual(tools[name].meta, {"ui": {"resourceUri": STRIP_URI}})
                for name in APP_TOOLS:
                    self.assertEqual(tools[name].meta["ui"]["visibility"], ["app"])
                resources = (await session.list_resources()).resources
                self.assertEqual({(str(resource.uri), resource.mimeType) for resource in resources},
                                 {(URI, MIME), (STRIP_URI, MIME)})
                for uri in (URI, STRIP_URI):
                    resource = (await session.read_resource(uri)).contents[0]
                    self.assertEqual(resource.mimeType, MIME)
                    self.assertEqual(resource.meta["ui"]["prefersBorder"], False)
                    self.assertEqual(resource.text.encode(), (ROOT / "ui/dist" / uri.rsplit("/", 1)[-1]).read_bytes())
                    self.assertLess(len(resource.text.encode()), 10 * 1024 * 1024)
                result = await session.call_tool("open_workbench", {})
                self.assertFalse(result.isError, result)
                self.assertEqual(result.structuredContent["session"]["workspaces"], [str(project)])
                self.assertLess(len(result.model_dump_json().encode()), 1024 * 1024)
                self.assertEqual(len(result.content), 1)
                bad = await session.call_tool("app_file_action", {"action": "read_text", "path": "../outside"})
                self.assertTrue(bad.isError)
                prefs = {"context_window": None, "hud_theme": "dark", "thought_auto_translate": False,
                         "thought_bilingual": True, "projects_rail_collapsed": True}
                reply = await session.call_tool("app_save_prefs", {"patch": prefs})
                self.assertEqual(reply.structuredContent["prefs"], prefs)
                reply = await session.call_tool("app_thoughts", {"limit": 10})
                self.assertEqual(reply.structuredContent["entries"], [])
                reply = await session.call_tool("app_retry_thought", {"step_hash": "badhash"})
                self.assertTrue(reply.isError)
                reply = await session.call_tool("app_test_api", {"preset": "custom"})
                self.assertFalse(reply.structuredContent["ok"])

    async def test_desktop_exposes_inline_receipts_without_the_legacy_workbench_view(self):
        with sandbox() as root:
            data = Store(root / ".gemini/antigravity-modeldesk/plugin_data/modeldesk-workbench")
            async with connect(data.root, {"HOME": str(root)}) as (client, _):
                tools = {tool.name: tool for tool in (await client.list_tools()).tools}
                self.assertFalse(tools["open_workbench"].meta)
                self.assertEqual(tools["dispatch_cli_agent"].meta["ui"]["resourceUri"], STRIP_URI)
                resources = {str(r.uri) for r in (await client.list_resources()).resources}
                self.assertEqual(resources, {STRIP_URI})
                call = await client.call_tool("open_workbench", {})
                self.assertFalse(call.isError)
                self.assertIn("输入框上方", call.content[0].text)

    async def test_new_profile_without_hooks_or_history_loads_workbench_panels(self):
        with sandbox() as root:
            data = Store(root / "profile" / "plugin_data" / "modeldesk-workbench")
            async with connect(data.root, {"HOME": str(root)}) as (session, _):
                tools = {"app_dashboard": {"settings": True}, "app_list_files": {}, "app_thoughts": {}}
                replies = await asyncio.gather(*(session.call_tool(name, args) for name, args in tools.items()))
                for reply in replies:
                    self.assertFalse(reply.isError, reply)
                dashboard, files, thoughts = (reply.structuredContent for reply in replies)
                self.assertIsNone(dashboard["session"]["id"])
                self.assertEqual(dashboard["sessions"], [])
                self.assertEqual(dashboard["tasks"], [])
                self.assertIn("ollama", dashboard["translation"]["presets"])
                self.assertEqual(files["files"], [])
                self.assertEqual(thoughts["entries"], [])

    async def test_dev_resource_reload_without_restart(self):
        with sandbox() as root:
            data = Store(root / "data")
            resource = root / "live.html"
            resource.write_text("<p>one</p>")
            async with connect(data.root, {"MODELDESK_UI_HTML": str(resource)}) as (session, _):
                self.assertEqual((await session.read_resource(URI)).contents[0].text, "<p>one</p>")
                resource.write_text("<p>two</p>")
                self.assertEqual((await session.read_resource(URI)).contents[0].text, "<p>two</p>")

    async def test_l1_server_crash_keeps_detached_worker_and_l4_sees_prior_tasks(self):
        with sandbox() as root:
            data = Store(root / "data")
            project = root / "project"
            project.mkdir()
            register(data, project, conversation="previous-conversation")
            env = fake_environment(root)
            # Use a raw stdio peer here so the test can SIGKILL the exact MCP process.
            with (data.root / "server.stderr").open("w") as errors:
                proc = await asyncio.create_subprocess_exec(
                    "bash", str(ROOT / "scripts/run-server.sh"), "--data-dir", str(data.root),
                    cwd=ROOT, env={**os.environ, **env}, stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE, stderr=errors,
                )
                async def send(message):
                    proc.stdin.write((json.dumps({"jsonrpc": "2.0", **message}) + "\n").encode())
                    await proc.stdin.drain()

                try:
                    await send({"id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25",
                               "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}})
                    init = json.loads(await asyncio.wait_for(proc.stdout.readline(), 8))
                    self.assertEqual(init["id"], 1)
                    await send({"method": "notifications/initialized"})
                    await send({"id": 2, "method": "tools/call", "params": {"name": "dispatch_cli_agent", "arguments": {
                        "engine": "gemini", "transport": "cli", "prompt": "hold surviving test", "write": False}}})
                    reply = json.loads(await asyncio.wait_for(proc.stdout.readline(), 8))
                    self.assertFalse(reply["result"].get("isError"), reply)
                    task_id = reply["result"]["structuredContent"]["id"]
                    runner = Runner(data)
                    for _ in range(30):
                        if runner.read(task_id)["native_session_id"]:
                            break
                        await asyncio.sleep(.04)
                    row = runner.read(task_id)
                    self.assertEqual(row["status"], "running")
                    self.assertTrue(row["pid"] and row["worker_pid"])
                    proc.send_signal(signal.SIGKILL)
                    await proc.wait()
                finally:
                    if proc.returncode is None:
                        proc.terminate()
                        await proc.wait()
            register(data, project, conversation="new-conversation")
            async with connect(data.root, env) as (session, _):
                dashboard = await session.call_tool("app_dashboard", {})
                self.assertTrue(any(t["conversation_id"] == "previous-conversation"
                                    for t in dashboard.structuredContent["tasks"]))
                final = await read_status(session, task_id, lambda task: task["status"] in {"review", "completed"})
                self.assertIn("survived", final["text"])
                self.assertEqual(final["task"]["native_session_id"], "session-original-001")

    async def test_stdio_restart_after_cli_crash_with_and_without_session(self):
        with sandbox() as root:
            data = Store(root / "data")
            project = root / "project"
            project.mkdir()
            register(data, project)
            env = fake_environment(root)
            async with connect(data.root, env) as (session, _):
                identifiers = []
                for name in ("crash-with-session", "crash-early"):
                    # Each crash writes partial.txt; using separate workspaces keeps the
                    # second case from intentionally triggering the first task's conflict guard.
                    cwd = project / name
                    cwd.mkdir()
                    result = await session.call_tool("dispatch_cli_agent", {
                        "engine": "gemini", "transport": "cli", "prompt": name, "write": True, "cwd": str(cwd)})
                    self.assertFalse(result.isError, result)
                    task_id = result.structuredContent["id"]
                    await read_status(session, task_id, lambda task: task["status"] == "recovery_pending")
                    identifiers.append(task_id)
            async with connect(data.root, env) as (session, _):
                recovered = await session.call_tool("resume_cli_task", {"task_id": identifiers[0]})
                self.assertFalse(recovered.isError, recovered)
                status = await read_status(session, identifiers[0], lambda task: task["status"] == "review")
                self.assertIn("原会话续接完成", status["text"])
                without = await session.call_tool("get_cli_task_status", {"task_id": identifiers[1]})
                self.assertIsNone(without.structuredContent["task"]["native_session_id"])
                self.assertEqual(without.structuredContent["task"]["status"], "recovery_pending")
                self.assertIn("crashed before native session", without.structuredContent["snapshot"]["log"])
