---
id: 2026-10-05-site-audit-meta-description-and-stale-pages
title: 网站体检以后会记下每页的描述，并且不再每周漏掉同一批页面
status: decided
owner: agent
decided_on: 2026-10-05
source: session:83a5fc92
verify_by: 2026-10-12
verify_how: 10-11 周日自动体检跑完后查：CTS 的 client_site_pages 里 meta_description 有值的页数应接近全部（样本=CTS 全部已体检页）；crawled_at 早于 10-04 的页只剩已从网站下架的几页；weekly 那条运行记录里 pages_stale_before_run 有数。不成：描述仍全空，或还有高曝光博客页停在 9-13。
---
网站体检爬虫以前从不写 meta_description（接口里根本没取），且按网站地图顺序截断，CTS 179 页 / 上限 150 页，尾部页面每周都被漏掉但状态仍是"已抓取"。
修法见 PR（改 src/lib/site-audit、src/lib/brief/jina.ts、site-audit-weekly 上限 150→200）。
