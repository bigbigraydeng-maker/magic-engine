---
id: 2026-11-02-crm-post-call-email-opened-to-all
title: 「通话后发邮件」对所有客人放开了：灰度名单已清空（发信设置第 7 版），其余各项与第 6 版逐项相同；两份模板仍停用
status: done
owner: agent
decided_on: 2026-11-02
source: session:9562a9b6
verify_by: 2026-11-10
verify_how: 看放开后第一周的发信记录（crm_email_send_receipts）与发送审计（conversation_outbound_log），核三件事：①发了多少封、被拦多少封、拦的原因分布；②有没有 failed / unknown 回执，有没有客人 7 天内收到超过 2 封（上限失效的迹象）；③销售有没有反馈发不出去或发错、客人有没有投诉或回信要求别再联系；三项都没有异常就翻 verified，有异常就先把灰度名单收回（再保存一版设置，recipient_allowlist 写回只有 hello@magicengine.cloud）再查原因
done_on: 2026-11-02
done_ref: doc:docs/ledger/evidence/2026-11-02-crm-post-call-email-opened-to-all--2026-11-02.md
---
PM 11-02 在 127 号窗口回「开」（之前先做了 7 天上限的真测，见卡 2026-11-02-crm-email-cap-live-check）。放开的是发信设置里的灰度名单：recipient_allowlist 由 2 个地址改为 null；总开关本来就开着。
放开后销售可以给「咨询过我们」且没标「别再联系」的客人自己写第一封信；两份模板（post-call-single-tour、spring-2027-follow-up）仍停用，启用要另走（先定模板文字）。
页脚（footer）仍为空；一对一跟进信是否需要退订说明（NZ 反垃圾邮件法）还没问过法务。
收回办法与取数细节见证据文档。
