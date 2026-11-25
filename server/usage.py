"""Per-model Antigravity usage and locally observed CLI execution metrics."""

from collections import Counter
from datetime import date, datetime, timedelta
import json
import sqlite3
from urllib.parse import unquote, urlsplit
from pathlib import Path

from .codex_usage import usage_state
from .storage import project_root, read_json
from .context_inspector import ContextInspector, TOKEN_FIELDS, Transcript, UUID


PROFILES = ("antigravity-modeldesk", "antigravity", "antigravity-cli")


def local_folder(uri):
    if not isinstance(uri, str):
        return None
    try:
        parsed = urlsplit(uri)
        if parsed.scheme == "file" and parsed.netloc in {"", "localhost"} and not parsed.query and not parsed.fragment:
            root = project_root(unquote(parsed.path))
            return str(root) if root else None
    except (ValueError, OSError):
        pass
    return None


def modified_at(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (TypeError, AttributeError, ValueError, OverflowError, OSError):
        return 0


def totals(states):
    counts = Counter({key: 0 for key in TOKEN_FIELDS})
    for state in states:
        for values in state.totals.values():
            counts.update(values)
    return dict(counts)


class Usage:
    def __init__(self, store, home=None, profiles=PROFILES, profile_paths_only=False):
        self.store = store
        self.home = Path.home() if home is None else Path(home)
        self.profiles = tuple(profiles)
        self.profile_paths_only = profile_paths_only
        self.inspector = ContextInspector()

    def projects(self):
        projects = {}
        for config in sorted((self.home / ".gemini/config/projects").glob("*.json")):
            row = read_json(config, {})
            if not isinstance(row, dict) or not isinstance(row.get("id"), str):
                continue
            resources = row.get("projectResources") or {}
            entries = resources.get("resources") if isinstance(resources, dict) else None
            folders = [root for item in entries if isinstance(item, dict)
                       and (root := local_folder(item.get("folderUri")))] if isinstance(entries, list) else []
            sid = row["id"]
            projects[sid] = {"id": sid, "name": row.get("name") or sid, "workspaces": list(dict.fromkeys(folders)),
                             "conversation_id": None}
        return projects

    @staticmethod
    def summaries(database):
        if not database.is_file():
            return []
        try:
            with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=.1) as db:
                cols = {row[1] for row in db.execute("PRAGMA table_info(conversation_summaries)")}
                if "conversation_id" not in cols:
                    return []
                fields = ("conversation_id", "parent_conversation_id", "project_id", "title",
                          "last_modified_time", "workspace_uris")
                projection = ", ".join(key if key in cols else "NULL" for key in fields)
                return [(*entry, "parent_conversation_id" in cols) for entry in db.execute(
                    "SELECT " + projection + " FROM conversation_summaries")]
        except sqlite3.Error:
            return []

    def catalog(self):
        projects = self.projects()
        registered = {root for item in projects.values() for root in item["workspaces"]}
        rows = {}
        for profile in self.profiles:
            base = self.home / ".gemini" / profile
            for sid, parent, project, title, stamp, raw_uris, knows_parent in self.summaries(base / "conversation_summaries.db"):
                if not isinstance(sid, str) or not UUID.fullmatch(sid):
                    continue
                row = rows.setdefault(sid, {"conversationId": sid})
                if knows_parent:
                    row["_parent_known"] = True
                if parent and not row.get("parent_id"):
                    row["parent_id"] = parent
                stamp = modified_at(stamp)
                if stamp <= row.get("_summary_stamp", -1):
                    continue
                try:
                    raw = json.loads(raw_uris or "[]")
                except (ValueError, TypeError):
                    raw = []
                allowed = projects[project]["workspaces"] if project in projects else registered
                folders = [root for uri in raw if (root := local_folder(uri)) in allowed] if isinstance(raw, list) else []
                row.update(title=title or row.get("title") or "", project_id=project or row.get("project_id"),
                           updated_at=max(stamp, row.get("updated_at", 0)), _summary_stamp=stamp,
                           workspacePaths=folders if raw else projects.get(project, {}).get("workspaces", []))
            for log in base.glob("brain/*/.system_generated/logs/transcript.jsonl"):
                if self.profile_paths_only and log.resolve() != log:
                    continue
                sid = log.parents[2].name
                row = rows.setdefault(sid, {"conversationId": sid})
                try:
                    mtime = log.stat().st_mtime
                    if mtime >= row.get("_log_stamp", 0):
                        row.update(transcriptPath=str(log), artifactDirectoryPath=str(log.parents[2]), _log_stamp=mtime)
                    row["updated_at"] = max(row.get("updated_at", 0), mtime)
                except OSError:
                    continue
        for row in rows.values():
            row["indexed_only"] = True
        hooks = self.store.sessions().get("sessions", {})
        for sid, hook in hooks.items():
            if not isinstance(hook, dict):
                continue
            if self.profile_paths_only:
                if not isinstance(sid, str) or Path(sid).name != sid or sid in {"", ".", ".."}:
                    continue
                hook = dict(hook, conversationId=sid)
                # The host also records transcript_full.jsonl in hooks. The
                # public display transcript beside it owns the HUD view.
                hook.pop("transcriptPath", None)
                artifact = hook.pop("artifactDirectoryPath", None)
                expected = [self.home / ".gemini" / profile / "brain" / sid for profile in self.profiles]
                if isinstance(artifact, str) and any(Path(artifact) == path == path.resolve() for path in expected):
                    hook["artifactDirectoryPath"] = artifact
            row = rows.setdefault(sid, {"conversationId": sid})
            log = hook.get("transcriptPath")
            if log and not Path(log).is_file():
                hook = {k: v for k, v in hook.items() if k != "transcriptPath"}
            stamp = max(hook.get("updated_at") or 0, row.get("updated_at", 0))
            # Only explicitly hook-authorized roots inherit writable file scope.
            writable = bool(hook.get("workspacePaths") or hook.get("artifactDirectoryPath"))
            if writable:
                row["workspacePaths"] = hook.get("workspacePaths") or []
                row["artifactDirectoryPath"] = hook.get("artifactDirectoryPath")
            row.update(hook, indexed_only=not writable, updated_at=stamp)
        return rows, projects

    def session(self, conversation_id=None, catalog=None):
        rows = self.catalog()[0] if catalog is None else catalog
        sid = self.selected(conversation_id, rows)
        return rows.get(sid, {})

    def navigation(self, rows, projects):
        sessions = []
        for sid, row in sorted(rows.items(), key=lambda pair: pair[1].get("updated_at", 0), reverse=True):
            folders = [str(root) for path in row.get("workspacePaths", []) if (root := project_root(path))]
            item = {"id": sid, "title": row.get("title"), "updated_at": row.get("updated_at", 0),
                    "model": row.get("modelName"), "parent_id": row.get("parent_id"),
                    "project_id": row.get("project_id"), "workspaces": folders}
            sessions.append(item)
            for project in projects.values():
                if not item["parent_id"] and not project["conversation_id"] and (
                        project["id"] == item["project_id"] or not item["project_id"] and
                        set(folders).intersection(project["workspaces"])):
                    project["conversation_id"] = sid
        return {"sessions": sessions, "projects": list(projects.values())}

    def transcripts(self, rows=None):
        rows = self.catalog()[0] if rows is None else rows
        paths = {}
        for sid, row in rows.items():
            if value := row.get("transcriptPath"):
                try:
                    path = Path(value).resolve(strict=True)
                    if path.is_file():
                        paths[sid] = (path, max(row.get("updated_at", 0), path.stat().st_mtime), row.get("modelName"))
                except (ValueError, OSError, RuntimeError):
                    continue
        return paths

    def snapshot(self, tasks, conversation_id=None, force=False):
        with self.inspector.lock:
            return self.collect(tasks, conversation_id, force)

    def selected(self, conversation_id, rows):
        if conversation_id:
            return conversation_id
        active = self.store.sessions().get("active")
        if active in rows:
            return active
        normal = [sid for sid, row in rows.items() if not row.get("parent_id")]
        return max(normal or rows, key=lambda sid: rows[sid].get("updated_at", 0), default=None)

    def thoughts(self, conversation_id=None):
        with self.inspector.lock:
            rows, _ = self.catalog()
            paths = self.transcripts(rows)
            sid = self.selected(conversation_id, rows)
            if sid not in paths:
                return sid, []
            path = paths[sid][0]
            if path.name == "transcript_full.jsonl":
                path = path.with_name("transcript.jsonl")
            return sid, list(self.inspector.scan(path).thoughts.values())

    def collect(self, tasks, conversation_id, force):
        rows, projects = self.catalog()
        paths = self.transcripts(rows)
        active = self.selected(conversation_id, rows)
        today = date.today().isoformat()
        oldest = (date.today() - timedelta(days=6)).isoformat()
        current = None
        window = {"today": {}, "week": {}}
        states = {}
        for sid, (path, _, _) in paths.items():
            if path not in states:
                states[path] = self.inspector.scan(path)
            if sid == active:
                current = states[path]
        for state in states.values():
            for day, models in state.days.items():
                if oldest <= day <= today:
                    for model, counts in models.items():
                        window["week"].setdefault(model, Counter()).update(counts)
                        if day == today:
                            window["today"].setdefault(model, Counter()).update(counts)
        prefs = self.store.prefs()
        model = paths[active][2] if active in paths else self.store.session(active).get("modelName")
        context = self.inspector.context(current or Transcript(), prefs.get("context_window"),
                                         prefs.get("context_threshold", .75), model) if current or model else None
        children = {}
        if current:
            # Resolve each reference against observed brain logs, including nested delegations.
            brain = {sid.casefold(): path for sid, (path, _, _) in paths.items()
                     if UUID.fullmatch(sid) and path.name == "transcript.jsonl" and
                     len(path.parents) > 3 and path.parent.name == "logs" and
                     path.parents[1].name == ".system_generated" and
                     path.parents[2].name.casefold() == sid.casefold() and path.parents[3].name == "brain"}
            # Prefer the host's explicit parent relation over text from a tool response.
            indexed = {sid.casefold(): row["parent_id"].casefold() for sid, row in rows.items()
                       if isinstance(row.get("parent_id"), str)}
            def references(parent, state):
                return {sid for sid, owner in indexed.items() if owner == parent} | {
                    sid for sid in state.subagent_ids if not rows.get(sid, {}).get("_parent_known")}
            pending = list(references(active.casefold(), current))
            seen = {paths[active][0]}
            while pending:
                sid = pending.pop()
                child = brain.get(sid)
                if child and child not in seen:
                    seen.add(child)
                    children[child] = states[child]
                    pending.extend(references(sid, states[child]))
        recent = self.navigation(rows, projects)["sessions"][:16]
        for item in recent:
            if info := paths.get(item["id"]):
                item["model"] = states[info[0]].model or item["model"]
        return {"conversation_id": active, "recent_sessions": recent,
            "context": context, "tokens": {"session": current.totals if current else {}, **window,
                                           "main": totals([current] if current else []),
                                           "subagents": {"count": len(children), **totals(children.values())}},
            "cli": execution_metrics(tasks, self.store.sessions()), "codex": usage_state(force=force)}


def execution_metrics(tasks, session_state):
    result = {}
    for engine in ("codex", "qoder", "gemini"):
        subset = [row for row in tasks if row["engine"] == engine]
        statuses = Counter(row["status"] for row in subset)
        finished = [row for row in subset if row.get("finished_at") and row.get("started_at")]
        succeeded = sum(statuses[k] for k in ("completed", "review", "accepted"))
        terminal = succeeded + sum(statuses[k] for k in ("failed", "cancelled", "recovery_pending"))
        passive = sum(run["engine"] == engine for s in session_state.get("sessions", {}).values()
                      for run in s.get("passive_cli_runs", []))
        result[engine] = {"tasks": len(subset), "calls": sum(row.get("attempt", 1) for row in subset), "passive": passive,
                          "success_rate": succeeded / terminal if terminal else None, "statuses": statuses,
                          "mean_seconds": sum(max(0, row["finished_at"] - row["started_at"]) for row in finished) /
                          len(finished) if finished else None}
    return result
