# 图文 Post 自动发布「最小版」设计稿 v0.2（与 Story 最小版并列的姊妹模块；已吸收子牙+魏征第一轮审查）

- **日期**：2026-10-14 ｜ **窗口**：90 号 ｜ **风险级**：**A**（对外发布的副作用）
- **状态**：只出方案，**不写代码、不建表、不传图、不开任何开关**。PM 10-14 经 74 号转达回「做 Post 最小版」，批准的只是「写这份设计稿 + 建表 SQL（不执行）」。
- **基线**：HEAD = origin/main = `08977a412`（2026-10-14 本机核实）。
- **v0.1 → v0.2**：子牙判「需改后再审」（4 条必须改）、魏征判「需改后再审」（9 条必须改），全部已并入；改动点集中在 §3（表字段）、§4（发前检查与失败隔离）、§5（首评抢占/`post_id` 来源/演练口径/人工结案）、§9（验收顺序）、§11（风险补写）。
- **建表 SQL**：已写好并在本机临时 Postgres 17 真执行验证过（见 §9 第 1 行），**不放进本 PR**（带 SQL 文件的 PR 会被风险闸判 A 级、要 PM 本人回「合」）。**建表 SQL 随「执行建表」那一刀一起提交**——那时本来就要问 PM，一次问完。字段与约束以 §3 为准。
- **平台层级（Tier Gate · Inline）**：属于既有「社媒」支柱的 Act 段；发布走既有 Meta 发布接口（L3），不新增能力线、不新增支柱。

---

## 0. 给 PM 的一页话（大白话）

**要解决的事**：CTS 每天要发 2 条图文 Post，不想再让员工手动发。你只想「看总览、点一次授权、出事回一句话」。

**为什么不用现成的「每日计划」**：每日计划按「一个推广活动=一个网址=正好 7 天」设计，一周只能讲一个团；每天 2 条、4 个团轮着发的周包塞不进去，硬塞要每周新建 4 个推广活动。所以不改它。

**做法**：照 Story 最小版的样子再做一个并列的小模块——「图文 Post 周包」。
- 每周一个「周包」，里面每条 Post 一行：图、正文、首评（带官网链接和追踪参数）、几点发、来源。
- 你在预览页看一遍，点一次「授权这一周」。没点、点了停、过期，都不发。
- 系统每 10 分钟看一次，到点就发；发出去后马上在第一条评论放链接。
- 晚了超过 20 分钟就放弃，不补发；结果不明就不重发，直接进今日待办让你去主页看一眼。
- 默认只演练（走完全部检查但不碰 Facebook）；真发要你说 go，另外还要一个客户名单开关。

**发之前系统会自己拦的**（拦住就发不出去，授权按钮也点不了）：
1. 图文件被换过、文字被改过（和你预览时看到的不一致）。
2. 文案里写了价格，但图的来源背不了真价，或价格和客户资料对不上（沿用现有的两道价格闸，不重写）。
3. 正文里带了链接；首评链接缺 4 个追踪参数。
4. 同一周内、或近 30 天内已经发过（含「发出去了但结果不明」的）完全相同的图（「第一帧不撞脸」的程序部分——程序只认文件完全相同；缩放/重压缩过的同一张图、画面像不像，由画面审查员判）。
5. 标成「纯文字卡」的条目（原则上不做）。

**一个你要提前知道的现实**：周包里 4 条带价格的文案，配的是图库图/来源不明的图，**现有价格闸大概率会拦它们**（我读代码推出的，没跑过）。不绕过。要么把价格从正文里去掉，要么把那张图登记进素材库并确认成客户实拍。这是你的决定，不是我的。另外：价格如果印在图片里，程序看不见，必须由画面审查员查。

**怎么分几次做（每次你都能叫停、能回滚）**：① 设计稿（本稿）；② 核心判断，在本机真数据库里把整条链跑通（假 Facebook，不碰线上）；③ 你同意建表 + 传演练图之后：接口 + 每 10 分钟扫描，默认只演练，先用一个演练包走一遍；④ 预览页 + 授权/停止按钮 + 周包导入；上线前清单走完 + 你说 go 才开真发。**每一步不做的事、需要你点头的事**见 §8、§9。

