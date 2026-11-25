"""ModelDesk's stdio MCP App and tool contracts."""

import argparse
import asyncio
from hashlib import sha256
import os
from pathlib import Path
from threading import Lock
from time import monotonic
from uuid import uuid4

from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, TextContent

from .deliverables import Deliverables, available_editors, bounded_text, unique_copy
from .storage import Store, project_root
from .task_runner import OPEN_STATES, Runner
from .thought_stream import ThoughtStream
from .translator import GEMINI_API, PRESETS, Translator, chat_endpoint
from .usage import Usage

ROOT = Path(__file__).resolve().parents[1]
URI = "ui://modeldesk/workbench.html"
STRIP_URI = "ui://modeldesk/task-strip.html"
MIME = "text/html;profile=mcp-app"
UI_META = {"ui": {"resourceUri": URI}}
STRIP_META = {"ui": {"resourceUri": STRIP_URI}}
APP_ONLY = {"ui": {"visibility": ["app"]}}
WORKBENCH_META = {
    **UI_META, "com.google.antigravity/ui": {"entrypoints": [
        {"type": "aux_pane", "title": "ModelDesk 工作台"},
        {"type": "global", "title": "ModelDesk 工作台"},
    ]},
}
MAX_HTML = 10 * 1024 * 1024
MAX_MODEL_RESULT = 900 * 1024
TABS = {"office", "files", "context", "translate"}
SPRITES = {"gemini", "gpt-dragon", "qwen", "hy", "dayu", "orange", "glm", "dounai", "dragon", "whale", "rainbow"}


def result(data, text="已完成", *, model_visible=False):
    payload = CallToolResult(content=[TextContent(type="text", text=text)], structuredContent=data)
    if model_visible and len(payload.model_dump_json().encode("utf-8")) >= MAX_MODEL_RESULT:
        raise ValueError("结果超过对话内联限制，请在工作台查看")
    return payload


def preference_patch(incoming):
    patch = {}
    for key, value in incoming.items():
        if key == "tab" and isinstance(value, str) and value in TABS:
            patch[key] = value
        elif key == "office_scene" and isinstance(value, dict):
            scene = {}
            for field, item in value.items():
                if field in {"hearthLit", "musicOn"} and isinstance(item, bool):
                    scene[field] = item
                elif field == "timeMode" and item in ("auto", "day", "dusk", "night"):
                    scene[field] = item
                elif field == "weather" and item in ("sakura", "fireflies", "rain", "breeze"):
                    scene[field] = item
                else:
                    raise ValueError("像素工坊偏好值无效")
            patch[key] = scene
        elif key == "office_desks" and isinstance(value, list) and len(value) == 3:
            if (all(isinstance(desk, dict) and set(desk) == {"endpoint", "sprite"}
                    and desk["endpoint"] in ("codex", "qoder", "gemini") and
                    isinstance(desk["sprite"], str) and desk["sprite"] in SPRITES for desk in value)
                    and len({desk["endpoint"] for desk in value}) == 3):
                patch[key] = value
            else:
                raise ValueError("工位绑定无效")
        elif key == "translation" and isinstance(value, dict):
            settings = {}
            for field, item in value.items():
                if not isinstance(item, str) or len(item) > 1024:
                    raise ValueError("翻译参数无效")
                if field == "preset" and item in PRESETS:
                    settings[field] = item
                elif field == "base_url":
                    if item:
                        chat_endpoint(item)
                    settings[field] = item
                elif field == "model":
                    settings[field] = item.strip()
                else:
                    raise ValueError("翻译参数无效")
            patch[key] = settings
        elif key == "context_window" and (value is None or type(value) is int and 0 < value <= 20_000_000):
            patch[key] = value
        elif key == "hud_theme" and value in ("auto", "dark", "light"):
            patch[key] = value
        elif key in {"thought_auto_translate", "thought_bilingual", "projects_rail_collapsed"} and type(value) is bool:
            patch[key] = value
        elif key == "context_threshold" and type(value) in (int, float) and .05 <= value <= 1:
            patch[key] = value
        else:
            raise ValueError("未知或无效的偏好设置")
    return patch


class WorkbenchServices:
    def __init__(self, data_dir, *, usage_options=None):
        self.store = Store(data_dir)
        self.runner = Runner(self.store)
        self.usage = Usage(self.store, **(usage_options or {}))
        self.files = Deliverables(self.store, session_lookup=self.usage.session)
        self.translator = Translator(self.store)
        self.thoughts = ThoughtStream(self.store, self.translator)


