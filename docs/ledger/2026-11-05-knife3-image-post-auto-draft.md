---
id: 2026-11-05-knife3-image-post-auto-draft
title: "第 3 刀：Facebook 图文帖自动草稿（CTS）"
status: done
done_ref: "pr:3636"
owner: agent
decided_on: 2026-11-05
source: pr:3636
risk: A
done_on: 2026-11-05
verify_by: 2026-11-06
verify_how: "明早 06:30 NZST 社媒周报函数跑完后查 social_plans 有没有新增 source='auto_image_post' 的行（CTS 客户配置里 imagePostPerDay 需 ≥1 且 imagePostSource='client'）"
ledger-id: 2026-11-05-knife3-image-post-auto-draft
---

社媒 Agent 第 3 刀完成：每天早上社媒周报 Inngest 函数跑完 reel 编排后，自动为 CTS 生成一条图文帖草稿——选团、选图、AI 写文案、事实核查、写入 social_plans。草稿需 PM 审批后才被 auto-publish sweep 拿起真发。

当场试跑用 CTS 真实数据 + GPT-4o-mini 跑通：选到 Explorer 日本 14 天团，AI 文案事实核查 PASS，未写数据库。25 条单测全过，tsc 0 错。

CTA base URL 硬编码 ctstours.co.nz（CTS 特定，后续客户配置化）。
