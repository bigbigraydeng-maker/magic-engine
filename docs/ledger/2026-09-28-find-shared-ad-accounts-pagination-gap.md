---
id: 2026-09-28-find-shared-ad-accounts-pagination-gap
title: findSharedAdAccounts 全表查询没分页——登记表超过单次上限时会静默截断，共享账户可能被误判成独占（现在只有 7 行，离上限很远）
status: decided
owner: agent
decided_on: 2026-09-28
source: session:c668eb35
verify_by: 2026-12-01
verify_how: 查 client_meta_ad_accounts 总行数是否接近单次查询上限（默认 1000，2026-10-18 实查 7 行）；或有人要给这个函数加调用方之前，先给它加分页（同文件之外已有 POSTGREST_PAGE_SIZE 的分页写法可抄，如 capabilities/ads/envelope-facts.ts）。未接近上限且无新调用方就展期，别为排期而排期
---
摘回自已关闭的 PR 2019 分支，2026-10-18 对主干重新核：src/lib/meta/client-ad-accounts.ts 的 findSharedAdAccounts 仍是一次无分页、无排序的 select，读失败时已 fail-closed（全当共享），但静默截断没有防护。调用方：google-data-pullback-daily、portfolio/diagnostics/loader.ts 等。
后果同原卡：别的客户在共享账户上的花费被算进本客户名下，可能误触发熔断或该拦的没拦。
按 §11：频率 极低（7 行 vs 1000 行上限）· IMPACT 高 · 收入 高 → 恰好一个低 → P1，但现实触发还很远；这张卡的价值是「新增调用方之前别忘了」。
