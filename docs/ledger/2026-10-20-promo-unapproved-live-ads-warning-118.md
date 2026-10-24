---
id: 2026-10-20-promo-unapproved-live-ads-warning-118
title: 推广计划页：计划未批准但 Meta 里已有广告在花钱时，顶部改红字提示（不再说「批准之前什么都不会发生」）
status: done
owner: pm
decided_on: 2026-10-20
source: session:ccc90b3d
verify_by: 2026-10-23
verify_how: 内部账号打开未批准计划的 /dashboard/clients/<id>/promo-plan：近 2 天确认有花费的账户显示红字（手动开的广告、ME 没有批准记录，要么补走批准流程要么到 Meta 暂停）；花费数据没跟上（新开投的花费次日才到）显示黄字「可能已经在花钱，请到 Meta 核对」；欠款停摆账户显示灰字「不会出广告」；快照 2 天没更新显示灰字；付费客户账号看不到这块。注意：开投当天页面只会出黄字，红字最早第二天
done_on: 2026-10-20
done_ref: pr:2945
---
PM 10-20 疑问「表里没看到批准的推广计划，怎么已经开始花费了？」（CTS 官方账户 10-20 手动开投，不经 ME 计划）。只读 ad_entity_snapshots / ad_daily_insights / ad_snapshot_captures，不新增 Meta 读取。终版口径：红字只给「近 2 天确认有花费」的账户；花费数据没跟上只出黄字且明说可能已在花钱；CTS 现在出黄字（官方账户当天花费行次日才到，主账户欠款停摆），不会出红字。仅内部账号可见。
