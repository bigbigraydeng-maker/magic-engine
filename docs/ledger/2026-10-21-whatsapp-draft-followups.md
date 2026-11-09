---
id: 2026-10-21-whatsapp-draft-followups
title: WhatsApp 草稿批准上线后的两个小尾巴：今日待办条目还指向旧页面且写「AI 那份还看不到」；抽屉里的草稿面板不会自动刷新
status: decided
owner: pm
decided_on: 2026-10-21
source: session:96dc6edf
verify_by: 2026-10-28
verify_how: 打开今日待办里「待批准草稿」条目，链接应指向客人抽屉（或说明 WhatsApp 草稿也在抽屉里批准），文案不再说「AI 那份还看不到」；在抽屉里停留时来了新草稿，不用重新打开抽屉就能出现。两件事都是小改，不改发送逻辑
---
来自 PR 2958 的独立审查。涉及文件：src/lib/pm-todo/messenger-draft-items.ts（条目指向与文案）、src/app/dashboard/clients/[id]/crm/_components/WhatsAppReply.tsx（草稿只在打开抽屉或批准后读一次）。不是阻断项，不在 2958 里做。
