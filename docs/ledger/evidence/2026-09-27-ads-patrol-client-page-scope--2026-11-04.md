# 证据 · 2026-09-27-ads-patrol-client-page-scope · 2026-11-04
fetched_at: 2026-11-04T21:37:30+1300
查了什么：生产库 flywheel_actions 里 action_type = ads.auto_pause_on_d3 的全部记账行（自动暂停出手前的归属判定），以及 10-09 夜巡已核的「没参与诊断」清单结论。
数字（带样本量、两边取数状态）：全库共 3 行，全部是 CTS，时间 10-27 / 10-29 / 11-03（NZ 次日凌晨 6 点巡检）。3 行 payload.ownership 都是 verdict=own，带 ads_checked（1 / 2 / 1 条广告）和 client_page_id（三行同一个 CTS 主页）；status 都是 dry_run_logged（演练开关未关，所以没真暂停）。三个广告组名字都带 CTS 的 7274 前缀，没有别的客户主页的广告组被算进来。生产库取数正常；Meta 侧无需取数。
来源/命令：Supabase 只读 SQL：select client_id, created_at, payload from flywheel_actions where action_type='ads.auto_pause_on_d3' order by created_at desc
结论：成。verify_how 三项——没有非 CTS 主页广告组被误切、D3 命中的广告组归属都核到 CTS 主页、每条记账都带 own 判定——在真实命中的 3 条上全部满足。
