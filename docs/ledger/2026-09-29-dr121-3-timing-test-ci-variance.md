---
id: 2026-09-29-dr121-3-timing-test-ci-variance
title: DR121-3 的 64KB 压力测试改用能扛 CI 抖动的耗时上限，别人别再瞎重跑
status: done
owner: agent
decided_on: 2026-09-29
source: session:9a244b0b
done_on: 2026-09-29
done_ref: pr:__PR_NUMBER__
---
`tools/ops-review-loop/tests/risk.test.ts` 里 DR121-3 那条测试今晚闪测 3 次（#2183、#2189、
广告构建控制在 223ms/253ms 各撞了一次），代码没改，重跑就过。本地连跑 7 次实测：正常
19–32ms，冷启动那次跳到 547ms——原来 200ms 的上限对这种波动完全没余量。改成 1000ms，
跟这个仓库同类"防止指数级变慢"测试的现成写法一致（seo-checker-dos.test.ts、
ads-strategy rules.test.ts 都是 1000ms），比旧的坏代码实测的 1.4–3.9 秒还紧很多倍，
真出问题照样抓得住。改后连跑 5 次全绿。
