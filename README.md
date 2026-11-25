# 吉米奈的工作台

基于 Antigravity 2.35.1 的独立 macOS 桌面，在原生项目列表和聊天窗口中集成像素工坊、派单状态、实时翻译、MP 上下文、HP 账户额度与文件右键操作。源码中的 ModelDesk 是插件和数据使用的内部名称。

## 下载 2.35.2

2.35.2 同步 Antigravity 2.35.1。模型回复使用吉米奈头像，回复下方的复制、评价和时间行与对话框分开。普通项目文件夹支持 Codex 读写派单。

| 你的设备和用途 | 下载 | 拿到后怎么用 |
| --- | --- | --- |
| **Mac · Apple Silicon（M 系列）**，macOS 13 或更新，直接安装使用 | **[下载 macOS 安装包（DMG）](https://github.com/shiduncong-creator/ModelDesk-AGY-Plugin/releases/download/v2.35.2/ModelDesk-2.35.2-macOS-Apple-Silicon.dmg)** | 打开镜像，双击「安装吉米奈的工作台」，完成后从 Dock 启动。 |
| **Windows**，在本机用 AI 接手移植 | **[下载 Windows AI 接手包（ZIP）](https://github.com/shiduncong-creator/ModelDesk-AGY-Plugin/releases/download/v2.35.2/ModelDesk-2.35.2-Windows-AI-Handoff.zip)** | 全部解压，用编程 AI 打开 `源码` 文件夹，复制顶层《Windows-AI部署指引.md》里的提示词。包内含源码和指引，Windows 安装器仍待移植。 |

Mac 安装包使用 Apple Development 开发签名，尚未通过 Apple 公证，首次打开可能被 Gatekeeper 拦截。[macOS 简明使用说明](docs/简明使用说明.txt) · [Windows 部署指引](docs/Windows-AI部署指引.md) · [版本说明与校验值](https://github.com/shiduncong-creator/ModelDesk-AGY-Plugin/releases/tag/v2.35.2)

开发者可以用 **Code → Download ZIP** 获取当前分支源码。解压后，在含 `pyproject.toml` 的目录开始构建。[macOS 构建步骤](docs/HANDOFF.md)

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
