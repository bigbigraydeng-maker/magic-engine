---
id: 2026-10-22-pause-two-claude-scheduled-tasks-until-saturday
title: Claude 额度快用完：台账夜巡和 NAL 群聊导出两个定时任务先停到周六，周六再打开
status: decided
owner: pm
decided_on: 2026-10-22
source: session:ec90bb17
verify_by: 2026-10-24
verify_how: 周六在定时任务列表里把这两个任务重新打开（enabled 改回 true），读回确认下次运行时间已排上
---
PM 10-22 回「停上面两个定时工作」：台账夜巡（每晚 21:32）和 NAL 群聊导出（每天 05:01）已停，任务配置文件都还在。
停的原因：它们每次运行都会烧 Claude 额度，PM 本周额度快用完。
周六日历（10-24 22:15，Claude 额度新西兰时间周六 22:00 重置）里已写「重新打开」这一步。
