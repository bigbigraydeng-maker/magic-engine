---
id: 2026-10-25-crm-full-audit-client-not-using-it
title: CRM 整体功能审核：CTS 员工已 70 天没在 ME 里推进过阶段，邮件与 WhatsApp 两个渠道 AI 摘要为 0；五条对外联系渠道只有 WhatsApp 真能用（PM 要求「crm 整体功能审核一下」）
status: decided
owner: pm
decided_on: 2026-10-25
source: session:96dc6edf
verify_by: 2026-11-08
verify_how: 只读复核三个数字即可（脚本思路见 docs/audits/2026-10-25-crm-pages-user-view-audit.md §5）：①contact_stage_events 按 changed_by 分组，客户员工 info@ctstours.co.nz 仍停在 2026-08-16 且条数未增 → 问题没解；②conversation_briefs 关联 conversations.channel，email 与 whatsapp 的简报数是否还是 0；③带 follow_up_due_at 的简报里年份为 2023 的条数（当时 50/491）。另：CTS 的 telephony_connections.extension_map 是否仍只有 PM 一个号码、leads_config.email_compose 是否仍为 null
---
PM 要求整体审核。两位审计员分头查「对外联系能力」与「客人管理与流程」，每项分清界面入口 / 是不是空壳或被开关挡 / 生产真被用过没有；下面三个数字我自己用只读 SQL 复核过。
最重的发现：CTS 1236 条阶段变更里客户员工只占 12 条、最后一次 2026-08-16（70 天前），其余 1170 条是 AI 自动改、28 条是我们自己；28 张订单全部 PM 建、置顶 0 人、暂缓 1 人。**ME 的 CRM 现在是我们自己的后台，不是客户的工作台**——今天前半天清垃圾、改显示，都是在打磨一个客户没在用的工具。
最可能的原因（有相关性、无直接证据，必须问客户）：AI 摘要只盖了 Facebook 私信（930 段 → 525 条），**邮件 554 段、WhatsApp 28 段一条都没有**，而 CTS 的往来 55% 是邮件；名单引擎在最大的渠道上看不到任何理由，员工自然退回 Outlook。附带 491 条带跟进到期日的摘要里 50 条年份是 2023（模型幻觉，schema 没卡年份）。
对外联系五条路只有 WhatsApp 真能用：打电话因「登记表里只有 PM 一个号」对 CTS 7 个员工账号全部 422；「写第一封邮件」开关在 CTS 是 null（关着）且界面静默不渲染；发短信根本没有实现，系统却会建议「发短信」；Facebook 私信 90 天 3 成功 2 失败（报过没有主页令牌）。另有两个半截功能：待认领页全站无入口（41 段对话卡着）、暂缓有后端无前端。
下一步按 §11 打分：①先问清楚客户到底怎么干活（P0，业务问题不是技术问题）；②AI 摘要补到邮件与 WhatsApp 并卡住年份（P0/P1）；③电话号码登记做成界面（P1）。
