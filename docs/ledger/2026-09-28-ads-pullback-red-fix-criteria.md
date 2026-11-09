---
id: 2026-09-28-ads-pullback-red-fix-criteria
title: 换掉「每日广告取数长红」的验收判据：按客户归类会把换了原因的真故障一起埋掉，单位必须是客户×数据源×失败原因
status: decided
owner: agent
decided_on: 2026-09-28
source: pr:2143
verify_by: 2026-10-12
verify_how: 判据不是「状态变绿」，是「状态从此能区分『已知那几家照旧读不到』和『本来能取到的客户今晚坏了』」。①最近 14 天 cron_run_logs 里 google-data-pullback-daily 有没有出现过 completed——一次都没有 = 没修；②回答「昨晚如果 CTS 的取数也坏了，我今天早上看得出来吗」——拿一次真实或回放的 CTS 取数失败，证明整轮会变红、而已知那几家照旧不会；③预期内跳过的单位是「客户 × 数据源 × 失败原因」，带结束日期最长 14 天、过期自动升级；回放证明同一客户换了失败原因会变红；④失败原因指纹必须比 `getAdAccountInsights returned null` 更细——那一个字符串在 `src/lib/meta/account-insights.ts` 里同时代表网络异常、任意非 2xx、以及成功但无数据行，直接拿它当白名单键会让同一客户新发生的限流或接口故障也不变红，与 ③ 自相矛盾；⑤不许给 ad-entity-snapshot（64% 抽风、当天还绿过）套预期内跳过。任一不满足 = 交回 PM
---
本卡取代 [[2026-09-28-ads-pullback-red-for-a-month]] 的 `verify_how`（那是冻结字段，按 `docs/ledger/README.md` 改判据应新建卡，不追溯改写）。事实与逐日证据仍看原卡及 doc:docs/audits/2026-09-28-ads-pullback-red-for-a-month-investigation.md。
**为什么换**：原判据按「客户」归类已知失败。实测 9/16–9/22 首要错误从 Meta 变成 GA4 又变回来，失败的仍是那几个客户 —— 按客户归类会把那段 GA4 故障算进「预期内」，连红灯都不亮，比现状更糟。
**第 ④ 条是 Codex 复审补的，比 ③ 更要紧**：`returned null` 这个字符串把三种不同原因压成一个，用它当键等于给该客户开了永久豁免。
**未证实的部分不要当依据**：GA4 那两段（`fetchGa4Snapshot returned null` 与权限不足）在现有证据里**不能**认定为同一客户的同一故障，须按两段待联查处理。
