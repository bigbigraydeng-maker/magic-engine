---
id: 2026-10-26-promote-pages-empty-vs-error-sample
title: 补一个样本：权限不足时 promote_pages / leadgen_forms 返回「200+空数组」还是「报错」（资格三态文案要靠它定稿）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3193
verify_by: 2026-11-16
verify_how: 等真撞上权限不足的账户或令牌（例如官方账户主页权限变化、令牌缺 scope）时，只读调用 promote_pages 与 leadgen_forms，记下原始返回形状（空数组还是 HTTP 错误）。到期前若仍没有样本，不造场景，续期或关闭并写明。不挡处方转计划草稿的第一刀（两态都按未知丢步骤，行为相同），只决定「读到 0 个——也可能是令牌看不到」这类文案要不要改。
---
设计稿 v0.6 §3 账户行与 §12.1 第 4 项的跟踪卡。
