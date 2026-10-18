---
id: 2026-10-18-learning-mechanisms-audit
title: 学习机制只读核查：PM 要的「从外部视频学」早就有，被 Gemini 免费额度卡在 4% 成功率；另三条学习回路空转
status: done
owner: pm
decided_on: 2026-10-18
source: session:c668eb35
done_on: 2026-10-18
done_ref: doc:docs/specs/2026-10-18-learning-mechanisms-and-ads-workflow-audit.md
verify_by: 2026-10-25
verify_how: 看 PM 是否决定升 Gemini 配额（升完查 viral_reference_library 近 7 天 analysis_status='done' 占比是否明显高于 4%）；是否批 apply playbook_staleness_findings 那张表；周度汇总那个 uuid 类型错是否修（修完查 client_learned_preferences 里 extracted_from_table='learning_rollup_weekly' 的行数是否 >0，今天是 0）
---
PM 10-18 要「广告工作流 + 一套能不断学习提升的方法」。核查结论在 done_ref。
最值钱一条：爆款库（抓 YouTube → 拆配方 → 出片时读）是唯一一条真正从站外内容学的回路，抓取端每天在跑、近 30 天进 551 条，但分析端还在 Gemini 免费档（每天 20 次），549 条 429 报错，近 30 天只有 22 条拆成配方。花钱升档就能救，不用开发。
另三条空转：周度汇总三个月写入 0 行（extracted_from_id 列是 uuid 而代码传字符串，错误被吞）；global_learned_lessons 有读无写；手册过期巡检的表在生产库不存在、迁移从未应用。
