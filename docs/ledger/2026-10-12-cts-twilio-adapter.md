---
id: 2026-10-12-cts-twilio-adapter
title: CTS 电话换用 Twilio 试用做第一次真实测试：适配器写好了，字段还没用真实回调核对
status: done
owner: agent
decided_on: 2026-10-12
source: session:96dc6edf
verify_how: PM 注册 Twilio 试用并填好环境变量、回「同意」后：应用迁移、建连接、用已验证手机打 3 通（接听/不接/带录音），查原始事件、通话状态、CRM 触点各一条、录音待下载
done_on: 2026-10-12
done_ref: pr:2468
---
VoIPLine 要先充值买席位且 PM 的卡被拒，PM 回「换 Twilio」。适配器与测试在本 PR；清单见 docs/clients/cts/2026-10-12-twilio-setup-checklist.md。
没做：员工点击拨号（外呼）、录音下载/转写/摘要、Twilio 真实回调字段核对。
