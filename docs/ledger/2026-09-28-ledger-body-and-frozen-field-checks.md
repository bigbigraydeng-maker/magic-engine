---
id: 2026-09-28-ledger-body-and-frozen-field-checks
title: 台账解析器加了两条校验——正文不超 5 行和冻结字段不许改
status: verified
owner: agent
decided_on: 2026-09-28
source: session:38d2a4d8
verify_by: 2026-10-05
verify_how: 造两张故意违规的卡跑 `npx vitest run src/lib/ledger`：①正文 8 行超过上限，新卡必须红；②用 checkFrozenFields 喂一份改写了 verify_how 的卡，必须返回违规。两张都还能通过 = 没做
done_on: 2026-09-28
done_ref: pr:2155
last_checked: 2026-10-10
check_note: 本地测试实跑通过：7 文件 89/89 通过
verified_ref: doc:docs/ledger/evidence/2026-09-28-ledger-body-and-frozen-field-checks--2026-10-10.md
---
后续：6 张老卡的 title/verify_how 被 YAML 空格# 截断（夜巡读到的也是截断版），需让夜巡改读原始文本——ads-d3-autopause-one-click-approval / ads-wp2-gateway-envelope-recheck / b2-changelog-and-ledger-correction / cts-title-cycle-stays-on / nal-messenger-outage-task-already-sent / pm-todo-five-kinds-merge-new-kinds
