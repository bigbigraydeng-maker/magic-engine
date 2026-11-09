---
id: 2026-10-10-cts-shanghai-reel-v5-approved-prepublish-done
title: CTS 上海 Reel 第三版 PM 已在后台点通过；发布前的四件事补齐，等每小时发布任务领走
status: done
owner: agent
decided_on: 2026-10-10
source: session:ccde6627
verify_by: 2026-10-13
verify_how: 查工单 fa4fdd89 的 status 应为 published 且 published_ref 非空（Facebook 页面能看到这条 Reel、首评在、链接带追踪参数）；若是 publish_failed 或仍 approved，按失败回执处理；发出后到 2026-10-13 记下首批播放与点击再判是否续投
done_on: 2026-10-10
done_ref: doc:docs/clients/cts/2026-10-10-shanghai-reel-v5-15s-brief-and-selfcheck.md
---
PM 2026-10-10 03:48 UTC 在后台对 fa4fdd89 点通过。发布前四件事（素材出处记录、当天重抓官网价格、首评过苏东坡、措辞）已补齐，见文档第九节。
【2026-10-11 更正】发布任务 2026-10-10 04:05 UTC 已领走，但因 Render 未设 FACTORY_PUBLISH_LIVE=true，只以草稿上传到 Facebook（video_state=DRAFT，/reel/（ID 见简报文档）/），**没有公开**；工单状态写 published 有误导性。转正需 PM 明确点头。没有起广告，没有联系客户。
【2026-10-11 已公开】PM 亲口说「发这一条」后，用 Graph 接口把草稿 （ID 见简报文档） 改成公开（2026-10-11 04:35 UTC），补发首评（评论 id （ID 见简报文档）），工单 published_ref 已更新为 PUBLISHED。系统自带的 promoteReelToPublished 对已上传的草稿报错（code 6000 / subcode 1363130），本次改用 POST /{video_id} published=true 才成功；已另开卡修。
