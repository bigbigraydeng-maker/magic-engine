---
id: 2026-10-05-cts-product-facts-snapshot
title: CTS 官网产品事实快照（价格/天数/出发日/包含项）能只读抓取了，带出处和核对日期，过期或抓不到会明说
status: done
owner: agent
decided_on: 2026-10-05
source: session:9db568bb
verify_by: 2026-10-12
verify_how: 接线后在真实库里跑一次刷新再读一次：CTS 产品页都有记录、与官网一致；抓失败的页显示 fetch_failed 而不是旧数；超过 14 天显示 stale
done_on: 2026-10-05
done_ref: pr:2270
---
只读抓取+读取接口已写完（PR 2270，草稿）；没接线、没往真实库写过、没建工单。Render 上还需配置 CLIENT_PRODUCT_FACT_SOURCES 才能真跑。
