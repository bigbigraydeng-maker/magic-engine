---
id: 2026-11-15-tour-poster-openai
title: 线路海报改用 OpenAI 改图模型（配方升到第 2 版）
status: decided
owner: agent
decided_on: 2026-11-15
source: doc:docs/tasks/2026-11-15-tour-poster-recipe.md
verify_by: 2026-11-26
verify_how: 合并上线后看 CTS 下一个起草日的 social-weekly-draft 回执 summary.imagePost：海报 status=composed 且 text_check=match 的比例，对比旧模型（5 张里 2 张过）
---
PM 2026-11-15「生成图片都转用 openai image 接口，retry」。旧模型现场 5 张里 3 张拼错字（derpature、Xiu02scan），全部被核字拦下退回原图。
同样的线路资料、照片和提示词改走 OpenAI（gpt-image-2.6-flare）后 4 张全过核字。单张约 0.054 美元（旧 0.038），SDK 自动重试关掉，防止重复扣费。
只改海报这一条；其他已有的生图入口不在本卡范围。