**你要点头的事（一次一件，不会一起问）**：对线上库建 2 张表 → 把演练图/周包图传到公开存储并登记进素材库 → 真发开关 → 每个 A 级改动回「合」。

---

## 1. 先对照代码核实（我读的，不是信文档）

| 事实 | 出处 |
|---|---|
| 每日计划一份 = 7 天 × 每天 Post+4帧Story+Reel 齐全，7 张图不重复 | `src/lib/campaign/daily-plan.ts` `CampaignDailyCommandSchema` |
| 每条 Post 链接必须等于所属推广活动的那一个网址 | `src/app/api/clients/[id]/campaign-daily-plan/route.ts`（`CTA_URL_MISMATCH`） |
| 计划进了发布队列/发过就锁死，下周要新建推广活动 | 同上 `receiptBlockingOverwrite` |
| 记录表唯一键 `(plan_id, date)`，一计划一天最多 1 条；发布时间写死新西兰 08:00 | `supabase/migrations/20261010100000_daily_plan_auto_publish.sql`、`daily-plan-publish.ts` `nzMorningUtc` |
| Story 最小版：2 张表、授权绑内容指纹、先抢占再发、每 10 分钟、`earlyMinutes 5 / maxLateMinutes 20 / staleClaimMinutes 15` | `src/lib/social/story-lite/*`、`docs/specs/2026-10-12-story-lite-design.md` |
| 图文件只许从自己的公开存储下载并比对 sha256（别的域名一律不碰） | `story-lite/ports.ts` `mediaHosts()` + `story-publish/file-check.ts` |
| 即时发图**通常**返回 feed 帖的 `post_id`（首评可当场写）；若 Facebook 只回照片对象 `id`（`postIdSource='id'`），那不是帖子 id，以它发首评会因页面前缀校验失败而抛错 | `lib/meta/page-posts.ts:513-536` `publishPagePhotoPost`、`lib/meta/first-comment.ts:52` |
| 首评共用写入器自带幂等标记：**串行**重复调用不会发两条；并发重叠、或评论超过扫描页数时不保证（先读后发） | `lib/meta/first-comment.ts` `ensureFacebookFirstComment`（`maxPages` 默认 5、无请求超时） |
| 价格闸两道：真价配真图（`client_assets.source`；按 URL 回查查不到=来源不明，且同 URL 多行时取哪行不确定，所以每日计划线改为拿素材行直接判，见 `daily-plan-publish-runner.ts:314`）+ 价格数字对客户资料（读失败即抛） | `lib/content/price-claim-gate.ts:44-97`、`lib/content/price-fact-gate.ts`、`campaign/daily-plan-publish-runner.ts` |
| Story 发布扫描：先抢占靠条件更新（`supabase-store.ts:284-311`）；窗口外条目直接 `SKIPPED_NOT_DUE`、不跑检查不写记录（`sender.ts:235-283`）；`checkFile` 单独包了 try，其余检查和 `sweepPack` 没有逐条隔离；演练 `runRehearsal` 会写 `last_check_*` 并发事件 | `story-lite/sender.ts`、`supabase-store.ts` |
| 正文不含链接检查、首评 4 个追踪参数检查 | `campaign/daily-plan-first-comment.ts` `dailyPlanPostLeaksCta` / `buildDailyPlanAutoChecks` |

## 2. 方案总览：并列模块，不碰 Story、不碰每日计划

```
周包 JSON/表格 ──导入脚本──► post_packs + post_items (PENDING，未授权)
                                   │ 预览（图/文/首评/时间/问题清单 + content_hash）
                      PM 点「授权这一周」(全局管理员，带 content_hash)
                                   │
        Inngest 每 10 分钟扫描 ──► 到点 ±(早5分/晚20分) 的条目
                                   │ 发前检查（见 §4）→ 先抢占(CLAIMED) → 发图(立即发布) → SENT + 回执
                                   │                                         └► 首评（共用写入器，标记幂等）
                                   └► 事件回执 post.item.attempted → 今日待办（拉模式）
```

