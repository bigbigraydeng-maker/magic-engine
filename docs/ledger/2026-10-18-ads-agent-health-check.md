---
id: 2026-10-18-ads-agent-health-check
title: 广告 Agent 完整检测（10-18 晚）：「看」是活的，「动」是空的——内核从没跑过广告动作、熔断事件表 0 行；CTS 官方账户未接受 Meta 条款阻塞 10/22 开投；探针明早 06:00 第一次真跑
status: done
owner: agent
decided_on: 2026-10-18
done_on: 2026-10-18
done_ref: doc:docs/ledger/evidence/ads-agent-health-check--2026-10-18.md
source: session:c668eb35
verify_by: 2026-10-19
verify_how: 明早 06:00 之后查 cron_run_logs：google-data-pullback-daily 最新一轮 summary 里是否出现 circuit_probe 键，里面 CTS 与 NAL 两个客户的 accounts 有没有 deliveringCampaigns 等字段、有没有 error。再核 pm-daily-todo 是否为 CTS 个人账户（码 3）与 Magic Picks（码 9）下发了账户异常待办
---
全部结论与证据在 evidence 文件。核心：授权内核 action_runs 的 ads.* 为 0、ads_circuit_events 为 0 行；7 个账户快照今天都更新；广告相关 9 个自动程序近 7 天 0 次失败。
阻塞 CTS 10/22：官方账户未接受 Meta 条款（草稿校验 1815089，只有管理员能点）；素材池 5 条全是候选 0 条批准。
我今天合并的熔断探针主干接线正确但还没跑过——每日任务新西兰 06:00 才跑，今天那轮在合并之前。
