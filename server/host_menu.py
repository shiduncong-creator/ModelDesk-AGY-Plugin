"""One explicit file action from the local macOS menu, over inherited pipes."""

import json
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

from .deliverables import Deliverables
from .storage import Scope, Store, read_json
from .translator import Translator

PROFILES = Path.home() / ".gemini"
PLUGIN_DATA = Path("plugin_data/modeldesk-workbench")
PROJECTS = Path.home() / ".gemini/config/projects"


def project_folders(directory):
    for config in directory.glob("*.json"):
        project = read_json(config)
        if not isinstance(project, dict):
            continue
        resources = project.get("projectResources")
        if not isinstance(resources, dict) or not isinstance(resources.get("resources"), list):
            continue
        for entry in resources["resources"]:
            if not isinstance(entry, dict) or not isinstance(entry.get("folderUri"), str):
                continue
            try:
                uri = urlsplit(entry["folderUri"])
            except ValueError:
                continue
            if uri.scheme == "file" and uri.netloc in ("", "localhost") and not uri.query and not uri.fragment:
                yield unquote(uri.path)


def scope_for_file(path, store, projects):
    # The front window may differ from the last session to run a hook.
    # Pick the deepest registered root that actually contains this exact path.
    roots = {root: "workspace" for root in project_folders(projects)}
    for session in store.sessions().get("sessions", {}).values():
        for root in session.get("workspacePaths", []):
            roots[root] = "workspace"
        if root := session.get("artifactDirectoryPath"):
            roots.setdefault(root, "artifact")
    for root in sorted(roots, key=lambda item: len(Path(item).parts), reverse=True):
        if not path.is_relative_to(root):
            continue
        record = ({"workspacePaths": [root]} if roots[root] == "workspace"
                  else {"artifactDirectoryPath": root})
        scope = Scope(record, store.root)
        scope.resolve(path)
        return scope
    raise ValueError("请选择 Antigravity 已登记项目或会话产物目录内的文件")


def perform(request, store, projects):
    action = request.get("action")
    if action not in {"info", "copy_relative", "git_diff", "translate", "rename", "trash"}:
        raise ValueError("未知宿主菜单操作")
    value = request.get("path")
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ValueError("请提供完整的本地文件路径")
    scope = scope_for_file(Path(value), store, projects)
    if action in {"rename", "trash"} and request.get("confirmed") is not True:
        raise ValueError("请先确认本次文件操作")
    files = Deliverables(store)
    if action == "translate":
        original = files.scoped_action(scope, "read_text", value)["text"]
        translation = Translator(store).translate(original, target="zh")
        return {"text": translation["translation"]}
    return files.scoped_action(scope, action, value, destination=request.get("destination"),
                                      confirmed=request.get("confirmed") is True)


def main():
    try:
        raw = sys.stdin.buffer.read(32769)
        if len(raw) > 32768:
            raise ValueError("文件操作请求过长")
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise ValueError("文件操作请求格式无效")
        # ModelDesk uses its own app data and translation preferences. The older
        # standalone file menu still works on machines with only the Google host.
        directory = PROFILES / "antigravity-modeldesk" / PLUGIN_DATA
        if not directory.is_dir():
            directory = PROFILES / "antigravity" / PLUGIN_DATA
        result = {"ok": True, **perform(request, Store(directory), PROJECTS)}
    except (OSError, ValueError, TypeError) as exc:
        result = {"ok": False, "error": str(exc)}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
