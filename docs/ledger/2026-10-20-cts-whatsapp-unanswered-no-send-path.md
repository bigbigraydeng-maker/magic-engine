---
id: 2026-10-20-cts-whatsapp-unanswered-no-send-path
title: CTS 的 WhatsApp 客人消息没人回：号码在接口上手机收不到，ME 后台从未发出过一条，也没有这个号码的发送凭据记录
status: decided
owner: pm
decided_on: 2026-10-20
source: session:96dc6edf
verify_by: 2026-10-22
verify_how: 让 PM 用手机给 CTS 的 WhatsApp 号发一条测试消息；ME 里出现会话后在客人抽屉里回一句，确认真的发得出去；查清发送用的是哪一份凭据；近三天已有的三位客人是否还有机会跟进（超过 24 小时只能打电话）
---
事实：库里 CTS 的 WhatsApp 全是客人发来的，最近三位分别在 10-17、10-18、10-19 来信，没有任何一条是从 ME 发出的；发送凭据没有按号码单独记录，只可能走旧的全局配置，是否有效未验证。
