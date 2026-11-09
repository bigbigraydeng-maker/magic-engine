---
id: 2026-10-06-cts-shanghai-surroundings-bot-price-sync
title: CTS 上海周边团改价后，客服机器人认的价格要和官网同一天换，换之前不动生产库
status: decided
owner: pm
decided_on: 2026-10-06
source: session:7b40603d
verify_by: 2026-10-09
verify_how: 官网改价那个 PR 上线后，按操作手册第 5 步抽查：机器人对「上海周边团」报的价和官网一致，且手册第 0 步的只读查询里生效的那一行是新价。
---
操作手册见 docs/clients/cts/2026-10-06-shanghai-surroundings-price-bot-sync.md（价格存在生产库的客户知识库表里，不在代码文件里，必须走「我们批准 + CTS 本人确认」双签，不能直接改库）。
官网 PR 在 chinatravel 仓（草稿，等 PM 回「合」）；两边同一天做，顺序见手册第 2–4 步。
