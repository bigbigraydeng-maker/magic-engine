# WP1「读回链补齐」实现说明（brief）· 第二版

- **v2 改动来源**：子牙 + 魏征审完 v1 提了 10 条必改项，加上统管对线上库做的只读核实（下面标〔线上已核〕的就是这部分）。本版逐条吸收，对照表见 §9。
- 设计稿：社媒 IMPACT 闭环 v1.4（从提交 `7c5f0b01e` 读出；任务里给的 `pp-wt/...` 路径在磁盘上不存在）。
- 代码基线：本地 `origin/main` = `bede2b0b1`（2026-10-28 18:59 UTC）。**本地快照，没有 fetch**。
- 本 brief 只读：没改仓库、没连生产库、没跑测试。没标〔线上已核〕的「为什么」都是**从代码推出来的**，要靠 §2 去证实。
- 风险：WP1 整体 A 级。例外：P1c（S2 口径 + 契约测试）是 B 级。

---

## 0. 线上已核的事实（统管只读查过，本版直接采用）

1. 近 30 天 25 条 `factory_reel_publish` **全部是 Facebook 草稿（DRAFT）**。
2. 工厂发布器的定时任务近 60 天 `summary.live` **全是 false**，也就是一直在草稿模式。
3. `content_work_orders` 里有 **20 个**「工单状态 = published、但 `video_state` = DRAFT、而且没有 `promote_request_id`」——从来没走过 ME 的「转公开」。
4. 有 **3 个** `video_state = PUBLISHED`、`event_ids` 有 1 个、但读回链里**没有登记**。它们是 2026-10-13 一次会话里「按 PM 指示」**手工改成已公开**的：`published_ref` 里有 `promoted_note`，没有 `promote_request_id`。对应的流量记录**还是 DRAFT**，发布时间也**对不上**。→ 接线函数核对时一定拒绝（`not_published` / `published_at_mismatch`，`factory-reel-measurement-adapter.ts:96-102`）。**B3（`+0000` 时间格式）对这 3 条不成立。**
5. `social.publish_post` 全库只有 3 行。
6. `flywheel_actions` 的行权限策略已经是 `TO service_role`（v1 的 D10 作废、已删除）。

**由此得到的 ⑥ 结论（大部分已坐实）**：09-09 之后没有新读数，主因是**工厂从来没有真的公开过 Reel**（一直是草稿模式），读回链根本没有东西可读。唯一的 3 条「已公开」是在 ME 流程之外手工改的数据，流量记录没同步，被接线函数正确地拒绝了——但拒绝时**没有留下任何人能看到的痕迹**（这一点仍然是代码缺陷，见 R2）。

---

## 1. 设计稿和代码对不上的地方

| # | 设计稿说的 | 代码 / 线上实际 | 影响 |
|---|---|---|---|
| D1 | 「Reel 发布动作**永远**停在草稿」 | 代码里已经有路可以走出草稿：10-18 上线的「转公开」（`promote/publish-steps.ts:77-119`）会把流量记录改成 PUBLISHED、清掉 `event_ids`，下一轮补发对账（`publish-worker.ts:474-492`）重新发信号。**但线上从来没有人用过它**（事实 3、4）。真正的断点是：草稿模式 + 没人点「转公开」+ 流程外手改的数据不同步 | WP1 ①的重点从「写代码打通」变成「P0 先查清 20 个草稿在 Facebook 上到底公开了没有」+「拒绝要看得见」 |
| D2 | 「`fetchAdStoryIds` 出错返回空列表」 | 出错时 `break`，返回的是**已经读到的那一部分**（`meta/ads-posts.ts:44-67`），可能是一个不完整但非空的列表；而且没写状态过滤 | 「读不全」函数要识别「读到一半出错」和「到上限被截断」 |
| D3 | 「新写一个函数」 | `meta/entity-settings.ts` 里的 `readList`（`:169-181`）本来就有「读全了没有」的标记，`fetchAdSettings`（`:221-227`）也已经在读 `creative{video_id,effective_object_story_id}`；只是它的状态过滤不含 ARCHIVED / DELETED（`:36-42`） | 新函数加在 `entity-settings.ts`、复用 `readList`；旧函数一个都不动 |
| D4 | 「比对 `effective_object_story_id`」 | Reel 在读回链里的帖子编号是 ME 自己拼出来的 `<page>_<video>`（`adapter.ts:48-50`），广告里返回的格式**没有实测过** | 要同时比对 `creative.video_id` |
| D5 | 「T+4 / T+72 在四处写死」 | 不止四处；`post-performance.ts:195-209` 的 `pickReceipt` 取「最大的时点」，`post-measurement-store.ts:192-202` 要求「正好两个时点」 | 见 §3.4 清单；S2 的修法按必改项 3 |
| D6 | 判定表的记录类型 = C1 / C2 / C3 / `story_dm_count` | WP1 就要存助推结果，但 C2 要到 WP4 才写 | 加第 5 种记录类型 `boost_check` |
| D7 | 「私信能否剔除广告来源，WP0 实测」 | 用读取接口拿私信，**拿不到广告来源**（`crm/attribution.ts:32-38`）；广告来源只通过推送消息写进 `conversations.entry_referral`（`webhooks/meta/messenger/route.ts:296-302, 355-404`） | 私信统计读 ME 自己的 `conversations` 表，不调 Graph；能剔除多少用 Q12 量 |
| D8 | Story「照 Reel 的做法写发布动作行」 | `story.item.attempted` 已经在发（`story-lite/sender.ts:103-132`，尽力而为、失败就吞掉），但**没有任何函数监听它** | 新增一个监听函数，并且要有补登记 |
| D9 | — | `story_items` 的建表语句在 `docs/migrations-sql/2026-10-12-story-lite.sql`，不在 `supabase/migrations/` | 写测试 / 核对表结构时去那里找 |

---

## 2. ⑥ 和 P0：只读排查（P0 必须回答的问题）

