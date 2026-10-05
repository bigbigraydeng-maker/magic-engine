---
id: 2026-09-28-seo-meta-cycle-topic-collision
title: CTS 每周自动改标题把两页标题写错——修了取词逻辑+加了跑题检查，两条错标题还没纠正
status: verified
owner: agent
decided_on: 2026-09-28
source: session:e93b2367
verify_by: 2026-09-29
verify_how: 下次 CTS 每周自动改标题任务（或手动 dry_run）跑过，抽查候选里若再出现"多字节 slug 里最长词是城市名"的页面，确认没有再借用别页的查询词；同时确认两条被写错的线上标题已由持锁窗口纠正或人工重写。
done_on: 2026-09-28
done_ref: pr:2172
verified_ref: doc:docs/ledger/evidence/2026-10-06-title-cycle-first-full-week.md
last_checked: 2026-10-06
check_note: 10/5 周一那轮真实运行：不借别页查询词的闸触发、9/28 写错的 3 页线上已恢复（见证据文件）
---
2026-09-28 05:31 UTC 一轮自动改标题把 liziba-monorail-chongqing-guide 套用了另一页的标题、chongqing-night-city-lights 换成完全不相关的"Forbidden City"标题。根因：gate.ts 用"最长词"判定页面独特主题词，而复合地名 slug 里最长词常是全站共享的城市名；且现有事实核对只测矛盾不测跑题。pr:2172 修了取词逻辑（要求命中≥2 个独特词）并加了 checkTitleOnTopic 跑题检查，4 条回归测试通过。两条被写错的线上标题尚未纠正——本会话没有能查到 seo_meta_log 的数据库权限，需要 PM 指派能连库或能看 chinatravel 仓库 PR diff 的人取 old_title 后再改。
