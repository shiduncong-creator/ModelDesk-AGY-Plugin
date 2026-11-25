"""Incrementally scan Antigravity JSONL, retaining counters and small summaries."""

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
import heapq
import json
import math
import os
import re
import threading


TOKEN_FIELDS = ("input_tokens", "cache_read_tokens", "output_tokens")
STEP_TYPES = {"USER_INPUT", "PLANNER_RESPONSE", "TOOL_RESULT", "TOOL_CALL", "GENERIC", "CHECKPOINT"}
MODEL_WINDOW_DEFAULT = 200_000
MODEL_WINDOWS = (
    (re.compile(r"gemini[\s_-]*[234](?!\d)"), 512_000),
    (re.compile(r"claude|gpt[\s_-]*[56](?!\d)|codex|\bo[34](?!\d)"), 200_000),
    (re.compile(r"gpt[\s_-]*4(?!\d)|deepseek|qwen"), 128_000),
)
BOOKS = (("道德经", 8_000), ("小王子", 22_000), ("老人与海", 35_000),
         ("哈利·波特与魔法石", 100_000), ("双城记", 187_000), ("三体", 202_000),
         ("红楼梦", 730_000))
UUID = re.compile(r"(?<![\w-])[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\w-])", re.I)
CJK = re.compile(r"[\u3400-\u9fff\u3040-\u30ff]")
MAX_LINE = 16 * 1024 * 1024


def labeled_window(model_name):
    match = re.search(r"(?<![\w.])(\d+(?:\.\d+)?)\s*([km])(?:\s*(?:tokens?|context))?\b",
                      model_name or "", re.I)
    if match:
        size = round(float(match[1]) * (1000 if match[2].lower() == "k" else 1_000_000))
        return size if 0 < size <= 20_000_000 else None
    return None


def infer_context_window(model_name: str) -> int:
    return labeled_window(model_name) or next((size for pattern, size in MODEL_WINDOWS if pattern.search(model_name.casefold())),
                MODEL_WINDOW_DEFAULT)


def book_yardstick(used_tokens: int) -> dict:
    title, size = next((book for book in reversed(BOOKS) if used_tokens >= book[1]), BOOKS[0])
    multiple = round(max(0, used_tokens) / size, 1)
    return {"title": title, "multiple": multiple, "label": f"《{title}》×{multiple:.1f}"}


def is_subagent(name):
    return isinstance(name, str) and name.casefold().split(".")[-1] == "invoke_subagent"


def collect_ids(values):
    ids = set()
    for value in values:
        if isinstance(value, dict):
            for key, item in value.items():
                key = str(key).replace("_", "").lower()
                if key in {"conversationid", "subagentid", "childconversationid", "trajectoryid", "agentid"}:
                    if isinstance(item, str) and UUID.fullmatch(item):
                        ids.add(item.lower())
                elif key in {"result", "output", "subagent", "agent", "children", "toolresult"}:
                    ids.update(collect_ids([item]))
        elif isinstance(value, list):
            ids.update(collect_ids(value))
        elif isinstance(value, str):
            text = value.strip()
            if UUID.fullmatch(text):
                ids.add(text.lower())
            elif text.startswith(("{", "[")):
                try:
                    ids.update(collect_ids([json.loads(text)]))
                except ValueError:
                    pass
            else:
                for match in re.finditer(r"(?:subagent|conversation|trajectory)[_ -]?id[\s:=\"'<>]*("
                                         + UUID.pattern + ")", text, re.I):
                    ids.add(match[1].lower())
    return ids


def local_day(date):
    if isinstance(date, str):
        try:
            return datetime.fromisoformat(date.replace("Z", "+00:00")).astimezone().date().isoformat()
        except ValueError:
            pass
    if isinstance(date, (int, float)):
        try:
            return datetime.fromtimestamp(date).date().isoformat()
        except (OSError, ValueError, OverflowError):
            pass
    return None


def int_count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def estimate(text):
    cjk = sum(1 for _ in CJK.finditer(text))
    return cjk + math.ceil((len(text) - cjk) / 4)


def compact_summary(value):
    if isinstance(value, str):
        return " ".join(value[:260].split())[:200]
    return ""


