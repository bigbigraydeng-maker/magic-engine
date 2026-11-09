# 证据：2026-10-09-calendar-cts-monday-title-pr-no-vendor-name · 取数 2026-10-09（NZ 时间，日历巡检只读核实）

日历事件：查一下周一 CTS 自动改的标题：有没有改错、单子里有没有真实供应商名

## 结论

9/28 周一那轮只开了 1 个单子（chinatravel #214，beijing-to-xian-high-speed-train，改 1 页）；新标题/描述没有把范围改窄或编造价格天数，单子正文搜 DataForSEO 为 0 处。

## 怎么查的

gh pr view 214 -R bigbigraydeng-maker/chinatravel：标题 'Beijing to Xi'an High-Speed Train: NZ Travel Guide' -> 'Beijing to Xian High Speed Train Guide'；描述改为 Routes, schedules & booking tips（无具体价格/天数/出发城市）；body grep -ci dataforseo = 0（仅出现 'Keyword Intelligence' 字样作为否定说明）。内容对错是我的只读判断，描述中 'ancient capital' 为泛称。另：10/3 有 #219 回滚 #213，属退役旧 SEO 任务，非本轮。
