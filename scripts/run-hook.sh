#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1
for python in ../modeldesk-python/bin/python3.12 .venv/bin/python "$HOME/.local/bin/python3.12" /usr/bin/python3; do
  if [[ -x "$python" ]]; then
    exec "$python" -S ./hooks/sync_hook.py
  fi
done
exec python3 -S ./hooks/sync_hook.py
