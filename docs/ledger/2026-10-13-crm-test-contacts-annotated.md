---
id: 2026-10-13-crm-test-contacts-annotated
title: CTS 两个测试联系人（电话接入测试号）已在客人页打上「测试」标注，没删、没动别的字段
status: done
owner: agent
decided_on: 2026-10-13
source: session:f53ba28d
verify_by: 2026-10-20
done_on: 2026-10-13
done_ref: pr:2520
verify_how: 打开 CTS 客人页搜两个测试号码尾号，确认两位客人身上有「测试联系人」的重要标记；回滚方法：把这两位的 important_note 清空（只在内容等于这句话时清）；标注本身不会把他们移出热名单，若热名单仍显示他们再问 PM 要不要推迟
---
PM 经统筹转述同意（2026-10-13）：只给两位测试联系人写 contacts.important_note = 「测试联系人（电话接入测试，非真实客人，请勿跟进）」，不动别的联系人、不删。
改前读回：两位的 important_note、important_due_at、pinned_at、snooze_until 全是空，do_not_contact 都是 false；阶段分别是 new 和空。改后读回：只有 important_note 变了，其余原样。
写法：按联系人 id 逐个更新，条件是 important_note 原本为空（防覆盖），写完读回。
注意：这只是标注，不改变名单归属；他们仍可能因 3 条漏接和 1 条接通触点出现在热名单。
