---
id: 2026-11-06-weekly-draft-resolved-scope-hotfix
title: 修第 3 刀留下的两个运行时错误：每日社媒函数引用了作用域外的变量、日期传错类型，不修明早 6:30 那次会在排完视频后崩掉
status: decided
owner: agent
decided_on: 2026-11-06
source: pr:3650
verify_by: 2026-11-06
verify_how: 合并部署后看 11-06 早上 6:30（新西兰）那次 social-weekly-draft 的运行记录：应有 finishRun 的记录、summary 里有 imagePost（drafted 大于等于 0 或写明跳过原因），不应是崩溃；CTS 的 social_plans 出现 source 为 auto_image_post 的新行（前提：CTS 客户配置里 imagePostPerDay 大于等于 1）
---
第 3 刀（PR 3636）合并时，图文起草那一步写在了「解析模式」那个分支之外，却引用了分支里才有的变量，运行时会直接报错，导致每次每日函数在排完视频后崩掉、不写运行记录、图文一条也不起草；另外日期参数传的是时间对象而不是日期字符串。本修复把这一步挪回分支里、日期按新西兰日历取值，并给这一步加了自己的保险（出错只记成错误回执，不影响运行记录）。CI 当时没抓到：这个文件的测试不在必过检查里，构建也不做类型检查。

合并前补充：本机把写入模式的到点处理整段跑过一遍（vitest，60 条通过），线上真实运行以 11-06 早上 6:30 那次为准。