- **同构于 Story 最小版**：同一组状态 `PENDING/CLAIMED/SENT/UNKNOWN_OUTCOME/FAILED/BLOCKED/MISSED`、先抢占再发、结果不明不重发、默认只演练+双开关、授权绑内容指纹、预览指纹确认、仅全局管理员、撤销=停没发的。
- **Post 比 Story 多的三样**：① 首评（含该条自己的追踪链接）；② 价格两道闸；③ 图的来源（`client_assets.source`）。
- **立即发布，不用 Facebook 定时托管**：到点（±窗口）才调发图接口，拿到 `post_id` 当场发首评，不需要「等定时帖变公开再补首评」那条异步链（`daily-plan-post-story-resolve`）。代价：真发时刻是扫描时刻（最多晚 10 分钟），所以到点判断用 Story 同一套窗口。

## 3. 数据（两张表；建表 SQL 随执行建表那一刀提交）

`post_packs`：与 `story_packs` 同形（授权/撤销都在一行，全有或全无约束）。
`post_items`：在 `story_items` 基础上——去掉 `media_kind/text_line`，新增
`visual_kind`（`photo`/`text_card`）、`message`（正文）、`first_comment`（首评全文，含链接）、`asset_id`（图在素材库里的那一行，价格闸读它的 `source`）、`asset_source`（预览/授权时看到的来源，入指纹；发送前重读，变了就 `BLOCKED(ASSET_SOURCE_CHANGED)`，授权后改素材标签解不开价格闸）、`role`（仅展示）、`fact_refs`（仅留痕）、`first_comment_status`（`NONE/POSTING/POSTED/FAILED/NEEDS_HUMAN`）、`first_comment_id/reason/attempts/attempted_at`；
约束：`SENT` 必带回执；`UNKNOWN_OUTCOME` 允许带回执（人工核对后可结案）；首评只在 `SENT` 后存在；`CLAIMED` 必带领取时间；`BLOCKED/FAILED/UNKNOWN_OUTCOME/MISSED` 必带原因码；`unique(pack_id, media_sha256)`；`(pack_id, client_id)` 复合外键（条目与所属包客户不可不一致）。
`source_ref`、`account_id` 含义与 Story 相同（官网页 https；Facebook 主页号）。**RLS 一律 `TO service_role`**。无外键到别的业务表；回滚=删两张表，没有别的东西引用它们。

## 4. 发前检查（预览时跑一遍并挡授权；发送前贴紧再跑一遍）

**指纹覆盖的字段（授权时存、发送前重算）**：`item_id, pack_id, client_id, channel, slot_at(规范化), media_url, media_sha256, visual_kind, asset_id, asset_source, message, first_comment, account_id, source_ref`。任何一个变了，预览指纹就对不上，授权被拒；授权后被改，该条 `BLOCKED(FINGERPRINT_CHANGED)`。（`role`、`fact_refs` 只是展示/留痕，不入指纹，改了不影响发什么。）

硬拦（`BLOCKED`，不发，进待办；预览里挡授权）：
1. 授权/过期/撤销/客户 active/页面号与 `clients.facebook_page_id` 一致（沿用 Story 做法）。
2. 指纹一致；图文件 sha256 与存的一致（`checkMediaFile`，只许自家公开存储域名）。
3. **价格两道闸，每次发送前都重新读，不信预览那次**：
   - 真价配真图：用 `post_items.asset_id` 那一行 `client_assets.source` 直接调 `judgePriceClaimWithSource`（不按 URL 回查）；同时校验该行 `client_id` 一致且 `storage_url` 与 `media_url` 逐字相同，否则 `BLOCKED(ASSET_MISMATCH)`。
   - 价格数字对客户资料：`judgePostPriceFacts`，`ctaUrl` 传首评里的官网落地页链接。**读库失败 ≠ 拦截**：回到 `PENDING`（窗口内下一轮再试），超窗按 `MISSED`；只有「读到了且对不上」才 `BLOCKED`。
   - 判定文本 = 正文 + 首评（与每日计划同口径）。不绕过、不加豁免开关。
   - **闸只看文字。价格印在图片里的，程序看不见——画面审查员必查（写进预览检查清单）。**
