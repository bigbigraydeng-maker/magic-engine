---
id: 2026-10-28-crm-post-call-template-email-impl
title: CRM 通话后选模板发邮件的代码已写完、本机测过（草稿申请单，没合并、没上线）；上线前还差三步，都等 PM 点头：应用数据库迁移、当场试跑、清空灰度名单
status: decided
owner: pm
decided_on: 2026-10-28
source: session:9562a9b6
verify_by: 2026-11-04
verify_how: PM 说 go apply 并应用迁移后，确认三张新表在库里；用 hello@magicengine.cloud 测试联系人按申请单里的当场试跑计划真发一封并收到（邮件线程里只有一封）；回执表里有一行 sent 和一行因 7 天上限被拦的 blocked；Inngest 云端看得到对应事件和成功的函数运行；任何一步没走到，就写卡在哪
---
代码在分支 feat/crm-email-tpl-impl：发信前各道闸（含每位客人 7 天最多 2 封）、模板管理页、发信设置、发送回执和后台收口都已做完并本机测过；功能开关默认关，没有设置行的客户行为不变。
前一张卡 2026-10-28-crm-post-call-template-email（设计稿，11 月 11 日验试跑）仍然有效：迁移（3 张新表）要 PM 手合并回「go apply」，试跑只用 hello@magicengine.cloud 测试联系人、不碰真客人，灰度名单由 PM 一句话清空才算上线。
本卡到期日 11 月 4 日，是后台函数 cloud-crm-email-send-receipt「首次自动运行」的预期日：它要等第一封试跑信发出才会被触发，而试跑要 PM 先回 go apply、再回「试跑」。到期还没走到，就在这张卡写卡在哪（多半是还在等 PM 点头，不是代码问题）。