### 2.1 P0 必答问题

| 编号 | 问题 | 为什么必须先答 | 怎么查 |
|---|---|---|---|
| **P0-1** | 那 20 个「ME 里是草稿」的 Reel，**在 Facebook 上实际是不是已经公开了**？ | 是 → 说明有人在 Facebook 后台手动公开了，ME 完全不知道（v1 的 R6，现在升为必答）；这 20 条就是「漏读的真实内容」。否 → 它们就是还没发，读回链没东西读是正常的 | Q2 列出 permalink，**逐条抽查**：用只读 Graph `GET /{video_id}?fields=published,updated_time,permalink_url`（令牌由有只读授权的窗口去用），或者人工打开 permalink 看。**只看，不改** |
| **P0-2** | 那 3 条「已公开」是谁、在什么时候、用什么方式改的？流量记录为什么没跟着改？ | 决定这 3 条历史记录要不要补登记（补登记 = 写生产库，要 PM 授权，见 §6） | Q15：`published_ref->>'promoted_note'`、`promote_request_id`、`updated_at`；对照当天的 `fde_work_logs` / 会话记录 |
| **P0-3** | 所有「已公开」的工单里，有多少带 `promote_request_id`（走的是 ME「转公开」）、有多少不带（流程外手改的）？ | 决定 R3（时间格式）还有没有必要做：没有任何一条走过「已被人手公开」分支 → R3 删掉 | Q15 |
| **P0-4** | 补发信号有没有失败过（结构校验不过之类）？ | 决定 R4 要不要做 | Q7 + Render 日志 L1 |
| P0-5 | 同一个工单有没有多行流量记录？ | 决定 R1 的优先级 | Q4 |

### 2.2 候选断点（根据线上事实更新过）

| 编号 | 断点 | 状态 |
|---|---|---|
| B1 | 工厂一直在草稿模式，Reel 从来没有在 ME 里公开过 | **〔线上已核〕主因** |
| B2 | 草稿在 Facebook 后台被人手动公开，ME 不知道 | 待 P0-1 |
| B3 | 「已被人手公开」分支用了 `+0000` 时间格式，信号结构校验不过 | **对已经发过信号的 3 条不成立**（它们不是走这个分支改的）；对以后走「转公开」的 Reel，**代码推断仍然可能成立**，等 P0-3 决定修不修 |
| B4 | 一个工单有多行流量记录，接线函数报错 | 待 P0-5 |
| B5 | 接线函数核对时拒绝（静默） | **〔线上已核〕那 3 条就是这种情况**（流量记录还是 DRAFT、时间对不上） |
| B6 | 发信号本身失败 | 待 P0-4 |
| B7 | 云端函数没有同步到 Inngest | 不影响结论（没有可读的东西）；P1 上线后照常检查 |
| B9 | 图文：每日计划自动发布只演练 | 〔线上已核〕全库只有 3 行 |

### 2.3 SQL（全部只读；Q14 已删）

```sql
-- Q0 现有 4 条回执来自哪里
SELECT r.created_at, r.window_hours, r.status, r.reason, a.payload->>'source' AS source, a.payload->>'post_id' AS post_id
FROM social_post_measurement_receipts r JOIN flywheel_actions a ON a.id = r.action_id
ORDER BY r.created_at DESC;

-- Q2 逐个工单（P0-1 用：列出 permalink 去抽查）
SELECT w.id AS work_order_id, w.client_id, w.status,
       w.published_ref->>'video_state' AS wo_state,
       w.published_ref->>'video_id' AS video_id,
       w.published_ref->>'permalink' AS permalink,
       w.published_ref->>'published_at' AS wo_published_at,
       w.published_ref->>'promote_request_id' AS promote_request_id,
       w.published_ref->>'promoted_note' AS promoted_note,
       jsonb_array_length(COALESCE(w.published_ref->'event_ids','[]'::jsonb)) AS event_ids_n,
       (SELECT count(*) FROM flywheel_actions t WHERE t.action_type='factory_reel_publish'
          AND t.payload->>'work_order_id' = w.id::text) AS traffic_rows,
       (SELECT count(*) FROM flywheel_actions m WHERE m.action_type='social.publish_post'
          AND m.payload->>'idempotency_key' LIKE 'factory-reel:' || w.id::text || ':%') AS measure_actions
FROM content_work_orders w
WHERE w.status = 'published' AND w.updated_at > now() - interval '60 days'
ORDER BY w.updated_at DESC;

-- Q4 一个工单有多行流量记录（P0-5）
SELECT payload->>'work_order_id' AS wo, count(*), array_agg(payload->>'video_state'), array_agg(client_id)
FROM flywheel_actions WHERE action_type='factory_reel_publish'
GROUP BY 1 HAVING count(*) > 1;

-- Q5 已公开工单里，发布时间不是 Z 结尾的（B3 对以后的风险）
SELECT id, published_ref->>'published_at' AS pub, published_ref->>'promote_request_id' AS req
FROM content_work_orders
WHERE published_ref->>'video_state'='PUBLISHED' AND (published_ref->>'published_at') NOT LIKE '%Z';

-- Q7 补发对账的运行情况（P0-4）
SELECT started_at, status, summary->>'live' AS live, summary->'reel_event_reconcile' AS reconcile, error_message
FROM cron_run_logs WHERE job_name='factory-publish-worker' AND started_at > now() - interval '14 days'
ORDER BY started_at DESC LIMIT 50;

-- Q9 读回链已登记、但过了 T+4 还没有回执
SELECT a.id, a.client_id, a.payload->>'source' src, a.executed_at
FROM flywheel_actions a
WHERE a.action_type='social.publish_post' AND a.payload ? 'idempotency_key'
  AND a.executed_at < now() - interval '5 hours'
  AND NOT EXISTS (SELECT 1 FROM social_post_measurement_receipts r WHERE r.action_id = a.id);

-- Q11 Story 已发出条数（P3 补登记的基数）
SELECT client_id, status, count(*), max(sent_at), count(*) FILTER (WHERE provider_receipt IS NULL) AS no_receipt
FROM story_items WHERE created_at > now() - interval '30 days' GROUP BY 1,2;

-- Q12 私信能剔除广告来源的比例（WP0 前置）
SELECT client_id, count(*) AS threads_30d,
       count(*) FILTER (WHERE entry_referral ? 'ad_id') AS with_ad_id
FROM conversations WHERE created_at > now() - interval '30 days' GROUP BY 1;

-- Q13 新表名有没有被占
SELECT to_regclass('public.social_verification_verdicts');

-- Q15 已公开工单是怎么被改成已公开的（P0-2 / P0-3）
SELECT w.id, w.client_id, w.updated_at,
       w.published_ref->>'promote_request_id' AS promote_request_id,
       w.published_ref->>'promoted_note' AS promoted_note,
       w.published_ref->>'published_at' AS wo_pub,
       w.published_ref->>'published_at_estimated' AS estimated,
       (SELECT string_agg(t.payload->>'video_state' || '@' || COALESCE(t.payload->>'published_at','null'), ' | ')
          FROM flywheel_actions t WHERE t.action_type='factory_reel_publish'
           AND t.payload->>'work_order_id' = w.id::text) AS traffic
FROM content_work_orders w
WHERE w.published_ref->>'video_state' = 'PUBLISHED'
ORDER BY w.updated_at DESC;
-- 同一天的工作日志，用来对照是谁改的
SELECT log_date, author_email, left(summary, 200) FROM fde_work_logs
WHERE log_date = '2026-10-13' AND summary ILIKE '%reel%';
```

