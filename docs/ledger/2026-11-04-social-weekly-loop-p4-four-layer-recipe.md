---
id: 2026-11-04-social-weekly-loop-p4-four-layer-recipe
title: 社媒每周闭环 P4：四层周方子（平台 / 行业 / 阶段 / 客户）只读合成
status: done
owner: agent
decided_on: 2026-11-04
source: pr:3571
done_on: 2026-11-04
done_ref: pr:PENDING
verify_by: 2026-11-18
verify_how: 合并后 npx vitest run src/lib/social/recipe 全绿；第一阶段试跑时用 CTS 真配置算一次 Facebook 周方子，客户名额（每周 3 条 Reel）原样保留、来源标 client；行业模板与阶段不同处只出建议
---
IMPACT v1.5 §3.3.1（PM 11-02 已定）落成只读纯函数：Facebook 平台硬规则、旅游 / 物流行业模板（数字都标建议）、四档阶段判定、合成周方子（客户填过的永远优先，不同处出建议）。IG / TikTok 返回 not_connected。不写库、不调模型。
