---
id: 2026-10-06-remotion-sync-shift-30ms-late
title: 视频切点系统性比鼓点晚约 30 毫秒；统筹决定先不改「晚 1 帧」设定，蒙太奇包渲完再复量
status: decided
owner: agent
decided_on: 2026-10-06
source: session:b2c90f61
verify_by: 2026-10-13
verify_how: 蒙太奇包做完后，用合成鼓点音轨（见 PR 说明里的做法）再量一次切点偏差；仍在 ±50 毫秒内就关本卡，超了再把 timing.ts 的 SYNC_SHIFT_FRAMES 改成 0
---
合成鼓点音轨实测：切点比真实鼓点晚约 30 毫秒（6/6 在 ±50 毫秒内），音轨本身没偏移，来源是 timing.ts 里原有的 SYNC_SHIFT_FRAMES = 1。
统筹 2026-10-06 决定：+30 毫秒在 ±50 目标内，先不改；改它会动所有旧 props 的出片时刻、还有旧测试锁着。
