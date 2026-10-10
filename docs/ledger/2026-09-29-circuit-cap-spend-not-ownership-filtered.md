---
id: 2026-09-29-circuit-cap-spend-not-ownership-filtered
title: 熔断日预算判据取数没按创意主页过滤，共用账户会把别家花费也算进这个客户
status: decided
owner: agent
decided_on: 2026-09-29
source: session:31cdcfa9
verify_by: 2026-10-13
verify_how: 查 circuit-cap-facts.ts 的 readLastCompleteSpend 有没有接上 PR 2118 的 ownership.ts 过滤；若接了，跑一次真实混主页账户核对花费数字变小；若仍未接，且届时已有共用账户+熔断真触发的生产案例，本卡按失败处理转 PM。
---
魏征复审 PR #2118（广告归属划分）时顺带发现：`src/lib/ads-strategy/circuit-cap-facts.ts` 的 `readLastCompleteSpend`（熔断判据 #2，客户日预算上限）直接按 `client_id`+`ad_account_id` 查 `ad_daily_insights` 整月/整天花费加总，没有经过 #2118 新建的 `ownership.ts` 任何过滤——共用 Meta 账户时，别家广告的花费会被算进这个客户的日预算合计。
方向偏向 fail-closed（多算花费只会让这个客户自己的熔断更容易误触发、卡住自己的自动化，不会让别人的广告被这个客户误暂停），所以不阻塞 #2118 合并，但要单独追踪修复。
