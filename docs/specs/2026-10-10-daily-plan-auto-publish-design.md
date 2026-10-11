# 每日计划图文 Post 自动发布 — 设计稿 v0.2（子牙+魏征一轮审后修订，未开工）

> **v0.2：§12 的修订优先于 §3–§6、§9 中与它冲突的写法。** v0.1 被两位审查判「需改设计后再审」（共 3 条阻塞），§12 逐条回应。

- 窗口：65 · 日期：2026-10-10 · 风险级别：**A**（对外发布 + 授权 + 不可逆副作用）
- 基线：HEAD = origin/main = `6cf5afa5a`（2026-10-10 刷新）
- 状态：**只出方案**。PM 在对话里回「做」之前不写代码、不发布、不改生产库。
- 范围：**只做 Facebook 图文 Post**。Instagram 图文（无直发线）与 Story（全仓无调接口代码）本轮不做。

## 0. 先对照代码核实（对 61 号调研结论的复核）

| 61 号的说法 | 核实结果 |
|---|---|
| FB 图文发布已有 `publishPagePhotoPost`，调用方是 `campaign-daily-plan/publish/route.ts` | **对**。路由 810 行（已超仓库 800 行上限），`approved`/`publish_authorization` 是 `z.literal(true)`，`no_publish` 默认 true，要求同版本 no-publish 队列回执，幂等键防重发 |
| 现在是人点按钮、没有定时 | **对**，且更具体：路由第一行就是 `requirePaidClientAccess(clientId)`（要登录用户会话），**定时任务没有用户会话，不能直接调这条路由** |
| 价格数字闸 | **对但名字有两个**：`price-claim-gate.ts`（真价配真图，来源判定）和 `price-fact-gate.ts`（数字对客户资料，PR #2365 已合并）。路由里两道都在，且**在任何 token 查询/Graph 调用之前** |
| Reel 的 worker 每小时第 5 分钟 | **对**（`render.yaml`：`schedule: "5 * * * *"`）。`docs/STATE.md` 还写 `*/10`，已过期，不是我这轮的活，记入后续事项 |
| IG 无直发线 / Story 无代码 | 抽查一致，本轮不做 |
| （61 号没提）**时间已经被 Facebook 托管** | 路由里 `resolvePublishSchedule` 已经让 FB 把帖子"定时"到**当天 08:00 NZ**（`nzMorningUtc`）；离发布时间不足 15 分钟或日期已过则**立即发布**。所以「按计划时间发」这一半早就有了，**缺的只是"谁来触发 + 谁来授权 + 失败怎么办"** |

撞车检查（2026-10-10 读分支/PR/工作区）：
- 64 号（East Inter 排期）工作区干净、HEAD 即主干，无对 `publish*` / `daily-plan-publish.ts` / `price-*-gate.ts` 的改动；
- 41 号价格闸 PR #2365 已**合并**；34 号 #2350 已合并；18 号统筹空闲；
- 开放 PR 里没有碰这几个文件的。本设计会改路由（抽共用函数），实现开工时再查一次。

## 1. 平台层级判定（Tier Gate · Full，精简版）

- 被判定对象：「已审核 + PM 已授权的每日计划 Post，到点由系统自动提交给 Facebook」。
- 层级：**L1 能力的扩展，不是新能力线**。挂在既有「社媒」支柱的 Act 段；发布走既有 Meta Connector（L3，`lib/meta/page-posts.ts`），不新开第二套发布客户端。
- 换客户测试：✓ — 客户名/页面号/时段/每日上限全部来自客户配置与授权回执；共享代码里没有 CTS/East Inter 字样。换成 East Inter 或悉尼地产客户，共享代码不用改。
- 换行业测试：✓ — 价格闸本身是「有报价就核对」，没有报价的行业直接通过；行业差异（比如发布时段）进 Profile/配置。
- 红线：1（不包装升级）✓ 2（无客户事实进共享代码）✓ 3（不直建 L1）✓ 4/5 ✓ 7 ✓。
- 无 PM 拍板的新支柱/新版本/抽佣事项。

## 2. 目标行为（人话）

1. PM 在后台对「某一版计划」点一次 **「授权自动发布」**（前提：这一版已经审核通过并生成了 no-publish 队列回执 —— 也就是现有两步都做完）。
2. 之后系统每小时看一次：哪些**已授权**的日期**该提交了**，逐条走**现有全部闸门**，通过就提交给 Facebook（FB 按当天时段发出），并写回执、触发已有的效果追踪（T+4h / T+72h）。
3. 任何一步拦下或失败：**不静默**，变成今日待办（说清 what / how / 直达链接）。
4. 没授权、授权被撤、计划被改过（版本变了）：**永远不发**。

## 3. 授权是什么（对齐 Reel，同时守住"审核 ≠ 授权"）

Reel：PM 在后台点「通过」→ 工单状态 `approved` → worker 才领。Post 对齐方式：

