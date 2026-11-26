---
id: 2026-11-16-crm-stopline-verify-moved-to-1202
title: 发目录之后的跟进第 1 刀（停线）的上线核对改到 12-02：它跑在 Inngest 上，本月额度用满不跑
status: decided
owner: agent
decided_on: 2026-11-16
source: session:96dc6edf
verify_by: 2026-12-02
verify_how: Inngest 额度恢复后，12-02 早上 cron_run_logs 里 crm-followup-stopline 有一条 completed；有客人被撤时他的抽屉里写着停的原因；回执 in_takeover 与 AI 跟进中人数对得上
---
原卡 2026-11-16-crm-catalogue-followup-stopline 的核对日 11-18 赶不上：Inngest 11-15 14:20 起额度用满，PM 不升级（见 2026-11-16-inngest-quota-relief-direct-fallback）。
停线每天只跑一次、不在这次兜底范围内，额度恢复前客人不会被自动撤标记；员工照常能手动撤。