4. 正文无链接/追踪参数（`dailyPlanPostLeaksCta`）；首评链接为 https、含 `utm_source/medium/campaign/content` 四参数、`utm_content` 以条目编号前 8 位开头、链接主机与 `source_ref` 主机一致。
5. 「第一帧不撞脸」程序部分：同包内图指纹不重复（DB 唯一约束）；同客户近 30 天内 `post_items` 里状态为 `SENT / CLAIMED / UNKNOWN_OUTCOME` 的条目（排除自己），以及**其它已授权、未撤销、未过期的包里 `PENDING` 且 `slot_at` 更早**（同一时刻按 `item_id` 小者在先）的条目，没有相同 `media_sha256`。只比「在先者」，所以两个同图的 `PENDING` 条目不会互相拦死，只拦后到点的那条。已撤销/已过期的包不计入。授权接口里再查一次。预览里对同客户 `story_items.media_sha256` 相同的给**软提示**（Story 与 Post 画面规格不同，不硬拦）。**程序只认文件完全相同；缩放/重压缩过的同一张图、画面相像，程序判不了，v1 不做感知哈希，由画面审查员在预览时判。**
6. `visual_kind = 'text_card'` → 预览标红并挡授权（「原则上不做」）；v1 没有放行开关，要放行得先改设计稿。
7. 发送窗口：早于 slot 5 分钟不动；晚于 20 分钟 `MISSED`，不补发。
8. **人工手动发布重复的程序缓解**：发送前只读拉主页最近帖子（`fetchPagePosts`），正文首句或图相同 → `BLOCKED(DUPLICATE_SUSPECTED)`。**能不能做取决于现有主页令牌读帖子的权限——未核实**，第 3 步开工前先核；核不通就退回「流程规定 + 客户级暂停开关」（`POST_AUTO_PUBLISH_CLIENTS` 去掉该客户即一键停，不用改库）。上线前清单硬项：确认每日计划自动发布线对 CTS 保持关闭。

**失败隔离（照 Story 的缺口补，不照抄）**：每一项检查、每一条条目各自 `try`；检查本身抛错 → 条目回到 `PENDING`（还没抢占）或释放抢占，写 `last_check_result = CHECK_ERROR`，**绝不**因为一个检查抛错而留下 `CLAIMED` 空转 15 分钟变成 `UNKNOWN_OUTCOME`，也**绝不**中断同一轮里其它条目。所有对 Facebook 和首评的请求都带超时（首评通过注入带 `AbortSignal.timeout` 的 `fetcher`）。

软提示（只在预览显示，不挡）：`role`、`fact_refs`、同一天条数、与 Story/Reel 同日提醒。

## 5. 发送与回执