@dataclass
class Transcript:
    identity: tuple | None = None
    mtime: int = 0
    offset: int = 0
    anchor: bytes = b""
    latest: dict = field(default_factory=dict)
    top: list = field(default_factory=list)
    totals: dict = field(default_factory=dict)
    days: dict = field(default_factory=dict)
    tool_queue: list = field(default_factory=list)
    subagent_calls: set = field(default_factory=set)
    subagent_ids: set = field(default_factory=set)
    thoughts: dict = field(default_factory=dict)
    model: str | None = None
    index: int = 0
    model_windows: dict = field(default_factory=dict)

    def record_translation_block(self, row, step, timestamp, model, kind, fields):
        for name in fields:
            text = row.get(name)
            if isinstance(text, str) and text.strip():
                break
        else:
            return
        slot = (step, kind)
        self.thoughts.pop(slot, None)
        self.thoughts[slot] = {
            "step": step, "kind": kind, "timestamp": timestamp, "model": model,
            "hash": sha256(text.encode("utf-8", "replace")).hexdigest()[:16],
            "text": text[:6000],
            "truncated": len(text) > 6000 or name in (row.get("truncated_fields") or []),
        }
        if len(self.thoughts) > 30:
            del self.thoughts[next(iter(self.thoughts))]

    def take(self, row):
        kind = str(row.get("type") or row.get("stepType") or "").upper()
        if kind not in STEP_TYPES:
            return
        self.index += 1
        step = row.get("step_index", row.get("stepIdx", self.index))
        timestamp = row.get("created_at", row.get("timestamp"))
        usage = row.get("usage")
        usage = usage if isinstance(usage, dict) else row
        visible = row.get("userVisible") is not False and row.get("visibility") not in ("private", "hidden")
        if kind == "PLANNER_RESPONSE":
            if row.get("model"):
                self.model = str(row["model"])[:128]
            model = self.model or "未知模型"
            if visible:
                self.record_translation_block(row, step, timestamp, model, "summary",
                                              ("thinking_summary", "thinkingSummary", "thinking"))
                self.record_translation_block(row, step, timestamp, model, "reply", ("content",))
            for source in (usage, row):
                for key in ("context_window_tokens", "contextWindowTokens", "model_context_window",
                            "contextWindowSize", "context_window", "maxContextTokens"):
                    size = int_count(source.get(key))
                    if 0 < size <= 20_000_000:
                        self.model_windows[model] = size
                        break
        if kind in {"PLANNER_RESPONSE", "CHECKPOINT"} and any(key in usage for key in TOKEN_FIELDS):
            numbers = {key: int_count(usage.get(key)) for key in TOKEN_FIELDS}
            if kind == "PLANNER_RESPONSE":
                self.latest = {"model": model, **numbers, "step": step, "timestamp": timestamp}
            else:
                model = str(row.get("model") or "检查点（模型未记录）")
            self.totals.setdefault(model, Counter()).update(numbers)
            if day := local_day(timestamp):
                self.days.setdefault(day, {}).setdefault(model, Counter()).update(numbers)
        if not visible:
            return
        calls = row.get("tool_calls") or []
        if isinstance(calls, list) and calls:
            self.tool_queue = []
            for call in calls:
                if not isinstance(call, dict):
                    continue
                name = compact_summary(call.get("name") or call.get("toolName"))
                raw_args = call.get("args") or {}
                if is_subagent(name):
                    self.subagent_ids.update(collect_ids(
                        call.get(key) for key in ("args", "arguments", "result", "tool_result", "output")
                    ))
                    call_id = call.get("id") or call.get("tool_call_id") or call.get("toolCallId")
                    if isinstance(call_id, str):
                        self.subagent_calls.add(call_id)
                if isinstance(raw_args, str):
                    try:
                        raw_args = json.loads(raw_args)
                    except ValueError:
                        raw_args = {}
                args = raw_args if isinstance(raw_args, dict) else {}
                detail = next((compact_summary(args[k]) for k in (
                    "Path", "FilePath", "TargetFile", "AbsolutePath", "CommandLine", "path", "command"
                ) if k in args), "")
                self.tool_queue.append((name, detail))
        display_fields = ("content", "tool_calls", "tool_result", "result", "output", "message")
        content = "\n".join(row[key] if isinstance(row[key], str) else json.dumps(row[key], ensure_ascii=False)
                            for key in display_fields
                            if row.get(key))
        tools = ", ".join(name for name, _ in self.tool_queue if name) if calls else ""
        detail = " · ".join(value for _, value in self.tool_queue if value)[:230] if calls else ""
        if kind in {"GENERIC", "TOOL_RESULT"} and self.tool_queue:
            tools, detail = self.tool_queue.pop(0)
        nested = row.get("toolCall") or row.get("tool_call")
        nested = nested if isinstance(nested, dict) else {}
        named = row.get("tool_name") or row.get("toolName") or nested.get("name") or nested.get("toolName")
        call_id = row.get("tool_call_id") or row.get("toolCallId") or nested.get("id")
        if (is_subagent(named) or isinstance(call_id, str) and call_id in self.subagent_calls
                or kind in {"GENERIC", "TOOL_RESULT"} and not named and not call_id and is_subagent(tools)):
            self.subagent_ids.update(collect_ids(
                row.get(key) for key in ("args", "arguments", "parameters", "toolCall", "tool_call",
                                         "tool_result", "toolResult", "result", "output", "content", "message")
            ))
        tokens = estimate(content)
        if tokens:
            data = {"step": step, "type": kind, "tool": compact_summary(named) or tools,
                    "summary": "上下文压缩" if kind == "CHECKPOINT" else detail or compact_summary(content),
                    "estimated_tokens": tokens}
            heapq.heappush(self.top, (tokens, self.index, data))
            if len(self.top) > 10:
                heapq.heappop(self.top)


