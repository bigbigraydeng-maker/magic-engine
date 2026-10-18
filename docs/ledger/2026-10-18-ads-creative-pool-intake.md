---
id: 2026-10-18-ads-creative-pool-intake
title: 已发布成片自动登记成广告素材候选（不再手填），批准仍只认人点；首次真写要 PM 点头
status: done
owner: agent
decided_on: 2026-10-18
done_on: 2026-10-18
done_ref: pr:2812
source: session:c668eb35
verify_by: 2026-10-21
verify_how: 看 CTS 的 ad_strategy_configs.creative_pool 是否从 3 条变成 15 条、新增的都是 status=candidate 且无 approved_by；再看那天 cron_run_logs 里 google-data-pullback-daily 的 creative_pool_intake 回执 added=12。East International 应仍为 blocked=facts:no_ad_strategy_config_row
---
只写 candidate，批准仍走人点的专用接口；池子所有消费方只认 approved，所以多一条候选不会花钱。
两道 fail-closed：配置读失败（fallback）不写，没有配置行（default）也不写——否则会凭空建行把客户静默拉进广告引擎（enabled 默认 true）。
当场试跑：生产 dry-run 只读跑过，CTS 考虑 15 条/已有 3 条/会补 12 条，East Inter 被第二道闸拦住。
真写路径没当场跑，因为写的是客户生产配置，须 PM 点头——PM 回「合」即为首次真写的授权，verify_by 为首次自动运行后一天。
