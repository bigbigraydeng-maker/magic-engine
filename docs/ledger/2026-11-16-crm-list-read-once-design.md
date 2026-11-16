---
id: 2026-11-16-crm-list-read-once-design
title: CRM 名单治本方案（数据没变就不重读）：设计稿写好了，等 PM 回「开始」才动手
status: decided
owner: pm
decided_on: 2026-11-16
source: session:96dc6edf
verify_by: 2026-11-23
verify_how: PM 看设计稿（docs/specs/2026-11-16-crm-list-read-once-design-v0.md）回「开始」或「改」；开始后第 1 刀是数据库加计数器，要 Ray 亲手合
---
2026-11-16 只读实测：停一分钟后第一次打开名单要 5.5 到 8.7 秒，时间花在数据库服务内部，且跟读取量成正比；连续使用时 2.6 到 2.9 秒。连接保持的改法经对照实验证明不对症，没提交。方案是加一个按客户的变更计数器，数据没变就复用上次读到的原始数据，排序分栏照旧每次现算。分三刀，第 2 刀只对照不启用。
