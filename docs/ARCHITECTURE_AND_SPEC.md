# ModelDesk Workbench (Antigravity Plugin) — 架构设计、协议契约与开发规范

> 文档版本：v1.0（2026-11-24）  
> 目标仓库：`ModelDesk-AGY-Plugin`
> 目标安装目录：`~/.gemini/config/plugins/modeldesk-workbench/`  
> 参考资产基线：`ModelDesk-macOS-office-preview`（分支 `feat/unified-pixel-preview`，提交 `97f10b9`）

---

## 1. 背景与核心定位

本插件彻底改变原先「独立外部工作台壳子探测 Antigravity 桌面端进程」的思路，转为 **Google Antigravity 2.0 原生插件（Plugin + MCP App + Lifecycle Hooks + Skills + Rules）**：

- **Antigravity 本体即主模型与主对话窗**：完全复用 Antigravity 原生聊天、文件 Diff、终端沙箱、Browser、图片上传、子代理与斜杠命令。
- **双宿主视图挂载**：通过 MCP Apps（SEP-1865 + Antigravity 扩展）将工作台 UI 同时挂载至：
  - **右侧辅助栏（`aux_pane`）**：宽 360–460px，边对话边监控像素办公室、交付产物、实时上下文与即时翻译；
  - **左侧边栏全屏（`global`）**：宽屏总览工作台（像素工坊 + 产物中心 + 用量与翻译并排展示）；
  - **对话内联卡片（inline）**：派单或打开工作台工具结果可直接内联或自动唤起侧栏。
- **零侵入、合规安全**：严格使用 Antigravity 官方文档化的 `plugin.json`、`mcp_config.json`、`hooks.json`、`transcript.jsonl` 与 MCP Apps 协议；**严禁探测宿主 `language_server` 内部受保护接口、严禁绕过权限检查或硬编码宿主版本号**。

---

## 2. 目标开发与运行环境（已于本机实测）

| 组件 | 实测路径 / 版本 | 备注 |
| :--- | :--- | :--- |
| **Python / uv** | `~/.local/bin/uv` (`0.12.18`), Python 3.12 | 推荐使用 `uv` 管理插件独立虚拟环境，或兼容 `~/.local/bin/python3.12` |
| **Python MCP SDK** | `mcp` (`FastMCP`) | 已验证 `FastMCP.tool(..., meta=..., structured_output=...)` 与 `FastMCP.resource(..., mime_type=..., meta=...)` 原生可用 |
| **Codex CLI** | `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` (`0.171.0-alpha.13`) | 同时自动回退探测 `PATH`、`/Applications/Codex.app/Contents/Resources/codex` |
| **Qoder CN CLI** | `~/.local/bin/qoderclicn` (`1.1.93`) | 支持 `--resume`、`--session-id`、`--continue` 与 ACP 协议 |
| **Antigravity CLI** | `~/.local/bin/agy` | 支持 `-r / --resume`、`-c / --continue`、`--model`、`--mode` |
| **Gemini CLI** | `@google/gemini-cli`（可选） | 本机暂未安装全局 `node`/`gemini`；适配器须预置探测并在就绪时自动启用，缺失时提示安装且可用 `agy` 或 Gemini API 兜底 |
| **像素办公室参考资产** | `ModelDesk-macOS-office-preview/.local-worker/panel/` | `pixel-office-scene.js`、`pixel-office-motion.js`、`pixel-office-sprites.js`、`pixel-office.js`、`pixel-office.css` |
| **Qoder/Codex 参考实现** | `ModelDesk-macOS-office-preview/.local-worker/` | 参考 `qoder_worker.py`（ACP 原会话恢复与 `recovery_guard`）、`codex_usage.py`（Codex 额度只读采集） |

---

## 3. 插件目录结构与清单契约

