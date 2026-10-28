---
id: 2026-10-28-retire-huatuo-six-dimension-scoring
title: 华佗六维体检打分已停，开方不再读诊断
status: done
owner: agent
decided_on: 2026-10-28
source: doc:docs/specs/2026-10-26-prescription-to-act-full-auto-design-v0.1.md
verify_by: 2026-11-04
verify_how: 合并后调度清单里没有 diagnostic-weekly；诊断页打开是「已废弃」；有体检记录时贴入只写入最近一条编号且不读分数，没有记录时拒绝保存而不是报服务器错误。不跑迁移。
done_on: 2026-10-28
done_ref: pr:3345
---
刀 20。周一自动诊断不再进调度，诊断页和接口改为已废弃。诸葛抽屉、鲁班、复盘、入驻和今日待办不再读三张诊断表。表还在，不写迁移。
贴入只读最近一条体检的编号，不读分数和问题清单。没有体检记录就拒绝保存，因为处方的体检编号列仍是必填。
主开方插入草稿时仍写入空的体检编号，迁移没有放宽这列。这次不改表，也不改那条主路径。
