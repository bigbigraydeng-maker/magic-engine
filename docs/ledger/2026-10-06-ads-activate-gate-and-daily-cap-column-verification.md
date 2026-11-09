---
id: 2026-10-06-ads-activate-gate-and-daily-cap-column-verification
title: 核实两个广告口子：「开广告只验登录」部分属实，「生产库缺日预算上限列」属实——都还没修，等 PM 定
status: decided
owner: pm
decided_on: 2026-10-06
source: session:c3d495f1
verify_by: 2026-10-13
verify_how: 看这两处是否已有修复并合并；生产库 client_meta_ad_accounts 是否多出账户日预算上限那一列
---
口子一（建议 A 级）：广告系列「恢复」入口和草案「批准」入口，只验该客户的付费账号，没有 PM 授权事件、不查日上限和熔断；生产里 0 次使用，口子在、没人走过。
口子二（建议 A 级）：生产库该表只有 7 列，确实没有日预算上限列；读不到时一律拒绝（不放行）；经审批内核的暂停会被拒，直连 Meta 的暂停不受影响；内核广告动作在生产历史上 0 次运行。
修法：口子一让「恢复」进内核或先限管理员、批准要 PM 身份；口子二 PM 授权后补列并填上限，再当场试跑。全部未动手。
完整证据（文件:行号、查询结果、最坏情形）：docs/ledger/evidence/2026-10-06-ads-activate-gate-and-daily-cap-column-verification.md
