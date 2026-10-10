---
id: 2026-09-30-ads-budget-cut-status-copy
title: 预算下调成功提示只确认预算变化，不猜测广告投放状态
status: done
owner: pm
decided_on: 2026-09-30
source: pr:2206
verify_by: 2026-10-07
verify_how: PR 合并后确认止损页面显示新预算、不显示“广告还在跑”；有状态警告时同时显示警告。
done_on: 2026-09-30
done_ref: pr:2206
last_checked: 2026-10-10
check_note: 连续两晚判不了：PR 已合并，但 verify_how 要求的线上实证夜巡取不到，交 PM 决定是否关卡
---
预算下调后不再声称广告仍在投放，避免缺少状态回读时误导操作人；22 项定向测试通过，生产状态待 PR 合并后验证。
