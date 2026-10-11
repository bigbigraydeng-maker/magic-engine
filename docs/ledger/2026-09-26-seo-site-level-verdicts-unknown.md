---
id: 2026-09-26-seo-site-level-verdicts-unknown
title: SEO 动作的效果不再拿整站流量涨跌来判：整站指标一律记「不知道」，成功率只算能判定的案例
status: done
owner: agent
decided_on: 2026-09-26
source: session:3b976bb5
verify_by: 2026-10-03
verify_how: 合并后等每 6 小时一次的归因任务跑过一轮，再查三件事：①生产库里整站 SEO 指标（seo.gsc.clicks/impressions/avg_position、seo.domain.*、seo.ga4.*）在合并后重算过的结论行全是 inconclusive、confidence 为 0，数字照留；②后台「飞轮成效」页与诸葛亮查历史工具写成「可判定 X / 共 Y」，可判定少于 3 个不给百分比；③后台「飞轮成效」排行里不再出现任何 SEO 行动类型（今天 SEO 结论全是整站指标，一个可判定案例都没有）。三项全对算成
done_on: 2026-09-26
done_ref: pr:2044
last_checked: 2026-10-11
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
PM 2026-09-26 在孔子窗口回「用 deepseek 修复 你来做质量检测」；第 1 条（停止从噪音里学）拆成 1a（本卡）和 1b（记忆下架，另卡 2026-09-26-seo-stop-learning-from-noise）。
改动面：flywheel/attribution（共用判断 + 两个评估器同一个打分函数）、case-library/outcome-confidence、flywheel/aggregate、后台飞轮成效接口与页面、诸葛亮查历史工具。
A 级：合并即授权归因任务把它还会重算到的整站 SEO 结论行原地改成 inconclusive（只改结论和置信度两列）；回滚 = 回退代码，下一轮归因算回旧值。
修「每周 SEO 快照」（第 5 条）必须排在本卡上线之后。
上线记录：PM 2026-09-26 在孔子窗口回「上 2040 2044」，03:05:29 UTC 合并（`393240dc`），03:10:20 UTC 部署成功。归因任务每 6 小时一次（00/06/12/18 UTC），部署后第一轮起把重算到的整站 SEO 结论行改成 inconclusive。
