---
id: 2026-11-11-cts-tailor-made-sic-product-label
title: CTS 定制行程单封面小字可在 Tailor-made 与 Seat-in-coach (SIC) 之间切换
status: decided
owner: agent
decided_on: 2026-11-11
source: session:dde5b762
verify_how: 打开 CTS 定制行程单编辑页「行程概览」，看有没有「产品类型」下拉；选 SIC 后预览封面图上小字应为 Seat-in-coach (SIC) journey，选回 Tailor-made 应为 Tailor-made journey
---
客户（CTS）要求：同一个行程单页面，封面首页上的「Tailor-made」字样能改成「Seat-in-coach (SIC)」。
做法：行程数据加可选字段 `trip.productType`（`tailor-made` 默认 / `sic`），老数据不填就是原样；编辑页行程概览加下拉；新建画册时封面小字跟着产品类型走，已有画册的小字仍可手改。
