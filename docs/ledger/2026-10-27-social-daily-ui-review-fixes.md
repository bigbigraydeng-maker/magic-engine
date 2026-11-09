---
id: 2026-10-27-social-daily-ui-review-fixes
title: 社媒日常三页上线后独立审查查出的 5 处真问题已修：不误并、旧版待审不藏、读不全要说
status: done
owner: agent
decided_on: 2026-10-27
source: session:d380bf84
verify_by: 2026-10-28
verify_how: 读回线上三页（本周总览 / 短视频 / 图文帖子）。本卡管审查修复：总览和短视频页里 Reel 列表正好 30 个版本时会写「只读了最近 30 个版本」；Story 那行写「需要人看」；草稿数和「已上传（未核对）」分开；图文帖子页活动下拉里没有两个一模一样的名字。四项都对上算成。
done_on: 2026-10-27
done_ref: commit:8012d8dac091
---
三个 PR 合并后，我另派了一个只读的独立审查员查 bug，10 条意见里 5 处是真问题，本卡对应修复。
只改展示层，不改数据接口和授权 / 发布逻辑。没修的：接口本身不返回 failed / dead_letter 的 Reel（要改接口，另算）。
