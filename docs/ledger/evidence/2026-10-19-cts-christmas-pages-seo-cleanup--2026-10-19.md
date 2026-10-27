# 证据：CTS 圣诞团下架后的 301 与站点地图核对

取数时间：2026-10-19 10:35 UTC（官网 PR 249 / 250 部署后，线上最新部署 10:34 UTC）
方法：对线上地址各发一次 GET（不带跟随，看第一跳；再带跟随看终点）；下载 sitemap.xml 全文检索。样本：3 个旧地址 + 1 份站点地图（172 条 loc，约 29.8KB）。

| 旧地址 | 第一跳状态码 | 跳转到 | 终点状态码 | 跳数 |
|---|---|---|---|---|
| /christmas-new-year-china | 301 | /tours/china/discovery | 200 | 1 |
| /tours/china/discovery/china-icons-collection | 301 | /tours/china/discovery | 200 | 1 |
| /tours/china/discovery/china-icons-collection-christchurch | 301 | /tours/china/discovery | 200 | 1 |

站点地图：HTTP 200，是平铺的 urlset（不是索引），172 条；检索 christmas-new-year-china 与 china-icons-collection 命中 **0** 条。
结论：301 目标正确、一跳到位；三个旧地址已从站点地图摘除。

顺带观察（不算本卡验收，供统筹决定）：301 的目标页 /tours/china/discovery 本身**不在**站点地图的 loc 里（精确匹配 0 条；同目录的子页如 beijing-xian、essentials、golden-china 等都在）。

没验的部分：谷歌侧何时处理这三个旧地址的移除，不在本次范围，属于之后几周的观察。
