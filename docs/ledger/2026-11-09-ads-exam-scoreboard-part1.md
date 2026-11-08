---
id: 2026-11-09-ads-exam-scoreboard-part1
title: 广告统一考卷第一段做完：25 道题一张分数表，一条命令出分（答对 22，已知待修 2，还没出题 1），改坏 WhatsApp 规则会掉分并点名
status: done
owner: agent
decided_on: 2026-11-09
source: session:c3bf7418
verify_by: 2026-11-18
verify_how: 合并后在主干跑 npx tsx scripts/ads-exam.ts，第一行是「答对 22 / 共 25 题」或更多且退出码 0；再看 11-09 之后合并的广告判断规则改动单里有没有贴改前改后分数，一条都没有 → 跟 PM 讲是否要把分数接进自动检查（会碰工作流，A 级）
done_on: 2026-11-09
done_ref: pr:3662
---
PM 11-09 回「做」。路线图「广告 agent 三个没排的缺口」第 1 项。题目 = 14 道诊断回放 + 考卷 1–6 + 新登记 7–9（WhatsApp 组按留资当没结果、5 条止损按留资判错、停了的组亮红灯）。
反证：删掉 core-metric 里的 WhatsApp → 答对 20、点名 Q23/Q24、退出码 1；还原后回到 22。没改任何判断规则，没碰工作流。
第二段（Grok Luban 查数/诊断题，要调模型）等 PR 3657 合并后另开。顺带发现：verdict-entry-point 测试在主干红（social weekly-loop fact-check 也调 computeVerdict），不是本 PR 引入。