日志和面板（只看，不点按钮）：
- **I1**：Inngest 面板里 `cloud-factory-reel-measurement-adapter` 是否存在。
- **I2**：`me/factory.reel.published` 那 3 条事件分别触发的接线函数运行，返回的 `reason` 是什么（预期是 `not_published` 或 `published_at_mismatch`）。
- **L1**：Render 日志里搜「发布信号 emit 失败」。

---

## 3. 逐项：改哪里（等 P0 结论出来再裁剪）

### 3.1 ①Reel

| 改动 | 文件:行 | 做法 | P0 之后的去留 |
|---|---|---|---|
| R1 接线函数查到多行要明确处理 | `factory-reel-measurement-adapter.ts:79-86` | 加 `.eq('client_id', …)`；改用 `.limit(2)` 当数组处理；查到 2 行 → `multiple_traffic_rows`，不抛异常 | P0-5 为 0 也保留（防以后出现），优先级降低 |
| R2 拒绝要看得见 | 同文件 `:220-250` 的每个 `return {ok:false}` | 调用新的**通用读回链结果记录**（§3.6），结果码 `reel_rebind_refused:<reason>` | **必做**（那 3 条就是吃了这个亏） |
| R3 时间格式统一 | `promote/publish-steps.ts:62-74` | `updatedTime` → `new Date(x).toISOString()`；转不出来就拒绝 | **大概率删掉**（P0-3：如果没有任何一条走过「已被人手公开」分支）；保留的话**单独开一个小的 A 级 PR**（动的是发布路径） |
| R4 补发失败要看得见 | `publish-worker.ts:462-466` | 构造信号时结构校验失败 → 写通用结果记录 `reel_event_contract_invalid` | 大概率删掉（P0-4 没有失败记录的话） |
| R5（开卡） | `publish-worker.ts:235-264` | 恢复路径拿回来的回执没有 `video_state` | 不在 WP1 |
| R6（升为 P0-1） | — | 草稿被人在 Facebook 后台手动公开、ME 不知道 | P0 回答之后：如果确实已公开，把「怎么把这 20 条同步进 ME」作为**需要 PM 授权的事项**（§6），代码层的「按主页读 Reel 列表对账」另开卡 |

### 3.2 ②Story

| 改动 | 文件 | 说明 |
|---|---|---|
| S1 常量 | `post-measurement-store.ts:31` 附近；`flywheel/vocabulary.ts:308-317` | 加 `social.publish_story` 常量 |
| S2 唯一索引 | 迁移文件（P2，和判定表同一次 `go apply`） | `(client_id, action_type, payload->>'idempotency_key') WHERE action_type='social.publish_story'`；防重复键 = `story-lite:<item_id>` |
| S3 登记函数 | 新文件 `src/lib/social/story-publish-action.ts` | insert → 撞唯一约束(23505) → 回读核对完整身份；`expected_metric=null`；**不写 `measure_at`**（这样不可能进 T+N 读数链） |
| S4 事件监听函数 | 新文件 `src/lib/inngest/functions/story-publish-action-recorder.ts` | 监听 `story.item.attempted`。**第一步、在任何查库之前**，用纯判断过滤：不是 `status==='SENT' && mode==='LIVE'` 的直接返回 `{skipped:'not_live_sent'}`，**不进任何 `step.run`、不查任何库**（验收见 T11b）。通过后回查 `story_items` 和 `readRegisteredPageId` 核对，再调 S3；核对不过 → 写通用结果记录 |
| S5 补登记（**按必改项 8 修改**） | `story-lite-publish.ts`：sweep 之后**只加一步发事件**；新文件 `src/lib/inngest/functions/story-publish-action-reconcile.ts` | 发布函数里**不做补登记本身**（它 `retries:0`、`concurrency:1`，Story 迟到 20 分钟就不补发了，不能被拖慢）。sweep 结束后发一个事件 `social/story.publish_actions.reconcile_due`，事件 id 按 10 分钟分桶（`story-reconcile:<yyyyMMddHHmm 向下取整到 10 分钟>`），发送失败只写进运行记录的 summary，不改变 sweep 的结果。由另一个函数 `cloud-social-story-action-reconcile`（concurrency 1）处理：查最近 7 天 SENT 但没有动作行的 `story_items`，**每次最多 50 条**，逐条调 S3 |
| S6 私信窗口（要等 WP0；**按必改项 7 修改**） | 新文件 `src/lib/social/verify/story-dm-window.ts` + 一个事件触发的函数 | 见 §3.5 |

