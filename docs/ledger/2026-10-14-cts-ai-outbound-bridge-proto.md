---
id: 2026-10-14-cts-ai-outbound-bridge-proto
title: AI 外呼第一阶段接线原型已跑通一通英文试拨（只拨 PM 自己手机）；价格/打断/别再打/中文还没验，真实客人阶段还没开始
status: decided
owner: pm
decided_on: 2026-10-14
source: session:96dc6edf
verify_by: 2026-10-16
verify_how: 再试拨一通中文：问价格 AI 只说「同事回电」、中途打断 AI 能停、说「别再打」AI 道歉并挂断；记录反应速度与 OpenAI 真账单，对照设计稿成本表
---
原型脚本 scripts/voice/proto/twilio-openai-bridge-proto.ts：Twilio 外呼 → 音频流 → OpenAI Realtime（mini），不碰 CRM。
首通结果：客人说完到 AI 开口中位约 0.5 秒；对话自然；费用估算每通约 0.03 美元（仅 OpenAI 部分，估算）。