```text
ModelDesk-AGY-Plugin/
├── plugin.json                        # 必填：Antigravity 插件清单（仅允许官方顶层字段）
├── mcp_config.json                    # 注册插件 MCP Server（名称全局唯一，必须加插件前缀）
├── hooks.json                         # 必须直接放在插件根目录！捕获会话、工具与 CLI 活动
├── pyproject.toml                     # Python 依赖（mcp 等，供 uv sync / uv run 使用）
├── README.md
├── assets/
│   └── logo.svg                       # 正方形透明底高对比度图标（四周留约 10% 边距）
├── rules/
│   └── AGENTS.md                      # 简明规则：多 CLI 协作规范与交付产物回报约定（无 frontmatter）
├── skills/
│   └── multi-cli-dispatch/
│       └── SKILL.md                   # 多 CLI 派单、中断恢复与独立验收操作指南
├── hooks/
│   └── sync_hook.py                   # 同步 Hook 脚本（单次执行 < 50ms，原子写入 ${PLUGIN_DATA}）
├── server/
│   ├── __init__.py
│   ├── main.py                        # FastMCP 服务端入口（stdio）
│   ├── storage.py                     # ${PLUGIN_DATA} 原子读写、SQLite/JSON 任务账本、0600 密钥存储/Keychain
│   ├── task_runner.py                 # 独立进程组执行器 + 四级中断续接状态机
│   ├── adapters/
│   │   ├── base.py                    # 统一 CLI 适配器接口
│   │   ├── codex.py                   # Codex CLI 执行、session/thread 续接与额度只读探测
│   │   ├── qoder.py                   # Qoder CN (`qoderclicn`) 执行、原会话恢复与 recovery_guard
│   │   └── gemini.py                  # Gemini CLI (`gemini`) + `agy` 兜底适配器
│   ├── context_inspector.py           # 增量解析 transcript.jsonl（Token/缓存/大户步骤）
│   ├── deliverables.py                # 聚合 artifactDirectoryPath + 工作区变更 + 右键动作后端
│   └── translator.py                  # OpenAI 兼容独立翻译引擎（含预设与长文分段）
├── ui/
│   ├── build.py                       # 单文件 HTML 构建脚本（内联 CSS/JS 与像素办公室模块，输出 < 10 MiB）
│   ├── src/                           # UI 源码（原生轻量 TypeScript/ESModule + @modelcontextprotocol/ext-apps 协议）
│   └── dist/
│       └── workbench.html             # 单文件 MCP App 产物（供 ui://modeldesk/workbench.html 提供）
├── scripts/
│   ├── run-server.sh                  # MCP 启动包装脚本（使用 uv/python3.12 启动 server/main.py）
│   └── install-plugin.sh              # 幂等安装脚本：软链或复制到 ~/.gemini/config/plugins/modeldesk-workbench
└── tests/                             # 完整自动化单元测试（pytest / unittest）
```

### 3.1 `plugin.json` 严格约束
仅允许官方支持字段（未知顶层字段会被静默丢弃），必须包含：
```json
{
  "name": "modeldesk-workbench",
  "displayName": "ModelDesk 像素工作台",
  "version": "0.1.0",
  "description": "Antigravity 原生工作台插件：多 CLI Agent（Codex/Qoder/Gemini）协作与星露谷像素办公室、可中断续接任务引擎、带完整右键菜单的交付产物中心、实时上下文/用量透视与内置独立翻译。",
  "logo": "assets/logo.svg",
  "suggestedPrompts": [
    "打开 ModelDesk 工作台面板，查看当前上下文占用与交付产物",
    "派单给 Codex 或 Qoder 协作执行任务，并在像素办公室查看实时状态",
    "使用内置独立翻译对照翻译当前交付文档"
  ]
}
```

### 3.2 `mcp_config.json` 严格约束
Server 名使用插件前缀避免全局冲突；路径使用 `${PLUGIN_ROOT}` 与 `${PLUGIN_DATA}`：
```json
{
  "mcpServers": {
    "modeldesk_workbench": {
      "command": "bash",
      "args": ["${PLUGIN_ROOT}/scripts/run-server.sh", "--data-dir", "${PLUGIN_DATA}"]
    }
  }
}
```

