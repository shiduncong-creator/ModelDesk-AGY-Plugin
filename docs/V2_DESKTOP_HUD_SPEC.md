# ModelDesk v2 · 桌面原生 16-bit 像素 HUD 重构规范

> **生效日期**：2026-11-24  
> **目标仓库**：`ModelDesk-AGY-Plugin`（就地升级，保留 Git 历史与官方插件目录软链）
> **参考只读仓**：`ModelDesk-macOS-office-preview`（严禁写入或修改）

---

## 1. 产品目标与硬边界

1. **纯官方 Antigravity 插件架构（重启永不掉线）**：
   - 仅使用 Antigravity 官方 MCP App（SEP-1865 + `com.google.antigravity/ui`）、Hooks、Skills 与 Rules；
   - **严禁**任何 CDP 注入、`--remote-debugging-port` 修改、Electron `app.asar` 改动或对 Antigravity 客户端启动方式的篡改；
   - **严禁**直接复制 GPL-3.0 社区项目代码，所有算法与 UI 均在本仓库干净原创实现。
2. **零改变用户原工作流 & 完整保留左侧项目列表**：
   - Antigravity 原生左侧「Projects / 对话列表」与中间聊天区完全不受影响；
   - 用户继续在 Antigravity 聊天框用自然语言派单（如「把规范定好派发给 Codex / Qoder / Gemini」），不再要求填写厚重的「新建派单」表单；
   - 在 `global` 全屏工作台宽屏态（`>= 900px`）中，保留一个可折叠的**左侧项目与最近会话栏（Projects & Sessions Rail）**，支持一键切换工作区与最近会话。
3. **双界面精准分工（彻底告别「4-Tab 工程师后台 + 手机套娃卡片」）**：
   - **界面 A（`ui://modeldesk/workbench.html`，`aux_pane` + `global`）**：桌面贴边原生 16-bit 像素 RPG HUD 伴随栏，通过 CSS `@container` 随宽度在「贴边单栏 / 双栏 / 含项目栏三栏」间无缝切换。
   - **界面 B（`ui://modeldesk/task-strip.html`，`inline` 专供 `dispatch_cli_agent` / `resume_cli_task`）**：超扁平 ~72px 桌面 16-bit 任务进度横条，不再把完整工作台塞进主聊天流。

---

## 2. 视觉设计规范（方案 2 · 桌面原生 16-bit 像素 HUD）

### 2.1 桌面级布局与反手机化约束
- **贴边无套娃**：顶层 `padding: 0`，禁止手机式「大卡片套小卡片 + 大量圆角外边距」；区域间用 `2px` 像素木框分割线或 `1px` 细线分隔，数字统一 `font-variant-numeric: tabular-nums`。
- **双色 16-bit 像素主题（自动跟随 Antigravity 亮/暗主题，并支持顶栏一键手动切换）**：
  - `prefs.hud_theme`: `"auto" | "light" | "dark"`（默认 `"auto"`，跟随 `hostContext.theme`）。
  - **暖日羊皮纸（`light`）**（重点适配 Antigravity 浅色白灰界面，高对比、温润不脏）：
    - 主底色 `#f2e5c9`，面板底 `#f7eed9`，顶条 `#e9d4ad`，次工具条 `#efe0bf`，木框边 `#8c572c` / `#b48455`，主字 `#3a2617`，辅字 `#785639`，激活态 `#c46526` / `#6d4aff`。
  - **夜空深色（`dark`）**：
    - 主底色 `#191623`，面板底 `#16131f`，顶条 `#221d31`，次工具条 `#1e192b`，木框边 `#6b4c35` / `#4f3a2c`，主字 `#f4ead6`，辅字 `#aa9b8d`，激活态 `#6d4aff` + `#f0bc68` 金边。
- **0fps 空闲休眠与动效减敏**：
  - 尊重 `prefers-reduced-motion: reduce`；
  - 页面不可见（`document.hidden`）时立即暂停全部动画与轮询；
  - 无运行中 CLI 任务且无用户交互满 2 秒后，像素魔药瓶与静态界面自动降频/休眠以降低 CPU/GPU 占用；鼠标悬停、滑块/状态变化或任务运行中即时唤醒。

### 2.2 界面 A：`ui://modeldesk/workbench.html` 详细结构

