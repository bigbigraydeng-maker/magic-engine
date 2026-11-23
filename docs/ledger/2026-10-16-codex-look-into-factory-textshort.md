---
id: 2026-10-16-codex-look-into-factory-textshort
title: 用 Remotion 重写 Codex 的 Shorts 快切观感进视频工厂（新模板 cutwords，原名 textshort），对拍达标后 Shorts 出片归 ME
status: decided
owner: agent
decided_on: 2026-10-16
source: session:450208a3
verify_by: 2026-10-23
verify_how: 先过子牙+魏征+板桥复核，再 DeepSeek 写 cutwords 模板（B 级）；用 Codex 10-16 三条已发 Shorts（上海/重庆/煎饼）的同素材同入点同文字经工厂真实出片，与成片同批时间点抽帧对拍：文字层 SSIM≥0.95、时长误差≤0.1 秒、响度 −14±1 LUFS、无价格闸通过，差异表交苏东坡/马良判；达标后 Shorts 出片归 ME、Codex 转备用（PM 10-16 拍板）。判据全文见设计稿 §8。
---
PM 满意的 Codex 视频其实是 Python+ffmpeg 脚本做的（不是 Remotion），所以是「用 Remotion 重写」；设计稿见 docs/specs/2026-10-16-codex-video-pipeline-into-factory-design.md。
阶段 2（documentary 长片 + ElevenLabs 配音）属 A 级、单独审批，暂不做；阶段 3（Inngest 工作流）另议；YouTube/TikTok 出片一律先走工厂，不再另写脚本。
