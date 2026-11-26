---
id: 2026-11-15-patrol-cost-ad-health-todo
title: 广告巡察报单次成本连续偏高，并把广告体检警报带进今日待办
status: done
owner: agent
decided_on: 2026-11-15
source: pr:3865
verify_by: 2026-11-17
verify_how: 主干合并部署后，任选一名有目标单次成本的客户：若库内日行满足连续两天滚动成本偏高，当日 ads_growth_states 的 headline 或 patrolCost 有说明；同日有 alert/watch 或处方的客户，pm-daily-todo 最多一条 ads_health_patrol_alert。快照偏旧时只见数据旧提示、不亮花费灯。
done_on: 2026-11-15
done_ref: pr:3865
---
只读：用 ad_daily_insights 按广告组算滚动三天主结果成本，连续两个新西兰日超目标一成五则写入巡察结论；读 ad_health_narratives 进 headline 与待办。
无表结构改动、不写 Meta、不改预算。实现见已合并 PR 3865（本卡为漏写台账的补办）。
验收靠下一轮每日拉数与次日 NZ 早晨待办邮件，不用手点广告后台。