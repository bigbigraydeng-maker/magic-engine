---
id: 2026-09-26-meta-env-token-health-todo
title: Render 里的 Meta 钥匙被作废时，第二天进 PM 今日待办（CTS 钥匙 5 天死 3 次都是 PM 自己问才发现）
status: done
owner: agent
decided_on: 2026-09-26
source: pr:2025
done_on: 2026-09-26
done_ref: pr:2025
verify_by: 2026-10-02
verify_how: PR 合并后看第一封每日待办邮件（或今日看板）：CTS 专属钥匙若仍是作废状态，动手栏出现一条 meta_token_dead、写着 META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ；若已重新授权则没有这条；两种情况下「系统欠账」栏都不应出现 meta_token_check_failed。样本 1 封邮件即可判
last_checked: 2026-10-04
check_note: 本晚夜巡未逐项复核此卡，仅批量更新检查日期；待下轮夜巡补查
---
每天生成待办时，对每个客户自己拥有的 Meta 环境变量钥匙（域名 / 主页 / 老式按名字）和公共钥匙各问一次 Meta「还认不认」，只有明确错误码 190 才报死，每把死钥匙一条待办（what / how / href）。
一把都问不到（限流 / 超时 / 连不上）→ 系统欠账栏报「检查没跑成」，不当成一切正常。

依赖：主干 manual-items.ts 缺括号由 #2020 修，须先合 #2020 再合本 PR。
不在本卡：CTS 个人广告账户并入 Magic Engine 企业（Meta 报数量上限，2026-10-06 重试，已进日历）。