- **一次点击，两条记录**：UI 上只有一个按钮「通过并授权自动发布」，但系统写**两个不同的回执**：
  1. 审核回执（已有 `review_meta`，admin + PASS + 清单全过）——只代表"内容过审"；
  2. **新增授权回执 `auto_publish_meta.authorization`**：`authorized_by_user_id`（PM 本人）、`authorized_at`、绑定的 `plan_id / plan_revision / review_revision`、授权的 `dates[]`、`page_id`、`max_per_day`、`request_id`、`provider_impact: 'NONE'`（授权本身不发东西）。
- 授权**绑版本**：计划被重生成/重审，`plan_revision` 或 `review_revision` 变了 → 授权自动失效（worker 逐次比对，不匹配就拒，并出待办"计划改过，请重新授权"）。
- **随时可撤**：「停止自动发布」写 `revoked_at`；worker 在**每次提交前**重读授权，已撤即停。已经交给 FB 的定时帖走现有 `recall` 路由撤回。
- 授权路由要求**全局管理员**（PM），与 post-review 同级。注意：现有 `requirePaidClientAccess` 同时放行 `admin` 与 `paid_client` 两档，手动发布路由因此客户自己也能点；**授权/撤销路由不能用它，要单独要求 `tier === 'admin'`**（待审查确认：手动路由对 `paid_client` 放行是不是本意）；授权事件 `daily_plan.auto_publish.authorized` 发 Inngest。
- **没有授权回执 = 没有任何自动发布**。`approved_by_user_id`（现有回执必填）写**授权的那个 PM**，不造系统账号。

## 4. 架构

```
PM 点「通过并授权」─▶ POST /api/clients/[id]/campaign-daily-plan/auto-publish/authorize
                        └ 写 auto_publish_meta.authorization（CAS）+ 发事件 daily_plan.auto_publish.authorized
Inngest 定时函数 daily-plan-auto-publish（每小时，TZ=Pacific/Auckland，同 competitor-watch 等写法，不用 Render cron、不用 CRON_SECRET）
   for 每个「有有效授权」的 (client, plan)：
     for 每个到期日期 d（见 §5，逐日期单独处理，一日被拦不拖累别日）：
        step.run('claim-d')     ─ 写 attempt 回执（claimed），CAS 防并发
        step.run('publish-d')   ─ 调共用核心 publishReviewedDailyPlanPosts({dates:[d], no_publish: !LIVE})
        step.run('receipt-d')   ─ 写 attempt 结果 + 事件 daily_plan.auto_publish.attempted
   └ 成功后沿用现有 daily_plan.post.published → 效果追踪 / 首评补发（story-resolve），不改
失败/拦截 ─▶ 今日待办（拉模式，参照 price-fact-items.ts）
```

- **抽共用核心**：把路由里「加载计划 → 校验版本 → 组装候选 → 价格闸×2 → 取主页令牌 → 发布 → 首评 → 测量事件 → 写回执」抽成 `src/lib/campaign/daily-plan-publish-runner.ts`。路由只剩「登录鉴权 + 解析指令 + 调核心」（顺手从 810 行降到 800 以下）；worker 走**同一个函数**。**不复制闸门**——这是"自动路径不比手动路径松"的结构性保证。路由现有测试（`publish/__tests__/route.test.ts`）作为抽取前后的行为不变证明，必须原样通过。
- **不新增数据库表/迁移**：授权与尝试回执放 `social_plans.plan_data.auto_publish_meta`（与 `publish_meta`/`publish_queue_meta` 同一做法）。
  - ⚠ 已知风险（请审查者重点看）：`persistReceipt` 现在用「整份 plan_data 覆盖 + 按 publish_meta.request_id 做 CAS」。worker 与 PM 的授权/撤销会并发写同一行不同键，存在**后写覆盖先写**的窗口。缓解方案：所有对 `auto_publish_meta` 的写入统一走一个"读-改-写 + CAS（条件含 auto_publish_meta.request_id 与 publish_meta.request_id）+ 失败重读最多 3 次"的小函数；核心写 `publish_meta` 后，worker 重读再写自己的键。若审查认为这不够稳，备选是**加一张只放尝试回执的小表**（需 PM 批准改库，A 级迁移）。
- **三层开关（fail-closed，默认关）**：
  1. 无授权回执 → 不发；
  2. 环境开关 `DAILY_PLAN_AUTO_PUBLISH_LIVE`（默认未设 = **只演练**：走完全部闸门，`no_publish: true`，不调 Facebook，只写演练回执）——与 Reel 的 `FACTORY_PUBLISH_LIVE` 同一模式；首次真发需 PM 明确说 go 后才在 Render 打开；
  3. 客户白名单 `DAILY_PLAN_AUTO_PUBLISH_CLIENTS`（逗号分隔 client id），不在名单 = 只演练。

