---
id: 2026-11-15-activate-paused-ad-card
title: 把一条暂停的广告开起来，必须先出确认卡
status: decided
owner: agent
decided_on: 2026-11-15
source: session:activate-ad-card
verify_by: 2026-11-22
verify_how: 开关默认关。用假编号跑这张卡：确认后只写一次并把回读记成在投且不加预算；已在投、广告组或系列不在投、计划闸不过、卡过期、开关关都不写；连点两次只写一次。
---

复用现有确认卡、开投计划闸和 flywheel_actions。动作是 ads.activate_ad。客户开关在 leads_config.activate_ad_card，默认关。不出迁移，确认前重新读广告状态。
