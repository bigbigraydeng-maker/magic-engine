---
id: 2026-10-21-whatsapp-draft-approval-in-drawer
title: CRM 客人抽屉里能批准 WhatsApp 的 AI 草稿（原来草稿面板只在私信卡里，WhatsApp 通过安全检查的草稿没有地方批准）；被安全检查拦下的只显示原因、不能批准
status: decided
owner: pm
decided_on: 2026-10-21
source: session:96dc6edf
verify_by: 2026-10-24
verify_how: 合并部署后，让 PM 手机给 CTS 的 WhatsApp 号发一个真实问题（例如问下一个团期）；系统自动回安抚消息后，客人抽屉里出现「AI 起草了回复，等你批准」和「批准发送」；被安全检查拦下的草稿只显示一行原因；点批准后手机收到；窗口超过 24 小时的客人不显示草稿面板
---
只加列表接口放开渠道和抽屉里的面板，不改任何发送逻辑。安抚消息目前只有 30 秒合并、没有按人限频，是另一件事，见 PR 说明。
