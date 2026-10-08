---
id: 2026-10-09-factory-reel-ad-draft-r4-implementation
title: 视频工厂发布成功的 Reel 自动起草一条「暂停」广告（只建暂停，开启仍要 PM 点头）
status: decided
owner: agent
decided_on: 2026-10-09
source: session:0d1ef522
verify_by: 2026-10-16
verify_how: 前置：PM 点头 apply migration 20261009000000、给试跑客户配开关、部署后到 Inngest 后台手动 Sync。夜巡只读核对：近 7 天 flywheel_actions 里 ads.factory_reel_draft 的 mode=dry_run 行应为 dry_run_ok 或已知 blocked，不得有 failed、也不得有超过 30 分钟的 started；PM 点头真建后应有一行 mode=on 且 status=drafted，对应 ads.create_ad 草稿行已按清单删除；PR 里「当场试跑」一段要有真实回执。
---
设计稿：docs/specs/2026-10-06-factory-reel-to-ad-draft-r4-design-v0.2.md（PR #2342）；统筹 02 号 2026-10-09 确认 R1→R8 拆分。
A 级，分支 feat/factory-reel-ad-draft-r4，代码由 DeepSeek 写；migration 只写文件，apply 前需 PM 本人点头。
后放项（激活时重设时间、过期自动删、账户总上限硬拦、Kernel 收编、官方号上传、激活后第二天按版位回读花费）见 PR「后续事项」，不在本卡范围。
