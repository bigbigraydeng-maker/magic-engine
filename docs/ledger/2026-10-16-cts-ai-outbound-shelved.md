---
id: 2026-10-16-cts-ai-outbound-shelved
title: CTS AI 外呼先搁置，PM 说晚些再开发；已有设计稿和接线原型，续做前先让 PM 再拨一通验证改后的中文开场与语言锁定
status: decided
owner: pm
decided_on: 2026-10-16
source: session:96dc6edf
verify_by: 2026-10-30
verify_how: PM 说要续做时：先跑原型再拨一通中文，确认开场告知完整播完且全程不乱切语言；然后按设计稿 v0.2 §8 的顺序做独立后台程序、按客户开关、别再打识别、预算上限；真实客人阶段前还要 CTS 书面同意、律师核对新西兰规则、每月预算上限
---
已有：设计稿（docs/specs/2026-10-14-cts-ai-outbound-call-design-v0.2.md，已合并）、接线原型 scripts/voice/proto/twilio-openai-bridge-proto.ts（只拨 PM 自己的两部手机）。
首批用途 PM 已定：新线索首次跟进。英文试拨成功（客人说完到 AI 开口约 0.5 秒）；中文试拨发现开场被杂音打断、语言乱切，已改成系统固定播放告知 + 语言锁定，改后未再试。
