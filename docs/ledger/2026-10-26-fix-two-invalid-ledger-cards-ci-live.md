---
id: 2026-10-26-fix-two-invalid-ledger-cards-ci-live
title: 主干台账检查红了：今天两张卡格式不对，已修；GitHub 检查已恢复，格式错会让每个 PR 变红
status: decided
owner: agent
decided_on: 2026-10-26
source: session:ec90bb17
verify_by: 2026-10-28
verify_how: 在主干跑 npx vitest run src/lib/ledger，台账条目全部合法；再看最近几个 PR 的 Ledger entries valid 没有因这两张卡变红
---
10-26 主干上两张卡不合格：一张 source 写成 pr:TBD，一张正文里带了十几位的迁移文件名。GitHub 自动检查 10-26 凌晨恢复，之前被账单锁挡着没人发现。
修法：前者换成合规新卡（冻结字段改不了），后者只改正文；以后新卡 source 写 session: 或 pr:真实号，正文别贴长数字。