### 3.3 `hooks.json` 严格约束
- **必须位于插件根目录**（`<plugin_root>/hooks.json`），工作目录为插件根目录，环境变量自动注入 `PLUGIN_ROOT` 与 `PLUGIN_DATA`。
- Hook 输入（stdin）使用 **camelCase**（`conversationId`、`workspacePaths`、`transcriptPath`、`artifactDirectoryPath`、`modelName`、`lastUserInput`、`hookEventName`、`cwd`、`toolCall`、`stepIdx`、`error`）。
- Hook 属于同步阻塞调用，**必须在 50ms 内完成**（禁止在 Hook 中发起网络请求或启动重型进程）：
  - `SessionStart`：记录活跃会话的 `conversationId`、`transcriptPath`、`artifactDirectoryPath`、`workspacePaths`、`modelName` 到 `${PLUGIN_DATA}/sessions.json`，不修改对话（输出 `{}`）。
  - `PreInvocation` / `PostInvocation` / `Stop`：刷新当前活跃会话时间戳与最后一步状态，输出 `{}`。
  - `PreToolUse`（`matcher: "run_command"`）：检测 `toolCall.args.CommandLine` 是否包含 `codex`、`qoderclicn`/`qoder`、`gemini`、`agy` 等 CLI 调用；若命中，记录一条 `passive_cli_run` 为 `running`（`decision` 永远不越权放行，若无需改写直接输出 `{}` 或仅做观察，注意：`PreToolUse` 契约要求 `decision` 字段时，**更稳妥的做法是仅在 `PostToolUse` 或不干预权限；若使用 `PreToolUse` 必须核对是否影响用户审批策略——因此强烈建议先确认：若 `PreToolUse` 会覆盖默认审批，则 `PreToolUse` 仅对显式匹配项返回或改由 `PostToolUse` + 主动 MCP 派单追踪，避免干扰宿主权限体系！**）。
  - `PostToolUse`（`matcher: "run_command|write_to_file|replace_file_content|multi_replace_file_content|write_file|edit_file"`）：记录产出/编辑过的文件路径及终端 CLI 结束状态，输出 `{}`。

> **重要安全注意（Hook 权限不越权）**：`PreToolUse` 输出必须包含 `decision`（`allow`/`deny`/`ask`/`force_ask`），绝对**不要**在插件 Hook 中对 `run_command` 返回 `"allow"` 绕过用户的终端安全策略！因此被动追踪优先通过 `PostToolUse` + `SessionStart` + `PreInvocation`/`PostInvocation`/`Stop`（这些都不触碰审批决策），实时执行态由主动 MCP 派单工具驱动；如果未来需要终端运行前感知，仅可在明确安全且不改变策略的前提下谨慎评估。

---

## 4. MCP App 协议与 UI 架构规范（SEP-1865 + Antigravity 扩展）

### 4.1 服务端 UI 资源与入口声明
1. **UI 资源**：
   - URI：`ui://modeldesk/workbench.html`
   - MIME：`text/html;profile=mcp-app`
   - Meta：`{"ui": {"prefersBorder": False}}`
   - 大小：严格 `< 10 MiB`（目标 `< 1.2 MiB`，支持通过环境变量 `MODELDESK_UI_HTML` 指向开发文件以实现免重启热迭代）。
2. **主入口工具 `open_workbench`**：
   ```python
   WORKBENCH_META = {
       "ui": {"resourceUri": "ui://modeldesk/workbench.html"},
       "com.google.antigravity/ui": {
           "entrypoints": [
               {"type": "aux_pane", "title": "ModelDesk 工作台"},
               {"type": "global", "title": "ModelDesk 工作台"},
           ]
       },
   }
   ```
   - 所有参数必须**可选**，接收空对象 `{}` 时直接返回当前项目/会话默认摘要快照（`content` 为精简文本，`structuredContent` 为轻量初始化状态，严格 `< 1 MiB`）。
