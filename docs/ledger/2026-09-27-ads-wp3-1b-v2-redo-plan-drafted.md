---
id: 2026-09-27-ads-wp3-1b-v2-redo-plan-drafted
title: 广告 WP3.1b 上一轮照错设计稿，PM 拍板按 v2.1 权威版重做；本会话出重做方案初稿等 PM 认后再让 DeepSeek 动
status: decided
owner: agent
decided_on: 2026-09-27
source: session:d9b147f8
verify_by: 2026-09-30
verify_how: 打开 feat/ads-wp3-1b-v2 分支上的 docs/roadmap/2026-09-27-ads-wp3-1b-v2-redo-plan.md，看方案有没有被 PM 认（回一句「按此干」或类似），认了就翻 done+指向实现 PR；PM 三天没回或提出重大修改就翻 failed 说明原因。同时看 docs/specs/2026-09-25-ads-impact-wp3-design-v1.md 是不是 accepted 状态。
---
上一轮 PR #2087 照总纲 spec §3 G11 实现，跟真正的 WP3.1b 权威（v2.1）差 11 条。三方审也各自发现 4 条独立 BLOCKER。PM 2026-09-27 经小秘书窗口 local_2bc4fba6 口头拍板「按新版重做」，同时正式认 v2.1。
本会话产出：v2.1 spec 状态 draft → accepted；docs/roadmap/2026-09-27-ads-wp3-1b-v2-redo-plan.md 方案初稿；分支 feat/ads-wp3-1b-v2 从 origin/main = 48b8d030 起（旧分支不删，旧 PR #2087 保持草稿，新 PR 开出来后关掉留话）。
统筹在会话中已裁两件（方案照写）：B4 走人工信封（不走 kind 分派，生产库 46/46 learning_stage=NULL）；系列级两个旁路走 PROVIDER_WRITE_GRANDFATHERED 精确路径 + ROADMAP 欠账（v2.1 §0 明禁本轮新增 ActionKey）。append-only 触发器升 BLOCKER 本轮做。
PM 待拍板 4 件（回话前不动一行代码）：DROP 生产库那张错 schema 表 / CTS 100/50 给哪个 act_ 号 / NAL 目标 / 真按一次用哪条广告。
