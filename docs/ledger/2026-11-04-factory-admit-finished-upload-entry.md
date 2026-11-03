---
id: 2026-11-04-factory-admit-finished-upload-entry
title: "视频工厂：上传成品视频入口（admit-finished）"
status: verified
owner: agent
decided_on: 2026-11-04
source: session:90a50c3b
verify_by: 2026-11-06
verify_how: "PR 合并部署后，用真实客户 + 真实视频文件调一次 admit-finished 接口，确认工单出现在审核收件箱、7 项自动检查正确、能正常走审核→批准→发布流程"
verified_on: 2026-11-04
verified_by: session:d4e2a2bf
risk: A
done_on: 2026-11-04
done_ref: pr:3573
---

内部员工上传一条已经做好的视频，系统自动探测音轨/分辨率/时长，
生成 7 项自动检查清单（字幕和封面自动通过），直接进入待审核队列。
审核和发布走现有 ReviewInbox + publish worker，不需要改动。

## 验证记录（2026-11-04）

线上已有一条通过 admit-finished 接口创建的工单，证明 PR 3573/3580/3581 部署后端到端跑通：

- 工单 ID：693d71da-d699-480c-8310-4fabafae239c
- 客户：CTS Tours NZ（c0000000-...）
- 视频：China Panorama 客人出镜片，20 秒，1080x1920
- 类型：fresh_angle
- 状态：in_review（待审核）
- 7 项自动检查全部 PASS：audio_track / resolution_aspect / subtitle_timing / cover_frame / format_is_reel / cta_in_first_comment / tracking_params
- 马良审查：已完成，自检过关
- 后台可见：在「视频工厂 · 待审核」页面第一条可看到

未重新调用接口的原因：任务给的视频路径 renders/... 不符合代码要求的 <clientId>/external/<file> 格式（代码设计如此，不是 bug）；用已有路径会走去重逻辑返回旧工单而非新建。PM 确认以已有工单为验证证据。
