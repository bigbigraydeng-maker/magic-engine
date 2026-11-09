---
id: 2026-11-02-crm-email-cap-live-check
title: 「通话后发邮件」的 7 天上限对真客人做了真测：27 位客人 25 位数得完全对、2 位少数 1 封（都已远超上限，结果仍是拦住）、0 次出错，每次约 6.5 秒
status: done
owner: agent
decided_on: 2026-11-02
source: session:9562a9b6
verify_by: 2026-11-03
verify_how: 打开证据文档 docs/ledger/evidence/2026-11-02-crm-email-cap-live-check--2026-11-02.md，核三点：①样本表里 27 位客人按类别列出、只有类别和数字（无姓名邮箱）；②库里 crm_email_templates 两份模板最新版仍是 disabled，且 post-call-single-tour 最新版内容与第 5 版逐列相同；③crm_email_send_receipts 在 2026-11-02 20:31–20:35（新西兰时间）之间 0 行；三点都成就翻 verified，任何一点不成就写卡在哪
done_on: 2026-11-02
done_ref: doc:docs/ledger/evidence/2026-11-02-crm-email-cap-live-check--2026-11-02.md
---
PM 11-02 回「抽查」「临时启用」后做的：先只读核对 Mailchimp 后台与 ME 记录（最近 7 天 11 封群发、87 人次，受众编号一致，无在跑的自动流程），再临时启用一份模板 3 分钟、对 27 位真实客人各调一次只读预览（不发信），随后改回停用并核对。
结论与细表见证据文档；没覆盖：3 封补发欢迎信的收件人；Mailchimp 钥匙失效或限流时的表现（按代码是「无法核实就拒发」，没造故障去测）。
撤回一条：我 11-02 上午报的「bdm@ 邮箱连接失效」不是缺口，PM 10-15 已决定该邮箱退役（见 docs/clients/cts/social-review/2026-10-patrol-log.md）。
发现的小缺口另开卡：2026-11-02-crm-email-cap-dedupe-merges-two-mails-within-two-minutes。
放开本身见卡：2026-11-02-crm-post-call-email-opened-to-all。
