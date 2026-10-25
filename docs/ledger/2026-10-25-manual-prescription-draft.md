---
id: 2026-10-25-manual-prescription-draft
title: 人工处方只能先存成草稿，周更不能盖掉它
status: done
owner: agent
decided_on: 2026-10-25
source: pr:3127
verify_by: 2026-10-27
verify_how: 合并部署后，在处方页贴一份人工草稿，页面能看到开方人，状态仍是草稿；下一个周二的自动开方不会把这份草稿批准或盖掉。
done_on: 2026-10-25
done_ref: commit:31b28b5204efd9f4ca15e4e9249fe96da65db5c2
check_note: 本机相关测试和类型检查已过。还没合并，所以生产上的周二自动开方还没验。
---
新入口只把给好的处方存成草稿。批准仍走原来的按钮，并且要再确认一次。「要求修改」会标成已拒绝。
不改表结构。没有已完成体检时存不进去。
