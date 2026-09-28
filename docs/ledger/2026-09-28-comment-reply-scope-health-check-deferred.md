---
id: 2026-09-28-comment-reply-scope-health-check-deferred
title: 评论回复权限主动巡检（不等失败）——不在 PR #2190 做，列为独立后续任务
status: decided
owner: agent
decided_on: 2026-09-28
source: pr:2190
verify_by: 2026-10-12
verify_how: "查 GitHub issue / PR 列表有没有实现「主动查 client_oauth 客户的 Meta 令牌是否有 pages_manage_engagement」这条通道的 PR 或 tracking issue；没有就在 ROADMAP.md 补一条"
---
PR #2190（评论自动回复卡死待办）加了 `intent=comment_reply` OAuth 流程（round 8）后，
第一次有路径能让客户拿到 `pages_manage_engagement` 权限；但检测完全是反应式的——
`comment-autoreply-stuck-items.ts` 只查已经 `failed`/`dm_sent`/越窗的行，客户部署后
要等真评论失败、且攒够 `MAX_ATTEMPTS=3` 次才会被现有通道抓到（`SCOPE_REPLAYED_ON_REFRESH`
是 `null`，刷新令牌不会自动补 scope，round 8 已查实）。中间有几小时窗口期会白白
失败几条自动回复。

Codex round 17 复审指出这个缺口，核实为真。不在这个 PR
里做：需要一条全新的主动检测通道——对每个启用评论回复且令牌来源是 `client_oauth`
的客户，真的调一次 Meta Graph API（`listGrantedScopes`）查当前 scope，是外部网络
调用不是数据库读，调用频率/是否缓存/失败降级都要单独设计，跟这个 PR 到目前为止
"发现现有代码具体错误→验证→改掉"的性质不同，是提一个新能力。现有反应式通道本身
是安全网，真出问题是几小时内失败几条回复，不是数据丢失，不是要立刻堵的洞。