## 5. 发什么、什么时候发

- **提交窗口**：worker 只提交 `date ∈ {今天, 明天}`（NZ 日期）的已授权日期。理由：交给 FB 后帖子在 FB 侧"定时"，提前不超过一天，PM 还有时间用 recall 撤回；不一次性把整周塞给 FB。
- **过期不补发**：`date < 今天(NZ)`，或今天的时段已过 → 判 `MISSED_WINDOW`，**不立即发**（现有 `resolvePublishSchedule` 对过期日期会"立刻发布"，worker 必须在调用前拦掉，否则机器迟到一小时 = 旧内容在错误时间上线），变待办"这条没按时发出，要不要改日期重发"。
- **每日上限**：`max_per_day`（授权回执里，默认 1，对应"每天一条图文"；硬上限 3）。同一主页同一 NZ 日期已有**未撤回**的已发/已定时帖达到上限 → 不再提交。
- **时段**：沿用现有行为 **08:00 NZ**，不新增任何关于"几点最好"的说法（我没有证据）。把时段做成客户配置项 `publish_slot_nz`（默认 08:00），CTS 受众偏中老年的最佳时段等 T+4h 效果数据攒够后由 PM 定，不写进共享代码。
- **每小时一次**：整点后第 20 分钟（避开 Reel worker 的第 5 分钟）。

## 6. 失败怎么处理（分三类，决定要不要重试）

| 类别 | 例子 | 处理 |
|---|---|---|
| **确定没发出去、可重试** | Graph 返回明确的限流/临时错误（有错误体） | 自动重试，最多 3 次，退避 10/20/40 分钟，仍在日期窗口内；3 次后转待办 |
| **确定没发出去、重试没用** | 价格闸/首评闸拦截、图片不可用、令牌失效(424)、`PAGE_ID_MISMATCH`、计划/审核版本不匹配、授权已撤 | **不重试**，立刻待办（说明哪条被拦、为什么） |
| **不确定有没有发出去** | 网络超时/连接被断但 FB 可能已收到 | **不自动重试**（防重复发帖）。写 `UNKNOWN_OUTCOME` 回执 + 待办「去主页的已定时/已发布列表核对，没有再点重发」 |

待办三件套（参照 `pm-todo/manual-items.ts` 与 `price-fact-items.ts`，拉模式直接查库，事件丢了也出得来）：
- **what**：哪个客户、哪天的帖、被什么拦了/没发成，影响是什么；
- **how**：具体点哪里（改价格/重新授权/去主页核对）；
- **href**：直达该计划的发布面板。
另加一条"**明天没有已授权的帖子**"提醒，防止授权链断了没人发现。

## 7. 回执与事件（机器可读）

| 事件 | 谁发 | 关键字段 |
|---|---|---|
| `daily_plan.auto_publish.authorized` | 授权路由 | request_id, client_id, plan_id, plan_revision, review_revision, dates, page_id, max_per_day, authorized_by_user_id, created_at |
| `daily_plan.auto_publish.revoked` | 撤销路由 | 同上 + revoked_at |
| `daily_plan.auto_publish.attempted` | worker 每次尝试 | request_id, client_id, plan_id, date, attempt_no, status(`DRY_RUN`/`PUBLISHED`/`BLOCKED`/`FAILED_RETRYABLE`/`FAILED_FINAL`/`UNKNOWN_OUTCOME`/`MISSED_WINDOW`/`SKIPPED_NOT_AUTHORIZED`), reason_code, provider_impact(`NONE`/`FB_SCHEDULED`), cost_usd(0), no_publish, created_at |
| `daily_plan.post.published`（已有） | 共用核心 | 不变 |

## 8. 明确不做

Instagram 图文、Story、改审核清单、改价格闸逻辑、新数据库表、新 Render cron、一周一次性全部提交、多客户同时上线（先单客户 + 演练）。

## 9. 上线与试跑（交付前必做）

1. 单测：授权缺失/过期/版本变/已撤、每日上限、过期不补发、三类失败各一、并发写 CAS、演练模式零 Graph 调用（断言 fetch 未被调用）。
2. 路由抽取：现有 `publish/__tests__/route.test.ts` 原样全绿。
3. **当场试跑**：本地起 Inngest dev + 本机沙盘库，造一份测试计划与授权，手动触发函数一次完整链路，**强制演练模式**（`no_publish`，Graph 调用被替身拦下），PR 正文写「## 当场试跑」（触发方式/时间/退出码/处理几条/回执内容）。**不会向任何客户主页真发。**
4. 首次真发：PM 明确说 go → 在 Render 设 `DAILY_PLAN_AUTO_PUBLISH_LIVE` 与客户白名单 → 只放 1 个客户 1 天 → 次日对照 FB 实际帖子核验（日历提醒）。

## 10. 审查安排（A 级）

