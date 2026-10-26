---
id: 2026-10-12-voice-finalize-mock-summary-counts-as-done
title: AI 接听收尾时，真摘要失败会悄悄换成假摘要还标「成功」——需要单独修
status: decided
owner: agent
decided_on: 2026-10-12
source: doc:docs/clients/cts/2026-10-12-voipline-privacy-and-retention.md
verify_how: 修好后让真实摘要请求失败一次，确认通话状态是失败或降级（不是成功）、可重试、且不进学习样本
---
src/lib/voice/finalize.ts：真实摘要请求异常时静默用 mockSummary 并写 done，且不进重试。A 级（数据质量，会污染以后的学习样本）。
修法方向：保留真实失败状态或标 degraded，允许重试，禁止进学习。不在 CTS 电话 PR 里修。