- 先抢占（原子条件更新，抢不到就不发）→ 发送前**紧贴着**再查一次授权/撤销/指纹/价格闸 → `publishPagePhotoPost`（立即发布，`timeoutMs: 45_000`）→ 写回。
- **只有 `postIdSource === 'post_id'` 才当 feed 帖 id 用**：写 `SENT + provider_receipt(post_id) + provider_receipt_kind='feed_post'` 并发首评。**回读、巡检对账、将来的自动下架（87 号 5A）一律只认 `feed_post`；`photo_object` 的条目一律走人工。**若只拿到照片对象 `id`：仍记 `SENT`（帖子确实发出了）并保存该 id，但 `provider_receipt_kind = 'photo_object'`、`first_comment_status = NEEDS_HUMAN`（原因 `POST_ID_NOT_FEED`），进今日待办，不当场发首评、不假装回执能和主页对上。
- 失败分类沿用 `PagePublishError.certainty`：明确拒绝 → `FAILED`；限流 → 退回 `PENDING`（窗口内再试）；不确定/超时/抢占后挂了 15 分钟 → `UNKNOWN_OUTCOME`，**永不自动重试**，进待办。发出后写库失败 → `UNKNOWN_OUTCOME(SETTLE_FAILED)`，并把拿到的 post id 一并存进 `provider_receipt`（表约束允许）。
- **`UNKNOWN_OUTCOME` 的出口**：PM（或 74 号转达）去主页核对后告诉我「发出了/没发」，由一次性、带审计的结案脚本改状态（发出了=改 `SENT` 并补回执；没发=改 `FAILED(CONFIRMED_NOT_SENT)`）。v1 不做界面按钮。`UNKNOWN_OUTCOME` 条目的图算入第 4 节第 5 项的去重范围；它的首评由结案后的 `SENT` 走正常路径。
- **首评**（`SENT` 且 `post_id` 合格之后）：
  1. 先条件更新抢占 `first_comment_status: NONE|FAILED → POSTING`；`POSTING` 超 10 分钟的**回收**同样是条件更新（`status='POSTING' and first_comment_attempted_at = 读到的值`），两个扫描同时回收只有一个拿到（同时 `first_comment_attempts+1`、写 `attempted_at`），抢不到就不写——扫描重叠或 Inngest 并发都不会同时写两条。Inngest 函数同时设 `concurrency = 1`。
  2. 调 `ensureFacebookFirstComment`（`marker = buildFirstCommentMarker('post-lite-first-comment', item_id)`，`expectedPageId` 必填，`failureLabel: '图文帖'`）→ 成功 `POSTED + first_comment_id`；失败 `FAILED + 原因码`。**绝不影响 `SENT`、绝不重发 Post。**
  3. 扫描对「`SENT` 且首评状态为 `NONE`（发出后进程挂了）、`FAILED`、或 `POSTING` 超过 10 分钟（视为失败）、且发出不超过 6 小时」的条目再试（`POSTING` 超时那一次，上一次请求有可能还在飞；靠抢占 + `concurrency=1` + 请求超时 + 幂等标记兜底，**不保证**零重复，所以首评重试前先看一眼已有评论，这正是幂等标记的作用）；超过仍没补上 → 今日待办「首评没补上」。次数上限 6 次。
  4. 包被**撤销**后不再自动补首评（撤销=整体停），该条进今日待办「首评没补上（包已停）」由人处理；人工结案成 `SENT` 的条目若所属包已撤销，同样进该待办。包仅**过期**不影响补首评（Post 已经发出，评论属于它）——首评重试用**单独的查询**（按 `SENT` 条目+包未撤销，不受 `expires_at` 过滤；Story 的 `listLivePacks` 会过滤过期包，不能直接用）。
- **扫描卡住的防护**：Inngest 函数设 `concurrency=1` 的副作用是一轮卡住后面全排队、条目静默 `MISSED`；所以同时设函数 `timeouts`，并加待办「超过 30 分钟没有扫描记录」。**残余（承认）**：「释放抢占（`CLAIMED`→`PENDING`）」那次写库本身若失败，条目会被 15 分钟过期回收当成 `UNKNOWN_OUTCOME`（没发过也变成要人看），靠待办兜底。
- **撤销的诚实边界**：撤销只保证「还没通过最后一次检查的条目不发」；已 `CLAIMED` 且已过最后检查、正在发送的，拦不住，回包会列出已发/在途的，人工在主页处理。已发的 Post 系统不自动删。
- **演练（默认）**：`POST_AUTO_PUBLISH_LIVE` 严格等于 `true` 且客户在 `POST_AUTO_PUBLISH_CLIENTS` 名单里才真发。否则走完全部检查，**写 `last_check_*` 和 `post.item.attempted(mode=DRY_RUN)` 事件**（与 Story 的 `runRehearsal` 同口径；所以它不叫「只读」），但**不抢占、不碰 Facebook、不改状态、不写首评**（首评重试同样受开关控制）。
- **事件回执**（Inngest，业务可读名）：`post.pack.authorized` / `post.pack.revoked` / `post.item.attempted`；每条带 request/pack/item id、client id、status、reason、provider_receipt、mode(DRY_RUN/LIVE)、`provider_impact`(`NONE`/`POST_PUBLISHED`)、created_at。人工授权只推进到下一事件，不等于发布授权；授权只来自 `authorize` 接口。

## 6. 周包怎么进系统

75 号周包表（日期/时间/所属产品/英文文案/事实库编号/图文件/首评链接/角色）→ **导入脚本**（`scripts/`，先只在本机跑，默认 `--dry-run`）→ 一份 manifest（每条：新西兰本地发布时间、图路径、正文、首评全文、官网落地页、角色、事实库编号）→ 校验后写 `post_packs/post_items`。
- 新西兰本地时间 → UTC 用 `Intl`（`Pacific/Auckland`），不写死偏移。
- 首评全文原样存（含 75 号给的 `utm_content=日期_P序号`；角色后缀由周包提供，代码不改链接）。
- **图要先传到公开存储，并登记进素材库**（与 Story 同一个域名白名单）：上传后算 sha256，同时在 `client_assets` 建/找到对应行（`storage_url` 与 `media_url` 逐字相同、`source` 如实标注），把 `asset_id` 写进 manifest。这两步是写线上存储和线上库，开工前对齐 Story 当时的 bucket 和做法并先问 PM。
- 导入只产生**未授权**的周包。授权永远是管理员本人在预览页点。