设计阶段：子牙（架构）+ 魏征（挑刺）各一次；PM 面对的按钮与待办文案再给板桥看一眼。实施完：补狄仁杰（攻击验证：能否绕过授权/版本/开关发出去）+ 子牙复审。A 级 PR 保持草稿，正文写「风险级别：A」，机器不合，PM 回「合」才合。

## 11. Reuse Statement（设计稿级）

- 复用：`lib/meta/page-posts.ts`、路由现有全部闸门（含两道价格闸、首评、幂等键）、`resolvePublishSchedule`、`daily_plan.post.published` 与效果追踪/首评补发 Inngest 函数、`recall` 路由、`sendInngestEvent`、今日待办拉模式、Reel worker 的"环境开关+白名单+原子领取+退避重试"模式。
- 新增且属平台共享：授权回执与尝试回执契约、共用发布核心、Inngest 定时函数、待办项。
- 行业相关：发布时段（配置项，默认沿用）。客户相关：白名单与授权内容。
- 共享代码里没有任何客户名/客户 ID/行业判断。
- 学习：本轮不产生学习记忆；T+4h 效果数据照旧写入既有测量记录，供以后定时段。

## 12. v0.2 修订（回应子牙 + 魏征第一轮审查）

**审查共识的 3 条阻塞，全部采纳：**

1. **撤销会被冲掉 → 改成新建两张小表，不再放 `plan_data` 大 JSON。**
   `social_plans.plan_data` 有 4 个现有写入者（publish / recall / post-review / publish-queue）整份覆盖，且 CAS 都不含新键，撤销与 claim 回执都会被悄悄冲掉（子牙 B2 / 魏征阻塞 1，两人独立推出同一结论）。
   - `daily_plan_auto_publish_auth`：授权行（plan_id, plan_revision, review_revision, page_id, dates, max_per_day, authorized_by_email, authorized_at, expires_at, revoked_at, revoked_reason）。撤销 = 单行单字段 UPDATE。
   - `daily_plan_auto_publish_attempts`：尝试行，`unique(plan_id, date)`，状态 `claimed / published / blocked / failed_retryable / failed_final / unknown_outcome / missed_window / dry_run`，含 request_id、provider_impact、reason_code、attempt_no、next_retry_at。claim = 唯一约束插入，天然原子。
   - 两张表走 service-role RLS 模板（`FOR ALL TO service_role USING (true)`），**这是 A 级数据库迁移，须 PM 明确批准后才能做。** 不动现有 4 条写入路径。
2. **撤回后会被重发 → 撤回即墓碑。** worker 与共用核心把 `recalled[]` 里的日期当终态（永不自动再发）；recall 路由成功后同步把该日期在 attempts 表标 `blocked(recalled)` 并撤授权对应日期。恢复要 PM 重新授权。
3. **step 重试致重复发帖 → claim 在前、发布 step `retries: 0`、把异常变数据。**
   - 调 Facebook **之前**先插 `claimed` 行；`claimed` 但没有结果的行，下一轮一律判 `unknown_outcome`，**不重试**；
   - 核心不再对外抛异常，一律返回结构化结果；Inngest 函数 `retries: 0`、`concurrency: {limit: 1}`；
   - `lib/meta/page-posts.ts` 需**小改**（增量）：加请求超时，错误带 HTTP 状态/`code`/`subcode`/「是否到达 Graph」，让"确定没发出去"可判定；原有调用方行为不变（v0.1 §11 说"只复用不改"，更正）；
   - 「同一幂等键在 `failed[]` 出现过」按不确定处理，不自动重发。

