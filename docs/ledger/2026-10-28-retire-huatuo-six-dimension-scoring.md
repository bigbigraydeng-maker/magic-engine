---
id: 2026-10-28-retire-huatuo-six-dimension-scoring
title: 华佗六维体检打分已停，开方不再读诊断
status: done
owner: agent
decided_on: 2026-10-28
source: doc:docs/specs/2026-10-26-prescription-to-act-full-auto-design-v0.1.md
verify_by: 2026-11-04
verify_how: 合并后调度清单里没有 diagnostic-weekly；诊断页打开是「已废弃」；贴入处方不再要求先有体检。不跑迁移。
done_on: 2026-10-28
done_ref: commit:644b785be1c0885ae7c87083fa1c06a49467d76c
---
刀 20。周一自动诊断不再进调度，诊断页和接口改为已废弃。开方、诸葛抽屉、鲁班、复盘、入驻和今日待办不再读三张诊断表。表还在，不写迁移。
