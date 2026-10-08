---
id: 2026-10-09-factory-reel-ad-draft-r4-implementation
title: 视频工厂发布成功的 Reel 自动起草一条「暂停」广告（只建暂停，开启仍要 PM 点头）
status: decided
owner: agent
decided_on: 2026-10-09
source: session:0d1ef522
verify_by: 2026-10-16
verify_how: 草稿 PR 里「当场试跑」一段要有 dry_run 真实回执；真建暂停对象需 PM 点头后三层回读都是暂停并按清单删除；两项都有才算做完
---
设计稿：docs/specs/2026-10-06-factory-reel-to-ad-draft-r4-design-v0.2.md（PR #2342）；统筹 02 号 2026-10-09 确认 R1→R8 拆分。
A 级，分支 feat/factory-reel-ad-draft-r4，代码由 DeepSeek 写；migration 只写文件，apply 前需 PM 本人点头。
后放项（激活时重设时间、过期自动删、账户总上限硬拦、Kernel 收编、官方号上传）不在本卡范围。
