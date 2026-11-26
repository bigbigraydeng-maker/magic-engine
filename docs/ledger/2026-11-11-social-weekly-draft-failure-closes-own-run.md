---
id: 2026-11-11-social-weekly-draft-failure-closes-own-run
title: 每周出稿中途断了，要当场标失败并进今日待办
status: done
owner: agent
decided_on: 2026-11-11
done_on: 2026-11-11
done_ref: doc:src/lib/inngest/functions/social-weekly-draft-failure.ts
source: doc:src/lib/inngest/functions/cloud-social-weekly-draft.ts
verify_by: 2026-11-18
verify_how: 部署后，下一次每周出稿如果在写库途中断线，这条运行记录当天应变为失败，今日待办出现「本周排期没跑完整」，同一时刻别的客户那条还在跑的记录不被改掉。重试次数仍是 0。
---
总开关和写库开关都没改。只补失败收口。断线发生在「给各客户派发」那一步、还没有客户时，只把这一次标成失败，不会给某个客户造一条待办。
