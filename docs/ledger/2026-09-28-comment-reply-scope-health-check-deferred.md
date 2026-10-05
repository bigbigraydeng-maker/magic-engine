---
id: 2026-09-28-comment-reply-scope-health-check-deferred
title: 评论回复权限主动巡检（不等失败）——不在这个 PR 做，列为独立后续任务
status: decided
owner: agent
decided_on: 2026-09-28
source: pr:2190
verify_by: 2026-10-12
verify_how: "查 GitHub issue / PR 列表有没有实现「主动查 client_oauth 客户的 Meta 令牌是否有 pages_manage_engagement」这条通道的 PR 或 tracking issue；没有就在 ROADMAP.md 补一条"
---
PR #2190 加了 `intent=comment_reply` OAuth 流程后第一次有路径拿到 `pages_manage_engagement`，
但检测通道纯反应式，客户部署后要等评论真失败攒够 `MAX_ATTEMPTS` 次才会被抓到（`SCOPE_REPLAYED_ON_REFRESH` 是 `null`，刷新令牌不会自动补 scope），中间几小时会白白失败几条回复。
Codex round 17 核实为真，不在这个 PR 做——需要一条新的主动通道，对每个 `client_oauth` 客户
真调 Meta Graph API（`listGrantedScopes`）查当前 scope，调用频率/缓存/降级要单独设计，
跟这个 PR"发现具体错误→验证→改掉"的性质不同；现有反应式通道是安全网，不是要立刻堵的洞。
