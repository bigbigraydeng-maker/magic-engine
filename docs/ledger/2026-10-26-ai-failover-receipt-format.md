---
id: 2026-10-26-ai-failover-receipt-format
title: AI 自动切模型的回执按 NextLoop 格式写成一行一条路径
status: decided
owner: agent
decided_on: 2026-10-26
source: session:4e60e40f
verify_by: 2026-11-02
verify_how: 看 PR3157 上线后第一次真实触发 OpenAI→DeepSeek 自动切时，Inngest receipt 或日志里能看到形如「调用方名 OpenAI→DeepSeek」每条一行的清单，而不是一句笼统的「已切换」。看得到=成。
---
NextLoop 切模型时打印形如「w4R:pJ Zen Free→550B；D1 Zen Free→550B；...auto-ladder→固定550B」，每条路径一行、从什么切到什么都写清楚。
我们昨天刚上 AI_FAILOVER_ALLOW_DEEPSEEK（PR3157），回执格式还没定。
目标：照抄这种格式写进 receipt。
