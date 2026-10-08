# 证据：2026-10-09-calendar-cts-video-audiences-growing · 取数 2026-10-09（NZ 时间，日历巡检只读核实）

日历事件：查一下 CTS 两个视频受众池开始长没长、断供提醒是否消失

## 结论

PR #2084 已合并(9-26)；ThruPlay 池 22200→27400(+5200)，Video viewers 50% 池 37800→43600(+5800)(10-08快照，Meta 下限值，样本=每日快照)；断供提醒 D11 自 9-27 起未再出现(最近一次 9-26)。10-07 快照显示 1000 是抓取异常，10-08 已恢复。

## 怎么查的

gh pr 2084 MERGED 2026-09-26；ad_entity_snapshots level=audience 两个池每日 audience_count_lower；ads_growth_states 9-27~10-08 problems 里无 D11。
