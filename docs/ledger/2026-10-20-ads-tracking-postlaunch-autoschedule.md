---
id: 2026-10-20-ads-tracking-postlaunch-autoschedule
title: 开投后 1 小时 / 24 小时的追踪读回由函数每小时自己补排；已于 10-20 15:25 开投，要核对 24 小时那份真的自动发出并读到了数
status: decided
owner: agent
decided_on: 2026-10-20
source: session:1f83deb6
verify_by: 2026-10-22
verify_how: 开投已发生（新西兰 10-20 15:25）。T+1h 读回已有一份（16:31 补发，样本不足的黄灯是正常的）；看 10-21 下午 4 点多是否自动发出 T+24h（ads.tracking_postlaunch.requested）、读回里的门不是灰，且每小时盯盘 ads-tracking-launch-watch 一直 spend_seen=true；不是就查盯盘配置（client-config.ts 的 launch_watch）和盯盘的运行记录
---
开投已于 2026-10-20 15:25（新西兰）发生，系列编号发布后没变，盯盘从 03:20Z 起每小时都看到本次系列有花费。盯盘窗口、系列、预计开投日写在 src/lib/ads-tracking-preflight/client-config.ts 的 launch_watch。
T+1h 和 T+24h 和 96 小时的盯盘都从「第一次见到本次系列有花费」起算；花费按系列汇总读，往同一个系列下新增广告组会自动算进来。决定逻辑在 launch-watch.ts，函数在 src/lib/inngest/functions/ads-tracking-launch-watch.ts。
核对日放在开投后第 2 天（10-22）；日历提醒已同步。
