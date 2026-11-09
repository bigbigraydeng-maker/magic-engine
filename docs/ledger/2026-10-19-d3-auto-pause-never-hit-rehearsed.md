---
id: 2026-10-19-d3-auto-pause-never-hit-rehearsed
title: D3 自动暂停零记录的真因是判据从没命中（每天 not_comparable），不是没跑；已用测试数据当场演练过五条分支
status: done
owner: agent
decided_on: 2026-10-19
done_on: 2026-10-19
done_ref: doc:docs/ledger/evidence/d3-auto-pause-rehearsal--2026-10-19.md
source: session:c668eb35
verify_by: 2026-10-26
verify_how: 查两件事：①`ad_health_narratives.payload.portfolio_diagnoses` 里 D3 还是不是天天 not_comparable——如果仍然是，就去查判据的样本门槛为什么永远不满足（这是真正该修的地方）②`flywheel_actions` 里 `ads.auto_pause_on_d3` 有没有出现第一行真实记录。
---
生产库 `flywheel_actions` 里这个动作 0 行。实查近几天的诊断回执：D3 每天 `not_comparable`、D7 每天 `hit`，所以没有东西可记。
PM 2026-10-19 指令「用测试数据演练一次，不碰真广告」。已用真代码 `processD3Hit` + 内存替身跑完五条分支：演练模式只记账不提交、真模式提交等批准、非本客户广告组记 blocked、核实不了记 failed、共用账户不出手。
全程零生产写入、零 Meta 请求，临时脚本已删。回执见 done_ref。
顺带查出：`awaiting_approval` 那条回执缺人话说明（其余四条都有），已另开卡。
下一步不是调阈值，是先查 D3 判据为什么永远不可比。
