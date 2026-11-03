# 自动改标题第一整周（2026-10-05 周一那轮，新西兰 18:31）的真实结果与证据

来源：cron_run_logs（seo-meta-cycle-step1~6）、seo_meta_log、线上页面抓取（2026-10-06）。

## 结果
- 候选 9 个 → 过闸 1 个 → 最终自动合并 0 个，转人工 1 个。seo_meta_log 近 30 小时没有新增行。

## 8 个被挡的候选及真实原因（step3 回执原文归纳）
| 页面 | 被谁挡 | 原因 |
|---|---|---|
| liziba-station-chongqing | 关键词 90 天内不重复用 | "liziba station chongqing" 已用于 /liziba-station-chongqing-guide |
| forbidden-city-travel-guide | 找不到可编辑的数据文件 | 页面定义在 src/lib/data/guides.ts，周循环只读 seo-pages* 与 blogs* 开头的文件（cts-meta-pr.ts 里的文件名正则） |
| chongqing-travel-guide | 同上 | 同上（guides.ts） |
| china-tours | 受保护转化页 | clients.seo_config.meta_cycle_protected_slugs |
| about | 受保护转化页 | 同上 |
| leshan-giant-buddha-day-trip | 关键词数据不足 | 供应商无搜索量/难度；该页对该词谷歌曝光 1，低于 30 的下限 |
| holidays-to-china-from-new-zealand | 关键词数据不足 | 同上，曝光 5，低于 30 |
| chongqing-hot-pot-guide | 不借用别页的查询词 | 页面自己的查询里，没有一个同时含 slug 里至少 2 个有区分度的词（chongqing、guide 都是泛词） |
- 过闸的 1 个：best-time-to-visit-china，在 step4 被事实核对拦下（fact_contradiction_detected：新描述与原文事实矛盾），applied=false。

## 对旧台账卡的证据
- 2026-09-28-seo-meta-cycle-topic-collision：①"最长词是城市名的页面不再借用别页查询词"在真实运行里触发（chongqing-hot-pot-guide 被拒）；②9/28 写错的三页线上现为：china-tours-from-new-zealand 的描述含 $3,480 / $3,880 / $7,999 / Auckland，liziba-monorail 与 chongqing-night-city-lights 恢复为改动前的标题和描述。
- 注意：china-tours-from-new-zealand 的标题仍带重复品牌尾巴「CTS | CTS Tours」（受保护页，需人工改）。

## 结论
自动改标题没坏；本周没改出东西，是因为① 前两周已把"潜力最大且可自动改"的页面改过一轮（90 天去重 + 近期改过），② 剩下的高曝光页有 2 个在周循环够不着的 guides.ts 里，③ 2 个受保护，④ 2 个数据不足，⑤ 1 个被事实核对拦下。三道安全闸（不借别页查询词、关键词 90 天不重复、事实核对）在真实运行里都实际拦住了东西。
