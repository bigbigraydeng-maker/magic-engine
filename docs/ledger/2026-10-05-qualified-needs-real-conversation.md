---
id: 2026-10-05-qualified-needs-real-conversation
title: CTS 合格线索必须客人真实发起过对话（表单自带首条消息不算）；线索类放宽自动审核刹车；自动发送暂停中，等 PM 回「合」后重新打开
status: decided
owner: pm
decided_on: 2026-10-05
source: session:4569e58a
verify_by: 2026-10-08
verify_how: 合并后重新打开 CTS 的 AI 自动审核开关；看每天早 6 点流水线 ctsSync 的 excludedNoConversation / rejectedStaleLeads / contactNotLinked / insertedLeads，以及 ctsReview 是否被刹车暂停；抽查已发的合格线索是否都有一条客人手打的消息（不是 "Hello! I filled out your form…" 模板）
---
事实：Facebook 表单会自动生成一条入站私信「Hello! I filled out your form and would like to know more…」，最近 14 天 124 条线索里 107 条的"对话"只有这一句；10/5 早上自动发出的 12 条合格线索按 PM 口径一条都不算（只靠员工备注判的）。已发出的撤不回。
改了：合格必须有真实入站对话；客人自己说的排除词压倒员工正面备注；联系人没找到只跳过不拒绝；线索类不再参与笔数/金额/批准占比三条刹车。
已知缺口：旧待核对线索被今天拒绝后不会复活（回传窗口只有 7 天，价值有限）。
