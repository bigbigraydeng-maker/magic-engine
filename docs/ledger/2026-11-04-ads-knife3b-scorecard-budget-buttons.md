---
id: 2026-11-04-ads-knife3b-scorecard-budget-buttons
title: 广告成绩单每行可以「加 10% / 加 20% / 减到多少」：加只提交、要 PM 本人批（成绩单下方有待批一栏）；减按止损直接执行，一次最多减 20%
status: done
owner: agent
decided_on: 2026-11-04
source: session:f765a75f
verify_by: 2026-11-10
verify_how: 合并部署后打开 CTS 广告健康页，成绩单每行有「调预算」；点开预览显示 Meta 当前预算和上次修改时间；对一个在投组点「减到」-10% 后 Meta 读回金额对得上；加预算提交后出现在「等 PM 批的加预算」一栏（加预算批准眼下会被信封快照问题挡住，见设计稿 §10）
done_on: 2026-11-04
done_ref: pr:3570
---
PM 11-04 回「做」。设计稿 docs/specs/2026-11-03-ads-knife3-spend-gate-and-budget-buttons-design.md §3、§10。
已知限制：加预算在新西兰白天几乎总被内核信封拒（快照只写有变化的行），要另修，修之前先跟 PM 讲清楚。
