# 吉米奈的工作台

基于 Antigravity 2.35.0 的独立 macOS 桌面，在原生项目列表和聊天窗口中集成像素工坊、派单状态、实时翻译、MP 上下文、HP 账户额度与文件右键操作。源码中的 ModelDesk 是插件和数据使用的内部名称。

## 获取源码与安装

GitHub 的 **Code → Download ZIP** 提供源码。解压后，包含 `pyproject.toml` 的文件夹就是项目根目录。Apple Silicon 用户可以按[维护交接里的构建步骤](docs/HANDOFF.md)制作 macOS 安装包。

已拿到配套 DMG 的用户，双击「安装吉米奈的工作台」。安装器会从本机读取对应版本的 Google Antigravity，缺少时从 Google 下载，随后安装到个人应用程序目录、固定到 Dock 并启动。本地交付使用 Apple Development 开发签名，其他 Mac 首次打开可能受 Gatekeeper 限制。详细操作见[简明使用说明](docs/简明使用说明.txt)。

Windows 接手者可以在本机 AI 编程工具中打开解压后的源码，按[Windows AI 部署指引](docs/Windows-AI部署指引.md)构建前端、移植系统接口并验收独立安装包。

## 项目入口

| 目录 | 用途 |
| --- | --- |
| `macos/` | 独立桌面、签名构建、图形安装器、Dock 和文件操作助手 |
| `ui/host/`、`ui/src/office/` | 原生主窗口布局、翻译、像素场景、角色与动画 |
| `scripts/` | 宿主版本适配、前端打包、插件和 hooks 启动入口 |
| `server/` | MCP 服务、执行端、历史导入、额度、翻译及文件操作 |
| `ui/src/`、`ui/dist/` | 兼容插件界面及可直接加载的生成文件 |
| `plugin.json`、`mcp_config.json`、`hooks.json`、`hooks/`、`rules/`、`skills/` | Antigravity 插件声明、事件和自然语言派单 |
| `assets/`、`themes/` | 应用图标和主题 |
| `tests/`、`docs/` | 自动回归、简明使用说明、交接与原始设计规格 |

从源码开发、重建交付包、更换上游版本及回归检查的步骤见[维护交接](docs/HANDOFF.md)。

## 许可证

本项目中由贡献者持有并有权授权的原创代码、文档及美术素材采用 MIT 许可证。衍生代码、四套 BotHouse 角色贴图和 Fusion Pixel Font 的原许可与署名见第三方说明。[MIT 许可证](LICENSE) · [第三方声明](THIRD_PARTY.md)
