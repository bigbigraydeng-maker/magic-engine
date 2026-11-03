---
id: 2026-11-03-ads-d7-into-pm-todo
title: 广告体检的授权 / 数据 / 配置问题（D7）现在会进今日待办，每个客户最多一条
status: done
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-11-10
verify_how: 合并部署后，下一个 UTC 周日晚（新西兰周一早上）的今日待办邮件里，仍未解决的客户应出现 D7 条目，每条带链接；样本至少 3 个客户，没出现就是还断着
done_on: 2026-11-03
done_ref: pr:3530
---
D7 命中带人工任务三件套，以前只进内部日报邮件和广告健康页，不进今日待办。现在并入现有的 ads_rule_finding，不新增待办种类。
节奏同其它广告规则：连着 2 天才出，头 3 天每天一次，之后只在 UTC 周日一次；不看数据是否拉全，最新一行超过 3 天就不出。
第 0 步留下的旧卡 2026-11-03-ads-d7-outcome-config-not-in-pm-todo 等第 0 步改动单合并后翻成 done，指向本卡的 PR。
