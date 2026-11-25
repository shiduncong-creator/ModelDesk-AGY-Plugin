#!/usr/bin/env bash
set -eu
root="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
plugins="$HOME/.gemini/config/plugins"
target="$plugins/modeldesk-workbench"
[[ -s "$root/ui/dist/workbench.html" && -s "$root/ui/dist/task-strip.html" ]] || { printf '%s\n' '请先运行 python3.12 ui/build.py。' >&2; exit 1; }
mkdir -p -- "$plugins"
if [[ -L "$target" && "$(readlink "$target")" == "$root" ]]; then
  printf '插件已链接 %s\n' "$target"
elif [[ -e "$target" || -L "$target" ]]; then
  printf '已有其他插件目录或链接 %s\n' "$target" >&2
  exit 1
else
  ln -s -- "$root" "$target"
  printf '已创建插件链接 %s\n' "$target"
fi
