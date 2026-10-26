---
id: 2026-10-27-me-dev-harness-knife1-snapshot
title: 总控台第一刀：只读汇总脚本，列最近 3 天活跃窗口的三个进度点和撞车
status: decided
owner: agent
decided_on: 2026-10-27
source: doc:docs/specs/2026-10-26-me-dev-harness-design-v0.2.md
verify_by: 2026-11-09
verify_how: 第二刀定时任务建好后，PM 手机上能打开手机版页面，窗口数和侧栏对得上，页面里没有窗口标题。对得上且无标题=成。
---
脚本在 scripts/harness/，只读，不写库不推代码。DeepSeek 写，三轮加修订，合计约 $0.04。
真实数据试跑：21 个活跃窗口，无撞车涉及活跃窗口，退出码 0。
下一步是第二刀：每天一次的定时任务取会话列表、跑脚本、发手机版页面。
