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
verified_ref: pr:3593
last_checked: 2026-11-04
check_note: "线上工单 693d71da 证明 PR 3573/3580/3581 端到端跑通：CTS 客人出镜片 20s 1080x1920，7 项自动检查全 PASS，马良审查完成，后台可见。PM 确认以此为验证证据。"
risk: A
done_on: 2026-11-04
done_ref: pr:3573
---

内部员工上传成品视频，系统自动探测并生成 7 项检查清单，直接进入待审核队列。
审核和发布走现有 ReviewInbox + publish worker。
