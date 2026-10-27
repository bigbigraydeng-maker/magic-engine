---
id: 2026-10-26-lesson-verify-pr1
title: 经验验证 PR-1：按文字自动归类，SEO 只读检查 + 广告建议实验卡片，丢弃只是不启用
status: decided
owner: pm
decided_on: 2026-10-26
source: issue:3088
verify_by: 2026-10-30
verify_how: 在广告引擎页打开一条提到 HTML/schema 的经验，点"检查这个站"能看到符合/不符合；广告类经验显示实验卡片且没有执行按钮
---
不调模型、不花钱、不迁移、不写生产库。类型由关键词自动归类，不用人选检查项，只选站点（我们自己的站 / clients 已有网址）。
广告回测留到 PR-2。"丢弃"第一版 = 保持不启用，不写 evidence。
已知缺口：关键词规则会归错，归错时改 `lesson-verify/classify.ts`；检查结果不落库，每次点击现算。
