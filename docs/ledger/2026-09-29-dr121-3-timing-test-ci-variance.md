---
id: 2026-09-29-dr121-3-timing-test-ci-variance
title: DR121-3 的 64KB 压力测试改用能扛 CI 抖动的耗时上限，别人别再瞎重跑
status: done
owner: agent
decided_on: 2026-09-29
source: session:9a244b0b
done_on: 2026-09-29
done_ref: pr:2196
verify_how: 合并后看 ops-review-loop-tests 在不相关 PR 上连续几次不再因 DR121-3 闪红（样本至少 10 次 CI 运行）；出现任何一次 >1000ms 就回头查是不是真退化
---
`tools/ops-review-loop/tests/risk.test.ts` 的 DR121-3 压力测试 9-29 晚在 #2183、#2189、广告构建控制窗口各闪测一次，重跑就过。
本地连跑 7 次：稳态 19–32ms，冷启动跳到 547ms，原 200ms 上限没余量；主干另一窗口改的 300ms 仍低于这个尖峰。
改成 1000ms，与 seo-checker-dos.test.ts、ads-strategy rules.test.ts 的现成写法一致，仍比旧坏代码的 1.4–3.9 秒紧。
改后全文件连跑 5 次全绿（370/370）。
