---
id: 2026-11-28-crm-followup-weekly-report-step2
title: 客人分组跟进工作流第二步：每周一早上 8:00 自动发一封跟进报告（上周动静、本周先打谁、各组人数变化、等放行的 AI 客人数），现在只发 PM 的 hello@ 信箱。PM 11-28 回「继续做第二步，每周报告」
status: decided
owner: agent
decided_on: 2026-11-28
source: session:96dc6edf
verify_by: 2026-12-08
verify_how: ①合并上线后到 Inngest 后台对 /api/inngest 重新 Sync，确认 cloud-crm-followup-weekly-report 已注册。②合并后的第一个周一上午（12-01 之前合并就查 12-01，否则查 12-08）：hello@magicengine.cloud 收件箱里有一封主题含「follow-up report」的信，发信时间在当天 8 点左右。③查 cron_run_logs 里 job_name = crm-followup-weekly-report 最新一行：status 是 completed，summary.results[0] 的 sent 为 true、recipients 只有 hello@magicengine.cloud、有 provider_message_id。算成：三条都对，且信里「vs a week ago」一列在第一步上线满 7 天后不再全是 no record yet。不成时第一步：看 Inngest 后台该函数有没有运行记录；没有就是没 Sync，有但没发出就看回执里的 reason。
---
PM 11-28 回「继续做第二步，每周报告」。收件人写死在函数文件的名单里，目前只有 CTS → hello@magicengine.cloud（PM 原话「先只发 hello@」）；发给 CTS 团队要 PM 另外点头并改这份名单。刹车：FOLLOWUP_WEEKLY_REPORT_PAUSED=true 时只取数记回执、不发信。
报告内容：最近 7 天六个数；「先打电话」新线索名单和「今天回」等回复名单各最多 15 位（只有名字和后台链接，名字里夹着的邮箱电话会掐掉，写明总数）；符合「交给 AI」规则的人数；各组人数和比一周前的变化。
11-28 当场试跑：用正式数据真发了三封到 hello@（16:08、16:10、16:18，都收到，以第三封为准）。第三封的数：先打电话 38 位、等回复 44 位、只发过邮件没填过表 36 位（只说人数不列名字）、符合 AI 规则 216 位；最近 7 天新填表 81、员工打过或发过信 91、来信来电 35、变成高意向 14、新订单 0、交给 AI 0。
这一步同时改了分组，第一步页面上的数字跟着变：新增「只发过邮件、没填过表、我们也没联系过」一组（打电话或发 WhatsApp 来的仍算等回复）；从没人碰过、发件地址像群发推销的算「不是客人」；最近 7 天的数只数客人。检查员（Opus）一轮，提的问题都已改，除了下一行两条。
没做的：报告没发给 CTS 团队；名单没逐人对邮箱（信里写了「先看邮箱是不是已经回过」）；「符合 AI 规则 216 位」是总池子，放行页每天只给一批（信里写明了）；另外三封老的汇总信同样会把名字里夹着的电话印出来，没在这一单里改；每周一自动发这一步上线前没真跑，按 verify_how 核。
