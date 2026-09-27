---
id: 2026-09-28-ledger-body-and-frozen-field-checks
title: 台账解析器加了两条校验——正文不超 5 行和冻结字段不许改
status: done
owner: agent
decided_on: 2026-09-28
source: pr:2137
verify_by: 2026-10-05
verify_how: 造两张故意违规的卡跑 `npx vitest run src/lib/ledger`：①正文 8 行超过上限，新卡必须红；②用 checkFrozenFields 喂一份改写了 verify_how 的卡，必须返回违规。两张都还能通过 = 没做
done_on: 2026-09-28
done_ref: pr:2151
---
实现卡 2026-09-28-ledger-rules-not-enforced-by-parse 的修法。
