---
id: 2026-11-16-ads-predictive-early-warning-intraday
title: 日内广告预警只通知 FDE，不改 Meta、不迁库
status: done
owner: agent
decided_on: 2026-11-16
source: pr:3880
verify_by: 2026-11-18
verify_how: 主干合并部署后，在 leads_config 打开 ads_predictive_early_warning 的测试客户：下一趟 ad-intraday-spend-sample 跑完后 leads_config 有 receipts；有 FDE 且触发时 Resend 日志有 outbound；巡察 headline 或待办出现预警文案；仍不写 Meta。
done_on: 2026-11-16
done_ref: pr:3880
---
接线：日内采样后跑 runPredictiveEarlyWarning；成效来自心跳 actions；触达=FDE 邮件+巡察+待办；Telegram 仅占位。默认关。