### 3.3 ③助推标记

| 改动 | 文件 | 说明 |
|---|---|---|
| B1 读取函数 | `meta/entity-settings.ts`（`:227` 后面） | `fetchAdCreativeRefsAllStatuses`：复用 `readList`；状态 = 现有那些 + ARCHIVED、DELETED；字段 `id,created_time,effective_status,creative{video_id,effective_object_story_id,object_story_id}`。**按必改项 9**：加上归档 / 删除的广告后，很容易撞到 25 页上限，结果整个账户都判成「读不全」。所以：①优先按「广告创建时间不早于帖子发布时间」在服务端过滤（Graph 的 `filtering` 是否支持 `created_time` **没有实测过**，P4 当场试跑第一步就测）；②服务端不支持 → 改成按时间分段读（每段读全才算这一段读全）；③P4 当场试跑同时实测「按帖子反查」的读取入口（`/{page}/ads_posts`、帖子上的 `promotion_status`）。三条都不行 → 照实标 `boost_unknown`，并在日报里写清楚原因 |
| B2 比对（纯函数） | 新文件 `social/verify/boost-match.ts` | 有命中 → `boosted`；没命中，但有账户读不全 / 账户没接入 / 账户列表为空 → `boost_unknown`；全部读全、没命中 → `not_boosted`。Reel 同时比对 `video_id` |
| B3 什么时候跑 | `daily-plan-post-measurement.ts:339-357` 之后**只加一次发事件** | T+72 回执写成功后，发 `social/post.boost_check_due`，由新函数 `cloud-social-boost-check` 处理，结果写判定表 `boost_check` |

### 3.4 ④读取时点「只追加」——要改的完整清单（WP1 不加新时点）

| # | 文件:行 | 现在写死了什么 |
|---|---|---|
| W1 | `campaign/daily-plan-publish.ts:35`（`measurementSchedule` `:345-351`） | `[4, 72]` |
| W2 | `daily-plan-publish.ts:398` / `:462` | `measure_at` 最多 4 个 |
| W3 | `inngest/functions/daily-plan-post-measurement.ts:59` | 只接受 4 或 72 |
| W4 | `social/post-measurement-store.ts:192-202` | 要求正好 `{4,72}` 两个时点；以后要加，必须老格式、新格式都接受 |
| W5 | `inngest/functions/factory-reel-measurement-adapter.ts:40` | `[4, 72]` |
| W6 | `social/post-performance.ts:195-209` `pickReceipt` | 取最大的时点。**按必改项 3**：改成**只在白名单 {4,72} 里取最大**，认不出的时点（比如以后加的 168）一律忽略。这样只有 4 小时读数时，仍然返回 4 小时那条 |
| W7 | `social-post-cohort.ts:26,105`；`social-post-evaluator.ts:34`；`campaign-tune-suggestions.ts:25`；`tune-suggestions/route.ts:21,93` | 只用 72（不受影响，要有测试守住） |
| W8 | 数据库 `window_hours > 0` | 不需要建库变更 |

白名单常量从 W1 导出，W6 引用它，不再单独写一份。契约测试锁住 W1 / W3 / W4 / W5 / W6 五处的集合一致。

### 3.5 Story 私信窗口（S6，按必改项 7）

- **问题**：私信同步（`messenger-sync-hourly`，每小时第 10 分，`cron/registry.ts:204`）加上推送接收端，会有最长约 1 小时的延迟。如果到点就数，窗口最后一小时进来的会话还没写进库，结果会**偏低，而且看不出来**。
- **做法**：
  1. 到点后先等一段：`sleepUntil(windowEnd + 70 分钟)`，确保至少跑过一轮同步。
  2. 再去查 `cron_run_logs` 里 `job_name='messenger-sync-hourly'`、`status='completed'`、`started_at >= windowEnd` 的记录。
  3. 有 → 才数；没有 → 写 `not_readable`，原因 `sync_not_caught_up`，**不写 0**。
- 广告来源：会话的 `entry_referral` 带 `ad_id` 的剔除；没带的照算（设计稿 M9 写过的已知局限）。
- 「邀请私信」是哪个时段、X 是几小时，都放客户配置。

### 3.6 通用「读回链结果记录」（按必改项 4，替代 v1 的「复用 writeMeasurementRecord」）

- **为什么不能复用旧的**：
  - `writeMeasurementRecord`（`campaign/daily-plan-measurement-record.ts:49-64`）把任务名写死成 `STORY_RESOLVE_JOB_NAME`（`daily-plan-post-story-resolve`）；
  - 它的记录格式要求填推广活动编号、计划编号（`:24-38`），用在 Reel / Story 上会逼人编造编号；
  - 它还会污染那个任务自己的健康检查；
  - 待办读取（`pm-todo/daily-plan-measurement-items.ts:85-87`）也是按这个任务名查的。
- **新建**：
  - 写入：新文件 `src/lib/social/readback-outcome-record.ts`。独立任务名 `social-readback-outcome`；字段 `{ client_id, subject_kind: 'reel'|'story'|'post', subject_ref, outcome, reason }`，**没有任何推广活动字段**。
  - 待办读取：新文件 `src/lib/pm-todo/social-readback-items.ts`。按新任务名、`status='failed'` 读，生成三件套（what / how / href）。在今日待办的组装处注册。
  - 登记：把 `social-readback-outcome` 登记进 `src/lib/cron/registry.ts`，否则「运行记录里有没登记的任务名」这类检查会报警。**改登记表 = A 级。**
  - 待解决：登记表的每一条都要求有 `schedule`（`registry.ts:81-112`），而这个任务名是**事件触发、没有排班**的。怎么登记（用 `scheduler:'inngest'` 加占位排班，还是新增「事件型」标记），**实施前要请子牙裁**——这一点 brief 层定不了。

