---
id: 2026-11-03-ads-scorecard-k1-core
title: 每日广告成绩单（第 1 刀 ①）：每天巡察给每个组算一行，并把预算判断写成「错配 / 没错配 / 还差几个」
status: done
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-11-10
verify_how: 合并部署后，CTS 每天的 ads_growth_states.payload.scorecard 有值：每个有花费的组一行，budget 里每个角色都有 state；没错配的日子也写了 maxGap 和 threshold；预算判断的 under / over 跟当天 D5 / O3 命中一致
done_on: 2026-11-03
done_ref: pr:3544
---
规则手册 v1.1 E-19 / E-20；修复方案第 1 刀拆成三张改动单，这是 ①（只算、只存，不进今日待办，不改 D5 / O3）。② 广告健康页显示、③ 合格客人列（要改数据库和设置页）随后。
代码由 DeepSeek 写（scorecard.ts），Claude Code 写考题、审 diff、接进巡察。考题 18 道，变异检验 9 处全抓住；另有一道「跟线上 D5 / O3 结论一模一样」的一致性题，防止两套算法走样。
当场试跑（生产形状，CTS …7274 账户 10-26 → 11-01）：组 A 每条留资 $5.94、组 B / C 约 $10.8、组 D 4 条还差 1 条；预算判断「没错配，最大差距 0.14，门槛 0.15」——以前这句不写。