## 7. 授权 / 预览 / 停止

与 Story 同构：`GET .../post-lite/[packId]/preview`、`POST .../authorize`（必带预览返回的 `content_hash`，预览后包被改就拒）、`POST .../revoke`；仅全局管理员，受限账号一律 403；写入类接口只收 `application/json`。预览页在 Post 页里按周包列：图、正文、首评、几点发、问题清单。**预览页上线前要过 Impeccable**：据 74 号转述，PM 对 Story 预览页回过「可以」下载并已用；Post 预览页上线前我再向 74 号确认一次，不假设跳过。撤销只停没发的；已发的 Post 系统不自动删（每日计划线有撤回接口，但本模块 v1 不接，回包列出已发的，人工在主页处理）。

## 8. 明确不做清单（v1）

不做 Instagram 图文；不做 Facebook 定时托管；不自动补发；不做图片生成/改图/加字；不改 `story-lite`、每日计划线、视频工厂；不做自动撤回/自动下架（那是 87 号设计稿 §5A，另案）；不做 `max_per_day` 周上限执行（量由周包本身决定）；不做跨客户看板/周报提醒；不新增 Inngest 以外的调度；不做测量回写（只存 `post_id` 回执，T+24/72 数据读回等第二阶段评估能否复用 `daily-plan-post-measurement` 的事件——**未核实，不承诺**）；不做感知哈希/相似图判断（v1 只认文件完全相同）；不做 UNKNOWN_OUTCOME 的界面结案按钮（用带审计脚本）；不在代码里写任何客户名/行业判断（`failureLabel` 等文案一律中性，如「图文帖」）（客户差异全部来自周包数据与客户配置）；不做「放行文字卡」「放行价格闸」类豁免开关。

## 9. 分四次改动（每次单独验收、单独回滚；都是 A 级，子牙+魏征两审，草稿，PM 回「合」）

| # | 内容 | 验收 | 回滚 | 要 PM 点头 |
|---|---|---|---|---|
| 1 | **本稿**（建表 SQL 已写好并在本机真执行验证，但随执行建表那一刀提交，不在本 PR） | 子牙+魏征审完（含复审）；SQL 在本机临时 Postgres 重放通过（含约束与 RLS 拒绝匿名，已做一轮） | 删本稿 | 无（设计稿阶段） |
| 2 | 核心库 `src/lib/social/post-lite/*`：类型、指纹、纯判断、发送逻辑（全部依赖注入）+ **本机临时 Postgres 里用建表 SQL 建出的真表跑整条链**（假 Facebook 通过注入的 fetcher） | 单测之外**当场触发完整链路**并贴输出：授权前不发 / 撤销停发 / 抢占互斥（含两个扫描并发）/ 结果不明不重发 / 价格闸（来源不明拦、读库失败不拦只重试）/ 检查抛错不卡住整轮 / 首评 NONE→POSTING→POSTED、失败不影响 SENT、`post_id` 来源为 `id` 时 `NEEDS_HUMAN` / 窗口晚到 MISSED / 演练不抢占；不碰任何线上服务 | revert PR（无表依赖） | 无 |
| — | **PM 点头 ①**：对线上库建 2 张表（回「建表合并」）；**点头 ②**：把演练包图传公开存储并登记素材行（我先写清传哪里、写哪几行再问） | 线上回读表存在、RLS 拒匿名；图可下载、sha256 对得上、素材行 `storage_url` 与 `media_url` 逐字相同 | 删两张表（无外部引用）；**删演练图与它登记在客户真实素材库里的那一行**（回滚清单必写，不能留在客户素材库里） | 两件事，分两次问 |
| 3 | 3 个接口 + Inngest 每 10 分钟函数（`concurrency=1` + `timeouts`，默认演练）+ 今日待办（没发出 / 不确定 / 授权了没动静 / 首评没补上 / 扫描停了）+ 注册 + `docs/ENV.md` 登记两个开关 | 本机临时库+演练模式当场触发整条链，PR 写「## 当场试跑」。线上分两层证明：**(a) 预检**：用一个**演练包**（发布时间设在未来 2 天，**不在发送窗口内**）走预览——预览把全部发前检查（含价格闸）跑一遍并返回问题清单，不看时间窗、不发任何东西；再让扫描函数在线上跑几轮，回读它记下的 `SKIPPED_NOT_DUE` 与函数运行记录，**由代码自己记录「写类 Facebook 请求数=0、读类请求数=N」**（计数来自发布端口被调用次数，不是靠「开关关着」推断）；演练包不授权，或授权后**当天就撤销**，且撤销必须先于任何开关变更。**(b) 窗口内演练**：真发之前，真周包先在 `POST_AUTO_PUBLISH_LIVE` 未设的情况下授权一次，等第一条的发送窗口到来，回读 `DRY_RUN` 记录（真实数据、真实检查、不发）——这一步之前不许开开关；开关状态须由 PM 在 Render 控制台确认「未设」（我读不到线上环境变量，不假设）。 | 关函数 / revert；表留着无害 | 无新开关 |
| 4 | 预览页 + 授权/停止按钮 + 周包导入脚本 + 上线前清单走完 | 页面真点（演练）；Impeccable 数字写 PR；导入脚本对 75 号 12 条跑 `--dry-run` 全绿 | revert 页面；周包行可 `revoke` | **周包图传公开存储并登记素材行**、Impeccable 再确认、**真发开关（PM 说 go，再单独问一次）** |

