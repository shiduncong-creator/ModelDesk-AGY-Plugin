"""Typed native HUD requests over the desktop application's private stdin/stdout pipes."""

import argparse
import asyncio
import json
from hashlib import sha256
from pathlib import Path
import sys
from threading import Lock
from time import monotonic

from .deliverables import available_editors
from .main import WorkbenchServices, create_server, preference_patch
from .storage import Scope, atomic_json, file_lock, project_root, read_json
from .translator import PRESETS, chat_endpoint, keyless_endpoint

PROFILE = "antigravity-modeldesk"
MAX_LINE = 256 * 1024
METHODS = {
    "snapshot": {"conversation_id"},
    "app_context_usage": {"conversation_id", "force"},
    "app_thoughts": {"conversation_id", "auto_translate", "limit", "visible_step", "visible_text", "visible_revision"},
    "app_retry_thought": {"conversation_id", "step_hash"},
    "app_provider_status": {"preset"},
    "app_save_prefs": {"patch", "key_preset", "api_key", "remove_key"},
    "app_test_api": {"preset"},
    "app_get_task_logs": {"conversation_id", "task_id", "limit", "before", "include_diff"},
    "app_task_action": {"conversation_id", "task_id", "action", "confirmed", "conflict_token", "prompt"},
    "app_list_files": {"conversation_id", "query", "workspace", "offset", "limit"},
    "app_file_action": {"conversation_id", "action", "path", "destination", "editor", "confirmed"},
    "app_translate": {"conversation_id", "path", "target", "preset", "technical", "save", "save_token", "save_format"},
}
FILE_ACTIONS = {"info", "read_text", "read_preview", "git_diff", "copy_path", "copy_relative", "copy_markdown",
                "reveal_finder", "open_app", "open_default", "export_copy", "rename", "trash"}
DOCUMENT_EXTENSIONS = {".txt", ".md", ".csv", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic",
                       ".tif", ".tiff", ".mp3", ".wav", ".m4a", ".mov", ".mp4", ".docx", ".xlsx", ".pptx"}


class HUDInputError(ValueError):
    """A fixed UI message which never interpolates the submitted request."""


def public_error(exc):
    if isinstance(exc, (json.JSONDecodeError, UnicodeDecodeError)):
        return "请求需要一行有效的 UTF-8 JSON"
    while exc:
        if isinstance(exc, HUDInputError):
            return str(exc)
        if type(exc) is ValueError and exc.__traceback__:
            frame = exc.__traceback__
            while frame.tb_next:
                frame = frame.tb_next
            # MCP wraps domain exceptions. Only pass fixed messages written
            # in the service source. Validator errors may embed user input.
            if (frame.tb_frame.f_globals.get("__name__", "").startswith("server.") and
                    str(exc) in frame.tb_frame.f_code.co_consts):
                return str(exc)
        exc = exc.__cause__
    return "操作未完成，请核对目标和设置"


def public_prefs(stored):
    result = {}
    for key, value in stored.items():
        try:
            if key == "translation_ollama":
                result[key] = preference_patch({"translation": value})["translation"]
            else:
                result.update(preference_patch({key: value}))
        except (TypeError, ValueError):
            continue
    return result


