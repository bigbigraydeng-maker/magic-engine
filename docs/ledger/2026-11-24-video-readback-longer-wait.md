---
id: 2026-11-24-video-readback-longer-wait
title: 成片传到广告账户后，ME 回读等到约一分钟，等 Meta 处理完再核对
status: decided
owner: agent
decided_on: 2026-11-24
source: session:ec90bb17
verify_by: 2026-11-25
verify_how: 下一张「把成片传到广告账户」确认卡点确认后，卡上结果是「已传到广告账户，回读到同一条视频」，工单 review_ref 有 meta_video_id
---
接 2026-11-23-video-readback-list。改成列账户视频后，CTS 黑五 C 条仍报回读失败：Meta 要处理完（这条 18 秒视频约 21 秒）才会出现在列表里，原来只等 12 秒。
改法：最多看 12 次、每次隔 5 秒（约一分钟），确认接口时限 120 秒内。所有客户适用。
