"""A deterministic local CLI stand-in for process/signal and stdio integration tests."""

import json
from pathlib import Path
import sys
import time

args = sys.argv[1:]


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def acp():
    session = "session-qoder-001"
    for line in sys.stdin:
        message = json.loads(line)
        method, params = message["method"], message["params"]
        if method == "initialize":
            result = {"protocolVersion": 1, "agentCapabilities": {"loadSession": True}}
        elif method == "session/new":
            result = {"sessionId": session}
        elif method == "session/load":
            assert params["sessionId"] == session
            result = {}
        elif method == "session/prompt":
            assert params["sessionId"] == session
            emit({"jsonrpc": "2.0", "id": 901, "method": "session/request_permission", "params": {}})
            reply = json.loads(sys.stdin.readline())
            assert reply["result"]["outcome"]["outcome"] == "cancelled"
            emit({"jsonrpc": "2.0", "method": "session/update", "params": {
                "sessionId": session, "update": {"sessionUpdate": "agent_message_chunk", "content": {
                    "type": "text", "text": "ACP reply",
                }},
            }})
            result = {"stopReason": "end_turn"}
        else:
            raise AssertionError(method)
        emit({"jsonrpc": "2.0", "id": message["id"], "result": result})
        if method == "session/prompt":
            return


if "--acp" in args:
    acp()
    sys.exit(0)
if "--version" in args:
    print("0.99.0")
    sys.exit(0)
prompt = args[-1]
Path("calls.txt").open("a").write(json.dumps(args) + "\n")
if "--resume" in args:
    assert args[args.index("--resume") + 1] == "session-original-001"
    emit({"session_id": "session-original-001", "response": "原会话续接完成"})
elif prompt == "crash-early":
    Path("partial.txt").write_text("unfinished\n")
    print("crashed before native session", flush=True)
    sys.exit(7)
elif prompt == "crash-with-session":
    emit({"session_id": "session-original-001"})
    Path("partial.txt").write_text("first attempt\n")
    sys.exit(6)
elif prompt.startswith("hold"):
    emit({"session_id": "session-original-001"})
    print("holding", flush=True)
    time.sleep(20 if "forever" in prompt else 1.4)
    print("survived", flush=True)
else:
    emit({"session_id": "session-checkpoint-002", "response": "checkpoint complete"})
