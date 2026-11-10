---
id: 2026-11-08-ev-expo-ab-old-video-winner-direct-eventbrite
title: EV Expo 旧视频组（旧组赢家）改直跳 Eventbrite 专用追踪链接、找人目标改链接点击，其余旧组仍落官网
status: done
owner: agent
decided_on: 2026-11-08
source: session:a8f89d06
verify_by: 2026-11-10
verify_how: Eventbrite 追踪链接页选昨天看 11/9：meevexpowinner 与 meevexpovideo 的售票数，各除以旧视频组、新视频组 11/9 的 Meta 花费；各不到 5 张票只记样本不够；新旧会互相抢量、预算不同，不当严格 A/B
done_on: 2026-11-08
done_ref: doc:docs/clients/ev-tech-expo/2026-11-08-ab-test-old-video-winner-direct-eventbrite.md
---
起因：Eventbrite 报表不认 UTM，官网嵌入的购票窗口卖的票分不出来源，Squid 同期在卖，旧组卖票无法追。
PM 定只把旧组赢家改直跳 Eventbrite 做对比；新建专用追踪链接，避免和新视频组共用链接混票。
