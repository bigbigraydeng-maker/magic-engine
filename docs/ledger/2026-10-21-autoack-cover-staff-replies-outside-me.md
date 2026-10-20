---
id: 2026-10-21-autoack-cover-staff-replies-outside-me
title: 并存模式上线或打开私信开关之前，员工在手机 App 或 Meta 后台直接回复也必须算已回复（限频现在只认经 ME 发出的记录）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:2972
verify_by: 2026-11-04
verify_how: 在 WhatsApp 切并存模式、或打开私信渠道开关之前，确认限频能看到员工在手机 App 或 Meta 后台直接回复的消息（例如读回声事件入库的出站消息）；没做之前不要切并存、不要开私信开关
---
限频只读「经 ME 发出」的发送记录，员工直接在手机 App 或 Meta 后台回复不会写进这张表，客人可能在员工已经回过后又收到一遍自动安抚（只会多发，不会漏发）。9-28 设计审查台账 #8、#9 已写「切并存前必补」。这是并存模式上线的前置条件，不是现在的缺陷。
