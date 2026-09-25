---
id: 2026-09-25-b2-libai-copy-provenance
title: 李白文案溯源上线：每篇候选文案生成后自动逐句标「官网可溯/brief 可溯/未证实」，未证实句进今日待办（署名李白）；另每月第一个周二体检提示词库只报告不改
status: decided
owner: agent
decided_on: 2026-09-25
source: session:121634d6
verify_by: 2026-10-13
verify_how: 合并后在内容工厂用选题助理生成一条候选，10 分钟内看该 content_posts 行的 generation_context_snapshot.libai_provenance 有 status=labelled 或 unverifiable（不能为空）；cron_run_logs 有 job_name=libai-copy-provenance 的行；若有未证实句，次个工作日早上待办邮件出现「李白：」条目。月检：10 月第一个周二（10-06）之后 cron_run_logs 有 job_name=libai-prompt-library-monthly 且 summary.skipped=false 的行
---
agent 自治计划 B2（docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md §4.1 李白），三只闹钟之一。
事件 me/libai.copy.generated 由 content-factory/generate 发；云端函数 cloud-libai-copy-provenance 读官网（Site Analyzer 封装）+ master_brief，Claude Haiku 逐句标注，有边界写回 generation_context_snapshot.libai_provenance；读不到官网 = unverifiable 不判。
待办兜底：生成 2 小时后仍无溯源记录 → 「李白还没检」进系统欠账栏（事件丢了不静默）。月检 cloud-libai-prompt-library-monthly 只读 docs/agents/prompt-library，不改文件。