1. **顶部 42px 扁平桌面 HUD 状态条（固定顶部，无大标题栏）**：
   - 左：`22×28` 16-bit 像素魔药瓶 Canvas + `MP` 标签；
   - 中：像素分段 MP 进度条 + 实时数值（如 `195K/512K`）；颜色随占比自动切换（`<65%` 紫晶、`65%–79%` 琥珀、`≥80%` 绯红警示）；
   - 右：`缓XX%` 胶囊（窄屏可省略文字只留数字）+ `/compact` 快捷按钮（若宿主具备 `message` 能力则调用 `app.sendMessage('/compact')`，否则复制 `/compact` 并轻提示）+ `🔑` 单行 API 开关 + `☀/☾` 主题切换 + `↻` 刷新。
2. **浮层 RPG 属性面板（点击魔药瓶或 MP 条展开，`position: absolute` 覆盖展开，绝不挤压下方布局）**：
   - 显示当前模型名称与自动识别窗口容量（如 `Gemini 4 Neon · 512K`，并保留可选的「自定义窗口 / 恢复自动」极简输入）；
   - 显示：已用 / 上限、Cache 命中率、**书本等值换算**（如 `《双城记》×1.0`）、**主会话 vs 子代理 Token 拆分**、今日 / 近 7 天汇总；
   - 显示 **Codex 5h + 周度配额像素进度槽** + `同步额度` 按钮；
   - 显示 Top 5 最占上下文步骤摘要；
   - 在窄屏模式下，提供轻量「切换本地会话」下拉框。
3. **可折叠单行自有 API 条（点 `🔑` 在顶栏正下方滑出）**：
   - **仅使用用户自己的 API**（不接任何免 Key 第三方公共翻译接口）；
   - 预设下拉：`gpt-6-luna`、`gemini-2.5-flash-lite`、`qwen-flash`、`deepseek-chat`、`ollama`（本机免密 `http://localhost:11434/v1`）、`custom`；
   - 单行 API Key 输入框（已保存时显示脱敏掩码 + 清除按钮；`ollama` 模式下提示「本机免密」可留空）；仅在选 `custom` / `ollama` 时下方展开一行 `Base URL` + `Model`；
   - `保存` + **`测通`**（调用 `app_test_api`，返回毫秒级延迟或清晰排障提示，绝不回显 Key）+ **`思考自动译` 开关**。
4. **容器自适应桌面主区（CSS `@container hud`）**：
   - **窄侧栏态（`< 620px`，典型右侧 `aux_pane`）**：
     - 上：全宽贴边 **星露谷像素工坊画布**（完整保留 `ui/src/office/pixel-office-*.js` 全部精绘房间、壁炉、天气、昼夜与 11 套真实 AI 娘像素精灵；默认工位映射调整为 `codex → gpt-dragon` 银龙娘、`qoder → dayu` 大肥鱼、`gemini → gemini` 吉米奈，仍支持换装）；画布左上角叠轻量状态角标，底部叠超紧凑 **小队状态条**（点击小人或工位弹出 **RPG 像素对话框浮层**：看实时尾部日志、Git Diff、原会话续接 / 断点续跑确认 / 暂停 / 终止 / 独立验收、换装与场景天气切换，**移除手动「新建派单」复杂弹窗**）。
     - 下：紧凑切换条（`📜 思考卷轴` | `🎒 产物栏 (N)` + `纯中文/双语` 开关）→ 全高贴边滚动区。
   - **中宽双栏态（`620px – 899px`）**：
     - 左栏（`~56%`）：像素工坊画布（上）+ 常驻桌面表格式「本轮产物栏」（下，免切 Tab）；
     - 右栏（`~44%`）：全高常驻「📜 思考过程实时卷轴」（并排看工坊 + 产物 + 实时思考中文流，0 切换成本）。
   - **全屏宽屏三栏态（`>= 900px`，`global` 工作台）**：
     - 最左可折叠 **项目与最近会话栏（`196px`）**：列出已登记工作区/项目与近期会话列表，点击即切换当前观察的会话与工作区；
     - 中栏（`~54%`）：宽画幅像素工坊 + 产物表；
     - 右栏（`~46%`）：全高思考过程实时卷轴。
