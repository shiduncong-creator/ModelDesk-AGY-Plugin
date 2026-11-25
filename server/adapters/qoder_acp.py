"""Qoder's ACP stdio transport. Permission requests remain denied in unattended mode."""

import json
import subprocess
import sys


def run(executable, cwd, session, model, prompt):
    argv = [executable, "--acp", "--permission-mode", "default", "--tools", "",
            "--strict-mcp-config", "--setting-sources", "", "--settings", '{"disableAllHooks":true}']
    if model:
        argv += ["--model", model]
    with subprocess.Popen(argv, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          text=True, encoding="utf-8", errors="replace") as child:
        sequence = 0

        def send(message):
            child.stdin.write(json.dumps({"jsonrpc": "2.0", **message}) + "\n")
            child.stdin.flush()

        def request(method, params):
            nonlocal sequence
            sequence += 1
            send({"id": sequence, "method": method, "params": params})
            for line in child.stdout:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if row.get("method") and "id" in row:
                    if row["method"] == "session/request_permission":
                        send({"id": row["id"], "result": {"outcome": {"outcome": "cancelled"}}})
                    else:
                        send({"id": row["id"], "error": {"code": -32601, "message": "Unsupported method"}})
                elif row.get("method") == "session/update" and method == "session/prompt":
                    update = (row.get("params") or {}).get("update") or {}
                    if update.get("sessionUpdate") in {"agent_message_chunk", "agent_thought_chunk"}:
                        print(json.dumps(update, ensure_ascii=False), flush=True)
                elif row.get("id") == sequence:
                    if "error" in row:
                        raise RuntimeError(f"Qoder ACP {method} 失败")
                    return row.get("result") or {}
            raise RuntimeError("Qoder ACP 提前退出")

        try:
            info = request("initialize", {"protocolVersion": 1, "clientCapabilities": {},
                                          "clientInfo": {"name": "modeldesk", "version": "0.1.0"}})
            if info.get("protocolVersion") != 1:
                raise RuntimeError("Qoder ACP 协议版本不兼容")
            params = {"cwd": cwd, "mcpServers": []}
            if session:
                if not (info.get("agentCapabilities") or {}).get("loadSession"):
                    raise RuntimeError("Qoder ACP 未声明原会话加载能力")
                request("session/load", {**params, "sessionId": session})
            else:
                session = request("session/new", params).get("sessionId")
                if not session:
                    raise RuntimeError("Qoder ACP 未返回会话 ID")
            print(json.dumps({"type": "session", "session_id": session}), flush=True)
            result = request("session/prompt", {"sessionId": session, "prompt": [{"type": "text", "text": prompt}]})
            if result.get("stopReason") != "end_turn":
                raise RuntimeError("Qoder ACP 未正常完成当前轮次")
        finally:
            child.terminate()


if __name__ == "__main__":
    try:
        run(*sys.argv[1:])
    except (OSError, RuntimeError) as error:
        print(str(error) if isinstance(error, RuntimeError) else "Qoder ACP 启动失败", file=sys.stderr)
        sys.exit(1)