class DesktopHUD:
    def __init__(self, home=None, data_dir=None):
        home = Path(home or Path.home())
        data_dir = Path(data_dir or home / ".gemini" / PROFILE / "plugin_data/modeldesk-workbench")
        services = WorkbenchServices(data_dir, usage_options={"home": home, "profiles": (PROFILE,),
                                                              "profile_paths_only": True})
        self.store, self.usage, self.files = services.store, services.usage, services.files
        self.runner, self.translator, self.thoughts = services.runner, services.translator, services.thoughts
        self.mcp = create_server(data_dir, services=services, mask_key_details=False)
        self.files.registered_only = True
        self.provider_cache = {}
        self.provider_lock = Lock()
        self.read_lock = asyncio.Lock()
        self.runner.task_scoped_diffs = True
        self.receipts = self.store.root / "hud_files.json"

    def provider_status(self, preset=None, *, refresh=False):
        with self.provider_lock:
            if refresh:
                self.provider_cache.clear()
            return self.cached_status(preset)

    def cached_status(self, preset):
        active, _ = self.translator.config(preset)
        previous = self.provider_cache.get(active)
        if previous and monotonic() - previous[0] < 12:
            return previous[1]
        status = self.translator.status(preset, masks=False)
        for field in ("config", "custom", "ollama"):
            config = status[field]
            for setting in ("base_url", "model"):
                try:
                    preference_patch({"translation": {setting: config.get(setting, "")}})
                except (ValueError, TypeError):
                    config[setting] = ""
        status.pop("gemini_api_key_mask", None)
        config = status["config"]
        try:
            endpoint = chat_endpoint(config["base_url"])
            status["configured"] = bool(config["model"] and (status["api_key_mask"] or keyless_endpoint(config, endpoint)))
        except ValueError:
            status["configured"] = False
        self.provider_cache[active] = (monotonic(), status)
        return status

    def session_tasks(self, sessions, sid=None):
        result = []
        for row in self.runner.rows():
            owner = row.get("conversation_id")
            if owner not in sessions or sid and owner != sid:
                continue
            cwd = project_root(row.get("cwd"))
            scope = Scope(sessions[owner], self.store.root)
            if cwd and any(cwd.is_relative_to(root) for root in scope.workspaces):
                result.append(row)
        return result

    def file_rows(self, sid, tasks, query="", workspace=None):
        # A dirty file in the same Git tree is not sufficient evidence of which
        # conversation produced it. Hooks, task receipts and brain/<id> are.
        receipts = read_json(self.receipts, {}).get(sid, [])
        rows = self.files.rows(tasks, sid, query=query, workspace=workspace, registered_files=receipts)
        return [row for row in rows if (row["exists"] or row["git_status"]) and
                any(src != "git" for src in row["sources"])]

    def register_file(self, sid, path):
        with file_lock(self.receipts.with_suffix(".lock")):
            data = read_json(self.receipts, {})
            files = data.pop(sid, [])
            data[sid] = ([item for item in files if item != path] + [path])[-300:]
            atomic_json(self.receipts, dict(list(data.items())[-200:]))

    def context(self, sid, tasks, force=False):
        data = self.usage.snapshot(tasks, sid, force)
        data["recent_sessions"] = [row for row in data["recent_sessions"] if row["id"] == sid]
        return data

    def thought_rows(self, sid, limit=20, auto_translate=True):
        preset, _ = self.translator.config()
        if not sid:
            return {"conversation_id": None, "preset": preset, "entries": []}
        _, rows = self.usage.thoughts(sid)
        enabled = self.store.prefs().get("thought_auto_translate") is True and auto_translate is not False
        ready = bool(rows) and enabled and self.provider_status()["configured"]
        return self.thoughts.snapshot(sid, rows, auto_translate=ready, limit=limit)

    def snapshot(self, sid):
        self.runner.reconcile()
        catalog, _ = self.usage.catalog()
        session = catalog.get(sid, {})
        active = session.get("conversationId")
        tasks = self.session_tasks(catalog, sid) if not sid or active else []
        folders = [str(root) for folder in session.get("workspacePaths", []) if (root := project_root(folder))]
        return {"session": {"id": active, "title": session.get("title"), "model": session.get("modelName"),
                            "workspaces": folders, "read_only": bool(session.get("indexed_only")),
                            "status": session.get("invocation_status")},
                "tasks": [self.runner.public(task) for task in tasks[:60 if active else 15]],
                "files": self.file_rows(active, tasks)[:150] if active else [], "prefs": public_prefs(self.store.prefs()),
                "context": self.context(active, tasks) if active else None,
                "thoughts": self.thought_rows(active), "translation": self.provider_status()}

    def visible_thought(self, sid, source, step, revision):
        result = {"conversation_id": sid, "revision": revision, "status": "unavailable"}
        if (not isinstance(source, str) or not source.strip() or len(source) > 24000
                or type(step) is not int or step < 0 or type(revision) is not int or revision < 1):
            raise HUDInputError("可见摘要参数无效")
        if self.store.prefs().get("thought_auto_translate") is not True or not self.provider_status()["configured"]:
            return result
        entries = []
        while source:
            end = min(6000, len(source))
            if end < len(source):
                newline = source.rfind("\n", end // 2, end)
                if newline >= 0:
                    end = newline + 1
            chunk, source = source[:end], source[end:]
            entries.append({"kind":"summary", "step":step, "text":chunk,
                            "hash":sha256(chunk.encode("utf-8")).hexdigest()[:16]})
        records = self.thoughts.snapshot(sid, entries, auto_translate=True, limit=len(entries))["entries"]
        if all(row["status"] == "translated" for row in records):
            return {**result, "status":"translated", "translation":"\n".join(row["translation"] for row in records)}
        result["status"] = "error" if any(row["status"] in ("error", "unconfigured") for row in records) else "pending"
        return result

    def checked_rows(self, sid):
        sessions, _ = self.usage.catalog()
        if not isinstance(sid, str) or sid not in sessions:
            raise HUDInputError("请先打开独立桌面的当前会话")
        return self.session_tasks(sessions, sid)

    async def original_tool(self, method, args):
        reply = await self.mcp.call_tool(method, args)
        return reply.structuredContent

    async def call(self, method, args):
        if not isinstance(method, str) or method not in METHODS or not isinstance(args, dict) or set(args) - METHODS[method]:
            raise HUDInputError("不支持的 HUD 方法或参数")
        sid = args.get("conversation_id")
        if sid is not None and (not isinstance(sid, str) or not 1 <= len(sid) <= 128):
            raise HUDInputError("会话标识无效")
        for flag in ("confirmed", "remove_key", "save", "technical", "force", "include_diff", "auto_translate"):
            if flag in args and type(args[flag]) is not bool:
                raise HUDInputError("操作标志需要布尔值")
        for field in ("limit", "before", "offset"):
            if args.get(field) is not None and (type(args[field]) is not int or not 0 <= args[field] < 2**53):
                raise HUDInputError("分页参数无效")
        for field in ("preset", "key_preset"):
            if args.get(field) is not None and (not isinstance(args[field], str) or args[field] not in PRESETS):
                raise HUDInputError("翻译预设无效")
        if "query" in args and (not isinstance(args["query"], str) or len(args["query"]) > 256):
            raise HUDInputError("搜索内容过长或格式错误")
        if method == "snapshot":
            async with self.read_lock:
                return await asyncio.to_thread(self.snapshot, sid)
        if method == "app_provider_status":
            return await asyncio.to_thread(self.provider_status, args.get("preset"))
        if method == "app_save_prefs":
            reply = await self.original_tool(method, args)
            reply["prefs"] = public_prefs(reply["prefs"])
            if "translation" in reply:
                reply["translation"] = await asyncio.to_thread(self.provider_status, refresh=True)
            return reply
        if method == "app_test_api":
            return await self.original_tool(method, args)
        if method == "app_context_usage" and sid is None:
            return None
        if method == "app_thoughts" and any(key.startswith("visible_") for key in args):
            if not isinstance(sid, str) or sid not in (await asyncio.to_thread(self.usage.catalog))[0]:
                raise HUDInputError("请选择当前会话")
            return await asyncio.to_thread(self.visible_thought, sid, args.get("visible_text"), args.get("visible_step"),
                                           args.get("visible_revision"))
        if method == "app_thoughts" and sid is None:
            return await asyncio.to_thread(self.thought_rows, None)
        if method == "app_list_files" and sid is None:
            return {"files": [], "total": 0, "editors": list(available_editors())}
        tasks = await asyncio.to_thread(self.checked_rows, sid)
        if method == "app_context_usage":
            return await asyncio.to_thread(self.context, sid, tasks, args.get("force", False))
        if method == "app_thoughts":
            return await asyncio.to_thread(self.thought_rows, sid, args.get("limit", 20), args.get("auto_translate", True))
        if method == "app_retry_thought":
            return await self.original_tool(method, args)
        if method in {"app_get_task_logs", "app_task_action"}:
            if not any(task.get("id") == args.get("task_id") for task in tasks):
                raise HUDInputError("任务不属于此会话及其工作区")
            params = {k: v for k, v in args.items() if k != "conversation_id"}
            if method == "app_task_action":
                if args.get("action") not in {"pause", "cancel", "native", "checkpoint", "accept"}:
                    raise HUDInputError("当前菜单只允许暂停、终止、续接或验收该任务")
                if args.get("action") == "cancel" and args.get("confirmed") is not True:
                    raise HUDInputError("请确认终止此任务")
            return await self.original_tool(method, params)
        rows = await asyncio.to_thread(self.file_rows, sid, tasks, args.get("query", ""), args.get("workspace"))
        if method == "app_list_files":
            start = max(0, int(args.get("offset", 0)))
            count = max(1, min(200, int(args.get("limit", 100))))
            return {"files": rows[start:start + count], "total": len(rows), "editors": list(available_editors())}
        path = args.get("path")
        if not isinstance(path, str) or path not in {row["path"] for row in rows}:
            raise HUDInputError("请选择此会话已登记的文件")
        if method == "app_file_action":
            action = args.get("action")
            if action not in FILE_ACTIONS:
                raise HUDInputError("未知 HUD 文件操作")
            if action in {"rename", "trash", "export_copy"} and args.get("confirmed") is not True:
                raise HUDInputError("请确认本次文件操作")
            if action == "open_default" and Path(path).suffix.lower() not in DOCUMENT_EXTENSIONS:
                raise HUDInputError("此格式请使用内置预览或指定的文本编辑器")
            if action == "export_copy":
                folder = self.files.scope(sid).resolve(args.get("destination") or "", workspace_only=True,
                                                      allow_root=True, direct=True)
                if not args.get("destination") or not folder.is_dir():
                    raise HUDInputError("请选择已存在的工作区目录")
        if method == "app_translate" and args.get("save") and not args.get("save_token"):
            raise HUDInputError("请先翻译并核对结果，再旁存文件")
        result = await self.original_tool(method, args)
        created = result.get("saved_path") if method == "app_translate" else (
            result.get("path") if args.get("action") in {"rename", "export_copy"} else None)
        if created:
            await asyncio.to_thread(self.register_file, sid, created)
        return result


async def serve(app, reader, writer):
    sem = asyncio.Semaphore(6)
    pending = set()

    async def handle(raw):
        request_id = None
        try:
            if len(raw) > MAX_LINE:
                raise HUDInputError("请求过长")
            req = json.loads(raw)
            if not isinstance(req, dict) or set(req) != {"id", "method", "args"}:
                raise HUDInputError("请求格式无效")
            request_id = req["id"]
            if type(request_id) not in (str, int) or len(str(request_id)) > 128:
                request_id = None
                raise HUDInputError("请求 ID 无效")
            data = await app.call(req["method"], req["args"])
            response = {"id": request_id, "ok": True, "result": data}
        except Exception as exc:
            # Tool validation errors can contain serialized inputs. Never echo
            # Pydantic/MCP details, including submitted API keys, across the pipe.
            response = {"id": request_id, "ok": False, "error": public_error(exc)}
        finally:
            sem.release()
        writer.write((json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
        writer.flush()

    while True:
        raw = await asyncio.to_thread(reader.readline, MAX_LINE + 1)
        if not raw:
            break
        first = raw
        if len(raw) > MAX_LINE:
            while raw and not raw.endswith(b"\n"):
                raw = await asyncio.to_thread(reader.readline, MAX_LINE + 1)
        await sem.acquire()
        task = asyncio.create_task(handle(first))
        pending.add(task)
        task.add_done_callback(pending.discard)
    if pending:
        await asyncio.gather(*pending)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    hud = DesktopHUD(data_dir=args.data_dir)
    asyncio.run(serve(hud, sys.stdin.buffer, sys.stdout.buffer))
