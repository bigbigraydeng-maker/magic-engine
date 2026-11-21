---
id: 2026-10-21-ads-objective-based-watch-awareness-whatsapp
title: 开投后盯盘按目标分开设计：播放量系列看视频观看类数，WhatsApp 系列看开聊类数，并查花费是否 6 小时为 0、ME 是否收到会话；只读、只提醒、不自动改广告
status: decided
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_how: 设计稿经 74 号验收后实现；验收看真实系列：播放量系列（ThruPlay 数、ThruPlay 成本、触达、频次超 3 黄 / 超 4 红、两条视频分开）、WhatsApp 系列（开聊数、开聊成本、暖受众 / 名单相似分开、两条视频分开、ME 是否收到该会话及入库延迟），且「花费为 0 超过 6 小时」的提醒在系列还没出花费（delivery=preparing）时真出一条今日待办
---
需求来自 74 号 10-21：本期新系列的目标是播放量 / WhatsApp 对话，现有开投后读回判的是点击 / 落地页浏览 / 留资，对它们会天天误报，所以 10-21 起 CTS 的盯盘配置已拿掉（PR 2947）。
74 号已把自治模式改回 observe，盯盘只出提醒、不动广告。读 Meta 的接口、待办三件套沿用现有盯盘做法；「ME 是否收到会话」要对 ME 的 WhatsApp 入库延迟。
