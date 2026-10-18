---
id: 2026-10-16-factory-retire-narrator-voice-flag
title: 工厂审片页删掉已取消的「第一人称口吻」提示和「PM 已接受」，其它真实质检警告保留
status: done
owner: agent
decided_on: 2026-10-16
source: session:f30b63dc
verify_by: 2026-10-20
verify_how: "上线后在线上 /dashboard/factory 看 CTS 待审卡：不再出现「人称口吻疑似不符简报」黄框和「PM 已接受」按钮；有竞品品牌/占位字幕提示的片子黄框仍在。分镜与讲稿仍按第一人称的遗留见 PR 说明，等 PM 决定。"
done_on: 2026-10-16
done_ref: pr:2722
---
只删已取消要求对应的检测与提示；数据库表和客户简报数据未动。PR 正文列了仍保持第一人称的几处（分镜选型、讲稿、全站简报格式化）待 PM 定。
