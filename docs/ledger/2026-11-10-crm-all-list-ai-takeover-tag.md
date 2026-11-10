---
id: 2026-11-10-crm-all-list-ai-takeover-tag
title: 「全部客人」名单里补上「AI 跟进中」小标（之前只有今天名单和抽屉有）
status: decided
owner: agent
decided_on: 2026-11-10
source: session:96dc6edf
verify_by: 2026-11-11
verify_how: 查 CRM「全部客人」里搜 Amos Pohl，名字旁应有「AI 跟进中」；今天名单里他应已挪到「交给系统跟」（当天交给 AI 的客人当天留在原位，次日才挪）。
---
PM 11-10 发第一位目录信后发现「全部客人」名单看不出 AI 接手：小标只接在今天名单和抽屉里，平铺名单的行没带这个字段。
修法：联系人列表读取多带 ai_takeover_since 列，行里 aiTakeover = 该列有值；加了回归测试，故意改坏后测试变红。
