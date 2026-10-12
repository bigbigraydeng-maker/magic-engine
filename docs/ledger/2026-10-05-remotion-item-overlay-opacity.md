---
id: 2026-10-05-remotion-item-overlay-opacity
title: Remotion 清单视频的条目页背景遮罩深浅改成可调（必填 0–0.6），不再写死 0.4
status: done
owner: agent
decided_on: 2026-10-05
source: session:52d6775d
verify_how: 下一条真实出片用 0.15–0.25 重出，抽 9 宫格对比原 0.4；背景明显更亮且白字仍清楚算成，仍偏暗就换亮素材或关模糊
done_on: 2026-10-05
done_ref: pr:2261
last_checked: 2026-10-12
---
PM 嫌条目页背景太暗。加了必填参数 itemOverlayOpacity，样例保持 0.4 原效果；本机用 0.4 与 0.15 各渲 18 秒对比，0.15 平均亮度高 24–35%。
注意：该字段必填，仓库外若有旧工单/旧 props 缺此字段会被整张拒绝。
