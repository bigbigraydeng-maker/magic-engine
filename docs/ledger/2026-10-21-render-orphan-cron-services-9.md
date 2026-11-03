---
id: 2026-10-21-render-orphan-cron-services-9
title: 服务器上有 9 个自动任务不在仓库清单里：5 个 PM 叫停过却没真停（现在空转），4 个调用的接口已失效（每次必失败）
status: decided
owner: agent
decided_on: 2026-10-21
source: session:ec90bb17
verify_by: 2026-10-28
verify_how: 用 Render 接口列服务，下面 9 个都显示 suspended，暂停后的事件里没有新的运行；src/lib/cron/registry.ts 白名单里这几条原因写明「已于某日在 Render 暂停」；以后把 render.yaml 任务注释掉时必须同一步在 Render 暂停，这条规矩写进 docs/PITFALLS.md；做一次 Render 服务清单对 render.yaml 加登记表的差集，只剩已知的外部任务和非定时服务。暂停前先要 PM 本人一句话。
---
2026-10-21 统管 18 号用 Render 只读接口对账：服务器上共 85 个服务，其中 10 个定时任务不在 render.yaml 里；baseline-domains-weekly 是登记过的外部任务不算，其余 9 个既不在 render.yaml 也不在登记表里（健康检查只看仓库清单，看不见它们）。
PM 叫停过却没真停的 5 个（render.yaml 和登记行只是注释掉，服务器上的服务不会因此消失）：email-reply-digest（9-3 叫停，每天跑）、factory-stock-refill（9-8，每周一）、execution-auto-run（10-7，每天，只跑演练）、job-boards-weekly（10-7，每周一）、team-memory-sweeper（10-7，每 30 分钟，14 天空跑 672 次、一次都没提炼）。现在都是空转：三个开关线上都没设；team-memory-sweeper 没有开关，上游一恢复它就会自己开始花模型钱。
调用的接口已失效的 4 个：lecture-publish（每 5 分钟，接口已删返回 404，最近 20 次全失败）、mailbox-sync-hourly（每小时，最近 20 次全失败，邮件同步早已改挂在 messenger-hourly 里）、linkedin-progress-post-mon 和 linkedin-progress-post-thu（LinkedIn 自动发帖随 Publer 移除已删，接口 404，下次运行 10-22 和 10-26 起失败；若 PM 其实想留 LinkedIn 自动发帖，那是另一个决定）。
为什么要紧：「PM 说停了」和「服务器真停了」对不上；失败的 4 个每天制造上百次失败记录，真失败会淹在里面。按资源优先级 §11：频率高、IMPACT 低、收入低 → P3，不抢别的活，等 PM 睡醒一句话处理。
修法：经 PM 同意后在 Render 上暂停这 9 个（暂停可随时恢复，不删除），再用一个小改动把白名单原因改成「已于某日在 Render 暂停」（改登记表属 A 级，并入 122 号窗口的登记表对齐那条一起走，不单开）。