5. **本轮产物栏与完整 16-bit 右键菜单**：
   - 优先置顶展示本轮会话实际改动/生成/交付的文件，带像素状态标签（`新增` / `修改` / `交付`），支持搜索过滤；
   - 右键任意文件行、点 `⋮` 或焦点下按 `Shift+F10` 唤出 16-bit 像素指令菜单：
     - `右侧原生预览`（调用 `com.google.antigravity/toggle-aux-pane` 打开 `fileView`，若当前视图无侧栏则回退为内置只读预览浮层）
     - `访达中显示`（`reveal`）
     - `复制相对路径` / `复制绝对路径`
     - `附加为 @上下文`（调用 `app.updateModelContext`，无此能力时自动隐藏）
     - `翻译此文件`（调用用户 API 翻译并在浮层展示双语/纯译文，支持复制与旁存）
     - `查看 Git Diff`
     - 分隔线后：`改名`、`移到废纸篓`（保留原安全确认与路径边界校验）。

### 2.3 界面 B：`ui://modeldesk/task-strip.html`（对话内联超扁平任务横条）
- 注册为独立 MCP Resource `ui://modeldesk/task-strip.html`，供 `dispatch_cli_agent` 与 `resume_cli_task` 的 `_meta.ui.resourceUri` 使用（**不挂** `aux_pane`/`global` entrypoint）。
- 高度严格控制在 **~72–88px**（展开内联尾部日志时上限 ≤ 240px），绝不渲染完整工作台：
  - 左：36×36 像素精灵头像（直接复用对应执行端的真实像素精灵图，施工中轻微律动）；
  - 中：执行端与任务摘要、像素状态标签（`[RUN mm:ss]` / `[PAUSED · 可续接]` / `[DONE ✓]` / `[FAILED]`）、细像素进度/活动条、最新一行日志文本；
  - 右：紧凑按钮 `日志`（原地展开/收起最后 15 行日志）、`暂停`（运行中）或 `原会话续接`（中断时）。
- 轮询策略：任务处于 `queued / dispatching / running` 时每 2 秒自动调用 `app_get_task_logs` 更新；进入终态或页面隐藏时立即停止轮询。

---

## 3. 后端能力升级规范（`server/`）

### 3.1 `server/context_inspector.py` 与 `server/usage.py`
1. **按模型自动映射上下文窗口上限**：
   - 新增 `infer_context_window(model_name: str) -> int`：
     - 匹配 `gemini-4` / `gemini-3` / `gemini-2.5` / `gemini-2` → `512_000`；
     - 匹配 `claude` → `200_000`；
     - 匹配 `gpt-5` / `gpt-6` / `codex` / `o3` / `o4` → `200_000`；
     - 匹配 `gpt-4` / `deepseek` / `qwen` → `128_000`；
     - 其余默认 `200_000`；
   - 若用户 `prefs.context_window` 为正整数，以用户手动覆盖为准，否则（`None` / 未设置）自动采用 `infer_context_window(model)`，并在返回 payload 中标明 `window_source: "auto" | "manual"`。
2. **主会话 vs 子代理（Subagent）Token 拆分**：
   - 在扫描 `transcript.jsonl` 时，识别 `invoke_subagent` 的工具回执/参数中出现的子对话 UUID（匹配标准 UUID 正则且对应本地存在的 `brain/<id>/.system_generated/logs/transcript.jsonl`）；
   - 在 `Usage.collect()` 中汇总当前会话自身 Token（`main`）与关联子代理累计 Token（`subagents`，含 `count` 和合计 `input_tokens / cache_read_tokens / output_tokens`）。
3. **书本等值换算 `book_yardstick(used_tokens: int)`**：
   - 内置轻量原创作物字数/Token 标尺（《道德经》8K、《小王子》22K、《老人与海》35K、《哈利·波特与魔法石》100K、《双城记》187K、《三体》202K、《红楼梦》730K），返回 `{"title", "multiple", "label"}`。
4. **实时 `thinking` 块增量提取**：
   - 扫描 `PLANNER_RESPONSE` 时，若 `row.get("thinking")` 为非空字符串，记录精简对象 `{step, timestamp, model, hash: sha256(text)[:16], text: text[:6000], truncated: len(text) > 6000}`，每个会话增量保留最近 30 条（按 step 去重更新）。

### 3.2 `server/translator.py` 与实时思考翻译缓存队列
1. **新增本机免密 `ollama` 预设**：
   - `PRESETS["ollama"] = {"base_url": "http://localhost:11434/v1", "model": "qwen2.5:7b", "keyless_local": True}`；
   - 仅当 `chat_endpoint(base_url)` 的 host 严格属于回环地址（`localhost`、`127.0.0.1`、`::1`）时允许无 API Key 调用（省略 `Authorization` 头）；任何非回环 HTTPS 地址仍强制要求保存 API Key。
