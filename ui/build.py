"""Build the two deterministic, self-contained MCP App resources with Python only."""

from pathlib import Path
import re

UI = Path(__file__).resolve().parent
SRC = UI / "src"
SPRITES = "office/pixel-office-sprites.js"
WORKBENCH_CSS = ("office/pixel-office.css", "workbench.css")
WORKBENCH_JS = (
    "bridge.js", SPRITES, "office/pixel-office-scene.js", "office/pixel-office-events.js",
    "office/pixel-office-motion.js", "office/pixel-office.js", "workbench.js",
)


def build_resource(name, css, js, max_bytes):
    html = (SRC / name).read_text(encoding="utf-8")
    for tag, sources in (("style", css), ("script", js)):
        embedded = []
        for source in sources:
            content = (SRC / source).read_text(encoding="utf-8")
            if re.search(rf"</{tag}[\s>/]", content, re.I):
                raise ValueError(f"Literal closing HTML {tag} in {source}")
            embedded.append(f"<{tag}>\n{content}\n</{tag}>")
        marker = "<!-- INLINE_" + tag.upper() + " -->"
        if html.count(marker) != 1:
            raise ValueError(f"Expected one marker {marker} in {name}")
        html = html.replace(marker, "\n".join(embedded))
    data = html.encode("utf-8")
    if len(data) >= max_bytes:
        raise ValueError(f"{name} exceeds its {max_bytes:,}-byte size budget")
    dest = UI / "dist" / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_suffix(".tmp")
    temp.write_bytes(data)
    temp.replace(dest)
    return len(data)


def build():
    return {
        "workbench.html": build_resource("workbench.html", WORKBENCH_CSS, WORKBENCH_JS, 1536 * 1024),
        "task-strip.html": build_resource(
            "task-strip.html", ("task-strip.css",), ("bridge.js", SPRITES, "task-strip.js"), 600 * 1024
        ),
    }


if __name__ == "__main__":
    for name, size in build().items():
        print(f"ui/dist/{name} · {size:,} bytes")
