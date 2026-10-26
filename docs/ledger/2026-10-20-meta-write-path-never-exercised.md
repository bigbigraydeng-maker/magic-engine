---
id: 2026-10-20-meta-write-path-never-exercised
title: 内核「真写 Meta」那一步至今没有被真实执行过——两次止损成功都是空操作（目标本来就停着），写入、撤回、回读验证对真实变化是否有效没有生产实证
status: decided
owner: pm
decided_on: 2026-10-20
source: session:c668eb35
verify_by: 2026-11-03
verify_how: 开投后在 A 方案上由 PM 明确点头做一次真实小动作（例如「预算降 20%」，业务有真实影响），读 action_runs 三步：apply 的 applied 为 true 且 Meta 端设置真的变了，readback 验证通过；再按需验撤回。读到真实变化的记录才算验过；空操作不算。
---
2026-10-19 T3/T4 两次 ads.pause_campaign 都 succeeded，但 apply 输出 applied:false、prior_status:PAUSED，没有调用 Meta 写接口。
所以授权、快照、回读、验证这条链有实证，写入 Meta 与撤回对真实变化是否有效没有。
这不挡开投（开投期间 Agent 不自己动手），但挡「关演练开关」：没有验过的写入路径不能放给自动执行。
需要 PM 点头，因为验证必然产生真实业务影响。
