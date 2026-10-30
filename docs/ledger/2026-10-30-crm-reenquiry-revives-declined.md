---
id: 2026-10-30-crm-reenquiry-revives-declined
title: CRM 客人说过「不感兴趣」后自己重新填表/回信 → 拿回「今天要联系」
status: decided
owner: pm
decided_on: 2026-10-30
source: session:96dc6edf
verify_by: 2026-11-02
verify_how: 上线后 Annette Tulett（8/31 被记 not interested，10/30 重新填表）出现在「今天要联系」，理由为「客户来消息了」；别再联系的客人即使重新填表仍不出现
---
问题（PM 2026-10-30）：Annette 8/31 被同事记了 not interested（老表格同步进来的备注），之后发了私信、点了邮件链接，10/30 重新填了表单，系统却因历史里有过一次 not_interested 把她永远压在「不联系」。
修法：segments 规则 1 里，「not_interested」被**严格晚于它的真人来信**（重新填表/回邮件/私信）推翻；邮件打开/点链接不算；**别再联系（do_not_contact）不在此列，合规红线不因重新填表解除**；重新找上门之后又说了一次不感兴趣则再次不联系。纯读时规则，不改数据。
