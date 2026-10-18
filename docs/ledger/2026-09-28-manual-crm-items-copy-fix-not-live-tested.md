---
id: 2026-09-28-manual-crm-items-copy-fix-not-live-tested
title: pm-daily-todo 定时任务改了两处待办文案，当场没触发真实发送验证
status: done
owner: pm
decided_on: 2026-09-28
source: session:5b9407a2
done_on: 2026-09-28
done_ref: pr:2167
verify_by: 2026-09-29
verify_how: "下一个新西兰工作日早上（下一次 pm-daily-todo 自动跑）之后，打开 PM 那封每日待办邮件，找「被标成永久别再联系」或「Messenger 客户说要停」这两类条目（有才看得到，没有就等下次有），确认『点链接直接打开他的抽屉』这句新文案而不是旧的『就地展开』——文案对了就翻 verified，不对翻 failed"
last_checked: 2026-10-18
check_note: 10-18 复核：PR 2167 状态 MERGED（2026-09-28T11:18Z）；要对邮件里「被标永久别再联系」条目的新文案，夜巡读不到邮件，仍判不了，owner 已是 pm
---

PR #2167（B6）改了 `src/lib/pm-todo/manual-crm-items.ts` 两处员工可见的待办说明文字（"点行就地展开"→"打开他的抽屉"，跟 B2 的交互改动对齐），不改判断逻辑、不改数据结构。这个文件的输出会进每天早上真发给 PM 的待办邮件（`pm-daily-todo` 定时任务），按规矩改到这类文件要当场触发验证；但当场触发意味着手动多发一封真实邮件给 PM，为验证两个字的措辞改动这么做不合适，所以当场没跑，改用下一次自然发生的真实运行核对。
