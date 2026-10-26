---
id: 2026-09-28-eastinter-reels-sep29-oct5
title: East Inter Facebook Reels Sep 29–Oct 5 排期（2/7 done，5/7 等 Muapi 充值）
status: decided
owner: agent
decided_on: 2026-09-28
verify_by: 2026-09-30
source: session:e12e5606
verify_how: 查 East Inter Facebook Page 的 Reels 发布记录，确认 7 条视频是否都已发布且首条评论都带了对应 UTM 链接；视频 ID / BM ID / 广告账户 ID 见 session:e12e5606，不进台账
---

## 已完成

- ✅ Sep 29 10:00 AEST — 第 1 条（海运 35 天 $0.28/kg，门到门）
- ✅ Sep 30 10:00 AEST — 第 2 条（从中国到门口的 4 步流程）
- 两条均通过 Muapi pixverse-v5.5-i2v（9:16，5 秒），Python Pillow 加字幕，Facebook `/videos` 接口排期
- 视频 ID 见 session:e12e5606（10 位以上数字不进台账）

## 阻塞

Muapi 余额不足，无法再提交新任务（最低阈值约 $0.50）。
剩余 5 条（Oct 1–5）需 PM 去 muapi.ai/topup 充值约 $1–2，充完后 agent 可立即续跑。

这条充值请求已接入今日待办「系统进不去、要你点一次的」栏（`src/lib/pm-todo/client-doc-manual-tasks.ts`），
不再只停在本卡正文里；本卡额外设了 `verify_by: 2026-09-30`（第一条被卡住的 Oct 1 发布前一天），
充值这件事拖到 Sep 30 还没动，夜巡会把它当「决定了没人动」拎给 PM（Codex 2026-09-28 复审第 3 轮 PR #2173）。

## 5 条待排脚本（已写好，充值后直接跑）

| 日期 | 文案钩子 | Unsplash 关键词 |
|------|----------|-----------------|
| Oct 1 Thu | "5–7 days from China" / Air freight | cargo airplane airport |
| Oct 2 Fri | "LCL vs FCL" / Which saves you more? | shipping containers port |
| Oct 3 Sat | "4 steps. China → your door." | warehouse cardboard boxes |
| Oct 4 Sun | "Sydney ✓ Melbourne ✓ Brisbane..." | sydney australia harbour |
| Oct 5 Mon | "One partner. Every step." | business handshake professional |

脚本路径见 session:e12e5606（本地 scratchpad，已包含全部 7 条，充值后重跑自动跳过已做的 2 条或修改索引继续）。

## 每条视频发布后手动操作（第一条评论加 CTA 链接）

- Sep 29：`https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=sea-freight-sep29`
- Sep 30：`https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=4steps-sep30`
- Oct 1：`https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=air-freight-oct1`
- Oct 2：`https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=lcl-vs-fcl-oct2`
- Oct 3：`https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=4steps-oct3`
- Oct 4：`https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=cities-oct4`
- Oct 5：`https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=one-partner-oct5`

这 7 条已各自接入今日待办「需要你动手」栏（`src/lib/pm-todo/client-doc-manual-tasks.ts`），
发布当天出现、次日自动消失，不再依赖本卡闲置超过 7 天才被拎出来提醒（Codex 2026-09-28 复审 PR #2173）。

## 广告账户

另一件不相关的事，已拆成独立台账卡，不共用本卡的 status/verify_how：见
[2026-09-28-eastinter-meta-nz-ad-account-slot-full](./2026-09-28-eastinter-meta-nz-ad-account-slot-full.md)。
