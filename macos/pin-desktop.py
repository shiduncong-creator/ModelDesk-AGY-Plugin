#!/usr/bin/env python3
"""Pin the independent desktop in its existing Dock position after a name or path change."""
from pathlib import Path
import subprocess

if __name__ == "__main__":
    app = Path.home() / "Applications/吉米奈的工作台.app"
    subprocess.run(["/usr/bin/swift", Path(__file__).with_name("PinDesktop.swift"), app], check=True)