**上线前清单**（真发开关打开之前，缺一项就不许开）：
① 沙盘里**真执行**过抢占 / 写回 / 撤销 / 首评抢占的条件更新（第 2 步已含，真表真 SQL，不只看语法）；
② 线上演练：第 3 步 (a) 预检 + (b) 真周包在开关未设时的窗口内 `DRY_RUN` 记录已回读；
③ CTS `client_status = active`、页面号与 `clients.facebook_page_id` 一致已核；
④ **每日计划自动发布线对 CTS 保持关闭**已核（`DAILY_PLAN_AUTO_PUBLISH_*` 未设）；
⑤ 重复发布防线：已核主页令牌能否读近期帖子并实装 `DUPLICATE_SUSPECTED`；不行则员工在授权周内停止手动发图文（流程规定）+ 客户级一键停（从 `POST_AUTO_PUBLISH_CLIENTS` 去掉客户）已演示过一次；
⑥ 价格闸对周包 4 条带价条目的**真实结果**已出，PM 已决定怎么处理（去价格 / 图登记为客户实拍）；
⑦ 图内是否印价格由画面审查员签字；
⑧ 首评链接四参数、`utm_content` 前缀（条目编号前 8 位）、主机核对已在预览看过；
⑨ Render / Inngest 单次函数最长运行时间与并发上限**已核实**（现在未核实，不许写成已核）；
⑩ PM 明确说 go；
⑪ 真发后第一条当场回读：Facebook 主页真有这条、首评在、`provider_receipt` 与主页帖子对得上；对不上立刻停。

## 10. 与 Story 最小版 / 87 号设计稿的关系

