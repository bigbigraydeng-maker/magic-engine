---
id: 2026-11-10-social-story-dm-window
title: Story 邀请私信的私信数先写进仓库，等判定表建好再验
status: decided
owner: agent
decided_on: 2026-11-10
source: doc:docs/specs/2026-10-29-social-wp1-readback-implementation-brief-v2.md
verify_by: 2026-11-16
verify_how: 判定表已在生产库、开关正好打开后，一条邀请私信 Story 在窗口结束加七十分钟后写出 counted 或 not_readable，不能写成 0。表还没建或开关没开时，发后成绩面板仍只显示已发出。
---
Story 私信数写入已合并的判定表，本包不新建表，也没有在任何库执行。
生产库还没建这张表。开关不是正好打开时不排期、不写判定。
规格见社媒读回实施说明里的私信窗口。不调 Meta。
当场没跑完整等待：这里没有事件服务器，也不能睡十几个小时。计数用单元测试盖住。
第一次真发出邀请私信并打开开关后，再看判定行是不是 counted 或 not_readable。
