---
id: 2026-10-21-pool-status-widening-typecheck-fix
title: 修 PR 3016 放宽素材池状态后留下的类型错误（推广计划检查的素材事实类型没跟着放宽），并说明为什么当时没抓到
status: done
owner: agent
decided_on: 2026-10-21
source: pr:3016
verify_by: 2026-10-28
verify_how: 合并后在主干跑完整 tsc（需 NODE_OPTIONS=--max-old-space-size=10240，否则内存不足会静默崩溃）：除 .next 目录的旧生成类型外应为 0 个错误；推广计划「投放素材已批准」检查对 testing / manual_approved 一律红。
---
类型修复 + 1 条测试；行为不变（只有 approved 算批准）。事故原因：3016 的完整类型检查漏跑（GitHub Actions 全停），我本地用 `tsc | grep` 过滤，tsc 因内存不足静默崩溃，空输出被我当成无错。
