---
id: 2026-10-06-remotion-sync-shift-30ms-late
title: 视频切点系统性比鼓点晚约 30 毫秒，要不要把原有的「晚 1 帧」设定改成 0，等统筹定
status: decided
owner: pm
decided_on: 2026-10-06
source: session:b2c90f61
verify_by: 2026-10-13
verify_how: 统筹拍板后若改，用合成鼓点音轨重渲，6 个切点偏差应接近 0；不改则本卡直接关
---
合成鼓点音轨实测：新做法 6/6 切点在 ±50 毫秒内，但全部晚约 30 毫秒；音轨本身没偏移，来源是 timing.ts 里原有的 SYNC_SHIFT_FRAMES = 1。
改它会动所有旧 props 的出片时刻、还有旧测试锁着，不在 PR #2279 范围，所以没改。
