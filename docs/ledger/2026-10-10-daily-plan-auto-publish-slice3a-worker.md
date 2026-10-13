---
id: 2026-10-10-daily-plan-auto-publish-slice3a-worker
title: 自动发布第三刀 a：每小时发布器（默认只演练）在审，合并后要核对第一轮定时运行
status: done
owner: agent
decided_on: 2026-10-10
source: pr:2435
verify_by: 2026-10-14
done_on: 2026-10-10
done_ref: pr:2435
verify_how: 合并部署后查 cron_run_logs 里 job_name=daily-plan-auto-publish：每小时第 20 分钟（新西兰）应有一条成功记录，summary 里 authorizations=0、没有 error；没有这条就是定时函数没注册上
---
PM 2026-10-11 回「合」，PR #2435（风险 A，三位审查已过）已合并。默认只演练，不设真发开关和客户白名单就不会发任何东西。
真发要 PM 明确说 go 之后才设环境变量，先放 1 个客户 1 天。界面按钮是 3b，另开。
