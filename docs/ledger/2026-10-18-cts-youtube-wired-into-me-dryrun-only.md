---
id: 2026-10-18-cts-youtube-wired-into-me-dryrun-only
title: YouTube 发布已接进 ME 后台（设置页按钮 + 自动暂存 + 授权记录），仍然只演练、不真发
status: decided
owner: agent
decided_on: 2026-10-18
source: session:a59e4edc
verify_how: 数据库那张表加好之后：在设置页填 CTS 频道编号并看到「已连接」；用一条已通过审核的工厂视频触发暂存，频道里出现私享视频且回执表有一行 staged；再触发一次授权，回执表出现 public_step 行且 no_publish 为真。任何一步 no_publish 为假都算失败
---
代码合并并加好数据库两张新表之前，页面上的 YouTube 区块会报错（读不到新字段），所以数据库改动须先上。
公开发布本身仍未开：事件只会走演练；且七项检查目前没有任何程序写入通过证据，所以演练也会被「检查没过」拦住。
改授权范围（让 Google 允许改成公开）是另一个单独审查的改动，不在这条里。