**必改项处置：**
- **授权人**：只认 `isGlobalAdminEmail`（`ADMIN_EMAILS` 精确名单），不用 `tier==='admin'`（演示号/受限管理员/公司域名都会冒充 admin）；授权带 `expires_at`（默认 14 天）；worker 每次提交前复核授权人仍在名单。
- **授权前先演练给 PM 看**：授权路由先跑完整闸门演练，展示最终正文、首评、发布时间、图；任何闸不过 = 不让授权。并改口径：授权的前提是**全部日期已逐项审核完并有入队回执**，按钮是「授权自动发布」，不是"一键审核"（v0.1 §3 的"一次点击两条记录"作废）。
- **撤销 ≠ 撤下已交给 FB 的帖**：撤销界面必须明说，并列出「已提交未公开」的帖，旁边给「撤回」入口（现有 recall）。
- **整批暂停口径保留**：PM 定的是"一条被拦整批暂停"。worker 提交任何一天前，先对该计划所有仍待发日期过全部闸门，任何一天被拦 = 整份计划暂停 + 一条待办。（v0.1 逐日期放行作废。）
- **campaign 归档 / 客户暂停合作**：worker 提交前必读这两个状态，不是活跃就不发。
- **"版本变了请重新授权"是死路**（现有入队回执一旦存在，同计划行无法再写新版本，只能新建 campaign）：待办文案如实写"这版计划已被改动，需新建计划并重新审核授权"，不假装有一键重授权。
- **`date_offset_days` 强制 0；`now` 由 worker 传入核心；核心加 `allowImmediate:false`**：核心自己判定 `publishNow` 即返回 `missed_window`，worker 不复制 15 分钟魔数；NZ 日期一律 `Intl Pacific/Auckland`，夏令时两个切换日各一条测试。
- **核心取授权人**：`approved_by_user_id` 由调用方传入核心（核心不自己读会话）；授权表存授权人 email 与其 user id。
- **每日上限**：只承诺"**本计划内**每个 NZ 日期不超过 max_per_day"，按 attempts 表的 `scheduled_publish_time`（NZ 日期）统计；不声称管到别的 campaign / Reel / 手动发布（要管得先去 FB 读，另立项）。
- **PM 可见性**：授权与待办界面显示当前模式（演练/真发）；`DAILY_PLAN_AUTO_PUBLISH_LIVE` 只认严格 `=== 'true'`；函数写 `cron_run_logs`；另设**独立于 worker 的拉模式看门狗**："已授权、24 小时内到期、没有任何尝试记录" → 出待办。
- **待办分车道**（`five-kinds.ts` 的 `LANE_OF_KIND` 穷举表）：被拦/失败/不确定/错过窗口 → 今日待办（"需要你动手"）；"明天没有已授权帖子" → 周报，不进今日待办（PM 2026-09-26 口径）。去重：与现有 `price-fact-items.ts` 同一问题只出一条（价格拦截待办复用它，不新增）；`missed_window` / `blocked` 按 (plan, date, reason) 去重；`unknown_outcome` 提供「已去主页核对：已发出 / 没发出」两个按钮收口（写 attempts 行），否则永久挂着。
- **两道价格闸判的文本不一致**（路由判 `[message, firstComment]`，待办扫描用 `buildPostPriceText`）：实现时对齐成同一个函数，列入后续事项并加测试，**不在本轮悄悄改闸逻辑**。
- **抽核心的 5 个易变点**写成测试：闸在 token 查询之前（闸拦下时 token 与 fetch 零调用）；dry-run 零副作用；persistReceipt 的 CAS 基准用同一次读到的 row；授权人由调用方传入；手动路径行为不变（现有 route 测试原样绿）。
- **不顺手动的**：手动发布路由对 `paid_client` 放行是否本意（魏征必改 2）——**不在本轮改**，单开台账卡请 PM 另行决定；本设计只保证"自动发布"这条路只认全局管理员。

**调度载体**：保留 Inngest 定时函数（CLAUDE.md §3 要求跨步骤接力走 Inngest；不新建 Render cron 服务，避开 CRON_SECRET 坑）。子牙倾向"挂在现有 factory-publish-worker 路由"，理由是改动最小；两条都站得住，**我选 Inngest，实现前由子牙二审时再拍一次**。

**试跑补强**（魏征建议）：除本地演练外，需要一次**真实 Graph 试跑**——在**非客户测试主页**（若有）上"远期定时 + 立即撤回"；没有测试主页则降级：首个真发客户只放 1 天、PM 当面看着、发完立刻对账（要 PM 给 go）。

**工作量与风险（给 PM 的判断依据）**：新增 2 张表（A 级迁移）、改 `page-posts.ts`（增量）、抽取 810 行发布路由、新增授权/撤销/确认 3 条路由 + 1 个 Inngest 函数 + 待办 + 面板按钮。属**大任务**，建议分三刀（见 §13）。

## 13. 建议的交付顺序（每刀都能单独验收、单独回滚）

1. **刀一（纯结构、零新行为）**：抽共用发布核心 + `page-posts` 结构化错误/超时；现有测试原样绿；不动数据库。
2. **刀二（A 级迁移）**：两张表 + 授权/撤销/确认路由 + 授权前演练 + 撤回墓碑联动；仍然**没有任何自动发布**。
3. **刀三**：Inngest 定时函数 + 待办 + 看门狗 + 面板按钮；默认只演练；PM 说 go 才开真发，先 1 个客户 1 天。

## 14. 第一刀审查后的校正（2026-10-10）

- 第一刀**不加 45 秒超时**（超时会新增"失败但其实发出去了"的记录，子牙/狄仁杰均指出）。超时与「失败回执记录 certainty、`unknown` 不得被重发（含手动路径的幂等分区）」**必须在第三刀加自动重试之前**一起上，且是第三刀的前置条件。
- `rejected` 判定收紧：仅 400/401/403/404/422 且带 Graph 错误体、code 非 1/2。

## 15. 第二刀范围校正（2026-10-10）

