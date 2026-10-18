---
id: 2026-10-18-ads-autopilot-dry-run-stays-on
title: 广告「只演练不执行」开关在防烧钱刹车装好前保持开着
status: decided
owner: pm
decided_on: 2026-10-18
source: chat:统筹18号窗口 PM 10-18「保持」
verify_by: 2026-11-01
verify_how: 查 ad_strategy_configs 各客户 autopilot_dry_run 仍为 true；WP3.2 只读评估器上线并跑满 7–10 天、结论经子牙魏征审后，才由 PM 本人决定是否关闭
---
背景（119 号查库，统筹未独立核实）：CTS 和 NAL 的 autonomy_mode=bounded_auto，9 个 ads.* 键策略表均为 auto_approve；目前只因 autopilot_dry_run=true 才没有真实动作，45 天内 ads.* 授权决定为 0。
PM 10-18 拍板：开关保持开着，任何窗口不得自行关闭；关闭属 PM 本人决定，且须在防烧钱刹车（WP3.2）有真实数据之后。
