---
id: 2026-10-05-seo-keyword-opportunity-entry
title: 只读"关键词全盘机会"入口：按客户品牌手册的种子词查 NZ 搜索需求，对照已跟踪排名，分买家词 / 研究词，给出上限而非承诺
status: decided
owner: agent
decided_on: 2026-10-05
source: session:cdd5dbf9
verify_by: 2026-10-06
verify_how: 合并部署后①用手动试跑入口跑 `job=keyword-opportunity`（dry_run=true，CTS client_id）：摘要里 paid_calls_made=0、plan 列出品牌手册里的种子词（最多 15 个）、est_max_cost_usd 约 0.375；②PM 同意花钱后真跑（dry_run=false + confirm），摘要里 status 非 no_data、summary 里有买家词 / 研究词各自的 top 列表；估算费用写进回复，事后与供应商账单核对一次
---
PM 2026-10-05 要"没排上名但搜索量大的词"的全盘视图。后台"竞品缺口"只拿 wendywutours 一家真对手去比，缺口词多为欧洲 / 日本 / 越南，不能当中国业务的机会图，所以改成按客户自己的品牌手册种子词（master_briefs.keyword_seeds）查需求。
设计要点：dry_run=1（含缺省）零供应商调用，只给计划与费用上限；只有 dry_run=0 才付费，每词一次 keyword_ideas，限 150 条 / 词。失败或为空一律报 no_data（HTTP 500），不当成"没需求"。品牌词、竞品品牌词不进机会表；同一搜索的不同说法只算一次（取最大量，不相加）。"冲到第 5 / 第 3 名多拿的点击"明确标为上限，不是预测。不写任何表。
费用是按供应商公开价估的上限（每次约 0.01 美元 + 每条 0.0001 美元），没对过账单；真跑后要核一次。改 `.github/` 属 A 级，需 PM「合」。
