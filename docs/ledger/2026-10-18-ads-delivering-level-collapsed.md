---
id: 2026-10-18-ads-delivering-level-collapsed
title: 共享取数层把「广告在不在投」判错一层（系列开着就算在投，哪怕底下广告组全停），熔断判据 #2 对 CTS 因此永远判不了——这次不修，观察期后单独立项
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-11-03
verify_how: 立项前先核三件：①A0 观察期回执里 deliveringCampaigns 与 deliveringAdsets 长期不一致的账户有几个（只有 CTS 还是普遍）②除熔断判据 #2 外还有哪些调用方吃这个布尔值、改了会不会连带改判（逐个 grep 调用点，别只看注释）③改法是改共享层口径还是只给熔断单独取数。三件齐了再开 PR，按 A 级走（这层喂的是花钱的闸）
---
A0 探针首跑就实证了：CTS 官方账户 deliveringCampaigns:5 / deliveringAdsets:0 / adsetsSeen:8 —— 系列开着、广告组全停，共享层却判成「在投」。
位置 src/lib/ads-strategy/circuit-cap-facts.ts:147,181（把系列级与广告组级折叠成一个布尔）。
后果：判据 #2「在投但没花钱」永远判不了，因为它要同时成立「在投」和「没花钱」，而这里的「在投」口径偏宽。
风险自评 A 级：这层喂的是熔断闸，熔断检查又在人工信封分叉之前——判错一层会连 PM 自己的止损按钮一起影响。所以不顺手改。
按 18 号 10-18 定的：A0 只分层记录暴露它，不动共享层行为；等观察期（10/22 起算）结束后单独立项。
