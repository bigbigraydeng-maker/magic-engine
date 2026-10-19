---
id: 2026-10-20-ads-tracking-postlaunch-autoschedule
title: 开投后 1 小时 / 24 小时的追踪读回由函数每小时自己补排；开投日未定，开投后要核对真的发出并读到了数
status: decided
owner: agent
decided_on: 2026-10-20
source: session:1f83deb6
verify_how: 开投日定下来、本次系列第一次有花费之后：看满 1 小时是否自动发出 ads.tracking_postlaunch.requested（T+1h），满 24 小时再发 T+24h；两份读回里的门不是灰；不是就查每小时盯盘函数 ads-tracking-launch-watch 的运行记录，以及 CTS 配置里的盯盘窗口和系列。开投日定了以后，把这张卡补上核对日（开投后第 2 天）并同步日历提醒
---
开投日还没定（等 122 / 119 做完再发布），所以这张卡暂时没有核对日。盯盘窗口写在 src/lib/ads-tracking-preflight/client-config.ts 的 launch_watch（先配到 11-30）；T+1h / T+24h 和 96 小时的盯盘都从「第一次见到本次系列有花费」起算，不看窗口日期。
决定逻辑在 launch-watch.ts，函数在 src/lib/inngest/functions/ads-tracking-launch-watch.ts；开投日定下来后在配置里加 expected_launch_on，过了那天 24 小时盯盘还找不到本次系列才会出开发待办。