2. **API 连通性检测 `Translator.test_connection(preset=None)`**：
   - 发送极轻量 `Chat Completions` 探测（`max_tokens: 8`，超时 `10s`，禁止重定向），返回 `{"ok": True, "preset": ..., "model": ..., "latency_ms": int}` 或安全脱敏错误信息。
3. **持久化思考译文缓存 + 异步限流队列（`server/thought_stream.py`）**：
   - 缓存文件 `<PLUGIN_DATA>/thought_cache.json`（原子写入，权限 `0600`，LRU 上限 400 条），缓存键为 `f"{preset}:{model}:{text_hash}"`，确保重启与轮询零重复扣费；
   - 内部维护 `ThreadPoolExecutor(max_workers=2)` 并发限流队列与 in-flight 去重集合；
   - 提供 `snapshot(conversation_id, entries, auto_translate=True)`：
     - 立即返回最新 `limit`（默认 20）条思考记录，每条附带 `status`（`"translated" | "translating" | "pending" | "error" | "unconfigured"`）、`translation`、`error`、`cached`、`latency_ms`；
     - 当 `auto_translate=True` 且当前预设已就绪（有 Key 或本机回环免密）时，将最新未译的最多 5 条异步提交后台翻译，不阻塞 MCP 响应；
     - 提供 `retry(step_hash, entry)` 单条强制重译接口。

### 3.3 `server/main.py` 新增与更新的 MCP 工具契约
- 保留全部现有工具名与参数向后兼容；
- 新增 MCP Resource：`ui://modeldesk/task-strip.html`；`dispatch_cli_agent` 与 `resume_cli_task` 的 `_meta` 指向 `ui://modeldesk/task-strip.html`；
- 新增 App-Only 工具：
  - `app_thoughts(conversation_id: str | None = None, auto_translate: bool | None = None, limit: int = 20)`
  - `app_retry_thought(step_hash: str, conversation_id: str | None = None)`
  - `app_test_api(preset: str | None = None)`
- 扩展 `preference_patch` 支持：`hud_theme`（`"auto"|"dark"|"light"`）、`thought_auto_translate`（bool）、`thought_bilingual`（bool）、`projects_rail_collapsed`（bool），并允许 `context_window: None` 切回自动识别。

### 3.4 构建脚本 `ui/build.py`
- 同时产出两份自包含单文件 HTML（纯 Python 构建，零外部 CDN，严格 CSP，不含裸 `</script>` / `</style>`，各自 `< 10 MiB`，目标 `workbench.html < 1.5 MiB`、`task-strip.html < 600 KiB`）：
  - `ui/dist/workbench.html`
  - `ui/dist/task-strip.html`

---

## 4. 验收标准（Codex 完工后自测 + Antigravity 独立复核）

1. **构建与校验**：
   - `.venv/bin/python ui/build.py` 成功生成 `ui/dist/workbench.html` 与 `ui/dist/task-strip.html` 且体积合规；
   - `"$HOME/.local/bin/agy" plugin validate --strict .` 通过且零错误。
2. **自动化测试**：
   - `.venv/bin/python -m unittest discover -s tests -t . -v` 100% 通过，且新增覆盖以下核心场景的单元测试：
     - `infer_context_window` 自动识别、主会话/子代理拆分、书本换算、增量 `thinking` 提取；
     - `ollama` 回环免密放行与非回环强制 Key 校验、`test_connection` 脱敏与超时、思考译文 LRU 缓存命中零重复请求、失败单条重试；
     - MCP stdio 握手验证双 UI Resource（`ui://modeldesk/workbench.html` 与 `ui://modeldesk/task-strip.html`）、`dispatch_cli_agent` 指向 `task-strip.html`、新增 3 个 `app_*` 工具可用；
     - 前端协议测试（`tests/test_ui.py` / `tests/ui_protocol.cjs`）验证新 HUD DOM、容器自适应布局、浮层属性面板、右键菜单、双语切换与 `task-strip.html` 轮询协议。
3. **隔离与文档**：
   - 参考仓 `ModelDesk-macOS-office-preview` `git status` 零改动；
   - 同步更新 `README.md`、`rules/AGENTS.md`、`skills/multi-cli-dispatch/SKILL.md`。
