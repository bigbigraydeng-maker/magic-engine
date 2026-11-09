---
id: 2026-10-19-cts-christmas-pages-seo-cleanup
title: CTS 圣诞团下架后的 SEO 侧清理：摘掉监控页、关催收录待办，官网 301 上线后验一次
status: verified
owner: agent
decided_on: 2026-10-19
source: session:2cd3c621
verify_by: 2026-10-26
verify_how: 官网 PR 249 上线后，对三个旧地址（圣诞活动页和两个团页）各请求一次：应 301 到发现之旅团页；并确认站点地图里已摘除这三个地址。官网没上线则顺延，不算失败。
done_on: 2026-10-19
done_ref: pr:2908
verified_ref: doc:docs/ledger/evidence/2026-10-19-cts-christmas-pages-seo-cleanup--2026-10-19.md
last_checked: 2026-10-19
check_note: 三个旧地址实测均一跳 301 到发现之旅团页，站点地图已摘除（0 命中）
---
已做：post-publish-watch 配置摘掉三个页面（14 改 11）；SEO 巡检待办（催收录 Christchurch 出发团页）已标为跳过。关键词清单和周快照里查过，没有圣诞团相关词，无需停用。
还没做：301 与站点地图的线上核对，要等官网合并上线。
