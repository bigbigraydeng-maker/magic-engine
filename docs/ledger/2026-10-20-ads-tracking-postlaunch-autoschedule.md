---
id: 2026-10-20-ads-tracking-postlaunch-autoschedule
title: 开投后 1 小时 / 24 小时的追踪读回由函数每小时自己补排，开投当天要核对真的发出并读到了数
status: decided
owner: agent
decided_on: 2026-10-20
source: session:1f83deb6
verify_by: 2026-10-23
verify_how: CTS 10-22 开投后，看开始花钱后的整点里是否自动发出 ads.tracking_postlaunch.requested（T+1h），满 24 小时再发 T+24h；两份读回里的门不是灰。不是就查每小时盯盘函数 ads-tracking-launch-watch 的运行记录和 CTS 配置里的盯盘窗口
---
盯盘窗口写在 src/lib/ads-tracking-preflight/client-config.ts 的 launch_watch（开投日起盯 4 天，下一次开投要换日期）；决定逻辑在 launch-watch.ts，函数在 src/lib/inngest/functions/ads-tracking-launch-watch.ts。
开投时刻记为「第一次看到有花费的那个小时」，人手带真实开投时刻发的读回会被优先采用。
