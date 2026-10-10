---
id: 2026-09-29-manual-reply-dnc-gate
title: 员工在 CRM 手动回 WhatsApp / Messenger / 邮件之前，先查「别再联系」名单——以前这三条路一行都没查
status: done
owner: pm
decided_on: 2026-09-29
source: session:5b9407a2
done_on: 2026-09-29
done_ref: pr:2179
verify_by: 2026-10-06
verify_how: "上线后在生产找一个被标成「别再联系」、且有 Messenger 或邮件对话的客人，打开他的抽屉试着手动回一句——应该发不出去，回复框提示「被标成『别再联系』」而不是「没有权限」；再找一个正常客人回一句，应该照常发出。另查 conversation_outbound_log 里这之后不应出现发给 DNC 客人的人工发送记录"
last_checked: 2026-10-10
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
魏征复审多渠道方案时查出：`isConversationOptedOut` 只有两个自动发送在用，员工手点的三条回复路由从不查「别再联系」，今天就能给说过 STOP 的客人手动发消息。
修法：新增 `lib/crm/manual-send-dnc-gate.ts`，先按「对话 + 客户」确认归属（查不到交回原逻辑报 404/403，不泄露别家客人的名单状态），再用既有 `isConversationOptedOut` 判；查询失败按拦。三条路由在发送前调用；Messenger 只拦人手打的那条路（AI 草稿由发送前已复查退订的流程发）。回复框新增两句人话提示。
