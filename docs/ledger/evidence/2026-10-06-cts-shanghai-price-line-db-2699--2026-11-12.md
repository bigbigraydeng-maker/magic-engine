# 证据 · 2026-10-06-cts-shanghai-price-line-db-2699 · 2026-11-12
fetched_at: 2026-11-12T21:35+13:00（库端 now() = 2026-11-12 08:35 UTC）
查了什么：生产库（CrazyContent）clients 表 CTS 一行的 factory_config 文本里，上海周边团（Shanghai & Surroundings）那条报价的 price_line。
数字（带样本量、两边取数状态）：factory_config 里共 7 条「N Nights · From NZD」价格行，取数成功；上海周边团那条为「7 Nights · From NZD $2,699 pp」；全文搜索 "3,399" 命中 0 次，"2,699" 命中。
来源/命令：Supabase 只读 SQL：select substring(factory_config::text from position('2,699' in factory_config::text)-160 for 200) from clients where id = CTS；另查 position('3,399' …) = 0。
结论：成。上海周边团价格行在生产库里是 2,699，旧价 3,399 已不存在。（划掉 3,399 的样式不在本卡判据内。）
