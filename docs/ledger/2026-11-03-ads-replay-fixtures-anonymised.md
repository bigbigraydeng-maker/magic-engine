---
id: 2026-11-03-ads-replay-fixtures-anonymised
title: 广告回放测试的样本数据去掉了真实广告账户号和真实金额（公开仓库），回放判定结果不变
status: done
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_how: 合并后在主干跑 npm test -- src/lib/ads-strategy/portfolio src/lib/meta/__tests__/adset-daily-video.test.ts 全绿，并且样本目录里搜不到改动前的任何真实编号
done_on: 2026-11-03
done_ref: commit:44cdf8eee9e5
---
13 个样本文件、9 个测试文件：12 位以上的编号全部换成同长度的假编号（同一个真编号永远换成同一个假编号），金额统一乘一个固定系数，测试里的目标成本同比例调整。
等价性证明：改动前后在 1148 个「账户 × 日期 × 结果口径」组合上逐个比对诊断结果，命中、状态、原因和点名的广告组全部一致，数字证据只差同一个系数。
git 历史里仍有原始数据，清历史要改写历史（禁止动作），这里没做。
