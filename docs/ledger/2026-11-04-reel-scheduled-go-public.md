---
id: 2026-11-04-reel-scheduled-go-public
title: Reel 按日公开：批周卡记「到日可公开」授权，每 30 分钟检查、到客户发布时点用转公开动作公开（默认关）
status: decided
owner: pm
decided_on: 2026-11-04
source: pr:3597
verify_by: 2026-11-10
verify_how: 合并部署 + Inngest Sync 后，手动发一次 social/reel.scheduled_go_public.due（CTS，dry_run）出回执；PM 打开开关 WEEKLY_PACK_REEL_SCHEDULED_PUBLIC 并在周卡逐条预览后批，flywheel_actions 里对应 Reel 的 scheduled_go_public.status=armed；11/9 新西兰 18:00 后该条状态为 consumed、Facebook 上为公开、回执 authorized_by 是批准人；任何没发出的条目出现在今日待办「Reel 按日公开」
---
设计 docs/specs/2026-11-04-reel-scheduled-go-public-design-v0.2.md（子牙、魏征设计复审各 5 条必改已并入 §8）。批卡时每条走一次性口令校验并在同一次乐观锁写入里作废口令、记授权（指纹不含团目录版本、绑定发布日）；定时函数 cloud-reel-scheduled-go-public 每 30 分钟醒一次，到客户发布时点（默认 18:00）对当天授权逐条重跑全部前置检查，核授权与抢占在同一次写入里完成，复用转公开的执行步骤；错过 / 内容或日子变了 / 失败 / 结果不明一律不发并进今日待办；客户页「已授权、还没公开」可单条撤回或重新预览后授权。开关 WEEKLY_PACK_REEL_SCHEDULED_PUBLIC 默认关，与「批卡即公开」同时开时只按日。
