---
id: 2026-11-16-crm-catalogue-followup-stopline
title: 发目录之后的跟进流程第 1 刀：每天早上 7:30 检查「AI 跟进中」的客人，订团 / 别再联系 / 阶段停营销 / 客人回来 / 员工真聊上了就自动撤标记、放回员工名单；员工可点「判错了，继续让 AI 跟进」
status: decided
owner: agent
decided_on: 2026-11-16
source: session:96dc6edf
verify_by: 2026-12-02
verify_how: 合并上线并在 Inngest 后台同步后，看 11-17 或 11-18 早上 cron_run_logs 里 crm-followup-stopline 有一条 completed；有客人被撤时，他的抽屉里写着停的原因、当天出现在今天要联系；没被撤的人数与回执 in_takeover 对得上
---
PM 2026-11-16 回「开始」。判「真聊上」用现成的通话分析结论（客人开没开口）和员工手记的解析结果，不按通话时长；说不准按聊上算，只有完全没证据的通话不算。
没有加表：停线记录写进现有的跟进记录表（contact_automation_events），原方案的「跟进计划记录表」留到第 2/3 刀真要按天数排信时再加。上线前只读试跑：CTS 47 位在 AI 跟进中，0 位该撤。
已知没做（审查 P2，留下一刀）：Messenger / WhatsApp 私信还认不出「客人回来了」（只会漏停、不会误停）；员工隔天才补记发目录前那通电话的笔记，可能被误停（员工可一键改判）。
2026-11-16 改期：停线跑在 Inngest 上，11-15 起额度用满不跑（PM 不升级），核对日改到额度恢复后的 12-02。