- 第二刀**不做面板按钮**：没有自动发布程序在跑之前，界面上出现「授权自动发布」会让人误以为已生效。按钮与待办提醒放第三刀，随程序一起上。
- 「确认已核对（unknown_outcome 收口）」接口也放第三刀（第二刀里不会产生 unknown 行）。
- 授权接口回包带 `note: "Recorded only. The automatic publisher is not running yet."`，第三刀移除。
- 授权事件发送失败会回滚授权；回滚本身也失败时，回包明说 `rollback: FAILED` 并提示手动撤销（授权可能仍然有效）。
- 撤回联动：撤回成功后把对应日期写成 `blocked / RECALLED` 的尝试行（唯一键 `(plan_id, date)` 让它不可能再被领取），并从授权日期里剔除；全部日期都撤回则授权整体作废。写失败不影响撤回本身，但回包 `auto_publish_tombstone: FAILED` 明说；第三刀 worker 另外把回执里的 `recalled[]` 当终态，双保险。

## 16. 第二刀审查后的改动与第三刀前置条件（2026-10-10，PR #2430 三位审查）

**本刀已改：**
- 撤销/读取授权都按「计划 + 客户」过滤，撤销可按授权编号精确撤（防止误撤新授权）。
- 授权表加 `activated_at`：先写未激活的行 → 发事件 → 再激活；事件或激活失败按 id 回滚并明说回滚是否成功。`judgeAuthorization` 把未激活判为不可用（`NOT_ACTIVATED`）。
- 授权前先核对 `clients.facebook_page_id`（只读，无令牌）；拒绝过去日期；已撤回的日期必须由 PM 在 `lift_recalled_dates` 里明确点名才能再授权，且解除动作在授权成功之后才执行。
- 撤回写墓碑不再依赖"当前有授权"（撤销后再撤回也留墓碑，`auth_id` 可空）；有日期正在发（`claimed`）时拒绝覆盖，并让撤回回包明说失败。撤回回包不再带内部错误原文。
- 过期/计划已变/半成品（超 5 分钟未激活）的旧授权，不再让新授权报 `ALREADY_AUTHORIZED`，自动作废后重建。
- 授权/撤销只认「全局管理员且不限定单个客户」；500 回包只给固定文案。
- 从未发过帖的计划，撤销回包的「在途」是已核对的空列表，不再误报 UNKNOWN。

**第三刀的硬前置条件（不满足不许开真发）：**
1. worker 以 `publish_meta.recalled[]` 为终态依据，**不依赖**墓碑表（双保险），并有测试。
2. worker 只认 `activated_at` 非空、且 `judgeAuthorization` 为 active 的授权；所有读授权的地方（含「明天有没有授权」检查）都必须过 `judgeAuthorization`，不得只看 `revoked_at is null`。
3. worker 写 attempts 必须条件更新（`where status='claimed' and request_id=本次`），否则迟到的 worker 会覆盖墓碑。
4. 新授权开始前要清理旧授权遗留的非「粘性」尝试行：`unknown_outcome / published / RECALLED` 继承，`missed_window / blocked(价格拦截) / dry_run` 不继承；`dry_run` 行不得占住真发的领取。
5. 超时 + 失败回执记 certainty + `unknown` 不得被重发（沿用 §14）。
6. 撤销后「在途帖」要能重复查询，非空时出待办；预览与确认之间的内容绑定（图片被换/价格资料被改）记作后续项，第三刀评估。
7. campaign 归档/客户暂停合作时 worker 不发。

**第二刀二次复审补充（子牙，2026-10-10）：**
- 授权表增加 `lifted_dates`（PM 点名解除撤回墓碑的日期，授权时写入）。第三刀 worker 的规则定为：「`publish_meta.recalled[]` 是终态，**除非**该日期在当前有效授权的 `lifted_dates` 里」——否则解除功能与「以 recalled[] 为终态」互相矛盾。
- 墓碑写入本身也要条件写（先插入忽略重复，再对 `status <> 'claimed'` 的行更新），防止检查与写入之间 worker 插入 `claimed` 被覆盖；与 worker 的条件更新是对称的两半。
- 「全部日期被撤回」触发的授权作废，现已按授权编号精确作废。
- 今天这一天过了新西兰 08:00 也必然是 `missed_window`：第三刀 worker 判定，授权接口只拦「早于今天」。

