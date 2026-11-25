#!/usr/bin/env python3
"""Build the static web ZIP accepted by Antigravity's -web_bundle_path option."""

import argparse
import base64
from copy import copy
from hashlib import sha256, sha384
from html.parser import HTMLParser
import io
import mmap
import os
from pathlib import Path
import re
import shutil
import struct
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path("/Applications/Antigravity.app/Contents/Resources/bin/language_server")
INSTALLED_DESKTOP_SOURCE = Path.home() / "Applications/吉米奈的工作台.app/Contents/Resources/bin/language_server"
MARK = b"ModelDesk host UI v1 "
RESOURCE_PREFIX = "modeldesk-host/"
END_RECORD = struct.Struct("<4s4H2LH")


def original_bundle(path):
    """Select the compiled UI by its own ZIP directory, independent of binary offsets."""
    with path.open("rb") as file, mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as data:
        matches = []
        for hit in re.finditer(rb"PK\x05\x06", data):
            end = hit.start()
            if end + END_RECORD.size > len(data):
                continue
            _, disk, central_disk, local_count, count, size, relative, comment = END_RECORD.unpack_from(data, end)
            start = end - size - relative
            limit = end + END_RECORD.size + comment
            if (disk or central_disk or not count or count != local_count or start < 0 or limit > len(data)
                    or data[start:start + 4] != b"PK\x03\x04" or data[end - size:end - size + 4] != b"PK\x01\x02"):
                continue
            raw = data[start:limit]
            with zipfile.ZipFile(io.BytesIO(raw)) as candidate:
                names = set(candidate.namelist())
                if {"index.html", "main.js", "jetbox.css", "compiled_tailwind.css"} <= names:
                    matches.append(raw)
        if len(matches) != 1:
            raise ValueError(f"需要唯一的 Antigravity 网页资源 ZIP，找到 {len(matches)} 份")
        return matches[0]


