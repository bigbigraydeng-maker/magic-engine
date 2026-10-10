---
id: 2026-09-26-seo-meta-pr-body-vendor-name
title: 标题周循环开在客户公开网站仓库的单子，「数据来源」一行不再写真实数据供应商名
status: verified
owner: agent
decided_on: 2026-09-26
source: pr:2058
done_on: 2026-09-26
done_ref: pr:2058
verify_by: 2026-09-28
verify_how: 2026-09-28 05:30 UTC 标题周循环跑完后，看 CTS 网站仓库 bigbigraydeng-maker/chinatravel 当周新开的单子（分支前缀 feat/me-seo-meta-cycle-）：正文里搜不到 DataForSEO（不分大小写），「数据来源」一行写的是 Keyword Intelligence；那周没开单子则记「本周无单子、下周再看」，不算失败
last_checked: 2026-09-28
check_note: 本周单子PR#214正文无DataForSEO字样，数据来源行正确对照Keyword Intelligence
verified_ref: doc:docs/ledger/evidence/2026-09-26-seo-meta-pr-body-vendor-name--2026-09-28.md
---
子牙第 3 条设计二审「另开卡 1」，有时限（下周一周循环前）。CTS 网站仓库是公开的，单子正文原来会写出真实供应商名，违反第三方封装名规则。
复用 src/lib/mcp/vendor-filter.ts 的 scrubString，只换「数据来源」这一行；标题 / 描述原文保持与网站真实改动一字不差。不碰 gate.ts（在草稿 #1948 的改动范围里）。
这是止血。第 3 条 3b 会把单子正文改成只写改动本身，证据只放 ME 审批页。