---

## 4. 判定表建表草案（按必改项 5、10 修改）

```sql
CREATE TABLE public.social_verification_verdicts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deterministic per judgement attempt: derived from the triggering Inngest event id
  -- (uuid v5 of `<event.id>:<record_type>`). Replays of the same event produce the same id.
  request_id            UUID NOT NULL,
  client_id             UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  record_type           TEXT NOT NULL CHECK (record_type IN
                          ('c1_fidelity','c2_performance','c3_goal_pace','story_dm_count','boost_check')),
  content_action_id     UUID,
  period_key            TEXT,
  -- Hard-coded on purpose: adding a platform (e.g. tiktok) = schema change (A, go apply).
  platform              TEXT NOT NULL CHECK (platform IN ('facebook','instagram')),
  verdict               TEXT NOT NULL,
  read_point            TEXT NOT NULL CHECK (length(read_point) BETWEEN 1 AND 64),
  window_hours          INTEGER CHECK (window_hours IS NULL OR window_hours > 0),
  boost_status          TEXT CHECK (boost_status IS NULL OR boost_status IN ('not_boosted','boosted','boost_unknown')),
  sample_size           INTEGER CHECK (sample_size IS NULL OR sample_size >= 0),
  observed_value        NUMERIC CHECK (observed_value IS NULL OR observed_value >= 0),
  evidence_receipt_ids  UUID[] NOT NULL DEFAULT '{}',
  evidence_verdict_ids  UUID[] NOT NULL DEFAULT '{}',
  cohort_definition     JSONB,
  baseline_value        NUMERIC,
  not_comparable_reasons TEXT[],
  reason                TEXT,
  logic_version         TEXT NOT NULL CHECK (logic_version ~ '^[a-z0-9_.-]{1,40}$'),
  subject_key           TEXT GENERATED ALWAYS AS
                          (COALESCE(content_action_id::text, 'period:' || period_key)) STORED,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT svv_content_client_fk FOREIGN KEY (content_action_id, client_id)
    REFERENCES public.flywheel_actions(id, client_id) ON DELETE RESTRICT,

  CONSTRAINT svv_subject_shape_chk CHECK (
    CASE record_type
      WHEN 'c3_goal_pace' THEN content_action_id IS NULL AND period_key IS NOT NULL
      ELSE content_action_id IS NOT NULL AND period_key IS NULL
    END),

  CONSTRAINT svv_verdict_domain_chk CHECK (
    (record_type = 'c1_fidelity'    AND verdict IN ('match','mismatch')) OR
    (record_type = 'c2_performance' AND verdict IN ('above','within','below','insufficient_sample','not_comparable')) OR
    (record_type = 'c3_goal_pace'   AND verdict IN ('on_track','behind','unreachable_within_quota','insufficient_sample')) OR
    (record_type = 'story_dm_count' AND verdict IN ('counted','not_readable')) OR
    (record_type = 'boost_check'    AND verdict IN ('not_boosted','boosted','boost_unknown'))),

  -- story_dm_count: required = content_action_id, window_hours, read_point;
  -- forbidden = period_key (shape chk), boost_status, sample_size, baseline_value, cohort_definition;
  -- observed_value only when counted; reason only (and required) when not_readable.
  CONSTRAINT svv_story_dm_shape_chk CHECK (
    record_type <> 'story_dm_count' OR (
      window_hours IS NOT NULL AND boost_status IS NULL AND sample_size IS NULL
      AND baseline_value IS NULL AND cohort_definition IS NULL
      AND ( (verdict = 'counted'      AND observed_value IS NOT NULL AND reason IS NULL)
         OR (verdict = 'not_readable' AND observed_value IS NULL     AND reason IS NOT NULL) ))),

  CONSTRAINT svv_boost_shape_chk CHECK (
    record_type <> 'boost_check'
    OR (boost_status = verdict AND observed_value IS NULL
        AND (verdict <> 'boost_unknown' OR reason IS NOT NULL))),

  CONSTRAINT svv_not_comparable_reason_chk CHECK (
    verdict <> 'not_comparable' OR COALESCE(array_length(not_comparable_reasons, 1), 0) > 0)
);

-- (a) Same triggering event replayed → same request_id → 23505 → caller treats as already written.
CREATE UNIQUE INDEX svv_request_uniq ON public.social_verification_verdicts (request_id);
-- (b) Same judgement input, different event (e.g. manual resend) → also blocked: one verdict per
--     (subject, read point, logic version). Re-judging requires a new logic_version.
CREATE UNIQUE INDEX svv_identity_uniq ON public.social_verification_verdicts
  (client_id, record_type, subject_key, read_point, logic_version);
CREATE INDEX svv_client_created_idx ON public.social_verification_verdicts (client_id, created_at DESC);

-- Append-only.
CREATE OR REPLACE FUNCTION public.social_verification_verdicts_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'social_verification_verdicts is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'check_violation';
END; $$;
CREATE TRIGGER svv_append_only_row BEFORE UPDATE OR DELETE ON public.social_verification_verdicts
  FOR EACH ROW EXECUTE FUNCTION public.social_verification_verdicts_append_only();
CREATE TRIGGER svv_append_only_truncate BEFORE TRUNCATE ON public.social_verification_verdicts
  FOR EACH STATEMENT EXECUTE FUNCTION public.social_verification_verdicts_append_only();

ALTER TABLE public.social_verification_verdicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.social_verification_verdicts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.social_verification_verdicts FROM anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS flywheel_actions_social_publish_story_idempotency
  ON public.flywheel_actions (client_id, action_type, (payload ->> 'idempotency_key'))
  WHERE action_type = 'social.publish_story' AND payload ->> 'idempotency_key' IS NOT NULL;
```