**第二刀三次复审补充（魏征，2026-10-10）——已改 + 第三刀验收项：**
- 已改：授权接口判断「已撤回」同时看墓碑表**和**计划回执里的 `recalled[]`（任一命中都拦；墓碑写失败也拦得住）；解除墓碑只删「读取时刻之前写入」的块；墓碑写入不覆盖 `unknown_outcome` 行；被顶替的旧授权会发一条 `revoked` 事件（尽力而为）。
- **解除的最终规则（取代前面的 §16.1 写法）**：`publish_meta.recalled[]` 是终态，**除非**该日期出现在当前有效、已激活授权的 `lifted_dates` 里。解除记录留在授权行上（谁、何时、哪些日期），不是删了就没有。第三刀 worker 与「明天有没有授权」检查都按这条规则，并配测试：解除后放行、没解除不放行、解除后再次撤回又被拦（再次授权必须再次点名解除）。
- 补充 §16.3：worker **发帖前**必须再校验一次自己仍持有 claim（`status='claimed' and request_id=本次`）；发帖后写回时发现 claim 已丢，必须记录 post_id、告警并转人工，不能静默。墓碑写入也要做条件写（先插入忽略重复，再对非 `claimed` 行更新）。
- 补充 §16.6 验收：撤销后再次查询仍能拿到同一份在途列表，并合并 attempts 里 `claimed / unknown_outcome / FB_SCHEDULED` 的行；非空要出待办。
- 补充 §16.7 验收：授权过期后 worker 不发（`judgeAuthorization` 已实现，测试覆盖）。
- 部署顺序提醒：先建表，再上这版代码；否则撤回会在日志里报「表不存在」（撤回本身仍成功，回包带警告）。

**魏征四次复审补充（第三刀验收项，2026-10-10）——worker 判「已撤回」分两层：**
1. attempts 表里只要有该日期的 `blocked/RECALLED` 行，一律不发，**不看** `lifted_dates`（防止解除后又被再次撤回的日期被放行）。
2. 没有墓碑行时，再看回执 `recalled[]`：命中且日期不在当前有效授权的 `lifted_dates` 里 → 不发。
3. 验收测试：授权行含某日期的解除记录、同时存在更新的墓碑行 → worker 不发。

## 17. 第三刀 a（后台部分）实际做了什么（2026-10-10）

- **发布核心补齐**：失败回执带 `certainty`（拒绝/限流/不确定）；**请求超时只在无人值守的发布器里启用**（手动发布保持原样，不加超时——子牙发现否则手动超时会留下「可能已发出」却无记录的重复发帖风险）；`allowImmediate:false`（时间已过 → `MISSED_WINDOW`，绝不迟发）与 `now` 由调用方统一传入。手动发布行为不变（默认仍允许立即发）。
- **发布器**（`daily-plan-auto-publish-worker.ts`）：每小时第 20 分钟（新西兰时间）扫一遍所有「已激活、未撤销、未过期」的授权；只看今天和明天；授权版本、客户/活动是否有效、撤回（墓碑 + 回执两层，解除记录在授权行）、已发/重试/不确定等状态全部按 §16 的规则判断；先把整份计划的闸门演练一遍，任何一天被拦就整份暂停；逐日期先「抢占」一行记录再发，发帖前再确认授权没被撤。
- **默认只演练**：`DAILY_PLAN_AUTO_PUBLISH_LIVE` 必须严格等于 `true` 且客户在 `DAILY_PLAN_AUTO_PUBLISH_CLIENTS` 名单里才会真发；否则走完全部检查、不抢占、不发、不写库。
- **失败不静默**：被拦/多次失败/时间已过/不确定 → 今日待办（拉模式，`auto_publish_*` 三类）；「已授权却没动静」看门狗；「不确定」由 PM 用 `confirm-unknown` 接口登记真相（发出/没发出）。
- **本次明确没做（留给 3b 或后续）**：授权/撤销/确认的**界面按钮**与「当前是演练还是真发」的横幅（界面上线前要过 Impeccable，需先获准下载检查程序）；「明天没有已授权帖子」周报提醒；撤销后可重复查询在途帖、预览与确认之间的内容绑定；每次授权清理旧授权遗留的非粘性尝试行（§16.4）——当前 attempts 表一计划一日期一行，新授权要用新计划，旧计划的行不影响新计划，所以暂不构成风险，但要在 3b 前复核。
- **每日上限**：因唯一键是 (计划, 日期) 且 `date_offset_days` 固定 0，同一计划同一天结构上最多一条；`max_per_day` 目前只是记录值，不跨计划/跨活动统计。

**子牙对 PR #2435 的复审（2026-10-10）——已改：**
- 手动发布失败且结果不确定（`failed[]` 里 `certainty` 为 unknown/缺失）的日期，发布器**一律不再自动发**，登记为 `unknown_outcome`（原因 `RECEIPT_FAILED_UNKNOWN`）进今日待办，等 PM 去主页核对。
- 发帖前**两次**复核：领取之后立刻复核一次授权与自己的占位；发布核心在真正调用 Facebook 前一刻再复核一次（`beforeSend`）。任一不成立 → 本日期记 `blocked / ABORTED_BEFORE_SEND`，没有发出任何东西。
- 写结果时发现占位已被改（post 可能已发出）→ 运行日志记 `error`，并带上 post id，不再只是备注。
- 客户状态改为**只有 `active` 才发**（`prospect`、读不到都不发），与活动状态一致；上线前要确认哪些客户是 active。
- 授权人必须仍是全局管理员；撤回发生在授权之后（或读不到撤回时间）则「解除」作废。
- 仍留待 3b 的建议项：待办里同一客户多种状态分开出、看门狗对「手动已发」「活动停用」的误报、`blocked` 每小时重复事件、整个扫描拆成每计划一个 step。

