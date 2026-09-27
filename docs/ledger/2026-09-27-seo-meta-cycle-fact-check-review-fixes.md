---
id: 2026-09-27-seo-meta-cycle-fact-check-review-fixes
title: SEO Meta-Cycle 事实核对闸门 5+4 条审查缺陷修复（反向检查 + 多币种/促销/数量 + 出发点/别名 + 日期扩展 + AI判官提示词 + 格式归一 + slug 解析加固）
status: done
owner: agent
decided_on: 2026-09-27
source: pr:1948
done_on: 2026-09-27
done_ref: pr:1948
verify_by: 2026-10-04
verify_how: 周一 cron 正常跑完无回归；/china-tours 被正确拦截（反向 + 正向事实检查均触发）
---
子牙 + 魏征审查 PR #1948 提出 5 条缺陷 + 子牙追加 4 项必改，全部修复：
1. BLOCKER: hard-fact-check 增加反向检查 — AI 改写新增的事实同样拦截
2. AI 判官提示词更新 — 凭空引入的事实视为矛盾
3. 格式归一化 — 地名大小写不敏感、全角半角、DD/MM/YYYY、无年月日
4. parseProtectedSlugs 加固 — 剥离域名/斜线、非数组报 malformed 跳过客户
5. 已合并 origin/main 无冲突
6. DR48-1: 多币种(€¥£+NZD/AUD/USD/EUR/GBP)、促销(save X%/X-for-X)、数量(14 days/12-day)
7. DR48-2: 出发点上下文("from Beijing"/"Shanghai departures") + 地名别名(NZ↔New Zealand/AU↔Australia/ChCh↔Christchurch)
8. DR48-4: ISO日期、序数词、无年日期、月份归一化
9. AI判官提示词扩展 — destination/itinerary city, trip duration, discount/promotion

子牙最终复核通过：变异测试 6 处全命中、44 条攻击样例全拦住。
CTS 真实数据 dry_run：9 候选 → 3 方案 → 全部被硬规则拦截 → 0 放行。/china-tours（事故原页）丢 $7,188/$6,188/22 Dec 2026/TAANZ/Christchurch/25 years + 加 Auckland，被正确拦截。
全套 131 测试通过（seo-meta scope）、120 通过（全量 vitest）。
PR 已转就绪，等 PM 回「合」后 gh pr merge --admin。