**写入与读取规则（防「被重跑覆盖、记下来的是最后一次」）：**
- 写入：只 INSERT；撞 23505 → 按 `request_id` 回读，核对关键字段（verdict、evidence）。一致 → 视为已写过；不一致 → 记结果码 `verdict_conflict`、进待办，**绝不覆盖**。
- 读取：同一组（client, record_type, subject_key, read_point, logic_version）**以 `created_at` 最早的那一条为准**。唯一索引 (b) 本来就保证只有一条；读取代码仍然按最早一条写，防止以后有人放宽索引。测试见 T14 ⑦⑧。

**删客户的完整顺序（需授权的 A 级流程，不在 WP1 实现，只写进卡里）：**
1. 管理员书面授权（写清是哪个客户、为什么删），并留审计记录。
2. 在同一个事务里：`ALTER TABLE social_verification_verdicts DISABLE TRIGGER svv_append_only_row`（关保护）。
3. `DELETE FROM social_verification_verdicts WHERE client_id = …`（**先删判定记录**；因为外键是 RESTRICT，顺序反了会失败）。
4. `ENABLE TRIGGER svv_append_only_row`（重新打开保护）。
5. 再删客户（`flywheel_actions`、回执等按原来的 CASCADE 连带删除）。
6. 事务提交前核对：判定表的保护触发器是启用状态。

现状：仓库里删客户的地方只有注册失败时的回滚（`self-register/route.ts:261,273`、`auth/self-serve-client.ts:114`），那时候还不可能有判定记录，所以不受影响。

---

## 5. 测试清单（每条都配变异检验）

| # | 测试 | 变异检验（这样改了必须变红） |
|---|---|---|
| T1–T3 | 助推比对：账户读不全 / 撞到页数上限 / 账户没接入或列表为空 → `boost_unknown` | 删掉「读全了没有」的判断或覆盖范围的分支 |
| T4 | 读不全但命中 → `boosted` | — |
| T5 | Reel 只靠 `video_id` 命中 → `boosted` | 删掉 video_id 比对 |
| T6 | 新读取函数的请求地址含 ARCHIVED、DELETED；`fetchAdSettings` 的地址不变 | 改动 `ALL_STATUSES` |
| T6b | 按时间过滤或分段：每一段都读全才算读全；任意一段 `complete:false` → 整体读不全 | 把「每段都要读全」改成「有一段读全就算」 |
| T7 | `ads-posts` 现有测试原样通过 | — |
| T8 | S2 同时遇到 Story 和图文动作行 → Story 只算一次 | 把查询改成两种动作类型都查 |
| T9 | `verifyActionIdentity` 遇到 `social.publish_story` → `invalid_publish_action` | 放宽动作类型判断 |
| T10 | Story 登记撞唯一约束 → 核对身份；不一致 → fail-closed | 删掉身份核对 |
| T11 | 核对不过（收据不同、状态不是 SENT、主页不对）→ 不写动作行，写一条结果记录 | 删掉回查 `story_items` |
| **T11b** | 演练事件（`mode=DRY_RUN`）以及 `BLOCKED` / `RETRY_LATER` 事件 → **假数据库的调用次数 = 0，`step.run` 调用次数 = 0** | 把过滤挪到 `step.run` 里面，或删掉过滤 |
| T12 | Story 发布函数：sweep 之后只多了一次发事件；补登记函数（假发布）的调用次数 = 0；发事件失败时 sweep 的结果不变 | 让发事件失败时抛异常 |
| T12b | 补登记函数一次最多处理 50 条 | 去掉上限 |
| T13 | 私信窗口：读库出错 → `not_readable`，不是 0；带 `ad_id` 的会话被剔除 | 把 `not_readable` 改成 0 |
| **T13b** | 窗口结束之后**还没有**一轮成功的同步 → `not_readable(sync_not_caught_up)`；有了才数 | 删掉「同步晚于窗口结束」这项检查；或把比较从 `>=` 改成「随便有一次同步就算」 |
| T14 | 数据库测试：①UPDATE / DELETE / TRUNCATE 都失败；②各记录类型的必填 / 禁填字段（包括 `story_dm_count` 的全部字段）；③同一个 `request_id` 写两次 → 23505；④同一组身份、不同 `request_id` → 23505；⑤删除有判定记录的客户 → 失败；⑥anon / authenticated 读不到；**⑦写入撞 23505 且内容不同 → 不覆盖，并产生 `verdict_conflict` 结果记录；⑧读取函数遇到（被人为放宽索引后的）两条记录 → 返回最早那一条**；⑨`platform='tiktok'` → 违反约束 | 去掉任意一条约束；或读取改成取最新 |
| T15 | 契约测试：W1 / W3 / W4 / W5 / W6 五处的时点集合一致；`pickReceipt` 在有 72 和 168 时返回 72；**只有 4 小时读数时返回 4 小时那条**；只有认不出的 168 时返回 null | 把 `pickReceipt` 改回「取最大」；或把白名单去掉 |
| T16 | 同一工单 2 行流量记录 → `multiple_traffic_rows`，不抛异常，并写一条结果记录 | 改回 `.maybeSingle()` |
| T17（R3 保留时才需要） | `+0000` 格式 → 存成 `Z` 结尾，信号能通过结构校验 | 去掉格式统一 |
| T18 | 通用结果记录：任务名是 `social-readback-outcome`；记录里没有 campaign / plan 字段；旧的 `daily-plan-post-story-resolve` 任务的待办读取结果不变 | 改成复用旧任务名 |
| T19 | 本包不碰「发布暂停」：用 grep 守住改动文件 | — |

---

## 6. 需要 PM 单独授权的事项（全部是写生产库或对外动作，不能合在代码合并里）

