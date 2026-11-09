---
id: 2026-10-06-remotion-pack-a-followup
title: 包 A 的补丁：分析整首歌并修正拍点早一帧、音乐可从指定小节起播、去掉所有会被读成版权存疑的字样
status: decided
owner: agent
decided_on: 2026-10-06
source: session:b2c90f61
verify_by: 2026-10-13
verify_how: 合并后挑 5 首 BPM 对不上的歌（big-stomp-kick / feel-good-travel / founders-in-motion / snap-the-floor / analytical-scholar）听一遍并渲后量偏差，再用新脚本重生成目录并把对的转 ready；与版权无关
---
实测证据（合成鼓点轨，真值已知）：旧分析器首拍早 20 毫秒，新版 ±2 毫秒；旧版只看前 60 秒，前一分钟静音的轨道直接测不出节拍，新版 BPM 误差 <1。
同一条轨按新做法渲清单片：6/6 画面切点比真实鼓点晚 30 毫秒（来源 SYNC_SHIFT_FRAMES=1，见另一张卡）；按旧的等间隔做法 0/6 在 ±50 毫秒内。
