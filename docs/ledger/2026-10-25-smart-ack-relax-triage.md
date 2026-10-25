---
id: 2026-10-25-smart-ack-relax-triage
title: 智能安抚放宽三道闸（数字闸删掉、Sue 不再当成起诉、邮箱不算链接），CTS 实测 60 条里 57 条用上模型且措辞全不重复；开关仍默认关，未对任何客人生效（PM 回「放宽」）
status: decided
owner: pm
decided_on: 2026-10-25
source: session:96dc6edf
verify_by: 2026-11-07
verify_how: 本地分支 feat/smart-ack（本卡写入时未推远端）。①跑 `npx vitest run src/lib/messenger/smart-ack src/lib/inngest/functions/__tests__/conversation-inbound-autoack` 应 203 条全绿；②跑干跑脚本 `node --env-file=<主目录>/.env.local node_modules/tsx/dist/cli.mjs scripts/smart-ack-dryrun.ts --client <CTS 的 client id，见 CLAUDE.md §9> --limit 60 --days 120 --out <本地文件>`，`smart:model_ok` 应 ≥ 24/60（40% 门槛），回退项逐条看是否都属「该回退」；③查 CTS 的 clients.leads_config->smart_ack 仍为空或 enabled≠true（= 开关没开、线上行为与放宽前逐字相同）；④真要开之前，PM 本人先看一遍干跑报告，再由 PM 说开
---
起因：v0.1 干跑只有 27%（30 条里 8 条）用上模型，低于 40% 门槛，我建议停；PM 2026-10-25 回「放宽」。查出不是模型不行，是三道闸误杀——数字闸拦掉 20/30（客人自己的电话和「Golden China - November」这种团名）、投诉词 `sue` 匹配到客人太太的名字 Sue（一条 4167 字高价值定制咨询被当投诉）、链接闸把客人邮箱域名当成垃圾链接拦掉 17/30。
改法与逐条证据见设计稿 §10（放宽）、§11（机器复审 5 条）、§12（写了没做 / 口径说准的 3 条）：判据收到只剩高确信规则，回复侧补上承诺过却没调的 `evaluateClaims`、数字词、分隔符混淆、英文正面判断、去重口径。
当场试跑（CTS 近 120 天 60 条真实首条进线，只读未外发，退出码 0）：54/60 用上模型，措辞不重复，6 条回退逐条核对都该回退；每处修复都做过变异测试。
红线：开关 `clients.leads_config.smart_ack.enabled` 默认关且读失败当关；任何失败都退回固定英文句；末尾由代码固定追加「这是自动回复」。开开关是另一次授权，开之前要先补回退率熔断并对设计稿 §12 三条各有结论。
遗留：每日上限是软上限、且渠道持续发送失败时模型调用次数无约束（§12 第 3 条）；A 级，PR #3115。
