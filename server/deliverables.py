"""Collect and operate on files within registered workspace and artifact roots."""

import base64
import mimetypes
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from .storage import Scope

TEXT_LIMIT = 512 * 1024
PREVIEW_LIMIT = 2 * 1024 * 1024
EDITORS = {"VS Code": "Visual Studio Code", "Cursor": "Cursor", "Typora": "Typora", "Zed": "Zed"}
SAFE_IMAGES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp"}


def git(cwd, *args, timeout=4):
    try:
        return subprocess.run(
            ["git", "--no-optional-locks", "-C", str(cwd), *args],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return subprocess.CompletedProcess(args, 1, b"")


def git_root(cwd):
    result = git(cwd, "rev-parse", "--show-toplevel")
    return Path(os.fsdecode(result.stdout).rstrip("\n")).resolve() if not result.returncode else None


def git_status(cwd, paths=None):
    if paths is not None and not paths:
        return {}
    result = git(cwd, "--literal-pathspecs", "status", "--porcelain=v1", "-z", "--untracked-files=all",
                 "--", *(paths if paths is not None else ["."]))
    raw = iter(result.stdout.split(b"\0"))
    rows = {}
    root = git_root(cwd) if result.stdout else None
    if root:
        for item in raw:
            if len(item) < 4:
                continue
            state = item[:2].decode("ascii", "replace")
            path = root / os.fsdecode(item[3:])
            old = next(raw, b"") if {"R", "C"} & set(state) else b""
            rows[str(path)] = state
            if old and "R" in state:
                rows[str(root / os.fsdecode(old))] = "D "
    return rows


def available_editors():
    return {label: str(path) for label, app in EDITORS.items()
            if (path := next((r / (app + ".app") for r in (Path("/Applications"), Path.home() / "Applications")
                              if (r / (app + ".app")).is_dir()), None))}


def bounded_text(path):
    with path.open("rb") as file:
        data = file.read(TEXT_LIMIT)
        if len(data) >= TEXT_LIMIT:
            raise ValueError("文本须小于 512 KiB")
    if b"\0" in data:
        raise ValueError("此文件为二进制文件")
    try:
        return data.decode("utf-8-sig")
    except UnicodeError:
        raise ValueError("文本预览仅支持 UTF-8") from None


def unique_copy(destination, write):
    """Publish a new file atomically without replacing an existing destination."""
    if destination.exists() or destination.is_symlink():
        raise ValueError("目标文件已存在")
    fd, name = tempfile.mkstemp(dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as file:
            write(file)
        os.link(name, destination)
    except FileExistsError:
        raise ValueError("目标文件已存在") from None
    finally:
        os.unlink(name)


class Deliverables:
    def __init__(self, store, session_lookup=None):
        self.store = store
        self.session_lookup = session_lookup or store.session
        self.registered_only = False

    def scope(self, conversation_id=None):
        return Scope(self.session_lookup(conversation_id), self.store.root, strict_paths=self.registered_only)

    def rows(self, tasks, conversation_id=None, query="", workspace=None, *, registered_files=()):
        scope = self.scope(conversation_id)
        selected = scope.resolve(workspace, workspace_only=True, allow_root=True) if workspace else None
        if selected and selected not in scope.workspaces:
            raise ValueError("请选择已登记工作区")
        rows = {}

        def register(value, source, status=None, current=False, delivered=False):
            try:
                path = scope.resolve(value, exists=False)
                if path.name == ".DS_Store":
                    return
                if selected and not path.is_relative_to(selected) and not any(
                        path.is_relative_to(root) for root in scope.artifacts):
                    return
                if path.is_symlink() or path.exists() and not path.is_file():
                    return
                info = path.stat() if path.is_file() else None
                if not info and status is None and not current and not self.registered_only:
                    return
                row = rows.setdefault(str(path), self.info(path, scope, info))
                if source not in row["sources"]:
                    row["sources"].append(source)
                if status is not None:
                    row["git_status"] = status
                row["current"] |= current or delivered
                row["delivered"] |= delivered
            except (OSError, ValueError):
                pass

        def scan_git(registered_only):
            for workspace in scope.workspaces:
                if selected and workspace != selected:
                    continue
                paths = [name for name in rows if Path(name).is_relative_to(workspace)] if registered_only else None
                for name, status in git_status(workspace, paths).items():
                    if not registered_only or name in rows:
                        register(name, "git", status)

        for artifact in scope.artifacts:
            for folder, dirs, files in os.walk(artifact):
                dirs[:] = [d for d in dirs if d not in {".system_generated", ".git"}]
                for filename in files:
                    register(Path(folder) / filename, "artifact", delivered=True)
        if not self.registered_only:
            scan_git(False)
        for name, observed in scope.session.get("observed_files", {}).items():
            cwd = observed.get("cwd")
            register(Path(cwd) / name if cwd else name, "hook", current=True)
        for name in registered_files:
            register(name, "desktop", current=True, delivered=True)
        for task in tasks:
            current = task.get("conversation_id") == scope.session.get("conversationId")
            for field in ("declared_files", "observed_files", "changed_files", "exported_files"):
                for value in task.get(field, []):
                    register(Path(task["cwd"]) / value, task["engine"],
                             current=current and field != "declared_files",
                             delivered=current and (field == "exported_files" or field == "changed_files" and
                                                    task["status"] in {"review", "completed", "accepted"}))
        if self.registered_only:
            scan_git(True)
        value = query.casefold()
        matching = (row for row in rows.values() if value in row["path"].casefold())
        for row in rows.values():
            status = row["git_status"] or ""
            row["change"] = ("删除" if not row["exists"] else "交付" if row["delivered"] else
                             "新增" if status == "??" or "A" in status else "修改" if status or row["current"] else None)
        return sorted(matching, key=lambda row: (not row["current"], -(row["updated_at"] or 0), row["path"]))

    @staticmethod
    def info(path, scope, info):
        mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
        workspace = next((p for p in scope.workspaces if path.is_relative_to(p)), None)
        return {
            "path": str(path), "relative": str(path.relative_to(workspace)) if workspace else None,
            "workspace": str(workspace) if workspace else None,
            "uri": path.as_uri(), "name": path.name, "mime": mime, "exists": bool(info),
            "category": "图片" if mime.startswith("image/") else "文档" if mime.startswith("text/") or mime == "application/pdf"
            else "压缩包" if path.suffix.lower() in {".zip", ".tar", ".gz", ".7z", ".rar"} else "其他",
            "size": info.st_size if info else None, "updated_at": info.st_mtime if info else None,
            "sources": [], "git_status": None, "current": False, "delivered": False,
        }

    def action(self, action, value, conversation_id=None, destination=None, editor=None, confirmed=False):
        return self.scoped_action(self.scope(conversation_id), action, value, destination, editor, confirmed)

    def scoped_action(self, scope, action, value, destination=None, editor=None, confirmed=False):
        if scope.session.get("indexed_only") and action in {"rename", "trash", "export_copy"}:
            raise ValueError("历史索引会话仅可读取，请在该会话打开工作台后管理文件")
        path = scope.resolve(value, exists=action != "git_diff", direct=action in {"rename", "trash"})
        if action == "git_diff":
            return {"text": self.diff(path)}
        if not path.is_file():
            raise ValueError("此操作需要普通文件")
        if action in {"info", "copy_path", "copy_relative", "copy_markdown"}:
            info = self.info(path, scope, path.stat())
            if action == "info":
                return info
            name = path.name.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("\n", " ")
            if action == "copy_relative" and info["relative"] is None:
                raise ValueError("此产物没有工作区相对路径")
            if action == "copy_markdown":
                return {"text": f"[{name}]({path.as_uri()})"}
            return {"text": info["relative"] if action == "copy_relative" else str(path)}
        if action == "read_text":
            return {"text": bounded_text(path)}
        if action == "read_preview":
            info = self.info(path, scope, path.stat())
            mime = info["mime"]
            try:
                if mime not in SAFE_IMAGES:
                    return {"text": bounded_text(path)}
                with path.open("rb") as file:
                    image = file.read(PREVIEW_LIMIT + 1)
                if len(image) > PREVIEW_LIMIT:
                    raise ValueError("面板图片预览上限为 2 MiB")
                return {"mime": mime, "image": base64.b64encode(image).decode("ascii")}
            except ValueError as error:
                return {"file": info, "preview_reason": str(error)}
        if action == "export_copy":
            if not destination:
                raise ValueError("请输入工作区内的导出子目录")
            folder = scope.resolve(destination, workspace_only=True, exists=False, allow_root=True, direct=True)
            folder.mkdir(parents=True, exist_ok=True)
            dest = scope.resolve(folder / path.name, workspace_only=True, exists=False, direct=True)
            with path.open("rb") as source:
                unique_copy(dest, lambda file: shutil.copyfileobj(source, file))
            return {"path": str(dest)}
        if action == "rename":
            if not destination or Path(destination).name != destination or destination in {".", ".."}:
                raise ValueError("请输入同目录的新文件名")
            dest = scope.resolve(path.with_name(destination), exists=False, direct=True)
            if dest.parent != path.parent or dest.exists() or dest.is_symlink():
                raise ValueError("目标文件已存在或不在同目录")
            os.link(path, dest)
            try:
                path.unlink()
            except OSError:
                dest.unlink()
                raise
            return {"path": str(dest)}
        if action == "trash":
            if not confirmed:
                raise ValueError("请确认移到废纸篓")
            self.desktop(["/usr/bin/osascript", "-e",
                          'on run argv\n tell application "Finder" to delete (POSIX file (item 1 of argv))\nend run',
                          str(path)])
            return {"ok": True}
        if action == "open_app":
            app = available_editors().get(editor)
            if not app:
                raise ValueError("所选编辑器不可用")
            self.desktop(["/usr/bin/open", "-a", app, str(path)])
        elif action in {"reveal_finder", "open_default"}:
            flags = ["-R"] if action == "reveal_finder" else []
            self.desktop(["/usr/bin/open", *flags, str(path)])
        else:
            raise ValueError("未知文件操作")
        return {"ok": True}

    @staticmethod
    def desktop(command):
        try:
            subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        except (OSError, subprocess.SubprocessError):
            raise ValueError("macOS 未能完成文件操作，请检查 Finder 或应用权限") from None

    @staticmethod
    def diff(path):
        root = git_root(path.parent)
        if not root:
            raise ValueError("此文件不属于 Git 仓库")
        patch = git(root, "diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", str(path)).stdout
        if not patch:
            patch = (git(root, "diff", "--no-ext-diff", "--no-textconv", "--cached", "--", str(path)).stdout +
                     git(root, "diff", "--no-ext-diff", "--no-textconv", "--", str(path)).stdout)
        if not patch and path.is_file() and not git(root, "ls-files", "--", str(path)).stdout:
            patch = git(root, "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--", "/dev/null", str(path)).stdout
        return patch[:TEXT_LIMIT].decode("utf-8", "replace")
