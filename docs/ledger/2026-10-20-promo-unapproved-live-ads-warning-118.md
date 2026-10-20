---
id: 2026-10-20-promo-unapproved-live-ads-warning-118
title: 推广计划页：计划未批准但 Meta 里已有广告在花钱时，顶部改红字提示（不再说「批准之前什么都不会发生」）
status: done
owner: pm
decided_on: 2026-10-20
source: session:ccc90b3d
verify_by: 2026-10-23
verify_how: 打开 CTS 的 /dashboard/clients/<id>/promo-plan，选未批准计划：应显示红字「现在 Meta 里已有 N 个广告组在花钱…」并链到作战地图；没有在跑广告的客户显示新文案「批准之前，ME 的自动动作都不会发生」；读不到时显示「读不到广告花费」
done_on: 2026-10-20
done_ref: pr:pending
---
PM 10-20 疑问「表里没看到批准的推广计划，怎么已经开始花费了？」（CTS 广告 10-20 15:26 起手动开投，不经 ME 计划）。只读 ad_entity_snapshots / ad_daily_insights，不新增 Meta 读取。当场试跑：对 CTS 生产数据跑 loadLiveAds 得到 5 个在跑广告组、币种 NZD；NAL 3 个；今日花费数据还没同步时显示「还没同步过来」而不是假装 0。