class Entry(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.lines = [0, *(m.end() for m in re.finditer(r"\n", source))]
        self.ends = {}
        self.scripts = []
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.scripts.append(dict(attrs).get("src"))

    def handle_endtag(self, tag):
        if tag in ("head", "body"):
            line, col = self.getpos()
            self.ends.setdefault(tag, []).append(self.lines[line - 1] + col)


def add_references(html, style, menu):
    parser = Entry(html)
    if (parser.scripts.count("/main.js") != 1 or len(parser.ends.get("head", [])) != 1
            or len(parser.ends.get("body", [])) != 1 or RESOURCE_PREFIX in html):
        raise ValueError("上游入口结构已变化，或已经包含 ModelDesk；请提供原始网页包")
    location = {tag: pos[0] for tag, pos in parser.ends.items()}
    if location["head"] >= location["body"]:
        raise ValueError("上游页面 head/body 顺序异常")
    for pos, tag in [(location["body"], f'<script defer src="/{menu[0]}" integrity="{menu[1]}"></script>'),
                     (location["head"], f'<link rel="stylesheet" href="/{style[0]}" integrity="{style[1]}" />')]:
        html = html[:pos] + tag + "\n  " + html[pos:]
    return html


def resource(name, content):
    digest = sha256(content).hexdigest()[:24]
    filename = Path(name)
    url = RESOURCE_PREFIX + filename.stem + "." + digest + filename.suffix
    integrity = "sha384-" + base64.b64encode(sha384(content).digest()).decode("ascii")
    return url, integrity


def build(source, output, assets=ROOT / "ui/host", desktop=None, reproducible=False):
    if source.resolve() == output.resolve():
        raise ValueError("输出位置须与原始文件不同")
    raw = original_bundle(source)
    art = {}

    def embed_art(match):
        name = match[1].decode("ascii")
        content = (assets / "art" / name).read_bytes()
        path = Path(name)
        if path.suffix == ".woff2":
            signature = b"wOF2"
            notice = path.stem + "-license.txt"
            art[RESOURCE_PREFIX + "art/" + notice] = (assets / "art" / notice).read_bytes()
        else:
            signature = b"\x89PNG\r\n\x1a\n"
        if not content.startswith(signature):
            raise ValueError(f"主题资源格式错误: {name}")
        leaf = f"{path.stem}.{sha256(content).hexdigest()[:24]}{path.suffix}"
        art[RESOURCE_PREFIX + "art/" + leaf] = content
        return f'url("art/{leaf}")'.encode("ascii")

    style = (assets / "theme.css").read_bytes()
    menu = (assets / "menu.js").read_bytes()
    if desktop:
        components, layout = desktop.client_assets(assets)
        style += b"\n" + layout
        menu += b"\n;\n" + components
    style = re.sub(rb'url\("art/([a-z0-9_-]+\.(?:png|woff2))"\)', embed_art, style)
    if not style.strip() or not menu.strip():
        raise ValueError("ModelDesk 主题或菜单为空")
    links = [resource("theme.css", style), resource("menu.js", menu)]
    with zipfile.ZipFile(io.BytesIO(raw)) as upstream:
        names = upstream.namelist()
        if (upstream.comment.startswith(MARK) or any(n.startswith(RESOURCE_PREFIX) for n in names)
                or len(set(names)) != len(names)):
            raise ValueError("上游网页包包含重复资源或已有 ModelDesk 修改")
        html = add_references(upstream.read("index.html").decode("utf-8"), *links)
        main = desktop.integrate(upstream.read("main.js"), assets) if desktop else None
        if main is not None:
            main_tag = '<script src="/main.js"></script>'
            integrity = resource("main.js", main)[1]
            html = desktop.replace_one(html, main_tag, f'<script src="/main.js" integrity="{integrity}"></script>')
        html = html.encode("utf-8")
        fingerprint = sha256(raw + html + b"".join(sha256(art[name]).digest() for name in sorted(art))).hexdigest().encode("ascii")
        expected = MARK + (b"stored-" if reproducible else b"") + fingerprint
        output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if output.is_symlink():
            raise ValueError("输出位置是符号链接")
        if output.exists():
            with zipfile.ZipFile(output) as previous:
                if not previous.comment.startswith(MARK):
                    raise ValueError("指定的输出文件已有其他内容")
                if previous.comment == expected and previous.testzip() is None:
                    return
        with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as temp:
            temporary = Path(temp.name)
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as new:
                for info in upstream.infolist():
                    output_info = copy(info)
                    if reproducible:
                        output_info.compress_type = zipfile.ZIP_STORED
                    if info.filename == "index.html":
                        new.writestr(output_info, html)
                    elif main is not None and info.filename == "main.js":
                        new.writestr(output_info, main)
                    else:
                        with upstream.open(info) as reader, new.open(output_info, "w") as writer:
                            shutil.copyfileobj(reader, writer)
                # Fixed timestamp and stored entries let a recipient recreate the
                # exact signed files, including on systems with a different zlib.
                additions = {links[0][0]: style, links[1][0]: menu, **art}
                for name, content in additions.items():
                    new.writestr(zipfile.ZipInfo(name) if reproducible else name, content)
                new.comment = expected
            with zipfile.ZipFile(temporary) as check:
                if check.testzip() is not None or check.read("index.html") != html:
                    raise ValueError("生成的网页包校验失败")
            os.replace(temporary, output)
        finally:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="language_server or its original web ZIP")
    parser.add_argument("--desktop", action="store_true", help="构建带原生工坊、上下文和翻译的独立桌面")
    parser.add_argument("--reproducible", action="store_true", help="生成供签名分发复原的确定性 ZIP")
    dest = parser.add_mutually_exclusive_group(required=True)
    dest.add_argument("--output", type=Path, help="private output .zip path")
    dest.add_argument("--output-dir", type=Path, help="directory to receive modeldesk-host-ui.zip")
    args = parser.parse_args()
    output = args.output or args.output_dir / "modeldesk-host-ui.zip"
    try:
        import desktop_layout
        source = args.source or (INSTALLED_DESKTOP_SOURCE if args.desktop and INSTALLED_DESKTOP_SOURCE.is_file() else DEFAULT_SOURCE)
        build(source, output, desktop=desktop_layout if args.desktop else None, reproducible=args.reproducible)
    except (ValueError, OSError, zipfile.BadZipFile) as exc:
        parser.exit(1, f"{exc}\n")
    print(output.resolve())


if __name__ == "__main__":
    main()
