---
id: 2026-10-04-seo-cron-registry-health-watch
title: 把「每周一改标题」和「每日排名采样」登记进「没跑会喊」的健康检查名单
status: decided
owner: agent
decided_on: 2026-10-04
source: session:06ec010d
verify_by: 2026-10-09
verify_how: "合并后跑一次健康检查（checkCronHealth），这两条各自都不在「从没跑过 / 逾期」里：seo-meta-cycle-step6-completed 周期取 30 5 * * 1，上一轮是 10/5；seo-meta-rank-sampler 登记日 10/4，首轮 10/4 UTC 20:20 之后必须有 cron_run_logs 行。若周一那条因为没有客户开启而报逾期，要判断是不是预期的静默——不能直接把登记删掉。"
---
周一那条主链 2026-09-20 起在线上跑，但此前一直没登记：它哪天因为没 Sync 而安静地不跑，健康检查不会喊。每日采样是 2026-10-04 新增。
登记的周期不手抄：测试断言它们等于 roster.ts 的 META_CYCLE_CRON 和 rank-sampler.ts 的 RANK_SAMPLER_CRON。
同目录 registry.test.ts 另有 2 项老失败（render.yaml 对账 8 项差异、reel-batch-render 未登记），干净主干上同样存在，本卡不处理。
