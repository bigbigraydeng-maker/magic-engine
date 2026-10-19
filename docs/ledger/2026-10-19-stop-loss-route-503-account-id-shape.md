---
id: 2026-10-19-stop-loss-route-503-account-id-shape
title: 测试抓到的第一个真缺陷：止损接口拿 Meta 的纯数字账户号去查 act_ 形式的库，生产里对任何客户都 503，页面「先全停/预算降 20%」同样用不了
status: decided
owner: agent
decided_on: 2026-10-19
source: session:c668eb35
verify_by: 2026-10-26
verify_how: 修复上线后重做 T3：对已停着的系列（NAL 的 Thruplay-物流-200/cbm）提交一次暂停，不再出现 503 timezone_unreadable，action_runs 里出现 1 条 ads.pause_campaign succeeded，且该条 input.ad_account_id 是 act_ 形式。再核页面按钮走同一条路由。
---
2026-10-19 11:51 NZ，18 号在 PM 授权下提交一次暂停，返回 HTTP 503 timezone_unreadable，库里没有新增 ads.* 执行记录。
根因：`stop-loss/route.ts` 把 Meta Graph 返回的 campaign.account_id（只有纯数字）直接交给 `resolveAccountTimezone`（按 act_ 形式查快照）和内核。库里 35 行 NAL 账户快照都是 act_<account-id>，对不上。
为什么没被测到：路由测试把 resolveAccountTimezone 整个 mock 成固定答案，并且原测试还断言交给内核的是纯数字 '<account-id>'——把缺陷当成了期望。
修法：路由入口一处规范化成 act_ 形式，取时区和交内核都用它；新增不 mock 时区、用真实形状的测试，变异还原缺陷会判红。A 级，PR 待审，PM 本人回「合」才上线。
