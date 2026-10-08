# 证据：2026-10-09-calendar-ads-patrol-own-adset-gate · 取数 2026-10-09（NZ 时间，日历巡检只读核实）

日历事件：查一下广告巡检是不是不再把别家的广告组算给 CTS

## 结论

PR #2118 已合并(9-28)；CTS(主页 <id>)最近一次巡检 10-08 的「没参与诊断」清单为 0 条，最近 8 天均 0 条；10-08 无 D3 命中；ads.auto_pause_on_d3 在 flywheel_actions 共 0 行(全库)。三项成立但 D3/自动暂停项是因为没有命中而成立，归属闸的 own 放行路径在生产未被实际触发。

## 怎么查的

gh pr 2118 MERGED；ads_growth_states(client=CTS) 9-26~10-08 逐日 excluded 数：2,2,3,2,2,1,0,0,0,0,0,0,0，10-08 problems=D4 hit+2×D10 not_comparable，无 D3；flywheel_actions action_type=ads.auto_pause_on_d3 → 0 行。
