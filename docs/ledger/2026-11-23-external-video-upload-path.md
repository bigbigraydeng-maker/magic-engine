---
id: 2026-11-23-external-video-upload-path
title: 外部成片过完三关后能出「传到广告账户」确认卡：上传步骤认 <客户>/external/ 下的文件
status: decided
owner: agent
decided_on: 2026-11-23
source: session:ec90bb17
verify_by: 2026-11-24
verify_how: 上线后对 CTS 黑五两条已过三关的工单点「收入素材库」，返回「已出上传确认卡」而不是 502；PM 确认后 review_ref 出现 meta_video_id
---
11-23 两条黑五外部成片三关全过，点「收入素材库」返回 502：上传那步只认工厂渲染目录 renders/，外部成片放在 <客户>/external/，被判「成片地址不对」。
修法：只在工单是外部上传时，多认本客户 external/ 目录下的文件（拒绝别的客户、../、外链、明文 http）；工厂成片判定不变。上传本身仍要 PM 点确认卡。
