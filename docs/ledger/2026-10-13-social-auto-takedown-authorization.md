---
id: 2026-10-13-social-auto-takedown-authorization
title: PM 授权：已发图文帖出现四类硬错误可自动下架，但下架记录必须做好；记录和开关没建好前不开
status: decided
owner: agent
decided_on: 2026-10-13
source: doc:docs/specs/2026-10-13-social-daily-agent-design.md
verify_by: 2026-10-27
verify_how: 看设计稿 5A 的实施卡是否已开、记录表是否建好；没建好就确认自动下架开关仍是关的
---
PM 原话（74 号转述，10-13）：「可以自动下架，但是需要做好记录，并且这个记录很重要！」仅限错价格、错日期、错团名、链接坏。
不含 Story、不含禁用词命中；每天最多 2 条；PM 标一次「下架错了」就自动关闭。
实现按 A 级：新表只增不改 + 清单页 + 今日待办；设计稿批准前不写代码。
