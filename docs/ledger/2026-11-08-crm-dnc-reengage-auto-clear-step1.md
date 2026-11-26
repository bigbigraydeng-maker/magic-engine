---
id: 2026-11-08-crm-dnc-reengage-auto-clear-step1
title: 「别再联系」的客人自己又填表或打进来接通 → 系统自动解除（第 1 刀，上线默认只演练，PM 看名单点头才真写）
status: decided
owner: agent
decided_on: 2026-11-08
source: session:96dc6edf
verify_by: 2026-11-13
verify_how: 合并部署后在 cron_run_logs 查 crm-dnc-reengage-sweep 至少有一轮成功、summary.cleared=0（演练）且 would_clear 的人数与 PR 里试跑名单一致；对不上先比对是谁多了/少了，不许打开 CRM_DNC_REENGAGE_WRITE_CLIENTS。
---
PM 11-08 在 76 号窗口回「开第 1 刀」。设计稿 docs/specs/2026-11-08-crm-ai-takeover-and-dnc-reengage-design-v0.md §3。
11-08 两位审查员（子牙、魏征）复审后收紧：只有填表和接通的来电自动解除，私信/回信只列出来请人看；表单勾退订的不解；解除触点用触发时间、固定 phone 渠道、写前重读。
本机用生产库只读导出的 24 位试跑：自动解除 2 位、请人看 1 位、挡住 21 位。定时任务本身要合并部署后才会第一次跑（演练），所以真跑的核对放在 verify_by。
打开真写（CRM_DNC_REENGAGE_WRITE_CLIENTS 填 CTS）必须 PM 本人看过名单说「解除」。
