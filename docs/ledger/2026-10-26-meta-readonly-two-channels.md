---
id: 2026-10-26-meta-readonly-two-channels
title: 仓库里有两条 Meta 只读通道（共享的 metaGraphGet 与处方种子自带的读取），合并前提未满足，别让它变成无人认领的欠账
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3195
verify_by: 2026-11-09
verify_how: 到期时核对三件事：一，`docs/ENV.md` 和 `render.yaml` 里是否已登记 `META_ADS_AI_GRAPH_VERSION`，并在 Render 上确认生产确实设了它；二，`src/lib/meta/graph-read.ts` 里 `metaGraphGet` 的路径白名单是否已补上 `promote_pages` 和 `<主页id>/leadgen_forms`（现在只放行 me、me/adaccounts、me/permissions、act_* 及 act_*/campaigns|adsets|ads|insights）；三，`src/lib/ads-strategy/plan-seed/deps.ts` 里自带的读取是否已改走 `metaGraphGet`。三条都满足就合并两条通道并把本卡标 done；不满足就把 verify_by 往后推并写明卡在哪一条。
---
现状：`src/lib/meta/graph-read.ts` 的 `metaGraphGet` 是共享的只读通道，但它在环境变量 `META_ADS_AI_GRAPH_VERSION` 没设时会直接报配置缺失（503），而这个变量没登记进 render.yaml 和 ENV.md；它的路径白名单也不含 `promote_pages`、`leadgen_forms`。所以第一刀（PR 3195）的 `plan-seed/deps.ts` 没法接它，自带了一条只读读取（令牌放请求头、分得清限流/令牌失效/缺权限、可推广主页有分页保护、错误原因过滤令牌片段）。这是真实的重复，本刀不收，由本卡认领。合并前提：先登记并确认生产已设该变量，再补齐白名单（白名单是共享传输层的安全边界，要单独审）。撤销「改走 metaGraphGet」这条必改的是统管 74，不是 119 自行放弃。
