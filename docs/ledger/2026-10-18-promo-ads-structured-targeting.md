---
id: 2026-10-18-promo-ads-structured-targeting
title: 推广计划的广告步骤能直接填「投哪个国家、多大年龄」，不必先存成受众
status: decided
owner: agent
decided_on: 2026-10-18
source: pr:2822
verify_by: 2026-11-09
verify_how: 推广计划页展开广告步骤 → 投放范围 → 填 NZ + 55 → 保存 → 读 plan_data.promo 里的 targeting
---
74 查实缺口：step-8/11 的受众栏是文字「NZ 55+ 广撒」不是编号。执行层早就支持地区/年龄（ad-draft.ts + ad-publisher.ts，含城市∪国家那个事故的防护），缺的只是计划层没字段。
受众编号与投放范围二选一；一个默认国家/年龄都不设；删除时真删键（留 undefined 会把已批准计划判成「内容变过了」，实测会变成 "targeting":null）。
界面写明这里管不了 Meta 的「语言」定向（误删它曾 11 小时烧 $57、0 转化）。
不做：计划→真广告草稿那条接线（现在根本不存在），交 119；开投回读核对实际受众仍未做。
