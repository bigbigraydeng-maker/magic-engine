---
id: 2026-11-11-crm-brief-include-phone-calls
title: 客人页面上的 AI 摘要把电话也算进去：打完电话（AI 通话要点生成后），下一轮每小时自动刷新时摘要和「下一步」跟着更新
status: decided
owner: agent
decided_on: 2026-11-11
source: session:96dc6edf
verify_by: 2026-11-12
verify_how: 合并上线后，查生产库：Christina Curtin（contact 78d11863-cd1d-4954-8ff2-ceafd3defc0b）的 conversation_briefs.generated_at 是否晚于 2026-11-10 06:18 UTC（那通 17 分钟电话的 AI 通话要点时间），且摘要里提到了 3 月出行 / 游轮；再查 cron_run_logs 里 messenger-brief 最近一轮 failed 是否为 0、没有「call notes unreadable」报错。摘要没更新：先看这轮有没有被每日重写上限挡住，再看通话要点那张表有没有读到她的两通电话；失败率上升就回滚本改动（只加不改，回滚即恢复旧行为）
---
PM 11-11 发现 Christina Curtin 页面上的摘要没跟着最后一次互动（电话）更新。查实：摘要由邮件 / 私信 / WhatsApp 的文字生成，电话不在输入里；而且「该不该重写」只看消息条数，光打电话永远不会触发重写。
修法：读客人最近 30 天的 AI 通话要点（最多 3 条）喂进摘要；通话要点比现有摘要新就算「该重写」（仍受每日重写上限和安静期约束）。读不到通话表时记日志、按原样跑，不让摘要整轮失败。
范围：只管已经有邮件 / 私信往来的客人；纯电话客人本来没有摘要，另开单。没有改数据库结构，没有新增定时任务。
