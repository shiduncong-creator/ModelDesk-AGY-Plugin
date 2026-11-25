# 吉米奈的工作台 · 项目交接

发行基线为 Antigravity 2.35.0、Electron 44.9.1、Apple Silicon。普通用户使用 DMG。源码 ZIP 是可独立解压的工程快照，包含前端原稿、预构建插件页面、服务、回归用例和生成发行包所需的代码。

Windows 移植从[Windows AI 部署指引](Windows-AI部署指引.md)开始，其中附有给接手 AI 的提示词、PowerShell 命令和目标机验收样例。

## 从用户入口追到源码

| 用户看到的功能 | 维护入口 |
| --- | --- |
| Dock 启动、独立资料、历史会话 | `macos/install-desktop.py`、`macos/PinDesktop.swift`、`macos/desktop-history.cjs`、`server/desktop_history.py` |
| 工坊角色、空闲动画、派单状态 | `ui/src/office/`、`ui/host/workshop.js`、`ui/host/native-activity.js`、`scripts/desktop_runtime235.py`；插件派单见 `server/task_runner.py` 和 `server/adapters/` |
| 翻译卷轴、可见思考摘要原位翻译 | `ui/host/insights.js`、`ui/host/inline-thoughts.js`、`scripts/desktop_thoughts.py`、`server/thought_stream.py`、`server/translator.py` |
| MP、HP、本轮产物 | `ui/host/native-slots.js`、`server/desktop_hud.py`、`server/context_inspector.py`、`server/deliverables.py` |
| 窗口内右键、文件操作 | `ui/host/menu.js`、`macos/FileActions.swift`、`server/host_menu.py` |
| 安装与打包 | `macos/build-release.py` 生成交付物；`ReleaseInstaller.swift` 显示进度，`install-release.py` 安装并校验桌面 |

原生宿主通过限定的 IPC 方法访问本机 HUD，MCP 另以 stdio 提供自然语言派单。用户可以单独安装并登录需要的外部 CLI，翻译服务由每位用户自行配置。

## 数据与升级

- 桌面应用位于 `~/Applications/吉米奈的工作台.app`。应用标识为 `org.modeldesk.antigravity.desktop`。更新时沿用旧 Dock 位置，也可迁移 `~/Applications/ModelDesk.app`。
- 会话与插件数据分别在 `~/.gemini/antigravity-modeldesk/` 及其 `plugin_data/modeldesk-workbench/`，桌面窗口资料在 `~/Library/Application Support/ModelDesk Desktop/`。启动时会导入本机原版已结束且符合条件的历史会话。配置、历史和密钥都属于当前用户。
- 安装器将 `~/.gemini/config/plugins/modeldesk-workbench` 指向随桌面安装的插件。已有独立开发用 ModelDesk 插件时会沿用并提示。此插件注册目录由原版和工作台共用。
- 替换前检查目标应用标识及运行状态。成功升级后，上一版 Contents 保存在 `~/Library/Caches/ModelDeskBuild/previous-*/Contents`。恢复旧发行版优先使用对应的已签名安装包，先退出工作台。
- 新系统上账户授权、外部 CLI 登录、云翻译密钥、首次 Google 登录与各模型返回的额度均需用接收者自己的账户验收。

## 开发与测试

在源码根目录执行。开发需要 Python 3.12，协议回归还会使用 Node.js，真实界面回归需要 Chrome。普通安装所需的 Python、MCP 依赖、文件助手和 Dock 助手均已随发行包提供。

```sh
uv sync --python 3.12
.venv/bin/python ui/build.py
.venv/bin/python -m unittest discover -s tests -t .
node tests/host_activity.cjs
```

图形回归入口可在 `tests/host_*_dom.cjs` 中查找。可用 `agy plugin validate --strict .` 校验插件声明。设计背景见[架构与执行端契约](ARCHITECTURE_AND_SPEC.md)和[桌面 HUD 规格](V2_DESKTOP_HUD_SPEC.md)，其中的规划及历史版本号用作设计参考。

## 从源码生成交付包

1. 准备 Apple Silicon Mac、Xcode Command Line Tools、uv、可用的代码签名身份和 Google 原版 Antigravity 2.35.0。将原版安装到 `/Applications/Antigravity.app`。
2. 从 Electron 官方 44.9.1 发行页下载 `electron-v44.9.1-darwin-arm64.zip`。构建器核对固定 SHA-256；也会校验 Google 签名及版本。首次运行需要网络下载 Python 发行版和锁定的 wheels。
3. 在源码根目录执行下面的命令，指定空的外部输出目录。多个签名身份时，增加 `--identity` 并填写证书全名。构建不会安装到发布机的 Dock。

```sh
uv python install 3.12.14
python3 ui/build.py
python3 -B macos/build-release.py --electron-zip ~/Downloads/electron-v44.9.1-darwin-arm64.zip --output ../工作台交付
```

输出含安装 DMG、源码 ZIP、简明使用说明与 SHA256SUMS.txt。可在交付目录运行 `shasum -a 256 -c SHA256SUMS.txt`。镜像内也带有源码和简明说明。Electron 和字体等组件保留各自的许可声明。当前本地交付使用 Apple Development 签名；面向陌生 Mac 正式分发须准备 Developer ID Application，对最终桌面及安装器完成 Apple 公证，并从带下载标记的镜像验证首次打开。开发签名校验通过和 Apple 公证是两项独立检查。

## 上游更新与交付验收

运行 `python3 macos/install-desktop.py --check-compatibility` 可检查本机上游桌面、前端结构及事件字段。若要发布新版本，更新固定下载版本、官方镜像 SHA-256、Apple Silicon 代码签名 CDHash 及适配器；Electron 升级还须更新 SDK 版本及摘要。重新构建并签名后再发布。当前安装器只使用已验证的精确版本。

挂载生成的镜像后，可在源码根目录执行发行冒烟验收。它从 Google 下载组件，在临时用户目录完成首次安装及覆盖安装，核对配置、插件、HUD、文件助手和签名，最后自动清理。实际 Dock 与首次登录另行实测。

```sh
python3 tests/release_smoke.py "/Volumes/吉米奈的工作台 2.35.0/安装吉米奈的工作台.app"
```

用新账户从 Dock 打开，派一个实际任务观察 Codex 的运行和结束，展开一条带可见思考摘要的消息，核对 MP 和 HP，再用文件右键做一次预览。确认外部 CLI、翻译帐号和模型均为测试方所有。

## 本次交付的验证记录（2026-11-25）

在 Apple Silicon Mac 的空白临时用户目录，从镜像安装器实际下载官方 2.35.0、重建桌面并校验签名。第二次安装复用本机原版，原应用目录和测试偏好得到保留。随包 Python 启动 HUD 成功，文件助手通过自检，插件完成 stdio 握手并列出 17 项工具。源码在 Git 仓库外解压后，88 项 Python 测试与 18 项前端协议测试通过。Chromium 另行验证了工坊、思考摘要、用量、文件菜单和 Overview。

本次隔离验收止于桌面文件安装与服务启动。另一台 Mac 的首次登录和首次从 Dock 启动仍属于目标机验收。安装器的本机 `codesign --verify --deep --strict` 通过；公开分发评估 `spctl --assess --type execute` 返回 `rejected`。公开发行的后续步骤是使用 Developer ID Application 签名并完成 Apple 公证。

[Electron 官方发行页](https://github.com/electron/electron/releases/tag/v44.9.1) · [Google Antigravity 版本](https://antigravity.google/releases) · [Apple Developer ID 与公证](https://developer.apple.com/developer-id/)
