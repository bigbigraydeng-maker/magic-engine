---
id: 2026-10-25-ledger-broken-card-spelling-repair
title: 读不出来的台账卡只许把编号改成文件名、来源改成同一个 pr 编号
status: done
owner: agent
decided_on: 2026-10-25
source: pr:3149
verify_by: 2026-11-01
verify_how: 只改编号对齐文件名、并把来源从「PR 井号加数字」改成同一个 pr 编号时，冻结检查不报错。改标题、验收说法、换成别的编号，或本来就合法的卡借这条改编号，仍然报错。
done_on: 2026-10-25
done_ref: pr:3149
---
这条只记录拼写修复本身。客户口令能不能从数据库读出来，仍由 2026-10-25-meta-client-token-db-verify 在到期日验收，本卡不代替那次验证。
