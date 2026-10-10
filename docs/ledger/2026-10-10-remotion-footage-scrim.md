---
id: 2026-10-10-remotion-footage-scrim
title: Remotion 清单视频新增可选参数 footageScrim，可调「下半屏压暗渐变」的强度（不写＝原效果）
status: done
owner: agent
decided_on: 2026-10-10
source: session:ccde6627
verify_how: 用 footageScrim 0.35 出的 CTS 上海第三版成片，取下 1/3 屏平均亮度，应明显高于不写该参数的旧版（旧版 0–22，新版 24–64 /255）
done_on: 2026-10-10
done_ref: pr:2417
---
PM 嫌上海 Reel 下半屏压得太暗。渐变写死在共享模板里，原来只能靠换素材。新增可选参数 footageScrim（0–1，倍数），不写或写 1 = 逐字节原效果。
证据：旧 props 用旧模板与新模板各渲 33 秒、991 帧，整片对比相似度 1.000000（完全一致）；schema 单测 263 项全过，类型检查无报错。
