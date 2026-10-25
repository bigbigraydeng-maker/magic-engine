---
id: 2026-10-21-crm-send-first-email
title: CRM 抽屉里给没有邮件往来的人发第一封邮件（走客户已连接的 Outlook 邮箱）：PM 定「先邮件，再 WhatsApp 模板，最后短信」；默认只允许发给咨询过我们的人；开关默认关
status: decided
owner: pm
decided_on: 2026-10-21
source: session:96dc6edf
verify_by: 2026-10-30
verify_how: 合并部署后，先在 CTS 配置里打开开关（需 PM 一句话），用自己邮箱 hello@magicengine.cloud 对应的测试联系人试发一封：时间线里这封信只出现一次（等下一次邮箱同步后再看），审计表有一行 sent；同一个人 60 秒内再点发送被拒；标了别再联系的人看不到写邮件框；只在营销名单里的人看到「他没咨询过我们」
---
PM 原话（2026-10-21）：CRM 要能对外打电话、发邮件、发短信、回 WhatsApp，否则就是摆设；回复「先邮件」。Outlook 授权已就绪（读生产库确认 info@ 邮箱有读、写草稿、发送三个权限）。
设计稿 docs/specs/2026-10-21-crm-send-first-email-design-v0.md 过子牙、魏征各两轮，不加表不加列不做迁移。合规默认由 PM 回「行」确认：只发给填过表单、发过私信或 WhatsApp、来过信、打过电话的人，只在邮件营销名单里的人系统不让发。风险级别 A（对客外发、撤不回）：PR 保持草稿，PM 回「合 N」才合，试发给 PM 自己邮箱那一步先问 PM。
遗留待核实：新建草稿的线程编号与同步读到的是否一致（必须靠真实试发验证，不一致就加重读一步）；短信与 WhatsApp 模板另立设计稿；OpenAI 账户余额为 0 与本功能无关。
