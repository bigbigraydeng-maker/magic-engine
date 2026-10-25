---
id: 2026-10-25-cts-junk-leads-root-cause-and-cleanup
title: CTS「今天要联系」里混进 6 条不是客人的来信——根因是邮箱同步把「有人发邮件来」当成「有人来咨询」；已逐条清理并记入学习样本（PM 2026-10-25 指示「一定要清理掉」）
status: done
owner: pm
decided_on: 2026-10-25
done_on: 2026-10-25
done_ref: doc:docs/audits/2026-10-25-crm-pages-user-view-audit.md
source: session:96dc6edf
verify_by: 2026-11-08
verify_how: 打开 CTS 的「全部客人 → ✨ Magic Engine 智能 → 今天要联系」，Afterpay Team、Vietnam Tours Direct、numbers-regulatory-review@twilio.com、chajense@chajense.com、guardian-reports@mail.grokbot.com、ZORAVYO 这 6 个都不应出现；在「到哪一步了 → 非咨询」里能找到他们，抽屉里的变更记录写着「[退回|类别] 原因」，改的人记为 system:junk-sender-cleanup
---
PM 问「为什么这 4 个人混进去」。逐条查建档来源：6 条里 5 条来自 Outlook 邮箱同步（来源 microsoft_mail），1 条来自官网表单。系统把「有人往 CTS 公司邮箱发了封信」直接当成「有人来咨询」建档、落在「新线索」，而公司邮箱本来就什么都收——供应商系统通知（Twilio 号码合规审批）、营销群发（Afterpay、越南地接的 Mailchimp）、同行推销（中国地接社想做供应商）、甚至以伦理为由拒绝去中国的抗议信；官网表单则没有任何防推销。
更要认的一点：PM 10-21 要的「只留有效咨询」筛选器早就建好了，它的五个类别（群发 / 系统通知 / 推销 / 自动回复 / 抗议）跟这 6 条一一对得上，但当初设计成「开关先关、机器不自动移人」，所以一次也没生效；今天我先去改名单显示层，等于在治症状。
已清理：用界面「退回」同一条代码路径（advanceContactStage + buildReturnNote）把 6 人改为「非咨询」，逐条回读确认；记录格式与 PM 自己手点的 5 次一致，所以它们同样进学习样本。
遗留：根因没解——下一条同类来信还会照样进来。要真解，得把既有的有效咨询筛选接到邮件入库那一步（读内容判断、写阶段、留退回通道），开之前先干跑给 PM 抽查；官网表单的防推销另算。
注：早先一次阶段分布统计读到「非咨询 3 人」，与现在逐条清单（PM 5 + 本次 6 = 11）对不上，没查清哪里读错，以逐条清单为准。
