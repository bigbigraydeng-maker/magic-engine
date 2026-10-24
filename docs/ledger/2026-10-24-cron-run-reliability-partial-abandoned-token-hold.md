---
id: 2026-10-24-cron-run-reliability-partial-abandoned-token-hold
title: 定时任务别把失败写成成功，别把中断写成一直在跑，坏掉的主页令牌别每小时重试
status: decided
owner: agent
decided_on: 2026-10-24
source: doc:src/lib/cron/run-logger.ts
verify_by: 2026-10-31
verify_how: 迁移应用到生产之后看三件事：条目失败的运行记录是 partial 或 failed 且失败条数大于 0；停在 running 超过预计时长两倍的行变成 abandoned，失败邮件里能看到这个数；Graph 190、缺主页角色、未核实公用令牌的客户不再每小时打接口，连接是 error 或进了暂停名单，今日待办有一条重连。迁移还没上之前，没有连接行的客户仍会重试。
---
部分条目失败要写成 partial（一条都没成则 failed）。清理任务把超时仍在 running 的行收成 abandoned，日报写出这个数。
坏主页令牌把已有连接标成 error；没有连接行就记暂停。这两种都会跳过，直到重新连接。待办走现成的连接待办，没有连接行的走暂停待办。
未核实公用令牌仍走原来的主页绑定待办，不重复下发。迁移文件只进仓库，这次不应用到生产。约束还没放行时，partial / abandoned 先写成 failed，错误说明里带前缀，避免行一直停在 running。
