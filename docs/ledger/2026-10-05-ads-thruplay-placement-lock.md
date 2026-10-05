---
id: 2026-10-05-ads-thruplay-placement-lock
title: 看完类视频广告建组锁 FB+IG 版位已做完，合并后要用暂停状态真建一次验证 Meta 接受
status: done
owner: agent
decided_on: 2026-10-05
source: session:10bbca62
verify_by: 2026-10-09
verify_how: PM 合并后，用暂停状态真建一条看完类视频广告组（不开、不花钱），回读版位应为 facebook+instagram；被 Meta 拒收则回头改建组参数
done_on: 2026-10-05
done_ref: pr:2264
---
本 PR 只用假数据证明了闸门逻辑，Meta 真接口是否接受「建组即带版位」没验过（卫青审查记录）。
同时：广告开启后 1–2 天按版位拆花费确认 Audience Network 为 0。
另记（后续，不在本 PR）：D9 诊断用 VIDEO_VIEW、闸门用 VIDEO_VIEWS 口径不一致，且都没覆盖 TWO_SECOND_CONTINUOUS_VIDEO_VIEWS，要合成一份名单；
每日巡检待办的「怎么改」文案仍是旧的语言/放宽提示，与版位无关。
