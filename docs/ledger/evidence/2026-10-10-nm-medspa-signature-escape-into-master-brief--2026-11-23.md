# 证据 · 2026-10-10-nm-medspa-signature-escape-into-master-brief · 2026-11-23
fetched_at: 2026-11-23T08:15:49+1300
查了什么：生产库客户资料表（master_briefs）里 NM Medspa 的记录，产品字段和官网字段。
数字（带样本量、两边取数状态）：NM Medspa 只有 1 条记录，is_active=true；products 共 1 条，只有 name、usp 两个键：name=Signature Escape，usp 与文档 §7 原文逐字一致（NZ$158 · 75min ... Scalp Ritual）；website 为空。取数成功（HTTP 200）。
来源/命令：只读 REST 查询 master_briefs?client_id=eq.<NM Medspa>&select=id,version,is_active,status,website,products,updated_at；对照 docs/clients/nm-medspa/2026-10-10-messenger-ad-faq-readonly-check.md §7。
结论：成。产品只有「名称+卖点」两个字段、内容与文档一致、没有多余字段，官网仍为空。附注：该记录 status 字段为 draft（不影响卡上判据）。
