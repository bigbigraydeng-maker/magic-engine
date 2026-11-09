---
id: 2026-11-09-crm-do-not-call-split-step1
title: 「只别打电话」和「别再联系」分开——第 1 刀：纯判断函数 + 存量只读名单（不接任何线上逻辑，不改任何客人）
status: decided
owner: agent
decided_on: 2026-11-09
source: session:96dc6edf
verify_by: 2026-11-16
verify_how: 看 PR 已合并且 src/lib/crm/refusal-scope.ts 的测试全绿；用 scripts/crm-refusal-scope-dryrun.ts 对 CTS 存量「别再联系」备注重跑，phone_only 名单与 PR 里给 PM 看的名单一致（Minnie Lillian Kake、gerowlands 在内；Stacey McConnochie 的别再联系 10-16 已被人工纠正过，不在待改名单里）。线上 classifyNote 行为应与合并前完全一致（note-parser 测试 93 条仍绿）。
---
PM 11-09 在 76 号窗口定：客人说「不要打电话」不等于「不要联系」，短信/邮件/WhatsApp 照样可以联系（一开始我建议「不加」，PM 纠正后改）。方案见 scratchpad do-not-call-vs-do-not-contact-plan-v0.md，PM 回「改」「你来跟进吧」。
第 1 刀只做：refusal-scope.ts（判一句话拒的是电话/全部/要人看）+ 测试 + 只读试跑脚本。note-parser.ts 只加了一个 export（DNC_PATTERNS），线上判法不变。第 2 刀（电话那侧的拦截 + 解析器切换）必须一起上线，否则中间「不要电话」会既不拦邮件也不拦电话。
存量试跑（生产库只读导出的 17 条「别再联系」原话）：只别打电话 4（Minnie Lillian Kake、gerowlands、Stacey McConnochie、John Oxley；其中 Stacey 的别再联系 2026-10-16 已有一条人工 dnc_cleared，试跑脚本没读清除记录，所以她其实早已放行；John Oxley 后来发过 Unsubscribe 仍应全面拦）、请人看 1（Jan Matuku）、不变 11、不是拒绝 1（Christine Matehaere「not intending to go」，8-16 前的旧误判）。John Oxley 之后在 Messenger 发过 Unsubscribe，仍应是别再联系，不能改。
真正改存量客人的状态属第 4 刀，要 PM 看名单说「改」。
11-09 第 2A 刀（只读一侧）：代码已写完推到同一个 PR 3692——isDoNotCall、拨号接口 409、分段/名单、页面小标+撤销条、日历回电改邮件跟进、各处拨号入口。没有任何程序写 do_not_call，线上今天不会有人被新规则挡住。CRM 全部相关测试 263 个文件 5354 条通过（本机重跑）；5 种故意破坏都变红。未做：私信页面客户卡片（拿不到客人档案标记，要改私信接口）。2B（解析器切换 + AI 合并 + 白名单词表 + Messenger 提示）还没开工，refusal-scope.ts 里的词表是弱版，PR 3692 在 2B 换词表之前不能合并。
11-09 第 2B 刀（写入一侧）：解析器切换（「不要电话」类 → do_not_call，不再记别再联系）、白名单词表（refusal-patterns.ts，单一来源）、AI 合并修正（规则判 do_not_call 时忽略 AI 的全拦）、Messenger 提示、表格导入保留「请人看」标记、自动解除不再放开电话。魏征第一轮 BLOCK（词表太窄）→ 修；第二轮 BLOCK（「不感兴趣+别打电话」被削弱、never call 被当回电等）→ 修；验收时又补 opt out 误伤、不想接电话漏判。CRM/Mailchimp/私信/转化/待办/自动解除测试 350 个文件、6975 条通过；每条新规则做过故意破坏。
上线后要留意：①有些说法比旧代码拦得更严（「没兴趣+别打电话」全拦；带时间的「暂时不考虑+别打电话」也全拦），被拦的人要员工手动「放回名单」；②自动解除（CRM_DNC_REENGAGE_WRITE_CLIENTS）写入打开之前，必须确认已带「补写只别打电话」这一条；③存量客人（Minnie Lillian Kake、gerowlands）仍被拦，第 4 刀你看名单说「改」才动；④AI 电话（voice/outbound-gate.ts、voice/crm-bridge.ts）接上线前必须接 isDoNotCall。
