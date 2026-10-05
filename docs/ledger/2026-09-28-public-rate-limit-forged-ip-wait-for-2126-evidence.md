---
id: 2026-09-28-public-rate-limit-forged-ip-wait-for-2126-evidence
title: 公开接口防刷用的访客地址能被伪造——先等网站免费诊断上线、看到真实日志再改
status: decided
owner: agent
decided_on: 2026-09-28
source: session:e0fcfa89
verify_by: 2026-10-01
verify_how: pr:2126 已合并并跑过半天后，用 Render 日志查 "[site-check] visitor" 行；多数真实访问为 accepted=yes 且 xff 最右一跳是 cf 才算前提成立，才可迁移调用点；否则停下报告
---
public-scan/start、scan/run、discover/register、auth/self-register、leads/sanitize、conversions/route-guard 按 x-forwarded-for 第一段或 cf-connecting-ip 取地址，可伪造。
修法：把 pr:2126 里的 visitor.ts 提到共享模块再迁移；风险级别 A，需子牙+魏征+狄仁杰审。
9-28 卡点：pr:2126 未合并，生产 7 天内没有该日志行，不迁移（否则可能把真实用户全部挡掉）。
