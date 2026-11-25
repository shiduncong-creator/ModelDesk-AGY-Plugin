# 在 Windows 上用 AI 部署「吉米奈的工作台」

这份接手包包含 ModelDesk 2.35.2 的完整项目源码和已在 Mac 上使用的像素工坊。**Windows 安装器尚待实现。** 第一次接手需要让能读写本机文件、运行 PowerShell 的编程 AI 完成移植。目标是做出一个可以交给下一位用户双击安装的 Windows 版。

## 接手者只需做三步

1. 在 Windows 资源管理器中右击接手包，选择「全部提取」。使用接手包时打开 `源码` 文件夹；使用 GitHub 的 Download ZIP 时打开名称以 `-main` 结尾的项目文件夹。确认里面有 `README.md` 和 `pyproject.toml`。
2. 在这台 Windows 电脑的编程 AI 中选「打开文件夹」，选择刚才包含 `pyproject.toml` 的项目文件夹。首个目标是 Intel／AMD 的 Windows x64。若「设置 → 系统 → 系统信息 → 系统类型」显示 ARM，请在下一步的提示词首句注明 Windows ARM64。
3. 复制下面整段提示词。AI 可以先构建界面和运行离线测试。用到 Antigravity 或外部 CLI 时，由你在本机完成账号登录；翻译密钥在工作台的「实时翻译卷轴 → 设置」中填写。

## 复制给 AI

```text
请在当前 Windows 电脑上接手「吉米奈的工作台」，默认目标为 Windows x64。先读 docs/Windows-AI部署指引.md 和 docs/HANDOFF.md，检查操作系统架构、源码根目录和 Antigravity App 的实际版本。请直接在这份源码中实现缺少的 Windows 支持，运行命令、修复错误、安装并验证。

交付目标是用户双击安装，从开始菜单打开独立的「吉米奈的工作台」。Google 原版继续独立使用。工作台要保留左侧原生项目和历史会话、中间原生聊天、右侧像素工坊、窗口内右键菜单、可见思考摘要的原位翻译，以及分别显示上下文和账户额度的 MP、HP 槽。接收安装包的人无需自行安装 Python、uv 或 Git Bash。

请按本文的顺序先验证共用界面，再移植后台与桌面。用单独的用户数据目录和临时项目测试。跑一条真实只读 Codex 派单，记录工位从接单到结束的变化。需要登录或填写密钥时，指出我应操作的界面，等我在本机完成。

完成后给出安装包的完整路径、SHA-256、适用架构、实际宿主版本、三步使用说明，并分别列出通过和待验收的功能。遇到阻塞请保留可复现命令和脱敏错误，说明下一步需要什么。
```

## AI 可以立即执行的第一轮检查

在含 `pyproject.toml` 的目录打开 PowerShell。开发机缺少 uv 时，可按官方 Windows 说明安装，例如使用 `winget install --id astral-sh.uv -e`，再重新打开终端。下列命令创建项目虚拟环境，构建兼容插件的两个 HTML 页面，并用测试数据检查宿主网页包的生成。它们是桌面移植的起点。[uv 安装说明](https://docs.astral.sh/uv/getting-started/installation/)

```powershell
Get-Location
Test-Path .\pyproject.toml
uv sync --python 3.12
.\.venv\Scripts\python.exe -X utf8 .\ui\build.py
.\.venv\Scripts\python.exe -X utf8 -m unittest -v tests.test_host_bundle
```

`Test-Path` 应返回 `True`。若返回 `False`，请在包含该文件的项目目录重新打开终端。构建成功会打印 `ui/dist/workbench.html` 和 `ui/dist/task-strip.html` 的大小，测试成功会打印 `OK`。开发机装有 Node.js 时，还可执行 `node tests/host_activity.cjs` 检查派单状态解析。Windows 服务启动和主窗口显示需要完成下表中的移植。

## 移植时从哪里入手

| 顺序 | 查阅源码 | 需要在 Windows 上完成的事 |
| --- | --- | --- |
| 1. 确认桌面基线 | `macos/install-desktop.py`、`scripts/build-host-bundle.py`、`scripts/desktop_runtime235.py` | 在 Google 历史版本页选 **Antigravity App → 2.35.1 → Windows → 对应架构**。记录实际文件版本和发行者。Mac 工程对应 Electron 44.9.1，在 Windows 上先核对宿主及其支持的网页资源加载方式。已装其他版本时先做兼容检查，保留现有安装。 |
| 2. 启动后台及派单 | `server/storage.py`、`hooks/sync_hook.py`、`server/task_runner.py`、`server/adapters/`、`mcp_config.json`、`hooks.json` | 将 `fcntl` 文件锁、进程组终止和 CLI 路径发现适配到 Windows。为 Windows 生成能直接启动随包 Python 的 MCP 和 hook 入口，覆盖带空格及中文的路径。验证任务启动、取消、续接和真实状态回传。 |
| 3. 接回原生窗口和文件 | `ui/host/`、`ui/src/office/`、`macos/desktop-hud.cjs`、`macos/desktop-history.cjs`、`server/desktop_hud.py`、`server/desktop_history.py`、`server/deliverables.py`、`server/translator.py` | 复用已有界面和 HUD 协议，接入 Windows 独立资料目录。实现资源管理器定位、文件路径与 URI 转换、回收站确认、当前用户凭据存储。若 MCP 工具已经列出但主窗口没有工坊，检查桌面布局和 HUD 的挂载。 |
| 4. 做成可交付安装包 | `macos/build-release.py`、`macos/install-release.py`、`tests/release_smoke.py` 是现有发行流程参考 | 新增 Windows 构建和安装入口。打包对应架构的运行时与依赖，使用独立应用目录、资料和开始菜单入口。验证普通用户首次安装、重复安装、升级保留设置及卸载。记录安装包签名状态。 |

桌面下载页有 App、CLI 和 IDE 三种入口，本项目对应 **Antigravity App**。目标版本缺失时，记录可取得的版本及兼容结果。Windows x64 和 ARM64 分别构建、分别验收。[Google 历史版本](https://antigravity.google/releases) · [Google 下载页](https://antigravity.google/download)

## 交付前，让 AI 和接手者一起验这四件事

| 在 Windows 上做的操作 | 应当看到的结果 |
| --- | --- |
| 在干净的普通用户环境双击安装包，从开始菜单打开；退出后再次打开 | 两次都进入独立工作台。能从左侧打开测试历史会话，原版仍可从自己的入口启动。升级后能读回之前保存的工坊设置。 |
| 在临时项目准备一份测试 README，在原生聊天里要求「派给 Codex，只读列出 README 标题」 | 后台任务出现时，工坊中的 Codex 离开空闲态；任务结束后状态同步更新。记录同一任务的宿主状态、工坊状态和时间。 |
| 配置自己的翻译服务并测试连接，找一条确实显示英文思考摘要的消息 | 开启自动翻译后，摘要原位出现中文；打开双语对照能读到原文。只有普通问候的会话可另测助手正文翻译。 |
| 选择有用量记录的会话，展开 MP／HP，在测试文件上右击 | MP 跟随当前会话显示上下文，HP 按账户实际返回的窗口显示额度。缺数据时显示未知或估算说明。文件可在资源管理器中定位，改名或移入回收站时能确认目标。 |

**完成的标志是另一位用户能用安装包从开始菜单进入工作台。** 如果目前只生成了 HTML、只跑通了 MCP，或缺少已登录的账号来验派单和翻译，请在交付记录里写明已经到达哪一步。
