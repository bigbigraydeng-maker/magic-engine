---
id: 2026-11-02-ads-next-step-merge-card
title: 广告健康页顶部「广告下一步」只读合并卡（体检红灯 / 待批 / 处方）
status: done
owner: agent
decided_on: 2026-11-02
source: pr:3521
done_on: 2026-11-02
done_ref: pr:3521
verify_by: 2026-11-05
verify_how: 合并后员工见内部 D 诊断红灯、客户见中性文案且不读 narrative；批完 D3/O1 后顶部待批行刷新。Vitest load-ads-next-step、ads-next-step-card、page 相关用例绿。
---
#3520 只读闭环 A：GET next-step 聚合 + 页面合并卡；非 staff 不读 portfolio_diagnoses、不列 O1；批准面板决策后 bump 刷新卡。
