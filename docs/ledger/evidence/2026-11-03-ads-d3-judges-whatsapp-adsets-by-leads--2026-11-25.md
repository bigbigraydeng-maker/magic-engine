# 证据 · 2026-11-03-ads-d3-judges-whatsapp-adsets-by-leads · 2026-11-25
fetched_at: 2026-11-25T03:22:03+13:00
查了什么：gh pr view 3535; SQL on ad_health_narratives 10-23..11-23 (search for 花钱没结果/D3); npx vitest d3-scope.test.ts
数字（带样本量、两边取数状态）：PR 3535 merged 11-02. CTS: narratives containing 花钱没结果 on 10-25..10-30 (6 days), zero on 11-04..11-23 (about 40 rows). d3-scope tests 30/30 pass. Remaining D3 hits after merge are on another client's WhatsApp groups, judged by conversation counts (expected, per-group result type).
来源/命令：见「查了什么」，均为只读查询
结论：成，修好后 CTS 的 WhatsApp 组不再被误报花钱没结果，测试全过。
