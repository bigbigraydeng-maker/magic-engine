---
id: 2026-11-10-me-send-gate-p2-2a-resend-send
title: 发信底座第 1 单「能发出去」：ME 自己经 Resend 发信的接口和三处加严已写好，草稿改动单等审查与你回「合」；你这边要先开 CTS 专用的 Resend 账号
status: decided
owner: pm
decided_on: 2026-11-10
source: session:33ebcd0b
verify_by: 2026-11-17
verify_how: 看是否已：①本单（A 级）两位审查员审过、PM 本人回「合」后合并；②PM 已开 CTS 专用 Resend 账号、news.ctstours.co.nz 在 Resend 里验证变绿、Render 里有 RESEND_API_KEY_CTS 与 RESEND_WEBHOOK_SECRET_CTS 与 UNSUBSCRIBE_SIGNING_SECRET 三个变量（只核有没有，不看值）；③合并后销售手发邮件照常能发（「最近发送」里没有新增「系统出错」）。缺哪件写哪件；真发信要等第 3 单的受控试跑，且只发 hello@
---
本单只加能力、不发信：Resend 发信接口（钥匙按账号分开，缺钥匙宁可不发、绝不借 ME 系统账号）、ME 发的信写进客人联系记录并计入销售「7 天 2 封」、销售手发拦已退订的客人、自动信模板（auto- 开头）销售选不到也发不出。
设计：docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.1、§6.3、§6.4、§9-4（P2-2a）。CTS 主域名已挂在 ME 系统账号下（官网询价通知在用），所以新账号用子域名 news.ctstours.co.nz。
下一单（第 2 单）：回执消费、一键退订入口、每日对账、保留期清理；第 3 单：授权页、开关、只发 hello@ 的受控试跑。
