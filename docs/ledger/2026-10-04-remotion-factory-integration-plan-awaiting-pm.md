---
id: 2026-10-04-remotion-factory-integration-plan-awaiting-pm
title: 把 Remotion 出片线接进 ME 视频工厂的方案已写好，等 PM 回「开做」才动手；接进去之前它出的片只能当样片不许发布
status: decided
owner: agent
decided_on: 2026-10-04
source: session:e78010ff
verify_by: 2026-10-11
verify_how: 查两件。①PM 是否对方案 docs/audits/2026-10-04-remotion-into-video-factory-plan.md 回了「开做」（第一步约 1 周、B 级、不碰数据库不碰发布；第二步接进工厂改数据库是 A 级，要 PM 亲口回「合」）；②在 PM 回复之前，~/Projects/cts-remotion 和 Dropbox 里的样片一律不得发布到任何客户账号。一周内没人跟进就交回 PM
---
方案由独立写作员读真实代码后写成，每条结论标了出处，未核实项单独标注（渲染耗时与成本、Render 价目、团队人数）。
已知两个静默断头：client-config.ts 会把不认识的引擎当 ffmpeg；失败待办只扫 creatomate 引擎，Remotion 出片失败不会进今日待办，第二步必须一起改。
素材库只有约 15 条真实视频，推荐 CTS 同事竖拍为主、免费图库补位；同一素材 30 天复用设上限。
