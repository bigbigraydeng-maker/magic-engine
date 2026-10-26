---
id: 2026-10-12-telephony-confirm-answer-before-real-traffic
title: 电话转接接真实客人线路之前，必须先做「员工按键确认接听」，否则语音信箱会被记成已联系
status: decided
owner: agent
decided_on: 2026-10-12
source: pr:2468
verify_how: 加按键确认后，用关机/占线的测试手机打一通，确认进语音信箱的那通被记成漏接来电、不是有效联系；再用正常接听的手机打一通，确认仍记成已接通
---
Twilio 转接员工手机时，运营商语音信箱接起来 Twilio 也认为「接通」，客人留言会被记成有效联系。本 PR 草稿只做 PM 自己手机的试用测试（测试前关语音信箱）。
接真实客人线路之前必须做：在 Number 上加确认接听的回调，员工按键才算接通。
