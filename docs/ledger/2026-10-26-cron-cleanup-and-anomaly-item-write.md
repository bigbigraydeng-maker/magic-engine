---
id: 2026-10-26-cron-cleanup-and-anomaly-item-write
title: 运行记录清理不再被超老的未收尾行打断，异常检测写待办不再找不存在的字段
status: done
owner: agent
decided_on: 2026-10-26
source: doc:src/lib/cron/abandon-stale-runs.ts
verify_by: 2026-10-28
verify_how: 改动上线后看下一次运行记录清理和异常检测的运行结果。清理必须跑完，不能再报整数超出范围，并且开跑已超过预计时长的「正在跑」行要被收掉。异常检测的错误里不能再出现待办表缺少 payload 字段。还没上线就记「还没合并」，不算失败。
done_on: 2026-10-26
done_ref: doc:src/lib/zhuge/proactive.ts
---
运行记录清理在收掉停很久的「正在跑」行时，把耗时写成了整数列装不下的数，整次清理因此失败，后面的孤儿行也收不掉。
异常检测每天把建议写成待办时带了一个表上没有的 payload 字段，所以待办一行都没写进去。
两处都只改写入方式：耗时超过整数上限就记成上限；待办的关联信息改记到已有的 steps_json。
不改表结构。上线后的下一次自动跑才算验过。
