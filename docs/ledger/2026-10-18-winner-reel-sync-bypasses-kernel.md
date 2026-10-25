---
id: 2026-10-18-winner-reel-sync-bypasses-kernel
title: 「赢家 Reel 自动建广告」直接调 Meta 建广告、停广告，不经授权关卡；CTS 开着，现在新广告默认建成暂停所以不自动花钱，但把默认改成启用的那一刻就会
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-11-03
verify_how: 查三件：①winner_reel_sync_config 里 new_ad_default_status 是否仍是 PAUSED（2026-10-18 实查：CTS 为 PAUSED）②该程序是否已收进授权关卡（动作登记 + 提交入口），或至少把「改成启用」这个选项在代码里锁死不许自动 ③该程序累计 19 次出错的原因
---
winner-reel-sync/engine.ts 的 createAdFromPost、pauseAd 直接调 Meta（不经 Kernel），建广告的状态取自客户配置，可以是 ACTIVE。清点调研员发现、我核了代码与正式库。
这是 v1.0 地基 4 同一类问题（绕过授权关卡的花钱路径），与已有的鲁班谷歌商家发帖那张卡是兄弟。9-28 支柱稿与缺口稿 G3 已点名「meta-ads/execute、winner-reel-sync 等十条绕过」。
按 §11：频率 低（开关没动过） · 影响 高 · 收入 高 → P1；默认状态一变就升 P0。
