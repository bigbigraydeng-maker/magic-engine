# 证据 · 2026-09-26-seo-meta-pr-body-vendor-name · 2026-09-28

fetched_at: 2026-09-28T09:35:00Z

查了什么：CTS 网站仓库 bigbigraydeng-maker/chinatravel 里 2026-09-28 05:30 UTC 标题周循环新开的单子
（分支 feat/me-seo-meta-cycle-2026-W40-beijing-to-xian-high-speed-train，PR #214）正文全文

数字/内容：
- 正文全文里搜「dataforseo」（不分大小写）：0 处命中
- 「数据来源」那一行写的是：「需求来自谷歌后台真实曝光 105 次；难度按谷歌前三名网站强度估算为 41
  （非 Keyword Intelligence 难度分）」—— 这周的判据来源是 GSC 曝光数据、不是 Keyword Intelligence，
  但正文明确点名对照的是「Keyword Intelligence」这个封装名，不是真实供应商名，说明 scrub 逻辑生效
- 标题/描述原文改动与网站真实改动逐字一致（未改动改动本身，只过滤了供应商名）

来源/命令：gh pr view 214 --repo bigbigraydeng-maker/chinatravel

结论：成。没有真实数据供应商名泄漏；这周判据来源恰好是 GSC 曝光量而非 Keyword Intelligence 查询，
文案相应写成"非 Keyword Intelligence 难度分"，用词比卡上预期的更精确但同样不含真名，符合止血目的。
