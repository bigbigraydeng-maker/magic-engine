---
id: 2026-11-02-me-send-gate-p2-first-day-sales-email-rule
title: PM 定新线索第一天的规则：销售已发过邮件的，ME 不再自动发欢迎信；没发过的，ME 才在第二天早上自动发
status: done
owner: agent
decided_on: 2026-11-02
source: session:33ebcd0b
verify_by: 2026-11-20
verify_how: 看第二步 P2-1b 的改动单是否已合并，且它的测试覆盖了：锁内判「销售已发人工邮件」→ 终态跳过、排除 ME 自己发的信、销售没发才在第二天早上发、7 天最多 2 封照旧、读不到邮件证据就拦（不当作没发过）。只写进设计稿不算落地；缺哪条就如实写缺哪条
done_on: 2026-11-02
done_ref: doc:docs/specs/2026-11-02-me-send-gate-p2-design-v0.md
---
PM 2026-11-02 在 33ebcd0b 窗口回「按建议办」（总设计 §0 提的第二个待定问题：两封都发会第一天就用掉 7 天额度）。
与 129 号 CRM 跟进 SOP v1 的「这 1 封替代自动欢迎信」一致，落成发送关口。
