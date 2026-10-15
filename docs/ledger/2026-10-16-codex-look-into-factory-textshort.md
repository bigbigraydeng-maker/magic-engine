---
id: 2026-10-16-codex-look-into-factory-textshort
title: 保留 Codex 文字短片的观感，用 Remotion 重写进视频工厂（新模板 textshort），并用 Codex 成片逐帧对拍验收
status: decided
owner: agent
decided_on: 2026-10-16
source: session:450208a3
verify_by: 2026-10-23
verify_how: 先过子牙+魏征+板桥复核，再 DeepSeek 写 textshort 模板（B 级）；用 Codex 的 three-china-double-takes-v2 与 food-steam-sizzle-sip 的 spec.json 转成工单、经工厂真实出片，与 Codex 成片同批时间点抽帧对拍（文字卡 SSIM≥0.95、时长误差≤0.1 秒、响度 −17±1 LUFS），差异表交苏东坡/马良判；首条 CTS 样片交审。
---
PM 满意的 Codex 视频其实是 Python+ffmpeg 脚本做的（不是 Remotion），所以是「用 Remotion 重写」；设计稿见 docs/specs/2026-10-16-codex-video-pipeline-into-factory-design.md。
阶段 2（documentary 长片 + ElevenLabs 配音）属 A 级、单独审批，暂不做；阶段 3（Inngest 工作流）另议；YouTube/TikTok 出片一律先走工厂，不再另写脚本。