- **与 87 号已对齐（10-14，依据：87 号 10-14 发给 90 号的消息与其 PR #2534 v0.4；我没有独立复核该 PR 内容）**：周包（包+条）本身就是「计划层」数据；87 号撤回了「按团并排+转换器」，改为「周包即计划层 + 本周总览（只读，由 87 号稿定义，读 `story_items`+`post_items`+工厂工单）+（可选）一键授权」。本模块只做**发布执行层**，不做总览。巡检要读的列（`item_id/pack_id/client_id/slot_at/message/first_comment/media_url/media_sha256/authorized_fingerprint/source_ref/role/fact_refs/status/provider_receipt/first_comment_status/first_comment_id/sent_at/reason_code`）表里都有；读取一律带 `client_id`，策略 `TO service_role`。5A 自动下架将来读 `post_items.provider_receipt`，v1 不做。
- **追踪参数口径（87 号提出，已采纳）**：首评链接的 `utm_content` 以**条目编号前 8 位**开头（现有首评生成器用「计划号前 8 位+日期」，一天两条会撞号），后面可追加 `-<槽位>-<角色>`。**「现有归因按前缀解析不受影响」未核实**：我只在 `src/lib/crm/attribution.ts` 看到 `utm_content` 被原样存为 `creativeRef`，没找到按前缀解析的代码；第 3 步开工前先核归因与首评自动检查对 `utm_content` 格式的实际依赖。导入脚本在生成 `item_id` 时把它写进首评链接，预览检查「`utm_content` 前缀 = 条目编号前 8 位」。75 号周包里手写的 `utm_content=日期_P序号` 由导入脚本改写。
- **开关命名**：`POST_AUTO_PUBLISH_LIVE` / `POST_AUTO_PUBLISH_CLIENTS`，与 `STORY_AUTO_PUBLISH_*`、`DAILY_PLAN_AUTO_PUBLISH_*` 同构；已 grep `src`、`render.yaml`、`docs/ENV.md` 无同名占用；第 3 步 PR 里登记到 `docs/ENV.md`。
- 两边稳定后再评估合并成一套带「格式」字段的实现；v1 **复制** story-lite 的做法而不引用它的私有函数、不改它：授权鉴权（`requireDashboardClientAccess` + 注入的 `isGlobalAdminEmail`）、`checkMediaFile`/媒体域名白名单写法、指纹配方、开关读取写法。**测量不复用每日计划事件链**（87 号复审：现有两个事件强制要计划号/活动号/计划版本）：v1 立即发布+首评当场发，效果数据先由巡检读主页。
- 每日计划自动发布那条线保持关着，不删。

## 11. 风险与已知缺口（如实）

1. **价格闸大概率拦周包里 4 条带价文案**（推断，没跑过）；解法需 PM 决定（去价格 / 图登记为客户实拍）。
2. 价格如果印在图里，闸看不到；程序判不了「画面是否撞脸 / 是否文字卡 / 缩放后的同一张图」，只挡文件完全相同与显式标注；其余靠画面审查员。
3. 立即发布意味着真发时刻 = 扫描时刻（最晚到点后 10 分钟内）；窗口 [-5, +20] 至少覆盖 2 次扫描，但一次扫描失败就可能错过。
4. 授权周内人工手动发图文与自动发布**可能重复**：程序缓解（发前读主页）取决于令牌权限，未核实；兜底是流程规定 + 客户级一键停。
5. 首评在 Post 之后写，之间 Post 无首评；失败/挂掉有重试（6 小时、6 次）与待办；**不保证首评一定补上**；首评失败期间没有自动回删。
6. 撤销拦不住已通过最后检查、正在发送的条目。
7. 测量（IMPACT 的 Check）v1 未接，只有回执与巡检读主页；已知缺口，不假装闭环。
8. 「近 30 天同图」只查 Post 表（Story 仅软提示），不覆盖 Reel。
9. 用量口径：CTS 全周每天 2 条 = 14 条/周；75 号首周周包（10-13~10-18）是 12 条。单客户下够用；第二个客户上线再评估合并/泛化。
10. 未核实项（不得当事实）：线上现有授权/发布记录、CTS `client_status`、Render/Inngest 函数超时与并发、Story 图当时的上传路径、主页令牌读帖子权限、价格闸对周包 4 条的真实结果。第 2/3 步开工前先读、先测，不猜。

## 12. Reuse Statement（设计稿级）

- **复用**：Meta 发图接口、共用首评写入器、两道价格闸、正文/首评检查、Story 的文件检查与开关/授权/指纹写法、Inngest 与今日待办拉模式。
- **真 platform-shared 的新增**：`post_packs/post_items`（无客户字段）、发布判断与发送逻辑；换成 East Inter 或悉尼地产客户，这段共享代码不需要改（客户差异只在周包数据、`clients.facebook_page_id`、价格资料）。
- **industry-specific**：无。**client-specific**：无写进共享代码；CTS 周包内容只在数据里。
- **学习/记忆**：无新增；发布回执 `post.item.attempted` 是后续 Check 的输入，v1 不写 memory。
- 交付时对账行：「本次实现落点与 tier-gate 决策时的分类是否一致」——届时在 PR 里逐条答。
