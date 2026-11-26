---
id: 2026-11-16-inngest-quota-relief-direct-fallback
title: Inngest 本月额度用完、PM 不升级：电话进 CRM、新线索进表格改由 Render 现有的每 5 分钟调度器直接跑；4 个跑太勤的 Inngest 定时任务调慢
status: decided
owner: agent
decided_on: 2026-11-16
source: session:96dc6edf
verify_by: 2026-11-17
verify_how: 上线后 cron_run_logs 里 telephony-direct-sweep 每 10 分钟有一条 completed；11-16 那 7 条没处理的原始电话事件变成 processed、telephony_calls 里出现对应通话且 crm_status=written；lead-sheet-sync 在每小时 50 分有带 runner=dispatcher 的记录；12 月第一周看 Inngest 后台月用量增速比 11 月前两周（约 3,500 次/天）明显低
---
PM 2026-11-16 回「不升」「开始」。Inngest 免费额度 11-15 14:20（新西兰）用满，之后电话记录进不了 CRM（原始事件照常存，只是没人处理）、新线索不进表格。
做法：两条新的 /api/cron 路由挂进已有的 cron-dispatch-frequent（不新开 Render 服务、不花钱），直接调 Inngest 那边同一套处理函数。开关 INNGEST_DIRECT_FALLBACK=off。两边都只捡没做完的活，额度恢复后同时开着也不会重复写。
调慢：电话补漏、通话分析补扫 每 10 分钟 → 每小时；快拍发布 每 10 → 每 20 分钟（发帖时段只容许晚 20 分钟，不能再慢）；「别再联系」重新联系检查 每 15 分钟 → 每小时；定时视频转公开 每 30 分钟 → 每小时。
没动：广告上线盯盘（T+1 小时检查会被推迟）、每日计划自动发布（时段过了就算错过）。这两条照旧，额度上的节省因此比当初估的 4.8 万次少。
不能救的：订单进展回报 Facebook、私信简报、广告止损等其余 Inngest 任务这两周仍停着，等额度恢复（预计 12-01，未核实）。按 §11：频率高（每天都有电话和线索）/ IMPACT 高（Measure 断了）/ 收入高（员工看不到客人通话记录）→ P0。
