---
id: 2026-10-06-instagram-publish-paused
title: 视频工厂发 Instagram 暂停：Publer 要取消，Instagram 账号还没关联 Facebook 主页
status: verified
owner: pm
decided_on: 2026-10-06
source: session:ef0c078e
verify_by: 2026-10-20
verify_how: 到期看三件事：1 Publer 是否已按取消计划退订；2 Remotion 在 CTS 是否已跑稳两周；3 PM 是否已在 Meta 后台把 CTS 的 Instagram 关联到 Facebook 主页。三件都成，再决定是否开始做 Meta 原生 Instagram 发布；没成就把这张卡顺延，别重开 Publer 方案。
done_on: 2026-10-17
done_ref: pr:2756
verified_ref: doc:docs/ledger/2026-10-17-publer-removal-2-instagram-crosspost.md
last_checked: 2026-10-19
check_note: 被 Publer 删除 2/N 取代，Instagram 跟发整套下线，本卡无需再验
---
暂停原因：PM 已决定取消 Publer、Instagram 推迟（见台账卡 2026-10-05-publer-retirement-unified-publish-plan）；PR2295 的 Instagram 发布整条依赖 Publer，与之冲突。另外 CTS 的 Instagram 账号存在但没关联到 Facebook 主页。
恢复条件：Remotion 在 CTS 跑稳两周后，PM 先在 Meta 后台把 Instagram 关联到 Facebook 主页，再决定改走 Meta 原生，不再用 Publer。
PR2295 保持草稿、不合并、不关闭。已完成可复用：适配器契约、回执状态机、跟发扫描、事件契约、今日待办下发（账号掉线）、14 条审查意见已清、默认只存草稿的三道开关（总开关、Instagram 独立开关、客户点名名单）。
已被 Publer 删除 2/N 取代（见 2026-10-17-publer-removal-2-instagram-crosspost），本卡关闭。