3. **App-Only 工具（`meta={"ui": {"visibility": ["app"]}}`）**：
   - 仅供前端 UI 通过 `app.callServerTool()` 调用，对模型隐藏，避免污染模型工具列表或泄漏 API Key / 大体量文件内容。

### 4.2 前端沙箱、主题与通信硬规则
1. **MCP Apps 协议桥接**：
   - 优先使用官方 `@modelcontextprotocol/ext-apps`（`App`、`applyDocumentTheme`、`applyHostStyleVariables`）打包成单文件 HTML；若当前无全局 npm 环境，需保证完全符合 SEP-1865 JSON-RPC over `postMessage` 规范（`ui/initialize`、`ui/notifications/initialized`、`ping`、`ui/notifications/tool-input`、`ui/notifications/tool-result`、`ui/notifications/host-context-changed`、`tools/call`、`ui/message`、`ui/update-model-context`、`com.google.antigravity/toggle-aux-pane`）并在测试中模拟宿主双向握手验证。
   - **必须先注册所有通知处理函数，再执行 `connect()`**，防止丢失首帧 `ontoolresult`。
2. **严禁依赖浏览器本地存储**：
   - Antigravity 每次在独立/临时 origin 中加载 iframe，`localStorage`/`IndexedDB` 重载即丢且不跨视图共享；
   - **全部用户偏好**（像素工坊时光/气候/壁炉/留声机、工位外貌绑定、翻译预设与 API 配置、上次选中 Tab）必须通过 app-only 工具读写 `${PLUGIN_DATA}/prefs.json`，并随每次修改立即持久化（Antigravity 不发送 `ui/resource-teardown`）。
3. **默认 CSP 与单文件内联**：
   - 默认 CSP 为 `default-src 'none'`（允许内联 `<script>`/`<style>` 和 `data:`/`blob:` 图片/字体，禁止外链与 `fetch`）；
   - 所有数据与外部 API（翻译、CLI 调度、文件操作）全部经由 `app.callServerTool()` 走 MCP Server 执行，不申请额外 `connectDomains`。
4. **宿主能力自适应与主题联动**：
   - 根据 `app.getHostCapabilities()` 自动检测 `message`、`updateModelContext`；在 `global`（左栏全屏）视图中自动隐藏依赖会话上下文的按钮。
   - 监听 `onhostcontextchanged`，动态应用 `--color-background-*`、`--color-text-*`、`--color-border-*`、`--font-sans`，并同步触发像素工坊的「自动」昼夜调色板。
   - 响应式双布局：容器宽度 `< 640px`（`aux_pane`）采用顶部紧凑 4-Tab 切换（`工坊` / `产物` / `上下文` / `翻译`）；容器宽度 `>= 860px`（`global`）支持左侧像素工坊 + 右侧多标签工作区双栏同屏。

---

## 5. 五大核心功能详细规格

### 5.1 星露谷像素办公室 & 多 CLI Agent 状态联动
- **资产迁移**：完整迁入基线提交 `97f10b9` 的星露谷风木屋与室外庭院渲染引擎、无穿模通道/木门寻路、11 套 AI 娘像素图集（默认 `主模型=gpt-dragon`、`Codex=orange` 或 `dragon`、`Qoder CN=qwen`、`Gemini=gemini`）、昼夜 4 模式、气候 4 模式、AI 娘点击对话与双人自主闲聊、家具道具点击互动与 `🎬 演示` 预览模式。
- **CLI 适配器接口（`server/adapters/base.py`）**：
  - `probe() -> AdapterStatus`（检测可执行文件、版本、登录/就绪态）
  - `start(task_spec) -> RunningHandle`（以独立进程组启动，实时回调输出流与 `native_session_id`）
  - `resume(task_record, follow_up_prompt) -> RunningHandle`（按 `native_session_id` 原会话续接）
  - `cancel(task_record) -> bool`（优雅停止独立进程组 `SIGTERM` -> `SIGKILL`）