class ContextInspector:
    def __init__(self):
        self.cache = {}
        self.lock = threading.RLock()

    def scan(self, path):
        with self.lock:
            try:
                with path.open("rb") as file:
                    stat = os.fstat(file.fileno())
                    state = self.cache.get(path)
                    identity = (stat.st_dev, stat.st_ino)
                    if state and state.identity == identity and state.offset <= stat.st_size:
                        file.seek(state.offset - len(state.anchor))
                        if file.read(len(state.anchor)) != state.anchor:
                            state = None
                    else:
                        state = None
                    if state is None:
                        state = self.cache[path] = Transcript(identity=identity)
                    elif state.mtime == stat.st_mtime_ns:
                        return state
                    file.seek(state.offset)
                    while line := file.readline(MAX_LINE + 1):
                        if len(line) > MAX_LINE:
                            while line and not line.endswith(b"\n"):
                                line = file.readline(MAX_LINE + 1)
                            if not line:
                                break
                        elif not line.endswith(b"\n"):
                            break
                        else:
                            try:
                                row = json.loads(line)
                                if isinstance(row, dict):
                                    state.take(row)
                            except (ValueError, TypeError, AttributeError):
                                pass
                        state.offset = file.tell()
                    file.seek(max(0, state.offset - 128))
                    state.anchor = file.read(min(128, state.offset))
                    state.mtime = stat.st_mtime_ns
                    return state
            except OSError:
                return Transcript()

    @staticmethod
    def context(state, limit=None, threshold=.75, model=None):
        latest = dict(state.latest)
        if state.model and latest.get("model") not in (None, "未知模型", state.model):
            latest = {}
        model = state.model or model or latest.get("model") or "未知模型"
        manual = type(limit) is int and limit > 0
        basis = "manual"
        if not manual:
            if model in state.model_windows:
                limit, basis = state.model_windows[model], "reported"
            else:
                limit = infer_context_window(model)
                basis = "model_label" if labeled_window(model) else "estimate"
        total = latest.get("input_tokens", 0) + latest.get("cache_read_tokens", 0)
        ratio = total / limit if latest else None
        return {"latest": latest, "model": model, "window_tokens": limit, "used_tokens": total,
                "window_source": "manual" if manual else "auto", "window_basis": basis, "book": book_yardstick(total),
                "ratio": ratio, "cache_hit_rate": latest.get("cache_read_tokens", 0) / total if total else None,
                "top": [row for _, _, row in sorted(state.top, reverse=True)],
                "advice": "建议输入 /compact 压缩上下文" if ratio is not None and ratio >= threshold else None}
