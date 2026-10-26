---
id: 2026-10-05-client-facts-step1
title: 客户资料库第 1 步做好了：新函数能只读取出品牌、视觉、三级禁忌，但还没接任何渠道
status: done
owner: pm
decided_on: 2026-10-05
source: session:21f04888
verify_by: 2026-10-12
verify_how: PM 用只读统计 5 条跑生产库（docs/audits/2026-10-05-get-client-facts-step1.md），第 1 条要齐 11 行；再看第 2/3/5 条有没有客户会被多拦少拦，没问题回「合」草稿 PR；到期没跑就回头问 PM
done_on: 2026-10-05
done_ref: pr:2248
---
PR 2248 是草稿，A 级，合并要 PM 在对话里回「合」。说明、威胁模型与统计 SQL：docs/audits/2026-10-05-get-client-facts-step1.md。
没有任何渠道接入它，Reels、社媒、广告现有行为都没变；切换前必须先对账新旧禁忌口径（见说明文档「不做」一节）。
下一步：PM 跑统计 → 看对比 → 才开「影子对比」PR。
