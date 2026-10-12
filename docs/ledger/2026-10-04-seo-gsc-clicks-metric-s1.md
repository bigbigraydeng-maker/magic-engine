---
id: 2026-10-04-seo-gsc-clicks-metric-s1
title: 目标页新增"谷歌搜索点击（近 28 天）"指标，数据不全时不出数；上线后再给 CTS 建目标
status: done
owner: agent
decided_on: 2026-10-04
source: session:cdd5dbf9
verify_by: 2026-10-11
verify_how: 该 PR 合并后，目标页能选这个指标；给 CTS 建目标后，每日刷新任务写出的当前值与数据库里近 28 天点击合计一致（基线 1042，窗口 9/2~9/29）
done_on: 2026-10-04
done_ref: pr:2228
check_note: PR 已合并；首次真实取数待 10/5 核对
last_checked: 2026-10-12
---
设计稿：docs/specs/2026-10-04-seo-weekly-list-v0.2.md 的 S1。建目标那步是生产数据写，需 PM 再回「合」。