def create_server(data_dir, *, services=None, mask_key_details=True):
    services = services or WorkbenchServices(data_dir)
    store, runner, usage = services.store, services.runner, services.usage
    files, translator, thoughts = services.files, services.translator, services.thoughts
    native_desktop = store.root.parts[-3:] == ("antigravity-modeldesk", "plugin_data", "modeldesk-workbench")
    file_translations = {}
    translation_lock = Lock()
    server = FastMCP("modeldesk-workbench", instructions="使用 ModelDesk 查看当前会话并协调获准的 CLI 任务。")
    runner.reconcile()

    def resource_html(path):
        with path.open("rb") as stream:
            content = stream.read(MAX_HTML)
        if len(content) >= MAX_HTML:
            raise ValueError("MCP App HTML 须小于 10 MiB")
        return content.decode("utf-8")

    if not native_desktop:
        @server.resource(URI, name="ModelDesk 工作台", mime_type=MIME, meta={"ui": {"prefersBorder": False}})
        def workbench_html() -> str:
            return resource_html(Path(os.environ.get("MODELDESK_UI_HTML") or ROOT / "ui/dist/workbench.html"))

    @server.resource(STRIP_URI, name="ModelDesk 任务进度", mime_type=MIME, meta={"ui": {"prefersBorder": False}})
    def task_strip_html() -> str:
        return resource_html(ROOT / "ui/dist/task-strip.html")

    def dashboard(conversation_id=None, extended=False, settings=False, settings_preset=None):
        runner.reconcile()
        catalog, projects = usage.catalog()
        session = usage.session(conversation_id, catalog)
        sid = session.get("conversationId")
        tasks = runner.rows()
        if extended:
            selected = [t for t in tasks if t["conversation_id"] == sid or t["status"] in OPEN_STATES]
            selected += [t for t in tasks[:15] if t not in selected]
        else:
            selected = tasks[:15]
        rows = [runner.public(t) for t in selected[:60]]
        state = {"session": {"id": sid, "title": session.get("title"), "model": session.get("modelName"),
                             "read_only": bool(session.get("indexed_only")),
                             "status": session.get("invocation_status"),
                             "workspaces": [str(root) for p in (session.get("workspacePaths") or [])[:12]
                                            if (root := project_root(p))],
                             "updated_at": session.get("updated_at")},
                 "tasks": rows, "adapters": runner.probes.snapshot(), "prefs": store.prefs()}
        if extended:
            state.update(editors=list(available_editors()), passive=session.get("passive_cli_runs", []),
                         **usage.navigation(catalog, projects))
        if settings:
            state["translation"] = translator.status(settings_preset)
        return state

    def dispatch(engine, prompt, cwd, conversation_id, declared_files, write, transport, model, timeout):
        return runner.public(runner.dispatch(engine, prompt, cwd, conversation_id, declared_files,
                                             write, transport, model, timeout))

    @server.tool(meta=None if native_desktop else WORKBENCH_META)
    async def open_workbench(conversation_id: str | None = None) -> CallToolResult:
        """打开 ModelDesk 工作台，查看会话、项目与任务摘要。"""
        state = await asyncio.to_thread(dashboard, conversation_id)
        if native_desktop:
            return result(state, "工坊和实时翻译在当前聊天旁，上下文在输入框上方。", model_visible=True)
        return result(state, f"已打开 ModelDesk 工作台，近期任务 {len(state['tasks'])} 项。", model_visible=True)

    @server.tool(meta=STRIP_META)
    async def dispatch_cli_agent(engine: str, prompt: str, cwd: str | None = None,
                                 conversation_id: str | None = None, declared_files: list[str] | None = None,
                                 write: bool = True, transport: str | None = None, model: str | None = None,
                                 timeout: int = 1800) -> CallToolResult:
        """在已注册工作区明确派单给 codex、qoder 或 gemini。"""
        row = await asyncio.to_thread(dispatch, engine, prompt, cwd, conversation_id, declared_files,
                                      write, transport, model, timeout)
        return result(row, f"任务 {row['id']} · {row['status']}", model_visible=True)

    @server.tool(meta=STRIP_META)
    async def resume_cli_task(task_id: str, mode: str = "native", follow_up_prompt: str = "",
                              confirmed: bool = False, conflict_token: str | None = None) -> CallToolResult:
        """续接原会话。无会话 ID 时先读取现场，再经用户确认执行 checkpoint。"""
        row = await asyncio.to_thread(runner.resume, task_id, mode, follow_up_prompt, confirmed, conflict_token)
        if row["status"] in {"conflict", "confirmation_required"}:
            row["task"] = runner.public(await asyncio.to_thread(runner.read, task_id))
            row["resume_mode"] = mode
        return result(row, f"任务 {task_id} · {row['status']}", model_visible=True)

    @server.tool()
    async def get_cli_task_status(task_id: str | None = None) -> CallToolResult:
        """查询单项任务及日志尾部，或列出最近任务。"""
        await asyncio.to_thread(runner.reconcile)
        if task_id:
            data = await asyncio.to_thread(runner.logs, task_id, 20)
            data["text"] = data["text"][-40000:]
            return result(data, f"任务 {task_id} · {data['task']['status']}", model_visible=True)
        rows = [runner.public(t) for t in runner.rows()[:30]]
        return result({"tasks": rows}, f"近期任务 {len(rows)} 项。", model_visible=True)

    @server.tool()
    async def cancel_cli_task(task_id: str, pause: bool = False) -> CallToolResult:
        """停止外部 CLI。暂停会保留中断现场以便续接。"""
        row = await asyncio.to_thread(runner.stop, task_id, pause)
        return result(row, "已登记暂停请求。" if pause else "已登记终止请求。", model_visible=True)

    def translate(text, path, target, preset, technical, save, conversation_id, *,
                  remember=False, save_token=None, save_format="bilingual"):
        if save_format not in {"bilingual", "translation"}:
            raise ValueError("旁存格式无效")
        scope = files.scope(conversation_id) if path else None
        if save and scope and scope.session.get("indexed_only"):
            raise ValueError("历史索引会话仅可读取，请在该会话打开工作台后旁存")
        source = scope.resolve(path, direct=save) if scope else None
        if source:
            if not source.is_file():
                raise ValueError("请选择可读取的文本文件")
            text = bounded_text(source)
        if save and not source:
            raise ValueError("请选择来源文件后旁存")
        digest = sha256(text.encode("utf-8")).digest() if source else None
        if save_token is not None:
            if not save or not source:
                raise ValueError("请指定旁存文件")
            with translation_lock:
                receipt = file_translations.get(save_token)
            if not receipt or receipt[0] < monotonic() or receipt[1:4] != (source, conversation_id, digest):
                raise ValueError("原文已变更或翻译记录已过期，请重新翻译")
            translated = dict(receipt[4])
        else:
            translated = translator.translate(text or "", target, preset, technical)
        if save:
            dest = files.scope(conversation_id).resolve(
                source.with_name(f"{source.stem}.{translated['target']}{source.suffix or '.md'}"), exists=False,
                direct=True)
            unique_copy(dest, lambda file: file.write(translated[save_format].encode("utf-8")))
            translated["saved_path"] = str(dest)
        elif remember and source:
            token = uuid4().hex
            with translation_lock:
                if len(file_translations) >= 12:
                    del file_translations[next(iter(file_translations))]
                file_translations[token] = (monotonic() + 900, source, conversation_id, digest, dict(translated))
            translated["save_token"] = token
        return translated

    @server.tool()
    async def translate_text(text: str = "", path: str | None = None, target: str = "auto", preset: str | None = None,
                             technical: bool = True, conversation_id: str | None = None) -> CallToolResult:
        """通过用户配置的独立 API 翻译文本或文件。模型回包只包含译文。"""
        data = await asyncio.to_thread(translate, text, path, target, preset, technical, False, conversation_id)
        return result({k: data[k] for k in ("target", "model", "chunks")}, data["translation"], model_visible=True)

    @server.tool(meta=APP_ONLY)
    async def app_dashboard(conversation_id: str | None = None, settings: bool = False,
                                      settings_preset: str | None = None) -> CallToolResult:
        return result(await asyncio.to_thread(dashboard, conversation_id, True, settings, settings_preset))

    @server.tool(meta=APP_ONLY)
    async def app_list_files(conversation_id: str | None = None, query: str = "",
                                    offset: int = 0, limit: int = 100, workspace: str | None = None) -> CallToolResult:
        rows = await asyncio.to_thread(files.rows, runner.rows(), conversation_id, query, workspace)
        offset, limit = max(0, offset), max(1, min(limit, 200))
        return result({"files": rows[offset:offset + limit], "total": len(rows), "editors": list(available_editors())})

    @server.tool(meta=APP_ONLY)
    async def app_file_action(action: str, path: str, conversation_id: str | None = None,
                                    destination: str | None = None, editor: str | None = None,
                                    confirmed: bool = False) -> CallToolResult:
        return result(await asyncio.to_thread(files.action, action, path, conversation_id, destination, editor, confirmed))

    @server.tool(meta=APP_ONLY)
    async def app_context_usage(conversation_id: str | None = None, force: bool = False) -> CallToolResult:
        return result(await asyncio.to_thread(usage.snapshot, runner.rows(), conversation_id, force))

    def thought_snapshot(conversation_id, auto_translate, limit):
        sid, entries = usage.thoughts(conversation_id)
        enabled = store.prefs().get("thought_auto_translate") is True and auto_translate is not False
        return thoughts.snapshot(sid, entries, enabled, limit)

    @server.tool(meta=APP_ONLY)
    async def app_thoughts(conversation_id: str | None = None, auto_translate: bool | None = None,
                                     limit: int = 20) -> CallToolResult:
        return result(await asyncio.to_thread(thought_snapshot, conversation_id, auto_translate, limit))

    def retry_thought(step_hash, conversation_id):
        _, entries = usage.thoughts(conversation_id)
        entry = next((row for row in reversed(entries) if row["hash"] == step_hash), None)
        if not entry:
            raise ValueError("当前会话没有这条翻译记录")
        return thoughts.retry(step_hash, entry)

    @server.tool(meta=APP_ONLY)
    async def app_retry_thought(step_hash: str, conversation_id: str | None = None) -> CallToolResult:
        return result(await asyncio.to_thread(retry_thought, step_hash, conversation_id))

    @server.tool(meta=APP_ONLY)
    async def app_test_api(preset: str | None = None) -> CallToolResult:
        return result(await asyncio.to_thread(translator.test_connection, preset))

    @server.tool(meta=APP_ONLY)
    async def app_get_task_logs(task_id: str, limit: int = 50, before: int | None = None,
                                include_diff: bool = False) -> CallToolResult:
        await asyncio.to_thread(runner.reconcile)
        return result(await asyncio.to_thread(runner.logs, task_id, limit, before, include_diff))

    @server.tool(meta=APP_ONLY)
    async def app_task_action(action: str, task_id: str | None = None, engine: str = "",
                                         prompt: str = "", cwd: str | None = None,
                                         conversation_id: str | None = None, declared_files: list[str] | None = None,
                                         write: bool = True, transport: str | None = None,
                                         model: str | None = None, timeout: int = 1800,
                                         confirmed: bool = False, conflict_token: str | None = None) -> CallToolResult:
        if action == "dispatch":
            return result(await asyncio.to_thread(dispatch, engine, prompt, cwd, conversation_id, declared_files,
                                                  write, transport, model, timeout))
        if not task_id:
            raise ValueError("需要任务 ID")
        if action in {"native", "checkpoint"}:
            return result(await asyncio.to_thread(runner.resume, task_id, action, prompt, confirmed, conflict_token))
        if action in {"pause", "cancel"}:
            return result(await asyncio.to_thread(runner.stop, task_id, action == "pause"))
        if action == "accept":
            return result(await asyncio.to_thread(runner.review, task_id, True))
        raise ValueError("未知任务动作")

    @server.tool(meta=APP_ONLY)
    async def app_translate(text: str = "", path: str | None = None, target: str = "auto", preset: str | None = None,
                            technical: bool = True, save: bool = False, conversation_id: str | None = None,
                            save_token: str | None = None, save_format: str = "bilingual") -> CallToolResult:
        return result(await asyncio.to_thread(translate, text, path, target, preset, technical, save, conversation_id,
                                              remember=True, save_token=save_token, save_format=save_format))

    def write_preferences(patch, key_preset, api_key, remove_key):
        safe = preference_patch(patch or {})
        settings = safe.get("translation")
        if settings is not None and (settings.get("preset") or translator.config()[0]) == "ollama":
            overrides = {key: settings.pop(key) for key in ("base_url", "model") if key in settings}
            if overrides:
                safe["translation_ollama"] = overrides
        if api_key is not None or remove_key:
            if key_preset not in {*PRESETS, GEMINI_API}:
                raise ValueError("密钥所属预设无效")
            if not remove_key and not api_key:
                raise ValueError("请输入 API Key")
            translator.keys.set(key_preset, "" if remove_key else api_key)
        payload = {"prefs": store.save_prefs(safe) if safe else store.prefs()}
        if "translation" in safe or api_key is not None or remove_key:
            payload["translation"] = translator.status(masks=mask_key_details)
        return payload

    @server.tool(meta=APP_ONLY)
    async def app_save_prefs(patch: dict | None = None, key_preset: str | None = None,
                             api_key: str | None = None, remove_key: bool = False) -> CallToolResult:
        return result(await asyncio.to_thread(write_preferences, patch, key_preset, api_key, remove_key))

    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=os.environ.get("PLUGIN_DATA"))
    args = parser.parse_args()
    if not args.data_dir:
        parser.error("需要 --data-dir 或 PLUGIN_DATA")
    create_server(args.data_dir).run(transport="stdio")
