#!/usr/bin/env python3
"""Apply or restore ModelDesk's palettes through Antigravity's native user settings."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import stat
import tempfile

THEMES = Path(__file__).resolve().parents[1] / "themes"
CONFIG = Path.home() / ".gemini/config/config.json"
STATE = Path.home() / ".gemini/antigravity/plugin_data/modeldesk-workbench/host-theme"
FIELDS = {
    "background": "background",
    "foregroundOverride": "foreground",
    "primary": "primary",
    "primaryForegroundOverride": "primaryForeground",
    "codeForegroundOverride": "codeForeground",
}


def palettes():
    result = {}
    for filename in ("warm-parchment.json", "night-sky.json"):
        theme = json.loads((THEMES / filename).read_text())
        result["customThemeSeeds" + theme["mode"].capitalize()] = {
            name: theme["seeds"][source] for name, source in FIELDS.items()
        }
    return result


def atomic_json(path, data, mode, previous=None):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temp = Path(stream.name)
    try:
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        temp.chmod(mode)
        if previous is not None and path.read_bytes() != previous:
            raise ValueError("Antigravity updated its settings. Retry to use the latest file.")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def configure(action, config=CONFIG, state=STATE):
    wanted = palettes()
    if action == "status":
        settings = json.loads(config.read_bytes())["userSettings"]
        return {
            "matches": {key: settings.get(key) == value for key, value in wanted.items()},
            "themeMode": settings.get("themeMode", "default"),
            "restoreAvailable": (state / "previous.json").exists(),
        }
    state.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (state / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        original = config.read_bytes()
        data = json.loads(original)
        settings = data["userSettings"]
        current = {k: settings[k] for k in wanted if k in settings}
        backup = state / "previous.json"
        if action == "restore" and not backup.exists():
            return "No saved ModelDesk palette to restore."
        saved = json.loads(backup.read_text()) if backup.exists() else None
        if saved:
            # Keep intervening edits from the Appearance panel intact.
            for key in wanted:
                if current.get(key) not in (saved["applied"].get(key), saved["before"].get(key), wanted[key]):
                    raise ValueError(f"{key} was edited independently. Keep or resolve that edit first.")
        if action == "apply":
            if current == wanted:
                return "ModelDesk palettes are active."
            if not saved:
                saved = {"before": current, "applied": wanted}
                atomic_json(backup, saved, 0o600)
            settings.update(wanted)
        else:
            for key in wanted:
                settings.pop(key, None)
            settings.update(saved["before"])
        atomic_json(config, data, stat.S_IMODE(config.stat().st_mode), original)
        if action == "restore":
            backup.unlink()
        elif saved["applied"] != wanted:
            atomic_json(backup, {"before": saved["before"], "applied": wanted}, 0o600)
        return "Applied ModelDesk palettes." if action == "apply" else "Restored previous palettes."


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("apply", "restore", "status"))
    try:
        result = configure(parser.parse_args().action)
        print(json.dumps(result, ensure_ascii=False) if isinstance(result, dict) else result)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(1, f"{exc}\n")
