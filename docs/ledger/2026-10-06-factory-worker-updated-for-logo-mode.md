---
id: 2026-10-06-factory-worker-updated-for-logo-mode
title: 出片机常驻进程已更新到带「logo 常驻开关」的版本，并出了两张常驻版草稿工单
status: done
owner: pm
decided_on: 2026-10-06
source: session:4878a887
verify_by: 2026-10-08
verify_how: 出片机日志每 30 秒在轮询、新工单能被领走渲完即正常；若出片异常，回退办法见交付说明第六之四节（换回 7b3cc092f 再重启）。
done_on: 2026-10-06
done_ref: pr:2313
last_checked: 2026-10-12
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
更新前版本 7b3cc092f，更新后 12ffc388e（PR 2313 合并提交）。更新前没有在渲的工单，重启后读回正常。
常驻版工单 a13cbd09 / e01c44d6 已进审核队列（草稿，未发布）。
