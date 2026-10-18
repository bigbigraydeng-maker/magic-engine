---
id: promo-cards-live-trial-run
title: 三张卡在生产页面当场填过一张并落库；#2798 三句修正文案已上线
status: verified
owner: 105-CTS推广
date: 2026-10-18
verify_how: 读 marketing_plans 21971d80 的 plan_data.promo.phases[0].business_case
done_ref: https://github.com/bigbigraydeng-maker/magic-engine/pull/2798
---

生产页面填了 CTS 草稿计划（21971d80）第 1 阶段的经营判断卡并保存，读库确认落库（updated_at 2026-10-18 03:00:26Z，status 仍 draft），元→分与百分数→小数换算都对，算式渲染 800×1.74×2.6% = 36.19 元。
#2798 三句修正文案已随部署上线，16:00 NZDT 在页面上逐句核过。
同时发现保本那行是断句，单开 PR #2810 修。
「旧计划批准记录仍显示批准的就是现在这一版」这一条**无对象可验**：库里没有任何已批准的推广计划。
试跑卡已按统筹要求删除，读库确认 cards_left=0（updated_at 2026-10-18 03:09:33Z，status 仍 draft），真实计划里没有留下试跑数据。

后续事项（都不新增页面）：
1. 经营判断卡和实验卡的金额输入框写死「元」，但规格注释写的是「账户币种的分」；这张卡挂在阶段上、没绑广告账户，拿不到币种。CTS 是新西兰元，显示「元」会让人误读。只读展示区已经写了「按广告账户的币种」，是这两处编辑标签没跟上。
2. assigned_to 是装饰性文本，没人会收到活。
3. 退回草稿时按 pending 硬删任务卡。
4. 页面级批量生成才是真口子。
