---
id: 2026-10-06-window-triage-three-tracks
title: 统筹窗口定三条主线（视频工厂 / SEO Agent / CTS 广告），其余只收尾；PM 口述「P0/P1 找我合」与现行 A/B/C 合并闸是两个独立维度，尚未接进自动合并
status: decided
owner: pm
decided_on: 2026-10-06
source: session:ec90bb17
verify_by: 2026-10-13
verify_how: 三条主线各有一个开发窗口在跑并向统筹汇报（会话列表可见）；PM 对「P0/P1 由 PM 本人合」是否接进自动合并闸给出回复，回复写进本卡或新卡。
---
统筹窗口 claude/organize-work-tasks-28b30b 只盘点、派活、收口，不写代码。
三条主线：视频工厂 / Remotion、SEO Agent、CTS 广告计划；现状不在本卡复述，见各自台账卡（remotion-pack-*、seo-*、cts-shanghai-*）。

合并口径更正：PM 说「P2/P3 自己合，P0/P1 找我合」。P0–P3 是资源优先级（ENGINEERING_QUALITY_GATES §11），A/B/C 是改动风险级，两者独立，不是谁比谁严。现行自动合并闸只看 A/B/C，一个判成 B/C 的 P0/P1 改动会被机器直接合，和 PM 这句话冲突。把优先级接进自动合并闸要改 .github/，属 A 级，等 PM 决定；决定前统筹对 P0/P1 不放行自动合并以外的任何动作。

本窗口已做：关 #2222（被 #2276 覆盖）；刷新 19 个待合并项分支；归档 27 个已收尾会话。没合并任何 PR、没用 --admin。
刷新分支没让任何一个自动合：真堵点是台账检查红灯和未解决的审查意见；#2201 刷新后被重新判级转红，是刷新造成的。经验已写入记忆 feedback-diagnose-stuck-prs-before-refreshing-branches。
