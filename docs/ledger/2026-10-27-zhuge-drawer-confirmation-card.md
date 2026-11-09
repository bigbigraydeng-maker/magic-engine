---
id: 2026-10-27-zhuge-drawer-confirmation-card
title: 对话框里花钱、发布、改广告只出确认卡，不执行
status: done
owner: agent
decided_on: 2026-10-27
source: doc:docs/specs/2026-10-26-prescription-to-act-full-auto-design-v0.1.md
verify_by: 2026-11-03
verify_how: 内部账号在诸葛抽屉里说开投或加预算，出现确认卡且确认键按不下去或点了也不改广告；只说确认、好、可以不会执行。客户员工说同样的话不出卡。
done_on: 2026-10-27
done_ref: pr:3313
---
这一刀只接确认卡。只读和起草仍在另一条草稿里，这里不重做。
读不到的日上限、线索、素材、系列归属保持读不到，不填成通过。
代理人可以发起卡，不能点。点卡仍走原来的确认卡，点了也不改广告。
建议链如果被塞进花钱或发布的话，直接拒绝，不往下跑。
