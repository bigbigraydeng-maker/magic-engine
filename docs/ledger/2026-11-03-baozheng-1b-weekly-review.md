---
id: 2026-11-03-baozheng-1b-weekly-review
title: 包拯（第 1b 刀）：每周把 AI 判客人阶段交给更强的模型复核，算准确率区间；两个模型不一样的进今日待办「认一下」，人点谁对只记结论不改客人
status: done
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-11-10
verify_how: 合并上线、PM 同意后在 CTS 客户设置写入阶段归类并打开总开关，从 Inngest 手动触发一次 cloud-baozheng-weekly：cron_run_logs 有一行 baozheng-weekly 且 summary.skipped=false、CTS 状态 reviewed、花费 <1 美元；第二天今日待办「认一下」栏出现分歧条目且邮件里没有客人姓名原话；点开复核页能看到判断那一刻的对话、点一次裁定后 crm_segment_feedback 多一行（segment 以 baozheng 加冒号开头）、客人阶段不变
done_on: 2026-11-03
done_ref: pr:3557
---
规则书 docs/sops/2026-11-03-crm-ai-judgement-review-rules-v1.0.md（v1.3，子牙、魏征第 2 关三轮过，第 3 关代码审查意见已修）。立项卡 docs/agents/intake/2026-11-03-baozheng.md；PM 11-03 回「自动跑」（调模型档 1）。
本地试跑：回放 765 次历史判断；真复核上周 9 + 落池 5，$0.037，抓到 5 次「已联系」判断时我方没有任何外发（真人联系闸上线前）。整条「定时 → 待办 → 复核页」链要上线 + PM 开开关后才能跑，见 verify_how。
没做：判法版本号（BZ-03）、提改法和考试（BZ-22～25，等真错题 ≥5）、停止线代码（BZ-28）。
