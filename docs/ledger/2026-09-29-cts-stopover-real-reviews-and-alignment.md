---
id: 2026-09-29-cts-stopover-real-reviews-and-alignment
title: CTS官网China Stopover行程卡片——布局对齐已修，评价来源改为真实Google评价；待复核合并
status: decided
owner: agent
decided_on: 2026-09-29
source: session:6a554a1d
verify_by: 2026-10-03
verify_how: 用无头浏览器（如 Playwright）在固定视口（如 1280×800）打开 https://www.ctstours.co.nz/tours/china/stopover，按 doc:docs/clients/cts/2026-09-29-china-stopover-real-reviews.md 的「验收清单」逐项核对（卡片渲染尺寸对齐、评价来源与内容真实性、自动更新回执或前后对比证据）；清单中任一项不满足＝没生效或没合并。
---
CTS 网站仓 chinatravel（不是 magic-engine）的一次改动，改动范围、验收细节与客户业务事实见
doc:docs/clients/cts/2026-09-29-china-stopover-real-reviews.md，本卡只留指针。
PR 现为 chinatravel 仓的草稿 chinatravel#215，已发复核请求给子牙（架构+挑刺+客户视角三方过一遍才合并），未合并前真站不会变。

本卡先停在 `decided`，不填 `done_on`/`done_ref`：`done_ref: pr:215` 会被 `scripts/ledger-check-refs.sh` 按本仓（magic-engine）的 `GITHUB_REPOSITORY` 去查，查到的是 magic-engine 自己的 PR #215，跟这条真正的改动（chinatravel 仓的草稿 PR）完全无关，会把外仓未合并的改动误判为可信凭据。合并后再补一张 `done` 更新：`done_ref` 用本仓能无歧义核验的凭据（例如指向一份记录了 chinatravel 合并 commit / PR 链接与核验截图的 `doc:docs/...` 证据文件），不要直接填外仓的 `pr:<n>`。
