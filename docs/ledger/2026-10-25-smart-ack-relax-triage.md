---
id: 2026-10-25-smart-ack-relax-triage
title: 智能安抚放宽三道闸（数字闸删掉、Sue 不再当成起诉、邮箱不算链接），CTS 实测 60 条里 57 条用上模型且措辞全不重复；开关仍默认关，未对任何客人生效（PM 回「放宽」）
status: decided
owner: pm
decided_on: 2026-10-25
source: session:96dc6edf
verify_by: 2026-11-07
verify_how: 本地分支 feat/smart-ack（本卡写入时未推远端）。①跑 `npx vitest run src/lib/messenger/smart-ack src/lib/inngest/functions/__tests__/conversation-inbound-autoack` 应 203 条全绿；②跑干跑脚本 `node --env-file=<主目录>/.env.local node_modules/tsx/dist/cli.mjs scripts/smart-ack-dryrun.ts --client c0000000-0000-0000-0000-000000000000 --limit 60 --days 120 --out <本地文件>`，`smart:model_ok` 应 ≥ 24/60（40% 门槛），回退项逐条看是否都属「该回退」；③查 CTS 的 clients.leads_config->smart_ack 仍为空或 enabled≠true（= 开关没开、线上行为与放宽前逐字相同）；④真要开之前，PM 本人先看一遍干跑报告，再由 PM 说开
---
起因：v0.1 干跑只有 27%（30 条里 8 条）用上模型，低于设计稿定的 40% 门槛，我当时建议停。PM 2026-10-25 回「放宽」。

查出来不是模型不行，是三道闸误杀（细节见设计稿 §10）：①数字闸把 20/30 条表单消息拦掉，因为里面有客人自己的电话和「Golden China - November」这种团名——而回复侧的检查本来就保证发出去的话不含任何数字，前面那道是重复设防；②投诉词表里的 `sue` 匹配到客人太太的名字 Sue，一条 4167 字的高价值定制咨询被当成投诉；③链接闸把客人邮箱里的 `gmail.com` 当成链接垃圾，拦掉 17/30。回复侧另有两处误杀：`one of our colleagues`（"one" 是数字词，白名单只写死了 `one of our team`）、`our China tour offering`（`offer` 是 `offering` 的子串）。

顺带修掉一个真 bug：链接正则带 `g` 标记却用于 `.test()`，`lastIndex` 残留导致同一条消息连问两次结果不一致；已拆成两份正则并加回归测试（改回去会红 3 条）。另外变异测试逼出一条真空档：原来「邮箱不算链接」那条规则其实没有任何测试能测到它（长表单消息不剥邮箱也照样放行），补了「只有问候 + 自己邮箱」的短消息用例。

实测（CTS 近 120 天 60 条真实首条进线，只读、未外发）：57/60 用上模型，57 条措辞全不重复，名字与团名都对得上；3 条回退逐条看都该回退。6 处关键判断做了变异测试，全部被测试盯住。

红线守住的部分没动：开关 `clients.leads_config.smart_ack.enabled` 默认关且读失败当关；模型调用单独一步、永不抛错，任何失败都退回固定英文句；末尾固定追加「这是自动回复」（PM 2026-10-22 回「写」）；每客户每日调用上限 + 当日回退率过高自动停用。

遗留：A 级，必须 PM 本人「合」才能合并；开开关是另一次授权。模型想说 "flight options" 被 `flight` 禁词拦住——CTS 确实做机票，但那是客户私有事实，平台默认不许自动回复碰机票，保持拦住，要改得单独讨论。
