---
name: multi-cli-dispatch
description: 在 Antigravity 对话派单给 Codex、Qoder CN 或 Gemini，用 ModelDesk 任务条和工位核对执行与交付。
---

# 多 CLI 协作

1. 在原生对话中明确执行端、目标、已登记工作区、写入范围和验收条件。需要核对项目范围时调用 `open_workbench`。用 `dispatch_cli_agent` 派单并记录任务 ID。
2. 跟进对话内联任务条的状态和尾部日志。需要更早日志或完整现场时打开工作台，点击对应工位，或调用 `get_cli_task_status`。
3. 中断任务先核对进程状态、日志和 Git Diff。已有原生会话 ID 时优先通过工位、任务条或 `resume_cli_task` 原会话续接。缺少 ID 时核对断点现场，经用户明确确认再续跑。检测到外部变更时核对最新差异并重新确认。
4. 核对本轮产物、实际变更和测试证据。验收通过后，在回复用户前调用 `accept_cli_task`，传入派单回执中的 `task_id`（即任务的 `id`）、`conversation_id` 和实际验收证据 `evidence`。有未通过的检查或待用户确认的验收项时，保留待验收并说明原因。回执列出相对文件路径、执行的验证命令、结果和待验收项。
