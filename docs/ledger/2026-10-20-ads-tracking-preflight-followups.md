---
id: 2026-10-20-ads-tracking-preflight-followups
title: 开投前追踪检查的 16 项后续改进（独立审查提出，本期不做，都不挡开投）
status: decided
owner: agent
decided_on: 2026-10-20
source: pr:2919
verify_how: 逐项修好后各有一条会先红后绿的测试；16 项全做完（或被明确放弃）再把状态改成 done，并写明每项对应的 PR
---
位置在 src/lib/ads-tracking-preflight/ 下：①门是否适用目前只有「有没有官网表单」一个开关（judge.ts / types.ts），要做成通用的 na_gates 配置；②盯盘函数自己失败只写运行记录，要接进 ads_tracking_preflight_broken 待办（inngest/functions/ads-tracking-launch-watch.ts、pm-todo/ads-tracking-preflight-items.ts）；③env.account_billing 红灯要拆成一键可修的一类、怎么办写具体（judge.ts）；④makeGraphGet 与 meta/graph-read.ts 合并复用（meta-reader.ts）。
⑤数据集翻页满 3 页会静默截断（meta-reader.ts MAX_DATASET_PAGES）；⑥管理入口缺限流 / 去重（app/api/admin/ads-tracking-preflight/trigger/route.ts）；⑦冬令时切换时每日 07:00 会与 pm-daily-todo（UTC 19:00）撞车（inngest/functions/ads-tracking-preflight.ts 的定时）；⑧盯盘读运行记录只取最近若干行（状态 60 行、第一次看到花费 120 行），窗口拉长会漏（inngest/functions/ads-tracking-launch-watch.ts）。
⑨client-config 用对象下标取配置，传 constructor / __proto__ 会取到原型上的东西，要改成只认自己的键（client-config.ts）；⑩REQUIRED_JOBS 含 messenger-sync-hourly，对没有私信的客户永远红（env-reader.ts）；⑪sanitize 抹不掉 JSON 形态的令牌，例如带引号的键值对（sanitize.ts）。
⑫「已过预计开投日 24 小时」实际是按账户时区的日历日比较（次日 0 点起算），措辞和边界不一致，要改措辞或改成精确的 24 小时比较（pm-todo/ads-tracking-preflight-items.ts 的 seriesAlarmCandidates 和待办文案）；⑬ T+24h 补排只在「满 24 小时」那一刻之后的第一次盯盘才发，没有像 T+1h 那样的调度容差（launch-watch.ts 的 decideLaunchWatch）；⑭ 开投后读回的待办链接只是推广计划页的兜底链接，没有能看到读回数字和历史的专属页（receipt.ts 的 ItemLinks）；⑮ 盯盘自己读不到花费（令牌失效 / 接口报错 / 系列配置有问题）只写运行记录、不出待办（inngest/functions/ads-tracking-launch-watch.ts 与 ads-tracking-preflight-items.ts；注意第②项管的是「盯盘函数自己失败」，这条是「函数没失败、但读不到数」）。
⑯ 今日待办读「开投前体检」只取最近 14 行运行记录，而开投后读回和体检写在同一个任务名下：读回一直读不到数时盯盘每小时重发一次，十几个小时就能把当天的体检挤出这 14 行，待办会误报「最近几轮里没有这个客户的回执」（pm-todo/ads-tracking-preflight-items.ts 的 loadRows；修法是按阶段分开取，或加大回看行数）。
