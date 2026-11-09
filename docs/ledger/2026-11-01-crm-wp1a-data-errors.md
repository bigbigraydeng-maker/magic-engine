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
问题：CRM 有三处把「不是真人联系」读成「联系过」：语音信箱被接起记成聊过、同事发的信记成客人来信、机器人自动回复记成人跟进。
修法（PR #3445 已合）：通话分析多输出「客人开没开口」写进触点 customer_spoke，自动推进必须 yes；同事发件人按「我们发出的」记；Messenger 同步改用完整判据。
PM 2026-11-01 明确：接起就挂的电话不算已联系（取代 10-29 说法）；asiascapeholidays.com 的 op1/op3 是同事，部署后只加这两个精确邮箱（不加整个域名），写生产配置前要 PM 点头。
没做：存量错行订正要单独授权；call-evidence.ts（通话后发邮件条）仍把语音信箱当通话，属邮件窗口。
当场试跑：只读查生产库给出三类存量数量，邮箱同步路由未能当场跑（无演练模式），首轮真实运行 11-04 核对。
