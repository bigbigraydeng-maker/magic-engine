---
id: 2026-09-25-roman-homepage-redesign-plan
title: Roman 官网首页按 Figma 新设计稿重做——品牌名统一 Team Hu、图片只用生产站现有素材、DeepSeek 分 8 轮写、统筹窗口只复审
status: decided
owner: pm
decided_on: 2026-09-25
source: session:213663cd
verify_by: 2026-10-09
verify_how: 网站仓库开出 feat/homepage-redesign-figma 的 PR，build 通过，桌面/手机各一张截图与设计稿并排比对无占位内容（假地址、假电话、设计师备注、来源不明评价）；合并仍等 PM go
---
权威任务说明在网站仓库 `~/Projects/roman-website/docs/redesign/PLAN.md`（12 个区块 → 真实数据/图片来源映射、8 轮派活表、每轮 RULES）。
设计稿逐块规格由子 agent 抽到 `docs/redesign/sections/*.md`，DeepSeek 只读这些文件写代码。
前置：网站仓库 PR #15（blog 配图/结构化数据修复）先合并，再从 main 拉新分支，避免冲突。
奖章图片生产站没有文件，先用文字版，奖章图另向客户要。
