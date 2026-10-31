---
id: 2026-11-01-crm-wp1a-data-errors
title: CRM 三处读数据的错：语音信箱当成聊过、同事的信记成客人来信、机器人自动回复当成人跟进
status: decided
owner: pm
decided_on: 2026-11-01
source: session:96dc6edf
verify_by: 2026-11-04
verify_how: 合并上线后：①新打出去的外呼，触点 metadata.customer_spoke 有值（yes/no/unclear），遇到语音信箱的是 no，且该客人不会被每小时任务从「新线索」推进到「已联系」；②CTS 的 own_email_domains 补上点名的同事地址后，同事发到 info@ 的信新记录 direction=outbound 且 metadata.staff_sender 有值；③新的 Messenger「我们在 Messenger 回复过」触点不再出现在 Meta AI 客服接管期间或系统通知上。存量错行（见 PR 正文数字）由后续单独的数据订正步骤处理，本卡不动生产数据
---
问题：CRM 有三处把「不是真人联系」读成了「联系过」，会让该打的人被藏起来或被推进阶段。
①语音信箱：Twilio 在语音信箱问候语被「接起」时也报 answered=true，通话 ≥10 秒就记成 outcome=spoke / reached=true；每小时任务据此把「新线索」推进到「已联系」，今天名单也写「刚通完电话」。
②同事的信：邮件方向由文件夹定（收件箱=客人来信）。同事从自己的邮箱发信、抄送到 info@ 时也躺在收件箱里，被记成客人在回话（出票同事的机票报价）。
③机器人回复：Messenger 同步只用单条判据，没用 Meta AI 客服接管期间/系统通知那套完整判据，AI 的追问和系统通知被写成「我们在 Messenger 回复过」。
修法：①通话分析多输出「客人开没开口」（带原话核验，语音信箱问候语一票否决），写进触点 customer_spoke；自动推进、「聊上了」都要求 yes；分析没出结果/失败一律不推进、也不藏人。②同事发件人（自家域名或 own_email_domains 里点名的地址）落在收件箱时按「我们发出的」记；点名地址只认那一个地址。③Messenger 同步改用完整判据。
PM 2026-11-01 明确：接起就挂的电话不算已联系（取代 10-29 的说法），所以自动推进必须 customer_spoke=yes。PM 2026-11-01 明确：asiascapeholidays.com 的 op1/op3 是同事——部署本 PR 之后，再把这两个精确邮箱地址（不是整个域名，该域名也在同行名单里）加进 CTS 的 own_email_domains（生产配置写入，需 PM 点头）。
没做：存量错行订正（要单独授权）；通话后发邮件条（call-evidence.ts）仍把语音信箱当通话——它属邮件发送功能，另一个窗口负责。
当场试跑：只读查生产库给出三类存量错行数量；单元测试加变异检验；不碰生产数据。
