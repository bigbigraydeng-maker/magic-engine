---
id: 2026-09-25-agent-crm-shipped-cts
title: 同行渠道（旅行社 Agent 客户）页面上线、两张表已建，等第一条 AI 自动提取进表
status: done
owner: agent
decided_on: 2026-09-24
source: pr:1983
verify_by: 2026-09-29
verify_how: 生产库 agent_customers 出现 ≥1 行由邮件同步自动写入（非手动添加）且姓名/人数与原邮件一致；页面 /dashboard/clients/<id>/agents 能开、能改阶段
done_on: 2026-09-24
done_ref: pr:1983
last_checked: 2026-10-04
check_note: 本晚夜巡未逐项复核此卡，仅批量更新检查日期；待下轮夜巡补查
---
入口：客户工作台「同行渠道」卡。每小时邮件同步对 trade 域名联系人跑 AI 提取，pax>30 标 needs_review。
两张 migration（agent_customers 建表 / dedup 唯一索引）已 apply。测试向导窗口正带 PM 走一遍。
已知小尾巴（ROADMAP P3）：顶栏「最后同步」硬编码；大团客户 needs_review 过载。
