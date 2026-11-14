---
id: 2026-11-15-crm-callback-time-must-match-staff-note
title: 员工笔记里 AI 读出的回电时间，必须在员工原话里有依据：只写「follow up 某个团」的备注不再排回电，团的出发日 / 天数不当回电日期；已排错的回电出清单、等 PM 点头再清
status: decided
owner: agent
decided_on: 2026-11-15
source: session:96dc6edf
verify_by: 2026-11-16
verify_how: 合并上线后，在 CTS 的 CRM 日历和「今天要联系」里看系统自己读出来的回电：①每一条都能在员工原话里找到这个回电时间；②新记一笔「please follow up 2027 catalogue」「I will follow up Best of China 13 May departure」这类只写跟进某个团的备注，不再出现回电日期（客人仍在跟进名单里）；③员工在笔记里写「call back tomorrow 4pm」「2pm tomorrow call」这类真约的，照常排上。④待清理名单（47 位客人最近一次回电：留 15、清 28、改 3、不露面 1）PM 点头后，只清 metadata.callback_at，并把旧值挪到另一个键留底以便撤回；清库前必须有 PM 的字。没排对：先看这条改动单是否已合并，再看新记的笔记原话
---
PM 11-15（经 18 号窗口转来）：CRM 日历里 11-14 有 2 条回电其实员工没约，是 AI 自己排的。查实：11-10 起每位客人最近一次回电 35 条里 25 条不对（同一句「跟进目录」排出 11-16…12-13 不同日子；拿团的出发日 13 当日期、拿 15 天团的天数当日期；还有早于笔记本身的）；全表 47 位客人最近一次回电里清 28、改 3。
根因：`groundNoteParse` 只看笔记里有没有「下一步」类的词（follow up / call back…）就原样放行 AI 的日期，没核原话里有没有回电时间。新增 `note-callback-grounding.ts`：AI 的日期必须落在原话里找得到的回电时间上（明天 / 周五 / next Thursday / in three weeks from 4 Nov / 18 or 19 Nov / 中文钟点），团的出发日（后面跟 departure / 出发）、天数、离笔记超过 60 天的日期都不算；相对说法优先于具体日期（员工常把月份打错）；原话只有一个说法而 AI 排错日子时改成原话那天；回电早于笔记时间置空。「有下一步」不变，客人仍在跟进名单里，只是不排具体时间。员工点「约回电」按钮的路径不经过这里，不受影响。
顺带修：`parseCrmNote` 没把自己的 `now` 传给 `saneCallbackInstant`，那个函数一直拿真实当前时间判「太久以前」，旧测试就此变成定时炸弹（「周五回电」），一并修正。
未做（PM 还没回「加」）：保存时提示 + 一键取消 + 日历标来源；固定考题 + 每周取消率。
