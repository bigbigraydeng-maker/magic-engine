---
id: 2026-10-26-audience-count-minus-one-d4-d11-false-alarm
title: Meta 对小受众返回人数 -1/0 表示「不报」，快照原样入库，现有 D4/D11 诊断可能对这类受众误报
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3193
verify_by: 2026-11-09
verify_how: 只读核对：snapshot.ts 把 approximate_count_lower_bound 原样存成 audience_count_lower（-1 照存）；d4-unharvested-audience.ts 的 isSmall 用「<= D4_AUDIENCE_FLOOR」，d11-audience-pool-starved.ts 用「<= floor」跳过。查近期诊断里有没有把「人数不报」的受众（例如 CTS 旧账户 Lookalike (1%) Leadform submitted 返回 -1）判成「人太少」的记录；若有，把 ≤0 当「读不到」处理（改快照入库口径或诊断判断，B/C 级小改），并补回归测试。到期前确认已查或已改。
---
2026-10-26 受众列表实测发现。不在处方转计划设计稿范围内，只开卡跟踪，别让这条事实只活在设计稿里。
