---
id: 2026-10-27-prescription-chain-status-readonly
title: 处方走到哪一步改为现算，处方卡上显示九个点
status: decided
owner: agent
decided_on: 2026-10-27
source: doc:docs/specs/2026-10-26-prescription-to-act-full-auto-design-v0.1.md
verify_by: 2026-11-02
verify_how: 打开一份处方卡，能看到看、量、确认、开方、同意、计划、素材、草稿、开投九个点。快照超过 12 小时时「看」显示卡住。读失败的点写读不到，不显示成完成。接口只读，不写库。
---
设计稿第五节刀 1。状态由处方、推广计划、素材池、工单、广告草稿和广告快照现算，不另存一份。
进度条是独立组件，处方页布局只在处方卡上挂这一处。
还没走到的点写「还没到」，不用完成或读不到去填。
