---
id: 2026-11-25-cts-expansion-adset-audience-network-observe
title: CTS 扩量组（120250648033550307）第三方版位 Audience Network 先观察、不排除，也不做全账户排除（PM 11-25 回「观察」）
status: decided
owner: pm
decided_on: 2026-11-25
source: session:8e4902d2
verify_how: 扩量组重新开投后，从 Meta 按 publisher_platform 拆分读回近 14 天花费；audience_network 占比 ≤2% 且无异常即维持；>5% 或单日明显偏高再提排除草稿（走 ME 广告流程）
---
11-25 实查（近 14 天，按版位拆分）：Facebook NZ$724.81 / 73 条线索，Instagram NZ$142.86 / 19 条，Audience Network NZ$2.98（约 0.3%）/ 0 条，unknown NZ$0.02。
理由：这是收线索的广告组，不是 9 月出事的按播放量优化组（那种才会把钱大量流到游戏奖励视频）；10-09 同类线索组也定了不动。全账户排除会影响共用账户里的其他客户，且改版位会让广告组重新进入学习期。
现状：扩量组所在系列当前暂停（CAMPAIGN_PAUSED）。没改任何 Meta 设置。
同轮另一件：PR 3493 已于 11-24 关闭，同样的修复已由 #3743 合进主干，无需处理。
