---
id: 2026-11-05-ad-creation-must-go-through-me
title: 广告创建一律走 ME 草稿流程，禁止 agent 直接用 Meta MCP 建广告组/广告（PM 11-05 拍板）
status: decided
owner: agent
decided_on: 2026-11-05
source: session:ca3e0d15
verify_how: 下次给客户建广告组/广告，走 createDraftForApproval / promo-plan 草稿器（API POST /api/clients/[id]/meta-ads/draft），不调 ads_create_ad_set / ads_create_ad；核建出的草稿进了「等你点头的广告」队列、PM 能在 ME 一键开
---
PM 11-05 拍板，把 11-04「不许直接改预算/开关」扩到「创建」。起因：本窗口图快直接用 Meta MCP 给 CTS 建组F，PM 要在 ME 开却开不了——ME 当天同步不到（次日约 01:30 快照才反映）、不进 ME 送审队列、建错了 agent 删不掉也改不了名。善后：PM 手删组F，走 ME 重建；3 个新相似受众保留复用。细节见记忆 feedback-ad-creation-must-go-through-me-2026-11-05。
