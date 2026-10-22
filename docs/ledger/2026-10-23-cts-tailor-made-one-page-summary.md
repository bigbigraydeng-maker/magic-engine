---
id: 2026-10-23-cts-tailor-made-one-page-summary
title: 定制行程单页面加「一页摘要」一键导出——亮点/价格/日期的浓缩版，不是完整行程单
status: decided
owner: pm
decided_on: 2026-10-23
source: session:ae2ea1a7
verify_by: 2026-10-30
verify_how: 打开任意一份已建好的 tailor-made 报价单，点「一页摘要」按钮，新标签页里能看到单页（非多页）文档，含标题/路线/日期/亮点/价格/顾问联系方式，且价格缺失时显示替代文案而不是空白或编造数字
---
实现：`src/lib/tailor-made/summary.ts`（派生 + 裁剪）、`summary-render.ts`（渲染）、
新路由 `one-pager-preview`、新模板 `templates/tailor-made-summary/`，复用既有
`template-html.ts` 注入机制；`TailorMadeEditor.tsx` 加「一页摘要」按钮。
