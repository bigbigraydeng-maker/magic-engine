---
id: 2026-10-21-openai-account-no-credit
title: OpenAI 账户余额为 0（调用返回 429），依赖它的功能可能在静默失败，如同行邮件自动提取终端客户；是否充值待 PM
status: decided
owner: pm
decided_on: 2026-10-21
source: session:96dc6edf
verify_by: 2026-10-24
verify_how: 用环境里的 OpenAI 钥匙发一次最小调用，返回不再是 429 余额不足；同行邮件提取的最近运行有成功记录
---
干跑筛选时模型一个字都没判出来，查原因是 OpenAI 返回余额不足。本次筛选与邮件功能改用平台自带的 Claude Haiku，不受影响。
其他还用 OpenAI 的功能（至少有同行邮件自动提取终端客户，旅游同行占 CTS 邮件的一大块）可能一直在静默失败，影响面我没逐个核对。钱的事由 PM 定是否充值，充值后验证。
