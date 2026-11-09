---
id: 2026-11-10-me-send-gate-p2-2b-receipts-unsubscribe
title: 发信底座第 2 单「回执和一键退订」：退订链接能用、每封信送到/退回/被投诉都记下来、销售手发和回复客人都查退订；改动单等你回「合」，本单一封信都不发
status: decided
owner: pm
decided_on: 2026-11-10
source: session:33ebcd0b
verify_by: 2026-11-17
verify_how: 看是否已：①本单（A 级）PM 本人回「合」并写明单号后合并上线；②用一个格式正确但签名是假的退订链接打开 /api/u/…，看到「This link is not valid」（＝退订钥匙已在 Render），不是「Sorry, that did not work」；③合并后 Resend 回执照常入库（provider_webhook_events 当天有新行）、Render 日志没有 emit_failed；④销售手发、回复客人来信照常能发（「最近发送」里没有新增「暂时查不到他有没有退订」）。缺哪件写哪件；回执和真信对上要等第 3 单只发 hello@ 的受控试跑
---
PM 11-10 在发信窗口回「开始」（126 另转来 PM 回的「行」）。本单只加能力、不发信、不改数据库结构。
内容：一键退订入口 /api/u/<令牌>（GET 只显示按钮，POST 退订，只停邮件不停电话）；回执消费（入库后发事件，消费函数按消息号/信的标签/地址指纹认信，只前进；系统邮件的回执对不上就结束）；投诉 = 退订邮件；销售手发与回复客人来信都查退订（回复规则：客人最后一封来信之后的退订才拦）。
设计：docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §16.10。每日对账、退信/投诉待办、自家闸线挪到第 3 单（开关打开前必须到位）；保留期清理见卡 2026-11-01-provider-webhook-events-retention-job。
