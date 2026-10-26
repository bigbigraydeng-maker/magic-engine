---
id: 2026-10-27-huatuo-diagnosis-scoring-retired
title: 华佗诊断打分废弃，开方不读诊断 [P22.ADS]
status: decided
owner: agent
decided_on: 2026-10-27
source: doc:docs/specs/2026-10-26-prescription-to-act-full-auto-design-v0.1.md
verify_by: 2026-11-09
verify_how: "打开设计稿第八节和第六节：六维打分、问题清单、周一自动诊断写成废弃；开方不读诊断；没有处方就开对话、有处方就审阅；入口叫处方、角色叫华佗，名字时间是 00:58；第八节写明诊断和开方是两套代码，huatuo 是开方自评不是诊断元数据；后续清理刀写明今晚不做，且行业映射不在清理里。缺一项=不成。"
---
华佗诊断打分废弃，见设计稿第八节。开方不读诊断，喂料是 Master Brief、客户需求和 FDE 录入。
入口叫处方，背后角色叫华佗。这个名字 00:58 已定。清理是后续刀，今晚不改代码。删表由 Ray 亲手合。
诊断和开方只是同一个名字。开方主路径读张骞，huatuo 是自评类型，不是诊断元数据。
行业映射留给开方，不在清理里。
