---
id: 2026-11-03-agent-loop-step1-stopped-again
title: 闭环升级第 1 步重开后又停：手动改动回看拿真实数据回放 5 周，0 处能下结论（第一版回放的 5 条「止损成立」全是误判）
status: done
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-12-03
verify_how: 12-03 复看时按证据文件的查询看近 30 天真实改动数，并用分支 feat/agent-loop-step1-ads 的回放再跑一次；有结论 ≥5 处才开改动单，否则继续停
done_on: 2026-11-03
done_ref: pr:3534
---
PM 11-03 回「重开第一步」。改动回看的代码、34 道测试、两轮复审都做完，存档在分支 feat/agent-loop-step1-ads（05c58ec58），没开改动单、没合并。
回放 09-26 → 11-02：回看 17 处、有结论 0 处。视频播放 / 点击类 6、前后有别的改动 5、WhatsApp 组对留资口径 3、系列各组目标不一 3。证据见 evidence/2026-11-03-agent-loop-step1-stopped-again--2026-11-03.md。
真正的卡点是「结果」按客户只配一种，而 CTS 一半广告组是 WhatsApp / 视频；同一个口径问题让线上 D3 误报，另开卡 2026-11-03-ads-d3-judges-whatsapp-adsets-by-leads。
