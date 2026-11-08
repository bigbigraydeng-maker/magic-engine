---
id: 2026-11-02-me-send-gate-p2-1a-await-pm
title: 第二步第一批（建表）：两张表和认领函数已建到生产库，等你亲手合并改动单 3511
status: decided
owner: pm
decided_on: 2026-11-02
source: session:33ebcd0b
verify_by: 2026-11-09
verify_how: 看是否已：①生产库仍有表 triggered_send_authorizations 与 triggered_sends、有函数 triggered_send_claim（11-02 已应用，线上迁移记录名 triggered_send_ledger，应用时刻 2026-11-02 01:51 UTC）；②改动单 3511 已由 PM 亲手合并，且主干上 supabase/migrations 目录里文件名以 _triggered_send_ledger.sql 结尾的那份迁移的 SHA-256 仍是 5d1343d176882a131f07577975c37ce723f429df19a2baee7bb788aa689036a6（与已应用的一致）。缺哪件就如实写缺哪件
---
这一批只建两张表和一个认领函数，并把新代码路径加进合并闸的高风险名单；不发任何信、不改任何联系人、客户看不到变化。碰数据库表，合并要 PM 亲手。
设计与次序：docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §10（P2-1a）。
2026-11-02 PM 读完审查后的改动说明，回「go apply」；已应用到生产库 CrazyContent：线上迁移记录名 triggered_send_ledger（应用时刻 2026-11-02 01:51 UTC）；应用的 SQL 与 PR 头提交里的文件逐字一致；读回全对，两表 0 行（细节：设计稿 §16.4）。
迁移文件之后不得再改。剩下一件：PM 亲手合并改动单（碰库表，机器不会自动合，agent 也不得用管理员权限）。
