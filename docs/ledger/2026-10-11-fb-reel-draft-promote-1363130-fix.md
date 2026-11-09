---
id: 2026-10-11-fb-reel-draft-promote-1363130-fix
title: Facebook Reel「草稿转正」旧做法被 Facebook 拒绝（1363130），改为翻视频本身并回读确认
status: decided
owner: agent
decided_on: 2026-10-11
source: session:7c3226a9
verify_by: 2026-10-14
verify_how: PR 合并后，下一条需要转正的草稿 Reel（讲课片「真发」或工厂工单转正）走新路径，回读 Facebook 该视频 published=true；若仍报错看 lecture-publish 回执里的 FB 原文。当前仍缺：工厂主线工单（content_work_orders）没有任何自动转正入口，要另开卡（涉及工单状态同步、首评、发布信号会触发下游建暂停广告草稿）
---
发现：promoteReelToPublished 对已上传完的草稿再调 finish 接口，Facebook 返回 400（code 6000 / 1363130 Video Upload Is Missing）。CTS 主页 2026-10-11 实测，PR 2450 已记录。
实测管用的做法：POST /{video_id} 带 published=true 返回 success，再回读 published=true。
本次只改转正函数（翻视频本身 + 回读确认，失败即抛）并补测试；不动工单状态、不补发布信号、不处理首评。