- **首批 3 个适配器**：
  1. `codex`：自动探测 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`、`/Applications/Codex.app/Contents/Resources/codex` 及 `PATH`；使用 `codex exec --json -C <cwd> -s workspace-write` 执行，解析 JSONL 事件流中的 thread/session ID 与消息；续接采用 `codex exec resume <session_id> ...`。
  2. `qoder`：自动探测 `~/.local/bin/qoderclicn` 及 `PATH`；支持非交互与 ACP / `--resume <id>` 恢复，继承原仓 `qoder_worker.py` 的 `session_id` 合法性校验与原请求一致性核对（`recovery_guard`）。
  3. `gemini`：自动探测 `PATH` 中的 `gemini`（`@google/gemini-cli`，使用 `gemini -p ... --output-format json` 与 `--resume <id>`）；若本机未装 `gemini`，状态卡片清晰标示「未安装 `@google/gemini-cli`」，同时提供切换到本机 `~/.local/bin/agy` 无头执行或独立 Gemini API 的选项。

### 5.2 中断续接与持久化任务引擎（核心可靠性要求）
1. **进程解耦与持久化账本**：
   - 每个任务在 `${PLUGIN_DATA}/tasks/<task_id>/` 保存：
     - `task.json`（原子写 tmp + `os.replace`）：`id`、`engine`、`status`（`queued` | `running` | `completed` | `review` | `accepted` | `recovery_pending` | `failed` | `cancelled`）、`cwd`、`prompt`、`conversation_id`、`pid`、`pgid`、`native_session_id`、`git_head_before`、`declared_files`、`changed_files`、`created_at`、`updated_at`、`last_heartbeat_at`、`exit_code`、`error`、`recovery_reason`。
     - `events.jsonl` / `output.log`：实时追加流式输出。
   - 外部 CLI 进程使用 `start_new_session=True` 启动（独立进程组），MCP Server 重启或 UI iframe 卸载不影响运行中的子任务；Server 启动时扫描所有 `status == running` 任务，按 `pid` 存活校验自动重挂或转入 `recovery_pending`。
2. **四级分层续接机制**：
   - **L1（UI 重载 / 切对话）**：后台任务照常跑，UI 重连后直接拉取最新日志与状态。
   - **L2（CLI 异常中断 / 超时 / 手动暂停，且已有 `native_session_id`）**：用户点击「原会话续接」，直接调用适配器 `resume()` 恢复原记忆继续执行。
   - **L3（未获 `session_id` 即崩 / 状态不明）**：**禁止静默自动重跑写文件任务**！转入 `recovery_pending`（像素办公室亮起红色 `!` 提示），UI 展示「中断现场快照」（启动前 `git_head_before` 对比当前 `git status/diff` + 日志末 50 行），由用户确认后选择「带断点上下文续跑（自动组装原目标 + 已改文件摘要 + 尾部日志）」或「终止」。
   - **L4（Antigravity 重启 / 换新会话）**：侧栏持续展示跨会话未结任务，提供「接回当前对话」按钮，通过 `app.updateModelContext()` 将任务状态、变更文件与结果摘要贴回新主对话。
3. **冲突保护**：续接写文件任务前比对当前 `git HEAD` 与目标文件修改时间，若检测到已被人工或其他 Agent 改动，先高亮差异并要求用户二次确认。

### 5.3 交付产物中心与完整自定义右键菜单（核心体验痛点）
1. **产物自动聚合（`server/deliverables.py`）**：
   - 来源 1：当前会话 `artifactDirectoryPath` 下的全部文件（排除 `.system_generated/` 内部日志目录，保留 `.md`、图片、归档等用户可见产物）；
   - 来源 2：当前工作区 `git status --porcelain` 中的新增/修改文件；
   - 来源 3：外部 CLI 任务（Codex/Qoder/Gemini）声明或实际产生的 `changed_files` 与导出报告。
   - 按分类/时间分组展示，支持搜索过滤、文件类型图标、大小与最后更新时间。
2. **完整自定义右键菜单（前端完全接管 `contextmenu`，同时提供 `⋮` 按钮兼容触控板/键盘）**：
   右键点击任意产物行弹出 macOS 风格分层菜单（带快捷键提示与边界防溢出定位）：
   - **打开与预览**
     - 在 Antigravity 侧栏预览打开（调用 `com.google.antigravity/toggle-aux-pane`，参数 `{"tabType": "fileView", "uri": "file:///..."}`；在无侧栏的 `global` 视图或 `-32601` 时优雅降级为面板内预览）
     - 在访达（Finder）中显示（服务端 `open -R <abs_path>`）
     - 用默认应用打开（服务端 `open <abs_path>`）
     - 用外部编辑器打开子菜单（自动探测本机已装 VS Code / Cursor / Typora / Zed，走 `open -a`）
   - **复制**
     - 复制绝对路径
     - 复制相对路径（相对当前工作区）
     - 复制 Markdown 链接（`[filename](file:///...)`）
     - 复制文件文本内容（文本文件 `< 512 KB`）
   - **智能协作**
     - 一键翻译此产物（切到翻译 Tab 并载入全文生成双语对照，或另存 `<name>.zh.<ext>`）
     - 附加到下一条对话上下文（调用 `app.updateModelContext()`，在无 `updateModelContext` 能力时隐藏）
     - 转交其他 Agent 复核（子菜单：交给 Codex 验收 / 交给 Qoder 润色）
   - **文件管理**
     - 查看 Git Diff（若属于 Git 仓库变更文件，在弹窗中显示彩色 diff）
     - 复制导出到工作区指定子目录
     - 重命名（同目录安全校验，禁止路径穿越）
     - 移到废纸篓（macOS 安全移入 Trash，不做不可逆 `rm -rf`，且弹确认）
   - **安全边界**：所有文件操作严格校验路径归属（必须位于当前已注册 `workspacePaths` 或 `artifactDirectoryPath` 内，做 `Path.resolve()` 防符号链接逃逸，禁止系统目录误删）。

### 5.4 实时上下文查看与用量显示
1. **实时上下文透视（`server/context_inspector.py`）**：
   - 从 `${PLUGIN_DATA}/sessions.json` 获取当前活跃 `transcriptPath`（也允许用户切换最近 10 个本地会话）。
   - 采用文件偏移增量读取（记录 `mtime` + `byte_offset` 缓存），解析每行 JSONL：
     - 统计最近一次 `PLANNER_RESPONSE` 的 `input_tokens`、`cache_read_tokens`、`output_tokens`、`model`（反映当前实时上下文水位与缓存命中率）；
     - 估算各步骤内容体积（`USER_INPUT` / `tool_calls` 返回 / `PLANNER_RESPONSE`），输出 **Top 10 最占上下文的步骤排行**（显示工具名、文件名/命令摘要与估算 Token）；
     - 水位超过设定阈值（默认 75%）时给出温和提示「建议输入 `/compact` 压缩上下文」。
2. **用量统计面板（`server/usage.py`）**：
   - **Antigravity 本地精准统计**：聚合当前会话 / 今日 / 近 7 天所有可发现本地 `transcript.jsonl` 的 `input_tokens`、`cache_read_tokens`、`output_tokens`，按模型分项展示。
   - **外部 CLI 聚合**：展示插件任务账本中 Codex / Qoder / Gemini 的调用次数、成功率与耗时；复用原仓 `codex_usage.py` 的本地只读逻辑获取 Codex 周剩余额度百分比（后台缓存，失败静默降级为「未同步」，不阻塞 UI）。

### 5.5 内置独立翻译引擎（`server/translator.py`）
- **协议**：标准 OpenAI Chat Completions 兼容接口（`POST {base_url}/chat/completions`，使用 Python 标准库 `urllib.request` 或 `httpx`，零重依赖）。
- **内置预设（一键切换）**：
  1. `gpt-6-luna`（默认推荐：OpenAI `https://api.openai.com/v1`，参考价输入 \$0.10 / 输出 \$0.50 per 1M）
  2. `gemini-2.5-flash-lite`（参考价输入 \$0.10 / 输出 \$0.40 per 1M，支持兼容端点）
  3. `qwen-flash`（DashScope 兼容端点，参考价输入 \$0.10 / 输出 \$0.40 per 1M）
  4. `deepseek-chat`（DeepSeek 端点，长文翻译输出极省）
  5. `custom`（自定义 `base_url`、`model`、`api_key`）
- **核心能力**：
  - 随手输入/粘贴翻译（支持中↔英自动检测、技术文档模式保留代码块/变量名不误翻）；
  - 交付产物一键双语对照翻译（长文按段落/Markdown 标题自动分块并发翻译，支持另存 `.zh.md`）；
  - 翻译结果一键复制或通过 `app.updateModelContext()` 附加给主模型；
  - **密钥安全**：API Key 优先存 macOS Keychain（`security` CLI / `org.modeldesk.agy-plugin.translator`），降级存 `${PLUGIN_DATA}/secrets.json`（权限 `0600`），前端只显示脱敏掩码（如 `sk-...a1b2`），永不出现在日志或模型可见的 `content` 中。

---

## 6. MCP 工具契约总览

### 6.1 模型 + App 可见工具（默认可见性）
| 工具名 | Meta 入口 | 职责 |
| :--- | :--- | :--- |
| `open_workbench` | `aux_pane` + `global` + `ui://modeldesk/workbench.html` | 打开/刷新工作台面板，支持空参数 `{}` |
| `dispatch_cli_agent` | `ui://modeldesk/workbench.html` | 派单给 `codex` / `qoder` / `gemini`，落盘任务账本并启动独立进程组 |
| `resume_cli_task` | `ui://modeldesk/workbench.html` | 按 `task_id` 执行原生原会话续接或断点交接续跑 |
| `get_cli_task_status` | — | 查询单个或全部 CLI 任务最新状态、日志尾部与变更文件 |
| `cancel_cli_task` | — | 停止运行中的外部 CLI 任务 |
| `translate_text` | — | 调用独立翻译 API 翻译指定文本或文件（不把原文塞进冗余上下文） |

### 6.2 仅 App 可见工具（`visibility: ["app"]`，隐藏于模型）
| 工具名 | 职责 |
| :--- | :--- |
| `app_dashboard` | 返回聚合快照：CLI 适配器探活、像素工坊状态、活跃任务列表、偏好配置 |
| `app_list_files` | 返回当前会话 Artifact、Git 变更文件与 CLI 交付物清单 |
| `app_file_action` | 执行右键菜单动作：`reveal_finder`、`open_default`、`open_app`、`read_preview`、`git_diff`、`export_copy`、`rename`、`trash` |
| `app_context_usage` | 返回实时上下文水位、缓存命中率、Top 占用步骤、今日/本周 Token 统计与 Codex 额度 |
| `app_get_task_logs` | 分页/尾部拉取大体积 CLI 日志与 `recovery_pending` 现场 Diff 快照 |
| `app_task_action` | UI 面板直接触发新建派单、原会话续接、断点重跑或终止 |
| `app_translate` | 面板即时翻译与交付物分段双语对照翻译（可选另存译文文件） |
| `app_save_prefs` | 持久化像素工坊偏好、工位外貌与翻译配置（API Key 单独安全存储，回包仅脱敏状态） |

---

## 7. 分阶段实施路线与验收标准

### Phase 1（核心闭环：骨架 + 交付产物完整右键菜单 + 实时上下文/用量 + 任务续接账本）
- [ ] 完成插件标准目录结构、`plugin.json`、`mcp_config.json`、`hooks.json`、`hooks/sync_hook.py`、`rules/AGENTS.md`、`skills/multi-cli-dispatch/SKILL.md`、`scripts/run-server.sh`、`scripts/install-plugin.sh`。
- [ ] 完成 Python `FastMCP` 服务端：正确暴露 `ui://modeldesk/workbench.html`（MIME `text/html;profile=mcp-app`）与 `open_workbench` 双入口（`aux_pane` + `global`，空参 `{}` 正常返回）。
- [ ] 完成 `context_inspector.py` + `usage.py`：增量解析真实 `transcript.jsonl`、展示上下文水位/缓存命中/Top 步骤/按模型 Token 统计，并集成 Codex 额度只读探测。
- [ ] 完成 `deliverables.py` + 前端交付产物面板与**完整自定义右键菜单**（含路径越界防护与 macOS 废纸篓安全删除）。
- [ ] 完成 `task_runner.py` 独立进程组持久化账本与四级续接状态机（含 `codex`、`qoder`、`gemini` 适配器及单元测试）。

### Phase 2（星露谷像素办公室无损迁入 + 完整翻译模块）
- [ ] 将基线 `97f10b9` 的星露谷像素办公室无损迁入 MCP App 单文件构建管线（移除 `localStorage` 改为 `app_save_prefs`，移除 `/api/state` 改为 `app_dashboard`，保留全部昼夜/气候/家具点击/AI 娘互动/状态动画/`🎬 演示`与 `prefers-reduced-motion` 支持）。
- [ ] 完成 `translator.py` 与前端双语对照翻译 UI（含 `gpt-6-luna` 等一键预设、安全密钥存储及交付产物右键直达翻译）。

### Phase 3（联调测试与收口）
- [ ] 全量自动化测试通过：
  - Hook 脚本执行耗时 `< 50ms`、正确处理 camelCase JSON 且不篡改审批策略；
  - MCP Server stdio 握手、列出 `tools` / `resources`、读取 `ui://modeldesk/workbench.html`（`< 10 MiB`）且验证 `open_workbench({})`；
  - 任务中断恢复测试（模拟进程崩溃后重启 Server，验证 `native_session_id` 原会话续接与无 `session_id` 转 `recovery_pending`）；
  - 交付产物路径逃逸拦截测试（`../` 与符号链接逃逸均被拒绝）；
  - 翻译引擎 Mock HTTP 测试与 API Key 脱敏测试；
  - 单文件 HTML CSP 与宿主 `postMessage` 协议握手测试。
- [ ] 提供清晰的自检报告与 `./scripts/install-plugin.sh` 一键安装指令（安装前先在仓库内自测通过）。

---

## 8. 开发纪律（Codex 须严格遵守）

1. **所有代码编写、构建与测试限定在 `ModelDesk-AGY-Plugin` 内**；参考 `ModelDesk-macOS-office-preview` 仅作只读读取，**禁止修改原仓任何文件**。
2. **不要直接修改 `~/.gemini/config/config.json`**；安装脚本只把插件目录软链/复制到 `~/.gemini/config/plugins/modeldesk-workbench/`，由用户在 Antigravity 中确认并启用。
3. **本机无全局 `node`/`npm`**：UI 构建脚本（`ui/build.py`）使用纯 Python 3.12 组装单文件 HTML（零 Node 依赖也能一键复现构建），同时保持前端 JS 严格遵循 MCP Apps SEP-1865 JSON-RPC 协议与 Antigravity 扩展。
4. 完成后运行全部自动化测试并给出清晰总结（含变更文件清单、测试结果与残余边界说明）。
