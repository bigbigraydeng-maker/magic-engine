---
id: 2026-10-24-render-cron-dispatcher
title: 把几十个定时任务收成 3 个调度入口，旧任务先别在服务器上删
status: decided
owner: agent
decided_on: 2026-10-24
source: doc:src/lib/cron/dispatch/catalog.ts
verify_by: 2026-10-31
verify_how: web 已部署后，用密钥 POST /api/cron/dispatch-frequent?dry_run=1 能返回本刻该跑的名单且不真正执行；确认返回不是 404 之后，才在 Render 同步 blueprint。同步后只剩 3 个 cron-dispatch-*，旧的逐条 cron 不再出现；cron_run_logs 里能看到 cron-dispatch-frequent 的行。
---
三个调度入口（每 5 分钟）取代原来大约 60 个定时任务。到点的旧接口仍在网站进程里跑，单条地址先留着。
524 是网关大约 100 秒掐断调用方；库里这些任务多数其实跑完了。拓客失败是 Google 地点账单没开。资讯偶发失败是模型额度用完。邮箱那条 401 是重复的旧任务，信已经在私信同步里收。
讲课片的旧地址已不存在，发布挂在工厂发布任务上。执行自动跑只做演练，每天选出的动作全被拦住，没有产出。
切流顺序：先等网站部署，再同步定时任务清单。同步会删掉清单里的旧任务。后台手工建的那几条要另外暂停。回滚是把新的 3 条暂停、把旧的恢复。
