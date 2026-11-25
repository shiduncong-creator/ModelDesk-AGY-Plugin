#!/usr/bin/env bash
set -eu
root="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
cd "$root"
export PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1
for python in "$root/../modeldesk-python/bin/python3.12" "$root/.venv/bin/python" "$(command -v python3.12 || true)" \
  "$HOME/.local/bin/python3.12" "/Applications/模型工作台.app/Contents/Resources/Python/bin/python3.12"; do
  if [[ -x "$python" ]] && "$python" -c 'import sys; assert sys.version_info[:2] == (3, 12); from mcp.server.fastmcp import FastMCP' >/dev/null 2>&1; then
    exec "$python" -m server.main "$@"
  fi
done
printf '%s\n' 'ModelDesk 需要带 MCP SDK 的 Python 3.12。请在插件目录运行 uv sync --python 3.12。' >&2
exit 1
