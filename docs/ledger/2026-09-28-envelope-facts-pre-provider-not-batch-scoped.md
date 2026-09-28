---
id: 2026-09-28-envelope-facts-pre-provider-not-batch-scoped
title: envelope-facts.ts 算账户当日预算合计时，pre_provider 判据混用了所有历史 kernel_pre 快照，没有限定到本次批次
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-12
verify_how: 查是否出现过"广告组/系列在 Meta 后台已消失或不再返回，但仍在预算合计判据里按 ACTIVE 计入"的案例；若出现按 §11 重新打分
---
Codex 复审 PR #2019（熔断器运行时调用方 round 15）：`src/lib/capabilities/ads/envelope-facts.ts:150` 附近，`at === 'pre_provider'` 时用 `r.capture_reason === 'kernel_pre'` 过滤 `snapshotRows` 来算"账户当日预算合计"，但这个过滤只看 `capture_reason`，不限定到"这一次动作对应的那一批 `kernel_pre` 快照"。如果某个广告组/系列以前有过 `kernel_pre` 记录，后来在 Meta 后台被删除或不再出现（当前抓取会把它标成 `disappeared`），这条旧的 `kernel_pre` 行仍会被这个判据当成"当前状态"混进预算合计，可能让账户预算合计持续偏高，挡住本该在日上限内的合法加预算动作。

跟 `docs/ledger/2026-09-28-envelope-facts-cooldown-blind-to-kernel-own-changes.md`（P0，同一个文件）是不同问题：那条是"看不到 Kernel 自己刚做的改动"（方向是过松），这条是"预算合计可能偏高"（方向是过紧，把合法动作误挡）——失败方向更安全，不是资金泄露风险，是效率/可用性问题。

按 CLAUDE.md §11：频率低（需要"实体从 Meta 后台消失/不再返回"且"旧 kernel_pre 快照恰好带着非零预算"同时成立）· IMPACT 中（误挡的是本该放行的加预算动作，不是资金泄露方向）· 收入关联中（间接影响，不是直接资金风险）→ 不满足两个高，落 **P2**，跟 Codex 自己给的分级一致。

**为什么没在这个 PR 里现在就修**：`envelope-facts.ts` 是 WP2 既有代码，本 PR 没有改动这部分逻辑。要修对需要给快照抓取加一个"批次 id"或改用"这次 `snapshot_pre` 的 `captured_at` 锚点"来限定 `pre_provider` 判据只看本次批次的行，这是独立的小型改动，不是这个 PR 顺手带一句代码能做对的事，且碰的是资金闸判据，按规矩需要走复审。

**下一步**：给 `captureClientSnapshots(..., { reason: 'kernel_pre' })` 那次调用补一个批次标识（哪怕只是用这次调用自己的 `captured_at` 时间戳做锚点，`pre_provider` 判据改成只认"最新一批 kernel_pre"而不是"所有历史 kernel_pre"），跟 P0 那条（`kernel_post` 写入缺失）属于同一次 Kernel 执行链梳理，建议一起做。
