---
id: 2026-10-14-story-switch-on-always
title: Story 自动发布总开关已打开并常开（只放 CTS）；每周闸门是 PM 在页面点的授权
status: decided
owner: pm
decided_on: 2026-10-14
source: session:61a3b5f4
verify_by: 2026-10-15
verify_how: 看线上 STORY_AUTO_PUBLISH_LIVE 仍是 true、名单只有 CTS；10/14 20:00「Walking the Great Wall? Message us.」到点后库里是已发且有回执编号、主页真有这条 Story（无贴纸）；10/15 起每天 08:30/13:00/20:00 照常；被拦 5 条始终没发
---
PM 10-14 在本窗口亲口回「开」（范围：授权包里到点的条目自动发，被拦的 5 条不发，错过的不补发）。新西兰 12:58 设两个变量，13:08 手动触发部署，13:11:54 上线；Render 改变量不会自动部署，要手动触发。
首个真发模式扫描（约 13:20）按设计把已过窗口的两条（08:30 Discover imperial Beijing、13:00 Beihai Park）标成 MISSED，没有补发、没有调用 Facebook。
开关从此常开，每周闸门是 PM 授权；出事点预览页「停」（秒级）。关回：把 STORY_AUTO_PUBLISH_LIVE 设为 false 再手动触发部署（约 3.5～6.5 分钟）。
