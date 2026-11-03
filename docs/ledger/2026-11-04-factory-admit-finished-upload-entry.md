---
id: 2026-11-04-factory-admit-finished-upload-entry
title: "视频工厂：上传成品视频入口（admit-finished）"
status: done
owner: agent
decided_on: 2026-11-04
source: session:90a50c3b
verify_by: 2026-11-06
verify_how: "PR 合并部署后，用真实客户 + 真实视频文件调一次 admit-finished 接口，确认工单出现在审核收件箱、7 项自动检查正确、能正常走审核→批准→发布流程"
risk: A
done_on: 2026-11-04
done_ref: pr:3573
---

内部员工上传一条已经做好的视频，系统自动探测音轨/分辨率/时长，
生成 7 项自动检查清单（字幕和封面自动通过），直接进入待审核队列。
审核和发布走现有 ReviewInbox + publish worker，不需要改动。