**魏征对 PR #2435 的复审（2026-10-10）——已改：**
- 价格类拦截（`PRICE_*`）**照样出今日待办**（每日计划里没有别的待办覆盖它）；「不确定有没有发出去」**不设日期下限**，必须一直出现到有人确认；同一客户的「不确定」与「其他失败」分成两条，互不遮挡；其余失败只看最近 14 天。
- 回执里已有该日期、但我方记录卡在 `claimed`（写回失败）→ 下一轮自动把记录改成 `published`（带回执里的 post id）。
- 被拦原因与上一轮相同 → 不再重新占位、不再重写、不再发事件（以前每小时一遍）。
- **新授权开始时清理旧授权遗留的「还没 / 这次没成」类记录**（`missed_window / failed_final / failed_retryable / dry_run / 非撤回的 blocked`），保留 `published / unknown_outcome / claimed / RECALLED`——所以「同一计划撤销后重新授权」不再被旧记录卡住（§16.4 落地，§17 里「旧计划的行不影响新计划」的说法作废）。
- 「解除撤回」现在也会清掉该日期遗留的 `published` 记录（帖子撤回后那条记录已经过时）。
- **手动发布与自动发布互斥**：手动发布前检查自动发布器是否持有这些日期的新鲜占位（15 分钟内），有就拒绝（`AUTO_PUBLISH_IN_PROGRESS`）；读不出占位时也不发（失败即停）。

**仍留待 3b / 后续（明确记账，不假装已做）：**
- 发帖后发现占位被改（极窄的竞态）时，目前只记入运行日志并计为错误、带 post id，**没有进今日待办**。
- 撤回接口与「撤销后的在途列表」还不读我方 attempts 表里的 post id（`RECEIPT_NOT_PERSISTED` 记为已发布的那类帖子在这两处看不见）。
- 看门狗的误报（PM 手动发过的日期；活动停用/授权人离职导致的跳过）与文案按客户而非总开关判断；`max_per_day` 仍是只记录不执行的字段，界面上线前要说明；重试实际等到下一个整点后的第 20 分钟（至少约 1 小时，不是 10/20/40 分钟）。
- 整个扫描是一个 step，真发多日期时可能超时；建议拆成每份计划一个 step。

## 18. 真发开关打开之前的硬前置清单（三位审查共识，2026-10-10；PR #2435 之后、PM 说 go 之前必须逐项完成）

默认只演练，不设 `DAILY_PLAN_AUTO_PUBLISH_LIVE=true` 与客户白名单，什么都不会发。下面每一项没完成，就**不许**设这两个环境变量：

1. **（已做，PR 见台账卡 golive-prereq1）丢占位要进待办**：发帖后写回时发现占位已被改，或写回本身抛错——现在只进运行日志（计 error、带 post id）。要做成拉模式待办（例如：墓碑/占位行与回执 `published` 同日期冲突）。
2. **（列表部分已做，台账卡 golive-prereq2；「手动发布也写占位」的双向互斥与「手动发布遇到未确认日期要拦」仍未做）手动发布、撤回、撤销后的「在途」列表都要读自动发布器的记录**（`published / unknown_outcome / claimed` 的 post id）；手动发布最好也写占位，让互斥变成双向（目前只有「手动发布前看自动发布有没有新鲜占位」这一向，检查与发送之间仍有一个很窄的窗口——不宣称「完全互斥」）。
3. **看门狗**：PM 手动发过的日期不报；活动停用/授权人离职导致的跳过用准确文案；「演练还是真发」按客户判断，不是看总开关。
4. 复合过滤语法已用线上真实数据库只读验证（接受）；**真发前还要在沙盘里真执行一遍 delete/update 版本**。
5. 占位时刻已改为真实领取时刻（本 PR 已做）。
6. **第一个上线客户的 `client_status` 必须是 `active`**（`prospect`、读不到一律不发——例如仓库里标为 prospect 的客户不会被自动发布）；并**扫一遍线上回执里 `failed[]` 无 certainty 的旧失败日期**，它们若落在今天/明天窗口里会被停放为「不确定」，需要 PM 逐条确认。
7. `max_per_day` 目前只记录不执行：界面上要隐藏或说明。
8. 部署端确认函数超时配置，或把扫描拆成每份计划一个 step。
9. 解除撤回时只删「比撤回更早」的 `published` 行（目前按读取时刻判断）。
10. 单日占位丢失（别人墓碑了这一天）已改为只放弃这一天、继续其他日期；授权被撤才停整份计划（本 PR 已做）。
