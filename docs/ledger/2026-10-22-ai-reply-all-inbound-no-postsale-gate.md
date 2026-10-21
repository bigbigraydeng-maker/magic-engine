---
id: 2026-10-22-ai-reply-all-inbound-no-postsale-gate
title: 所有 WhatsApp / 私信进线都发自动安抚、都起草 AI 回复，不再因为「看起来像老客户」而跳过（PM 拍板）
status: decided
owner: pm
decided_on: 2026-10-22
source: session:96dc6edf
verify_by: 2026-10-29
verify_how: 合并部署后，用 CTS 的 WhatsApp 测试号发一条含「booking」字样的咨询（例如「Can we modify the itinerary before booking」）：约 1 分钟内收到英文自动安抚，并在对话抽屉里出现 AI 草稿；读库确认这条对话没有被跳过。回看最近的 WhatsApp 新对话，不再有「售后跳过」
---
起因：客人 Brian 的 WhatsApp 咨询里有一句「modify the itinerary before booking」，系统的售后关键词「booking」把他判成已成交老客户，所以自动安抚和 AI 起草都跳过了，顾问几个小时后才手动回。查最近 30 天 CTS 新进的 184 个私信和 WhatsApp 对话，只有 2 个命中这类关键词，两个都是误判。
PM 原话（2026-10-22）：这个功能跟用户是不是老客户应该没有关系，所有 WhatsApp 进线都应该有 AI 回复。
做法：拿掉自动安抚（F1）和 AI 起草（F2）里的「售前/售后分类」那一步和对应的跳过结果；其余闸不变（退订、渠道开关、6 小时限频、AI 草稿仍要人批准才发）。分类函数本身留在代码里，只是不再用来拦。风险级别 A（对客自动外发的闸）。
