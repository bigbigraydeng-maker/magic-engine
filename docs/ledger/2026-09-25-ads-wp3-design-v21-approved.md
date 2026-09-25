---
id: 2026-09-25-ads-wp3-design-v21-approved
title: 广告 WP3 接线设计稿 v2.1 PM 认了，实施按 3.1a→3.1b→3.2→3.3 四小步各开 PR
status: decided
owner: agent
decided_on: 2026-09-25
source: pr:1996
verify_by: 2026-10-02
verify_how: 3.1a（同步开关）实施 PR 开出且引用设计稿 §4/§12；migration 先 apply 再合并；子牙+魏征+狄仁杰各一轮通过算成
---
设计稿 `docs/specs/2026-09-25-ads-impact-wp3-design-v1.md`，合同 issue:1986。
三方两轮设计复审 48 条全部并入；狄仁杰复核 3.1a/3.1b 均可进。
Kernel 一行不动；熔断走 envelope-facts 钩子；Check/Tune 复用 attribution+extractor；链条挂 pullback 末尾。
3.1b 同 PR 修 WP2 遗留 issue:1994。任何客户开 bounded_auto 另行授权。
