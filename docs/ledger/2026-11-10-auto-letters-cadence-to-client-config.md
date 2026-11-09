---
id: 2026-11-10-auto-letters-cadence-to-client-config
title: 倒计时信的节奏（周三发、6 到 1 个月、最后一封提前 3 天停）现在所有客户共用一套，发信引擎用之前必须改成从客户配置读，没配就不排信
status: decided
owner: agent
decided_on: 2026-11-10
source: session:37644f65
verify_how: 看 src/lib/messaging/letters/load.ts 里的 cadenceFor：它改成读客户配置，没配节奏的客户返回空，列表和详情都不排信；发信引擎第一次调用计划函数的改动单里要能看到这一条
---
读接口的节奏现在只由 load.ts 里的 cadenceFor 决定，暂时所有客户共用现有旅游客户那一套，这是过渡。
发信设计窗口审查提出（P1）：发信引擎用计划函数之前，这里要改成从客户配置读，没配就不排。
