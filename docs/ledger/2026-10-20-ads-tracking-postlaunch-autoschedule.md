---
id: 2026-10-20-ads-tracking-postlaunch-autoschedule
title: 开投后追踪读回的盯盘：本期（10-21 起）不适用；下一期开投前要按目标（播放量 / WhatsApp 对话）另设计「该看什么数」再配
status: decided
owner: agent
decided_on: 2026-10-20
source: session:1f83deb6
verify_how: 下一期开投前：为播放量 / WhatsApp 对话目标设计各自的「该看什么数」（现有读回判的是点击 / 落地页浏览 / 留资，对它们会天天误报），再在 client-config.ts 配 launch_watch；T+24h 自动补排的真实核对留到那一次（本次开投的 T+24h 因系列已暂停、盯盘配置已拿掉，不再核对）
---
开投后读回由函数每小时自己补排的机制已上线：10-20 15:25（新西兰）开投后，T+1h 读回已有一份（16:31 补发），盯盘从 03:20Z 起每小时都看到本次系列有花费。
10-20 当晚 PM「全停并重排」，旧系列（官网点击）已暂停，本期新系列目标是播放量 / WhatsApp 对话，所以 10-21 起 CTS 的 launch_watch 整段拿掉（client-config.ts 里有说明），T+24h 不再核对。
决定逻辑在 launch-watch.ts，函数在 src/lib/inngest/functions/ads-tracking-launch-watch.ts。设计「按目标看什么数」是后续活，做之前这张卡保持 decided。
