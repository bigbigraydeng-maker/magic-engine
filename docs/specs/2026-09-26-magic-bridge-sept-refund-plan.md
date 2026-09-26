# Magic Bridge · CTS 9 月赞助额度退还方案（待 PM 执行前点头）

- 日期：2026-09-26 · 作者：卫青（Claude Code）· PM 意向「退」（经小秘书转达）；**执行 = 改生产数据，按 A 级处理：PM 在聊天里对本方案明确回复后才执行**
- 性质：这是 Magic Engine 给 CTS 的**免费分析额度**（我们自己的钱），不是客户付款；退还 = 把被失败白扣掉的额度还回去，让 CTS 本月还能再生成报告。

## 1. 明细（生产只读，`meta_ads_ai_analysis_jobs`，CTS，period 2026-09，共 12 条）
| # | 时间（UTC） | 结果 | 失败原因 | 模型 | 扣了 |
|---|---|---|---|---|---|
| 1 | 09-22 06:27 | 失败 | 数据包过大（没调模型） | — | $0.000000 |
| 2 | 09-22 07:10 | **成功** | — | 旧模型 | $0.046212 |
| 3 | 09-22 14:36 | 失败 | analysis_failed（60 秒超时） | 旧模型 | $0.120000 |
| 4 | 09-22 14:48 | 失败 | analysis_failed（60 秒超时） | 旧模型 | $0.120000 |
| 5 | 09-22 15:41 | 失败 | model_unavailable（60 秒超时） | 旧模型 | $0.120000 |
| 6 | 09-23 04:49 | 失败 | model_unavailable（60 秒超时） | 旧模型 | $0.120000 |
| 7 | 09-23 04:52 | 失败 | model_unavailable（60 秒超时） | 旧模型 | $0.120000 |
| 8 | 09-23 05:01 | 失败 | analysis_incomplete（写超长被截断） | Haiku | $0.120000 |
| 9 | 09-23 05:22 | 失败 | analysis_incomplete（写超长被截断） | Haiku | $0.120000 |
| 10 | 09-23 05:37 | **成功** | — | Haiku | $0.020390 |
| 11 | 09-24 05:01 | 失败 | analysis_incomplete（写超长被截断） | Haiku | $0.120000 |
| 12 | 09-24 09:54 | **成功** | — | Haiku | $0.016112 |

- 失败合计 **$0.960000**（8 条 × $0.12）；成功合计 $0.082714；总计 $1.042714 = 额度表 `meta_ads_ai_sponsored_budgets.spent_usd`（对得上）。
- 说明：这 8 次失败里，对方（模型供应商）实际收了我们多少钱无法逐条回查——截断那 3 次真实成本约 $0.02/次（代码当时没记），超时那 5 次对方可能也按已处理的字数收了一部分。按 PM「退」的意向，**退还全部 $0.96**：失败没给客户任何报告，不该占客户的免费额度；我们自己多出的那点真实成本由我们吸收。

## 2. 改哪里（只改一行，不动任务记录）
- 表：`meta_ads_ai_sponsored_budgets`，行：`client_id = CTS, period_key = '2026-09'`
- 字段：`spent_usd` 从 `1.042714` → `0.082714`（减 0.96）
- **不改** `meta_ads_ai_analysis_jobs` 里每条任务的扣费记录（保留审计痕迹；额度表没有从任务表重算的逻辑，两者不同步不影响任何功能——已查迁移里只有预留/结算两处加减 `spent_usd`）
- 退后：本月上限 $1.25 − 0.082714 = 约 $1.17 可用，按每份预留 $0.12 约可再生成 9 份

## 3. 执行 SQL（带守卫：只有当前值完全等于核对时的值、且没有进行中的预留时才改，否则改 0 行）
```sql
UPDATE public.meta_ads_ai_sponsored_budgets
   SET spent_usd = spent_usd - 0.960000, updated_at = now()
 WHERE client_id = 'c0000000-0000-0000-0000-000000000000'
   AND period_key = '2026-09'
   AND spent_usd = 1.042714
   AND reserved_usd = 0
RETURNING client_id, period_key, spent_usd, reserved_usd, cap_usd, updated_at;
```
- 期望返回 1 行、`spent_usd = 0.082714`。返回 0 行 = 期间有人又生成过报告，停下重新核对，不重试。

## 4. 回滚 SQL
```sql
UPDATE public.meta_ads_ai_sponsored_budgets
   SET spent_usd = spent_usd + 0.960000, updated_at = now()
 WHERE client_id = 'c0000000-0000-0000-0000-000000000000'
   AND period_key = '2026-09'
   AND spent_usd = 0.082714
RETURNING spent_usd;
```
（若退还后 CTS 已经又生成过报告，`spent_usd` 不再是 0.082714，回滚改为「当前值 + 0.96」前先核对不超上限 $1.25。）

## 5. 执行后
- 回读一次额度行，贴结果到台账卡证据。
- 日历：10/03 上午查 CTS 9 月额度是否仍在应有位置（PM 要求）。
- 顺序建议：**先合 PR-A（按实扣费）再退**——否则退完之后如果又截断一次，还会被白扣 $0.12。
