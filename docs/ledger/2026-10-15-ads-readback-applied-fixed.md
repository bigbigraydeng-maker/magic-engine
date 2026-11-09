---
id: 2026-10-15-ads-readback-applied-fixed
title: 五个广告动作的回读产物补上 applied，并加一道读注册表的产物契约闸
status: decided
owner: pm
decided_on: 2026-10-15
verify_by: 2026-10-22
verify_how: "PR 合并后 grep src/lib/capabilities/ads/*.ts 的 readback output 都含 applied；跑 npm test -- src/lib/capabilities/ads/__tests__/output-contract.test.ts 应 6 条全过；并在注册表里临时加一个必填字段确认这道闸会变红"
source: session:90a50c3b
---
事实（已核实，不是推演）：注册表八个广告动作的 outputSchema 都 required ['applied']；产物口径是最后一个成功步骤的 output（gateway.ts:1209 lastOutputOf）；validateAgainstSchema 真的查 required（registry.ts:359）；不合格就 failRun 并对 provider_native 触发撤回（gateway.ts:1209-1216）。五个有实现的动作 readback 都没产出 applied。
更正我先前对 PM 说错的一句：这四个动作**不是「天天在跑」**——生产库 action_runs 全表只有 2 条记录（2026-08-21，都是 page.*），广告动作从来没执行过一次。所以这是「第一次真用就会踩」的地雷，不是正在发生的故障。
已修：五个动作各补 applied；新增 output-contract.test.ts 直接读注册表 required 判定（不硬编码字段名），变异验证过。
未做：没有动任何广告账户；没有改动作声明；真实链路仍未在真账户上跑过（广告动作至今零执行）。
