---
id: 2026-10-18-ads-agent-health-check
title: 广告 Agent 完整检测（10-18 晚）：「看」是活的，「动」是空的——内核从没跑过广告动作、熔断事件表 0 行；CTS 官方账户用接口建不出带表单的留资广告（报错 1815089，不是条款没点）阻塞 10/22 开投；探针明早 06:00 第一次真跑
status: done
owner: agent
decided_on: 2026-10-18
done_on: 2026-10-18
done_ref: doc:docs/ledger/evidence/ads-agent-health-check--2026-10-18.md
source: session:c668eb35
verify_by: 2026-10-20
verify_how: 明早 06:00 之后查 cron_run_logs：google-data-pullback-daily 最新一轮 summary 里是否出现 circuit_probe 键，里面 CTS 与 NAL 两个客户的 accounts 有没有 deliveringCampaigns 等字段、有没有 error。周一 10-19 早上 8 点后再核 pm-daily-todo 是否为 CTS 个人账户（码 3）与 Magic Picks（码 9）下发了账户异常待办（今天周日不发，不是故障）
---
全部结论与证据在 evidence 文件。核心：授权内核 action_runs 的 ads.* 为 0、ads_circuit_events 为 0 行；7 个账户快照今天都更新；广告相关 9 个自动程序近 7 天 0 次失败。
阻塞 CTS 10/22：官方账户用接口建不出带表单的留资广告（草稿校验 1815089）。我最初误写成「条款没点、管理员要点」，PM 指出条款点过很多次，仓库 10-06/10-09 记录证实这是接口老问题、要真人身份在广告管理器里建；素材池 5 条全是候选 0 条批准。
我今天合并的熔断探针主干接线正确但还没跑过——每日任务新西兰 06:00 才跑，今天那轮在合并之前。
