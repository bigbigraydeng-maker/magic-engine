---
id: 2026-10-06-remotion-list-logo-mode
title: 出片机清单模板加一个可选的「logo 常驻」开关（默认行为不变），用来比对 logo 两种显示方式
status: done
owner: pm
decided_on: 2026-10-06
source: session:4878a887
verify_by: 2026-10-08
verify_how: 看审查 agent 对「常驻 / 最后 2 拍」的判定与理由是否已写进交付说明；若判定常驻更优，出片机已更新后再建一张用 logoMode 的新工单进审核队列。
done_on: 2026-10-06
done_ref: doc:scripts/factory-worker/engines/remotion/README.md
last_checked: 2026-10-12
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
只加可选字段 logoMode（always / last_beats，不写 = 最后 2 拍，旧工单渲出来不变）。
证明：默认渲出的帧与出片机上传的成片逐帧相似度 1.000；定向测试 236 项 + 54 项通过。
常驻版只在本机渲了对比，没有进审核队列，出片机常驻进程未更新。
