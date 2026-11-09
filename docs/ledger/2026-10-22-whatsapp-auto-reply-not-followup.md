---
id: 2026-10-22-whatsapp-auto-reply-not-followup
title: WhatsApp 的自动安抚和 AI 起草经人批准发出的回复，不再被算成「已跟进」，昨天今天的 WhatsApp 咨询留在「今天要联系」直到真人接手（PM 拍板）
status: decided
owner: pm
decided_on: 2026-10-22
source: session:96dc6edf
verify_by: 2026-10-29
verify_how: 合并部署后，用 CTS 的 WhatsApp 测试号发一条咨询：约 1 分钟收到自动安抚后，这个人仍在「Magic Engine 智能」的「今天要联系」里（原因写「进线了，还没人联系」）；顾问在抽屉里亲手回一句、或记一笔后，才从今天要联系里下去；补标历史那 6 个人（Sarju Dayal、Jacs、Kay Jay、Trent Pitman、Celine宝宝、Oscarsda）经 PM 同意后写入，之后他们回到今天要联系
---
起因：PM 发现昨天今天 WhatsApp 进来的咨询没有出现在「今天要联系」。查出来：发送 WhatsApp 的代码对每条出站都记「我们在 WhatsApp 回复过」且不标机器发的，名单引擎又不读「机器发」这个标记，所以自动安抚（约 1 分钟内发出）一发，客人就被算成「已跟进」，掉进「先放着」。8 个人里只有 2 个还在热名单（客人在我们回复之后又说话了）。
PM 原话：「是的，按这个改」——自动安抚、以及 AI 起草经人批准发出的回复，都不算跟进；真人亲手回、打电话、记笔记才算。
做法：①发送 WhatsApp 时，发件人是机器账号（自动安抚 / AI 起草批准发出）就在触点上标 automated；②名单引擎（segmentContact）不再把标了 automated 的出站算成「我们最后一次联系」（之前文件里写明「目前不读它」，这是遗留，现已补上）。对全库只读重算：只有 1 人因此换了名单位置（Kenneth David Rae，冷变热），其余不变。③历史 6 条触点的补标用脚本，默认只读，写库要 PM 同意。
遗留：Messenger 渠道目前没有 AI 自动回复（开关关），不受影响；若将来打开需同样标记。
