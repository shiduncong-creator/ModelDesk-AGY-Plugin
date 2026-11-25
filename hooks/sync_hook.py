"""Observe lifecycle events and leave host decisions untouched."""
import fcntl
import json
import os
import re
import sys
import tempfile
import time

EVENTS = {"SessionStart", "PreInvocation", "PostInvocation", "PostToolUse", "Stop"}
CLI = re.compile(r"(?:^|[\s;&|(/])(?:[\"']?)(codex|qoderclicn|qoder|gemini|agy)(?=$|[\s;\"'&|)])")
FILE_TOOLS = {"write_to_file", "replace_file_content", "multi_replace_file_content", "write_file", "edit_file"}


def observe(payload, root):
    event = payload.get("hookEventName")
    conversation = payload.get("conversationId")
    if event not in EVENTS or not isinstance(conversation, str) or not conversation:
        return
    os.makedirs(root, mode=0o700, exist_ok=True)
    path = os.path.join(root, "sessions.json")
    with open(os.path.join(root, "sessions.lock"), "a") as lock:
        deadline = time.monotonic() + .010
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    return
                time.sleep(.001)
        try:
            with open(path, encoding="utf-8") as file:
                state = json.load(file)
        except FileNotFoundError:
            state = {"sessions": {}}
        sessions = state["sessions"]
        row = sessions.setdefault(conversation, {"conversationId": conversation})
        for key in ("transcriptPath", "artifactDirectoryPath", "modelName", "cwd"):
            value = payload.get(key)
            if isinstance(value, str) and 0 < len(value) <= 4096:
                row[key] = value
        paths = payload.get("workspacePaths")
        if isinstance(paths, list) and all(isinstance(value, str) and 0 < len(value) <= 4096 for value in paths):
            row["workspacePaths"] = paths[:12]
        now = time.time()
        row.update(updated_at=now, hookEventName=event)
        if "stepIdx" in payload:
            row["stepIdx"] = payload["stepIdx"]
        if event in {"SessionStart", "PreInvocation"} or not state.get("active"):
            state["active"] = conversation
        if event != "PostToolUse":
            row["invocation_status"] = "running" if event == "PreInvocation" else "idle"
            row["last_step_status"] = "failed" if payload.get("error") else event
        else:
            tool = payload.get("toolCall") or {}
            name = tool.get("name") or tool.get("toolName")
            args = tool.get("args") or {}
            if isinstance(args, str):
                args = json.loads(args)
            failed = bool(payload.get("error"))
            row["last_step_status"] = "failed" if failed else "completed"
            if name == "run_command":
                match = CLI.search(str(args.get("CommandLine", args.get("command", "")))[:8192])
                if match:
                    engine = {"qoderclicn": "qoder", "agy": "gemini"}.get(match[1], match[1])
                    runs = row.setdefault("passive_cli_runs", [])
                    runs.append({"kind": "passive_cli_run", "engine": engine,
                                 "status": "failed" if failed else "completed", "at": now,
                                 "step": payload.get("stepIdx")})
                    del runs[:-25]
            elif name in FILE_TOOLS and not failed:
                for key in ("TargetFile", "FilePath", "AbsolutePath", "Path", "path", "file_path", "target_file"):
                    value = args.get(key)
                    if isinstance(value, str) and 0 < len(value) <= 4096:
                        files = row.setdefault("observed_files", {})
                        files[value] = {"at": now, "cwd": payload.get("cwd") or row.get("cwd")}
                        if len(files) > 50:
                            del files[next(iter(files))]
                        break
        for sid in sorted(sessions, key=lambda sid: sessions[sid]["updated_at"], reverse=True)[16:]:
            if sid != state["active"]:
                del sessions[sid]
        data = json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(data) > 196608:
            old_sessions = sorted((sid for sid in sessions if sid not in {conversation, state["active"]}),
                                  key=lambda sid: sessions[sid]["updated_at"])
            for sid in old_sessions:
                sessions[sid].pop("observed_files", None)
            for sid in {conversation, state["active"]}:
                if sid in sessions:
                    files = sessions[sid].get("observed_files", {})
                    for name in list(files)[:-10]:
                        del files[name]
            data = json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        fd, tmp = tempfile.mkstemp(dir=root, prefix=".sessions-")
        try:
            with os.fdopen(fd, "wb") as file:
                file.write(data)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(512 * 1024 + 1)
        if len(raw) <= 512 * 1024 and os.environ.get("PLUGIN_DATA"):
            observe(json.loads(raw), os.environ["PLUGIN_DATA"])
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        pass
    print("{}")
