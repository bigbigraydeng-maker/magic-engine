# 线路海报配方（tour_poster_v1）接入自动图片帖 + 「签过的 AI 海报可打真价」新规矩

权威任务说明（本文件唯一）。写入者：Claude Code 会话（PM 窗口 sid-aa469cf6）及其派出的实现助手；工作区 `~/Projects/magic-engine-tour-poster`，分支 `feat/tour-poster-recipe`，基线 origin/main `9491df6c1`（2026-11-14）。

## 目标
自动图片帖（每周起草 → 每日计划 → 人审 → 发布）在客户开启后，把挑中的真实照片经 Visual Studio 的「改图」模型（Muapi `minimax-h3-image-edit`）排成线路海报：照片 + 线路名 / 天数 / 起价 / 最近出发日 / 网址，用客户品牌色。海报上的字只来自已发布线路资料，不让模型自己编。

## PM 决定（原话与日期）
- 2026-11-15「现在开始安排接入老 ME，如果好用的话，我再推给新版 ME」
- 2026-11-15 选「改规矩允许写」：海报上可以写价格。
- 2026-11-15 CTS 品牌色以官网红金为准。

## 新规矩（替代「AI 图一律不能配真实价格」，仅限下面这一类）
一张 **AI 排版海报** 可以配真实价格，必须同时满足：
1. 它是由一张本身能打真价的照片（`client_verified` / `fde_shot`）排出来的——发布时**按原图当前的来源重新判**，原图被降级则海报跟着失效；
2. Magic Engine 团队成员（admin）看过海报、对过原图，签了字（`verified_by` / `verified_at`）；
3. 海报带价格时，即使文案没写价格，也按「这条帖子报了价」处理（防止价格藏在图里绕过闸）。
其余 AI 图规则不变。理由：试跑发现该模型会重画照片（兵马俑旁的马被重画），所以必须人对原图签字。

## 验收
1. `social_agent.image_post_recipe = 'tour_poster_v1'` 才启用；默认关，未开启的客户行为完全不变。
2. 海报文字只来自 `PublishedTourFact`（name / durationText / displayPriceText / 最近一个可售出发日 displayDate）+ `master_briefs.website` 的域名；品牌色来自 `master_briefs.vi_colors`（#rrggbb 校验）。缺品牌色 → 不出海报，退回原图，回执写原因。
3. 生成失败 / 超时 / 无输出 → 退回原图（现有行为），回执写原因；不重试 submit（防重复扣费）。
4. 海报存进 `visual-assets` 公共桶，新建一行 `client_assets`：`source='ai_generated'`、`status='analyzed'`、`mime_type='image/jpeg'`、`ownership='client_exclusive'`，`vision_metadata.poster = { recipe_id, recipe_version, source_asset_id, has_price, text_lines, cost_usd, provider_request_id, created_at }`。草稿 `image_asset_id` 指向海报。
5. 发布闸（`daily-plan-publish-runner` 用的 `judgePriceClaimWithSource` 路径）按上面三条判；共享判据放 `src/lib/assets/provenance.ts`，纯函数，带单测（允许 / 拒绝各路径）。
6. 签字：`PATCH /api/clients/[id]/assets/[assetId]/provenance` 增加 `{ action: 'confirm_poster' | 'revoke_poster' }`，仅 admin，仅对带 `vision_metadata.poster` 的素材；不改 source。素材库页面对海报显示「AI 海报 · 待对原图 / 已对原图」，附原图链接和签字按钮。
7. 成本记在 `vision_metadata.poster.cost_usd` 和图片帖步骤回执里。
8. UI / 客户可见文字不出现供应商真名（用 Visual Studio）。

## 不做
不改数据库结构；不接新版 ME；不自动发布；不动视频配方；不改写死的 CTS 网址（image-post-step.ts:110，另记后续）；不做中文（线路资料无中文名，另记后续）。

## 验证
`npm test -- <相关测试>`、`npm run type-check`、`npm run lint`；当场试跑：用 CTS 真实已发布线路 + 一张真实照片调一次（花费 ≤ 0.05 美元，不发布）。

## 后续事项
- 线路资料加中文名字段后出双语版。
- image-post-step.ts 写死 ctstours.co.nz 改为按客户配置。
- 测试通过后推给新版 ME（PM 决定）。
