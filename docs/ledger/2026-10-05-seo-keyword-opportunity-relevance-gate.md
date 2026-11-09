---
id: 2026-10-05-seo-keyword-opportunity-relevance-gate
title: 关键词全盘机会加相关性过滤：话题词（种子词 + 已跟踪词）+ 旅游周边噪音词，偏题与噪音分开计数
status: decided
owner: agent
decided_on: 2026-10-05
source: session:cdd5dbf9
verify_by: 2026-10-06
verify_how: 合并部署后先免费演练，再经 PM 同意付费重拉：summary.excluded 里 offTopic、noise 都大于 0；top_buyer / top_research 前 25 名不再出现 passport、immigration、airlines 这类词，且大多含 china / 城市 / 景点名；若前 25 名仍有明显无关词，补话题词规则再重拉前先对照本卡
---
首次付费真跑的 383 个词里前 25 名几乎全是与 CTS 无关的词，总量 37.9 万不可信（详见 2026-10-05-seo-keyword-opportunity-entry 卡末尾）。本卡记录修正：话题词来自客户自己的品牌手册种子词与已跟踪词，去掉泛旅游词、"visa"、4 字以下的词；噪音词表是旅游行业默认策略（调用方可覆盖）。费用是按公开价估的，重拉后与账单核对。
