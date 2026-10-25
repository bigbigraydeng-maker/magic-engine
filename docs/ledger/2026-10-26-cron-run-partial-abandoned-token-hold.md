---
id: 2026-10-26-cron-run-partial-abandoned-token-hold
title: 定时任务别把失败写成成功，别把中断写成一直在跑，坏掉的主页令牌别每小时重试
status: decided
owner: agent
decided_on: 2026-10-26
source: session:9c08a71c
verify_by: 2026-11-02
verify_how: 迁移应用到生产后看三件事：条目失败的 cron_run_logs 行是 partial 或 failed 且 failed_count>0；停在 running 超过预计时长两倍的行变成 abandoned 且日报邮件写出条数；Graph 190/缺主页角色/未核实公用令牌的客户不再每小时打接口，连接 status=error 或进了 meta_page_sync_holds，今日待办有一条重连。迁移未应用时，没有连接行的客户仍会重试。
---
把 Grok 10-24 的 PR #3076 关掉按当前 main 重做（关 PR 决策见 2026-10-26-close-grok-cron-prs-rewrite-on-current-main）。
三件事：run-logger 按条数定 partial/failed；清理任务把超时 running 行收成 abandoned 写进日报；Graph 190 等三类坏令牌走连接 error 或 meta_page_sync_holds 跳过直到重连。
约束未放行时 partial/abandoned 先写成 failed、错误说明带前缀。暂停表不在时跳过写入，不把整轮挂掉。迁移文件只进仓库，由 PM 决定何时 apply。
