---
id: 2026-11-23-video-readback-list
title: 成片传到广告账户后，ME 回读改成「在账户视频列表里找这条」，不再每次误报失败
status: decided
owner: agent
decided_on: 2026-11-23
source: session:ec90bb17
verify_by: 2026-11-24
verify_how: 上线后下一张「把成片传到广告账户」确认卡点确认，卡上结果写「已传到广告账户，回读到同一条视频」，工单 review_ref 里有 meta_video_id
---
11-23 PM 确认了 CTS 黑五 A、B 两张上传卡，两条视频都真的进了主账户（Meta 里状态 ready），
但 ME 回读用的地址 `/act_x/advideos/<id>` Graph 不支持，回读每次都失败，卡记成「失败」、工单没记下视频编号。
改法：回读改为列账户视频（最多 3 页、只跟 graph.facebook.com 的下一页），新传的视频没列出来就隔 4 秒再看，最多 4 次。所有客户适用。
那两条已上传视频的编号要补记到工单（生产库写入，等 PM 点头）。
