# CTS「Shanghai & Surroundings」改价 — 客服机器人价格同步手册

日期：2026-10-06 · 状态：**待 PM 回「合」后执行** · 本文件只是手册，**没有改任何代码、没有碰生产库**。

## 背景（一句话）
官网把这个团（`shanghai-surroundings`，2027-03-25 出发）双人间每人价从 NZD 3,399 改成 2,699（单人房加价 400 不变）。
官网改价在 chinatravel 仓的草稿 PR 里。客服机器人（私信回复）的价格核对要同步换，否则要么报旧价、要么拒绝报新价。

## 机器人到底读哪里（已查代码，没查生产库）
- 价格对账代码：`src/lib/messenger-agent/verifier/policies/cts.ts`。第 3/5/7 道闸门把回复里出现的每个价格，拿去和「在售产品事实」的 `price_nzd` 逐个比对；对不上就拦下，转人工。
- 「在售产品事实」= 生产库表 `client_knowledge_facts` 里，`client_id = c0000000-0000-0000-0000-000000000000`（CTS）、`fact_key` 以 `tour.active.` 开头的行，价格在 `structured_value.price_nzd`。
- **不是**代码文件。`config/clients/cts/offerings.yaml`（里面 shanghai-surroundings 还是 3399）是旧版本（v2），当前代码已没有生产调用方（见 `cts.ts` 头部注释、`knowledge-fact-expiring-items.ts`），**改它对机器人没有任何效果**，所以本次没动。
- 迁移文件 `20260915120000_...` 只种了 4 条通用事实（营业年限等），**没有**种 `tour.active.*`；产品价格事实是后来通过萃取/FDE 审核页进库的，所以仓库里没有可改的种子。

## 为什么不能直接 `UPDATE ... SET price_nzd = 2699`
1. 价格类事实要**双签**：我们这边批准 + CTS 本人点确认链接。直接改内容，库里的触发器会把这一行**自动打回「候选」并清空两个签字**（见 `20260913235959_client_knowledge_facts_v1.sql` 的 `reset_signoff_on_content_change`）。结果是机器人在这个团上没有任何已确认价格，所有带价格的回复都被拦。
2. 同一个事实同一时刻只能有一条「生效」，新旧两条不能同时生效。
3. 所以正确做法是：新开一条候选 → 退役旧的 → 批准新的 → CTS 确认。中间有一小段时间机器人对这个团**不报价**（转人工），这是设计上的「宁可不说、不说错」。

## 步骤（PM 回「合」之后，同一天做完）

**第 0 步（现在就能做，只读，不改任何东西）：看生产库里这一行存不存在**
```sql
SELECT id, fact_key, status, visibility, sensitivity,
       structured_value->>'price_nzd' AS price_nzd,
       valid_until, approved_by_email, client_confirmed_at
FROM client_knowledge_facts
WHERE client_id = 'c0000000-0000-0000-0000-000000000000'
  AND fact_key LIKE 'tour.active.shanghai-surroundings%'
ORDER BY created_at;
```
- 结果为 **0 行**：生产库里根本没有这个团的价格事实，机器人现在对它就是「没有已确认价格 → 价格回复全拦」。**无需任何同步，本手册第 1–5 步全部跳过**，只需在官网改价后另行决定要不要把新价录进知识库。
- 结果有一行 `status='approved'` 且 `price_nzd = 3399`：往下做。把这一行的 `id` 记为 `<OLD_ID>`。
- 结果里已经有价格 2699 的候选行：说明别人已经开过了，直接从第 3 步接着做。

**第 1 步（可提前做，不影响机器人）：复制出一条新价格的「候选」**
```sql
INSERT INTO client_knowledge_facts
  (client_id, fact_key, scope, statement, structured_value, status, visibility,
   sensitivity, source_kind, evidence)
SELECT client_id, fact_key, scope,
       replace(statement, '3,399', '2,699'),
       jsonb_set(structured_value, '{price_nzd}', '2699'::jsonb),
       'candidate', visibility, sensitivity, 'manual',
       jsonb_build_object('note', '2026-10-06 PM 改价：3399 -> 2699，复制自 <OLD_ID>')
FROM client_knowledge_facts
WHERE id = '<OLD_ID>';
```
执行前核对：旧行 `statement` 里写的是 `3,399` 还是 `3399`（不同就改 `replace` 的第二个参数）；执行后再 SELECT 一次，确认新行 `statement` 和 `price_nzd` 都已是新价。**这条语句我没有在生产库验证过**，请由 FDE 在 Supabase SQL 编辑器里先 `BEGIN; ... ROLLBACK;` 看一眼结果再正式执行。

**第 2 步（官网合并那一刻）：退役旧事实 → 机器人暂停报这个团的价**
```sql
UPDATE client_knowledge_facts SET status = 'retired' WHERE id = '<OLD_ID>';
```
只改状态、不改内容，不会触发打回。此后机器人遇到这个团的价格问题会转人工，不会再报 3,399。

**第 3 步：官网上线并确认**
PM 回「合」→ 合并 chinatravel 草稿 PR → Render 部署完成 → 打开产品页确认显示 2,699。

**第 4 步：批准新事实 + 发给 CTS 确认**
在 FDE 审核页（issue #1646）批准新候选；到「待客户确认」列表给 CTS 确认人发确认链接；CTS 点确认。批准人和确认人不能是同一个邮箱（数据库会拒）。

**第 5 步：验收**
重跑第 0 步的查询：应只有一条 `approved`、`price_nzd = 2699`、`client_confirmed_at` 非空；再让机器人（或测试私信）问一次这个团的价格，应报 2,699 或转人工，**不应再出现 3,399**。

## 顺序为什么是这样（两种错位的后果）
- 机器人先换、官网后换：这段时间机器人报 2,699，官网仍写 3,399，客户看到两个价。
- 官网先换、机器人一直没动：机器人继续报 3,399，且把官网的新价 2,699 当成「没核实的价格」拦下。
- 上面第 2 步先退役旧事实，保证无论哪一步卡住，机器人最坏也只是「不报价、转人工」，不会报错价。

## 附带发现（不在本次范围）
- 回复里出现的价格必须等于某个在售产品的 `price_nzd`，所以机器人**现在就无法**报「单人房总价」（改价后是 3,099）这类由加价算出来的数；如果希望机器人能报，需要另行决定是否录入单人价事实。
