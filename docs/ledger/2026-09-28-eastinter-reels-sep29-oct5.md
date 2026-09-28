---
id: 2026-09-28-eastinter-reels-sep29-oct5
title: East Inter Facebook Reels Sep 29–Oct 5 排期（2/7 done，5/7 等 Muapi 充值）
status: decided
owner: agent
decided_on: 2026-09-28
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

## 5 条待排脚本（已写好，充值后直接跑）

| 日期 | 文案钩子 | Unsplash 关键词 |
|------|----------|-----------------|
| Oct 1 Wed | "5–7 days from China" / Air freight | cargo airplane airport |
| Oct 2 Thu | "LCL vs FCL" / Which saves you more? | shipping containers port |
| Oct 3 Fri | "4 steps. China → your door." | warehouse cardboard boxes |
| Oct 4 Sat | "Sydney ✓ Melbourne ✓ Brisbane..." | sydney australia harbour |
| Oct 5 Sun | "One partner. Every step." | business handshake professional |

脚本路径见 session:e12e5606（本地 scratchpad，已包含全部 7 条，充值后重跑自动跳过已做的 2 条或修改索引继续）。

## 每条视频发布后手动操作（第一条评论加 CTA 链接）

- Sep 29：`https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=sea-freight-sep29`
- Sep 30：`https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=4steps-sep30`
- Oct 1：`https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=air-freight-oct1`
- Oct 2–5：同格式，campaign 名见上表

## 广告账户（另一件事的结论）

- 澳元账号已确认 CLOSED（状态码 101），账户 ID 见 session:e12e5606
- 所属 Business Manager 广告账户数已满 5/5，API 无法新建新西兰元账号
- 需 PM 联系 Meta 客服释放名额或加上限；具体账户 ID / BM ID 见 session:e12e5606（账户号属客户业务事实，不写进台账）