| 编号 | 事项 | 性质 | 前提 |
|---|---|---|---|
| A1 | P2 建库变更（判定表 + Story 防重复索引） | 改生产库结构 | P2 合并之后，PM 回 `go apply` |
| A2 | 如果 P0-1 查出那 20 个草稿在 Facebook 上已经公开：在 ME 里把它们**改成「已公开」**（工单 + 流量记录） | 写生产数据；而且会触发补发信号，下游可能会建广告草稿（事件文件头写了，信号也是给自动建广告用的） | P0-1 的结论 + PM 明确授权；执行前先确认下游自动建广告是关着的 |
| A3 | 那 3 条流程外手改的历史记录：**补登记进读回链**（对齐流量记录 + 登记 `social.publish_post`） | 写生产数据；T+4 / T+72 早就过了，补出来的读数是「迟测」，回执上能看出来 | P0-2 的结论 + PM 明确授权 |
| A4 | **当场试跑时重新触发补发信号** | 写生产库（工单的 `event_ids`）+ 事件 | 单独获准；见下面的替代方案 |
| A5 | 把工厂发布器切成真发（`FACTORY_PUBLISH_LIVE=true`） | 对外发布，不可逆 | PM 本人决定；**不在 WP1 范围**，但不做这一步，Reel 这条线就一直没有读数可读 |

**当场试跑：找不到「已转公开、记录也对得上」的真实 Reel 时的替代方案**（按线上事实，现在确实一条都没有）：
1. **本地完整链路**：本机 Supabase + Inngest 开发服务器 + 测试数据（一条 PUBLISHED 流量记录 + 工单），Graph 用假的请求函数。从发信号 → 接线函数 → 登记 → 读数函数 → 回执，拿到真实输出。不碰生产。
2. **生产只读旁观**：等 PM 下一次在 ME 里真点「转公开」（这是业务动作，不是为了试跑），然后用 §2 的 Q2 / Q9 只读确认它被登记、T+4 回执出现。T+72 开台账卡，`verify_by` = 第一次 T+72 那天。
3. 拒绝路径的试跑：在生产上不制造数据；用 P1 的结果记录去观察那 3 条历史记录**如果被重新投递**会产生什么记录——只在 A3 获批、并且要补登记的时候顺带验证，不单独为了试跑去写生产。

---

## 7. 拆成几个 PR（按必改项 6 修改；全部串行，同一时间只有一个写入者）

| PR | 内容 | 级别 | 文件边界 | 依赖 |
|---|---|---|---|---|
| **P0** | 只读排查，回答 P0-1 到 P0-5 | 无代码 | — | 有只读权限的窗口去跑 |
| **P1a** | R3 时间格式（**P0-3 显示没必要就删掉**） | A（小） | `promote/publish-steps.ts` + 测试 | P0 |
| **P1b** | R1、R2、R4（R4 按 P0-4 决定去留）+ 通用结果记录 §3.6 + 待办读取 + 登记表 | A | `factory-reel-measurement-adapter.ts`、`publish-worker.ts`（只改 `:462-466`）、新文件 `social/readback-outcome-record.ts`、新文件 `pm-todo/social-readback-items.ts`、待办组装处、`cron/registry.ts` + 测试 | P0；登记方式先请子牙裁 |
| **P1c** | W6 `pickReceipt` 白名单 + T15 契约测试 | **B** | `social/post-performance.ts`、`campaign/daily-plan-publish.ts`（只导出白名单常量）、`post-measurement-contract.test.ts`、`post-performance.test.ts` | 无（可以和 P0 并行，文件不重叠） |
| **P2** | 迁移：判定表 + Story 唯一索引 + 数据库测试 | A | `supabase/migrations/<新>.sql`、数据库测试脚本 | 合并后 PM `go apply`（A1） |
| **P3** | Story：S1、S3、S4、S5 | A | `post-measurement-store.ts`（只加常量）、`vocabulary.ts`、两个新文件 + 新的补登记函数文件、`inngest/functions/index.ts`、`story-lite-publish.ts`（只加一步发事件） | P2 已经 apply；P1b 合并（要用通用结果记录） |
| **P4** | 助推：B1–B3 | A | `entity-settings.ts`（只新增）、`social/verify/boost-match.ts`、新的 Inngest 函数、`daily-plan-post-measurement.ts`（只加一次发事件）、`index.ts` | P2、P3（`index.ts` 要串行）；试跑第一步先实测按时间过滤和按帖子反查 |
| **P5** | Story 私信：S6 | A | `social/verify/story-dm-window.ts`、新的 Inngest 函数、`index.ts` | P2、P3、WP0 实测 |

每个 A 级 PR：草稿状态 + 正文写「风险级别：A」；实施前、实施后各请子牙 + 魏征审一次；合并要问 PM（回 `合 N`）。P1c 是 B 级，机器判级、检查全绿后自动合并。

---

## 8. 给 DeepSeek 的分轮指令（只列出比 v1 有变化的轮次，其余照 v1 的格式；每轮只碰一个文件主题）

公共前缀不变：`/read-only CLAUDE.md` + 本轮的只读文件；只改列出的文件；strict，不许用 any；不提交。每轮之后由 Claude Code 跑 `npm test -- <路径>` 和带大内存参数的 `npm run type-check`，并核对退出码。

