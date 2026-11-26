---
id: 2026-11-16-crm-list-read-shadow-compare
title: CRM 名单提速第 2 步：两个名单接口暗中对照「改动记号」与完整读取，不启用缓存
status: decided
owner: agent
decided_on: 2026-11-16
source: session:96dc6edf
verify_by: 2026-11-20
verify_how: 读线上日志里 [crm-list-shadow] 行，连续 3 个工作日 mismatch 为 0、match 有数才算成；有 mismatch 就按 sampleIds 找漏盯的表或字段
---
PM 2026-11-16 回「第二步」。每次请求仍完整读，只多读一次记号计数并在响应后比对；环境变量 CRM_LIST_SHADOW=off 可关。
装上后凌晨 4 小时 CTS 已有 52 条记号（系统写入），说明记号变得很勤，第 3 步能省多少要看对照里 match 占几成。