- **C-1（P1c）** `src/lib/campaign/daily-plan-publish.ts:35` 旁边：导出 `PUBLISH_MEASUREMENT_WINDOW_SET = new Set<number>(PUBLISH_MEASUREMENT_OFFSETS_HOURS)`。验收：type-check 通过。
- **C-2（P1c）** `src/lib/social/post-performance.ts:195-209`：`pickReceipt` 先过滤 `PUBLISH_MEASUREMENT_WINDOW_SET.has(r.window_hours)`，然后照原来的逻辑取最大。验收：T15 的后三条。
- **C-3（P1c）** `src/lib/inngest/functions/__tests__/post-measurement-contract.test.ts`：五处一致的契约测试。验收：T15 第一条；把其中一处改成 `[4,48]` 时测试变红（写进 PR 正文）。
- **O-1（P1b）** 新文件 `src/lib/social/readback-outcome-record.ts`：`writeReadbackOutcome(supabase, {clientId, subjectKind, subjectRef, outcome, reason})` → 往 `cron_run_logs` 插一行，`job_name='social-readback-outcome'`、`status='failed'`；写入失败要抛异常。验收：T18。
- **O-2（P1b）** 新文件 `src/lib/pm-todo/social-readback-items.ts`：照 `daily-plan-measurement-items.ts:80-120` 的结构，按新任务名读，生成三件套。并在今日待办的组装处注册。验收：一条假记录能变成一条人工任务；旧待办的测试不变。
- **O-3（P1b）** `src/lib/cron/registry.ts`：加 `social-readback-outcome` 的登记（具体写法按子牙的裁决）。验收：登记表的对账测试通过。
- **R1-1 / R1-3（P1b）** 同 v1，但把「写结果码」都改成调用 O-1。
- **S-4（P3）** 新文件 `story-publish-action-recorder.ts`：handler 第一行就做纯判断过滤（在任何 `step.run` 之前）。验收：T11、T11b。
- **S-5a（P3）** `src/lib/inngest/functions/story-lite-publish.ts:41-56`：在 sweep 之后加 `step.run('emit-story-reconcile')`，只调一次 `sendInngestEvent`（10 分钟分桶的事件 id），失败时 catch 住、写进 summary。验收：T12。
- **S-5b（P3）** 新文件 `src/lib/inngest/functions/story-publish-action-reconcile.ts`：concurrency 1；`.limit(50)`；逐条调 S-2。验收：T12b。
- **B-1（P4）** `src/lib/meta/entity-settings.ts`：新增函数；参数里加 `since`（帖子发布时间），默认先试服务端按 `created_time` 过滤；不支持的话换成调用方按 7 天分段读、并汇总每一段读没读全。验收：T6、T6b。**实现之前先由 Claude Code 实测 Graph 支不支持这种过滤，把结论写进 PR。**
- **D-1（P5）** `src/lib/social/verify/story-dm-window.ts`：`countNewThreads(threads, {sentAt, hours, lastSuccessfulSyncStartedAt})`；`lastSuccessfulSyncStartedAt` 为空或早于窗口结束 → `not_readable(sync_not_caught_up)`。验收：T13、T13b。时间用参数传入，不用假时钟去拨。

---

## 9. 必改项对照表（10 条）

| # | 必改项 | 本版怎么处理 | 在 brief 层能不能解决 |
|---|---|---|---|
| 1 | 删 D10、§7 里的对应条目、Q14 | 已删 | 能 |
| 2 | R6 升为 P0 必答；B3 改为「对已发过信号的 3 条不成立」；P0 加查 `promote_request_id` 和是谁改的 | §2.1 P0-1、P0-2、P0-3，§2.2，Q15 | **部分能**：问题和查法写清楚了，但 20 个草稿在 Facebook 上到底公开了没有，必须**人去抽查或用 Graph 只读读一次**，答案 brief 里给不出 |
| 3 | `pickReceipt` 在白名单里取最大，认不出的忽略；T15 补「只有 4 小时读数」 | §3.4 W6，T15，C-1 到 C-3 | 能 |
| 4 | 不复用 `writeMeasurementRecord`，改成通用结果记录 + 独立任务名 + 登记 | §3.6，O-1 到 O-3 | **部分能**：登记表要求每条都有排班，事件触发的任务名怎么登记，要请子牙在实施前裁 |
| 5 | 判定表唯一键不能靠 `attempt_no` | 去掉 `attempt_no`；`request_id` 由事件编号算出来并加唯一约束；另加身份唯一约束；读取以最早一条为准；T14 ⑦⑧ | 能（`request_id` 具体怎么从事件编号算，用 uuid v5，实施时定） |
| 6 | P1 按 P0 裁剪、拆成 P1a / P1b / P1c | §7 | 能（裁掉哪几项要等 P0） |
| 7 | 私信窗口要等同步追上 | §3.5，T13b，D-1 | **部分能**：同步任务运行成功 ≠ 推送接收端没丢消息；推送丢失还是会少算，只能在日报里写明「已知局限」 |
| 8 | 补登记不能拖慢 Story 发布 | §3.2 S5：发布函数里只发一次事件，补登记放到另一个函数，每次最多 50 条；T12、T12b | 能 |
| 9 | 加上归档 / 删除的广告后容易撞页数上限 | §3.3 B1：按创建时间过滤 / 分段读 / 先实测按帖子反查；T6b | **不能**：Graph 支不支持按 `created_time` 过滤、按帖子反查的入口能不能用，必须在 P4 实测；三条都不行就只能大量标 `boost_unknown` |
| 10 | 判定表补：删客户的完整顺序、平台写死、`story_dm_count` 必填禁填、演练事件不查库 | §4（顺序 1–6、平台注释、`svv_story_dm_shape_chk`），§3.2 S4，T11b，T14 ⑨ | 能 |
| 另 | 当场试跑会写生产库；「已发布」盖在草稿上、补登记 3 条都要单独授权 | §6 A2–A4 + 替代试跑方案 | 能（授权要 PM 本人给） |

## 10. Reuse Statement

- 复用：现有读回链（两个读数函数、快照写入、回执表）、`entity-settings.readList`、`readRegisteredPageId`、`conversations.entry_referral`、`messenger-sync-hourly` 的运行记录、`story.item.attempted`、只追加触发器的写法、组合外键的写法、cron 登记表、今日待办的组装处。
- 新增 platform-shared：判定表、助推比对、Story 动作登记和补登记、私信窗口统计、通用读回链结果记录。
- industry-specific：无。
- client-specific：「邀请私信」时段和 X 小时放客户配置；共享代码里不出现客户名或 ID。
- 不新建定时函数：新增的都是事件触发的函数；Story 发布函数里只多发一次事件。
