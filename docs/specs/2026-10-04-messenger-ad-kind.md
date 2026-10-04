# 设计稿 v3.1（与最终实现对齐）：ME 能建「暂停状态」的私信视频广告（第一步）

- 日期：2026-10-04 · 风险级别：**A**（花钱 / 对外发布 / 权限）· 状态：**v3.1（设计稿两审：两人均「有条件通过」；实现后又各审一轮，必改项已落实，见 §12 末尾）**
- 分支：`feat/me-messenger-ad-kind`（起点 origin/main `31f716c05`）· 写入者：本 Claude Code 窗口（唯一）。写代码不走 DeepSeek，原因：A 级发布安全核心 + 需同时看懂 8 个互相咬合的文件（CLAUDE.md §5 两类例外）。
- 来源：检查报告 `docs/audits/2026-10-04-me-ad-publishing-capability-audit.md` §四第 1 步；台账 `docs/ledger/2026-10-04-me-messenger-ad-publishing-dev-plan.md`
- 层级门（Inline）：L3 Meta Ads Connector 上新增一种「打法」，挂在既有「广告」支柱；**不新增能力线 / 支柱 / 表 / 迁移 / 环境变量 / cron**。`messenger_direct` 打法早已在 `play-vocabulary.ts` 登记。

## 1. 做什么 / 不做什么

**做**：新增草案类型 `messenger_conversation` —— 建成**暂停**的「点广告 → 进 Messenger 对话」视频广告，建完走回读 + 闸门，等人点头；**但 ME 的「开」按钮对它一律拒绝**（§6）。
**不做**（本轮排除）：PM 授权事件 / 紧急开关 / 每日总预算检查；回复率与值班；A/B；令牌；任何 OAuth 授权范围；视频工厂 / Remotion；`boost-post`；开启任何广告；合并任何 PR；自定义欢迎语；改 `draft-listing` 路由。

## 2. 改哪些文件

| 文件 | 改动 |
|---|---|
| `src/lib/ads-strategy/ad-draft.ts` | `DraftKind` 加 `messenger_conversation`。**三处「不是 A 就当 B」的兜底全部改成穷举**：`metaTripletFor` → `Record<DraftKind,…>` 表；`describeDraft` → `Record<DraftKind,string>` 表；`DRAFT_PLAY` 本来就是 Record。新增 `APPROVABLE_KINDS` / `isApprovableKind()`、`MESSENGER_CTA_TYPE`、`MAX_MESSENGER_CREATIVES = 4`；`AdDraftCreative` 加 `language?`、`thumbnailImageHash?`；`validateDraft(d)` 拆成「通用 / 私信」两个小函数（现函数已近 50 行）。**红线不进 `validateDraft`**（§4）|
| `src/lib/meta/ad-publisher.ts` | `creativeSpec` 改成对 `kind` 穷举的 switch（陌生值 `throw`）；抽出 `adSetBodyFor()` 和 `publishCreatives()`（现 `publishDraftPaused` 90 行，超 50 行铁律必须拆）；删掉 `promoted_object` 两边相同的死三元；三个 Graph 助手都加 `AbortSignal.timeout(15s)`；`publishDraftPaused` 增加可选 `{stopWritingAt, giveUpRollbackAt, now}`（§7）；请求超时 / 断网这类「不知道 Meta 有没有建成」的失败，把对象名记进 `orphans`；新增 `pausePublished()`（§5）|
| `src/lib/meta/asset-upload.ts` | 新增 `waitForVideoReady()`（§7）|
| `src/lib/ads-strategy/draft-and-gate.ts` | ① 私信类型在 publish 之前等视频转码；② `approveDraft` 改**白名单**（§6）；③ 建完回读后追加「建成预期」检查（§5）；④ `CreateDraftDeps.brandRedlines?`，红线检查在这里调用 `checkDraftRedlines`（不在 `validateDraft` 里）；回读→过闸→合并期望检查抽成 `gateReadback()`（`createDraftForApproval` 现已 70 行，必须拆）；⑤ `DraftRecord.redlinesChecked: number | null`（`null` = 没读到 / 没查；数字 = 查了几条，`0` = 客户没配）；`DraftRecord.autoPause?`（§5）；⑥ 改正文件头「没有任何路径能让 ME 自己让广告开始花钱」那句过时注释 |
| **新** `src/lib/ads-strategy/created-as-expected.ts` | 纯函数 `checkCreatedAsExpected(...)` → `LaunchFinding[]`。**不动** `launch-readback.ts`（子牙：入参不扩）|
| `src/lib/meta/readback.ts` + `meta-readback-adapter.ts` | 回读多取 `status` / `effective_status`（广告组、广告）；新增 `fetchCampaignStatus()`；`graphGet` 加 15s 超时；`RawMetaAdSet` / `RawMetaAdCreative` 加可选状态字段（现有调用方不受影响）|
| **新** `src/lib/ads-strategy/draft-redlines.ts` | `foldForRedline`（NFKC + 去零宽 + 标点折成空格）、`findRedlineHits`、`checkDraftRedlines`、`loadDraftRedlines(supabase, clientId)`：合并 `clients.brand_redline_phrases` + `master_briefs.avoid_words` + `excluded_topics`（与 `draft-listing` 同口径）。**读库出错返回 `null`**（含同一客户多条 active brief 导致 `maybeSingle` 报错），不退化成 `[]`；读出来时丢掉空白条目，`findRedlineHits` 再丢掉折叠后短于 2 字的短语（空串会让 `includes('')` 恒真）|
| `src/lib/ads-strategy/play-vocabulary.ts` | `messenger_direct.knownTraps` 补两条（接口建素材不能带链接；视频必须带缩略图）|
| `src/app/api/clients/[id]/meta-ads/draft/route.ts` | 调 `loadDraftRedlines`，传给 `createDraftForApproval` |
| `src/app/dashboard/ad-approval/page.tsx` | 隐藏条件用 **`!isApprovableKind(p.draft?.kind)`**（和 `approveDraft` 同一个函数；旧记录没有 `draft` 或 kind 陌生也照样隐藏），显示「暂不可开：要等 PM 授权与总预算检查上线」|
| 测试 | 见 §9 |

## 3. Meta 参数表（私信类型）

| 层 | 字段 | 值 |
|---|---|---|
| 系列 | `objective` / `status` | `OUTCOME_ENGAGEMENT` / `PAUSED` |
| 广告组 | `optimization_goal` / `billing_event` / `destination_type` | `CONVERSATIONS` / `IMPRESSIONS` / `MESSENGER` |
| 广告组 | `promoted_object` | `{ page_id }`（主页以库为准，AD-SEC-2）|
| 广告组 | `status`、预算、终点、定向 | 沿用：`PAUSED`；日预算 ≤ 50；≤ 30 天 |
| 创意 | `object_story_spec.video_data` | `video_id, message, title, [link_description]` + 缩略图（`image_hash` 优先，否则 `image_url`；两个都给以 hash 为准）|
| 创意 | `call_to_action` | `{ type: MESSAGE_PAGE, value: { app_destination: 'MESSENGER' } }`，**不写任何 link** |
| 广告 | `status` | `PAUSED` |

- **有依据**：不带 link、用 `app_destination` —— PITFALLS D13（2026-09-26 实测）：带 `fb.com/messenger_doc/` 会被 Meta 当场报 1815765。
- **猜的，没有本仓实测**（魏征指出）：① 按钮类型 `MESSAGE_PAGE`（D13 实测过审的是 `GET_QUOTE`）；② `OUTCOME_ENGAGEMENT + CONVERSATIONS + MESSENGER` 整组组合（D13 只验过创意）；③ **不传** `page_welcome_message` 能否过审（D13 的写法带了欢迎语）。三条全部由当场试跑第一步验证；按钮类型只放在 `MESSENGER_CTA_TYPE` 一个常量里，被拒就换常量。
- 欢迎语本轮不传，Meta 会自动加默认问候语 —— 这正是回读要「摊开给人看」并过红线扫描的东西（§5）。

## 4. `validateDraft`（建之前 ME 自己能判的错）

**通用（所有类型，新增）**：
1. `creatives` 必须是数组、每条的 `primaryText` / `headline` 必须是字符串，且 `description` / `videoId` / `imageHash` / `thumbnailUrl` / `thumbnailImageHash` / `language` 有就必须是字符串，否则返回问题而不是抛 500（现在 `c.primaryText.trim()` 会直接抛，且不留账）。`checkDraftRedlines` 对坏条目同样不抛。
2. `kind` 必须是已知类型（现在 `/draft` 是 `body as AdDraft`，陌生 kind 会被当成「养受众」默默建出去）。
3. **品牌红线**（由 `createDraftForApproval` 调 `checkDraftRedlines`，结果并进同一份问题清单）：任一禁用词命中任一创意的正文 / 标题 / 描述 → 拒，并报出命中短语。复用 `scanRedlineHits`，外加 `foldForRedline()`（对短语和待查文本**同时**做）：NFKC（全角 `１９２８` → `1928`）、去零宽 U+200B–200F / 2060 / FEFF / 00AD、标点折成空格（带标点 / 连字符的写法）。**纯 ASCII 短语按整词比**（`ai` 不命中 `email`、`AT&T` 不命中 `what time`，借 `scanRedlineHits` 的子串比对加词边界标记实现，整词匹配不跨文案拼接）；含中文等无空格分词文字的短语仍按子串比。折叠后短于 2 字的条目不参与比对，但**不静默忽略**：记进 `DraftRecord.redlinesSkipped`。**挡不住的**：`ninety-eight years` / `98-year`、同形异码字母、`一九二八年`、视频画面与缩略图上印的字。
   **影响面比最初写的大（PR 正文必须写明）**：词表 = `brand_redline_phrases` + `avoid_words` + `excluded_topics`，且 `/draft` 路由上**现有的留资 / 养受众草案**命中也会被拒（`draft-listing` 不经过这里，不受影响）。
   **两个值不能混**：红线参数 `undefined` = 没加载 → 私信类型拒、其它类型沿用旧行为不查；`[]` = 查过、客户没配 → 放行。读库出错 `loadDraftRedlines` 返回 `null`，路由当「没加载」。`null` 的情形：读库报错、客户这一行读不到、任一字段被存成字符串 / 对象而不是数组。

**私信类型（新增）**：
4. 红线没加载就拒（见上，由 `checkDraftRedlines` 执行）—— 私信类型 fail-closed。
5. 创意条数 1–4。
6. 每条必须有 `videoId`；缩略图 `thumbnailImageHash` 或 `thumbnailUrl`（必须 `https://`）至少一个，否则拒。
7. **一语言一组**，两层：①每条创意必须声明 `language`，格式限定为**两位**语言代码（`en` / `zh` / `mi`，取 `-`、`_` 前的主子标签并转小写；`English`、三位的 `eng` 直接拒，因为 `eng` 和 `en` 会被当成两种语言），全组一致；②用 `dominantScript()` 判文字体系，全组必须一致。**诚实写明**：`language` 是调用方**自报，不是校验** —— 现有路由默认 `lang ?? 'en'`，文案生成器一律填 `en` 时英文混毛利语仍能通过；它只是把「混放」从「没人声明」变成「声明里就看得出来」。文字体系判定是第二道，但分不开同为拉丁字母的语言。
8. `leadFormId`、`linkUrl` 不要求，也不会被用到。

> **关于「since 1928 / 98 years 只能与『25 年新西兰』成对」**：这是 CTS 的客户事实，不进共享代码。机制 = 客户配置的红线短语。「成对才允许」子串匹配表达不了，所以本轮采用更保守的：命中即拒，文案写手用「25 年新西兰」的说法即可绕开。⚠️ CTS 现有名单是否含 `98 years` **未确认**；加进去是改生产客户数据，本窗口不做，交 PM。**在确认之前，PR 与汇报都不声称「红线已拦住 98 years」。** 另外红线只扫文字，扫不到视频画面和缩略图上的字（这条仍靠人看 + 视频工厂的分镜自检）。

## 5. 回读闸门与「建成预期」检查

**原样复用，不改**：`launch-readback.ts` 98–117 私信判定、192–211 多语言 blocker 与落点未知 warn。

**新增 `checkCreatedAsExpected`（只对私信类型调用，在 draft-and-gate 里与现有报告合并，任何 blocker 都使状态变 `blocked`）**，输入 = 回读结果 + `metaTripletFor(kind)` + 建出来的 id + 红线，产出 blocker：

| code | 触发条件 |
|---|---|
| `not_paused` | 系列 / 广告组 / 任一广告的 `status` 不是 `PAUSED`，或读不到 —— **补上「全程 PAUSED」目前没有任何回读证据**这个洞 |
| `messaging_adset_mismatch` | 回读的 `optimization_goal` 不是 `CONVERSATIONS`，或 `destination_type` 不是 `MESSENGER`（含读不到）|
| `ad_count_mismatch` | 回读到的广告数 ≠ 我们建出来的 `adIds.length`（含 0 条 —— 刚建完有最终一致性窗口；现有闸门对 0 条创意会放行）|
| `brand_redline_in_readback` | 回读到的买家可见文案（含 Meta 自动加的问候语）命中红线 |

**`not_paused` 不能只记账**（魏征）：对象还在 Meta 上可能在花钱。触发时 `draft-and-gate` 立刻对读到非 PAUSED（或读不到）的对象调 `pausePublished()` 补一刀暂停，结果（成功 / 失败及原因）写进 `DraftRecord.autoPause`，失败的要出现在审批页「系统自己拦下的」里让人看见。

局限（写明，不假装）：创建时才跑；`readback-sweep` 日常巡检不带这些期望；**只有私信类型做 PAUSED / 0 条创意检查**，另外两种仍放过；**Meta 自动问候语能否在回读里读到、能否被红线扫到是未验证的**（`readback.ts` 只读 `video_data.page_welcome_message`）—— 列为试跑阶段 A 的验收项。

## 6. 为什么本轮必须「拒绝开启」，以及怎么拒

现状：`/api/ad-approval/[actionId]` 的「开」只验登录的付费客户或管理员，没有 PM 授权事件（第 2 步才做）。只加类型不加限制 = 付费客户登录点一下，私信广告真花钱。台账卡要求「没完成前 ME 不得自动打开任何私信广告」。

做法：
- `approveDraft` 改**白名单** `APPROVABLE_KINDS = {lead_form, video_thruplay}`；`draft.kind` 不在名单（含缺失、陌生值、私信类型）→ `{ok:false, error:…}`，**零 Meta 调用**，账本状态不变。用白名单不用黑名单（魏征：账本里 `kind` 缺失 / 陌生时黑名单放行）。第 2 步上线时把私信类型加进白名单。
- 审批页不渲染按钮（§2）。
- **已知口子，接受并写明**：`meta-ads/execute` 的 `ads.reactivate_campaign`（`execute/route.ts:133-135`）可以把本客户任意系列开成 ACTIVE。它只开系列；广告组和广告仍是 PAUSED，不会花钱（核对过其余 ACTIVE 写入点：`stop-loss.ts:225`、`pause-unit.ts:58`、`ads-auto-pause/index.ts:167` 都只恢复「改前就在投」的对象），所以本轮不动；第 2 步（授权 + 紧急开关）一并收口。人在 Meta 后台手动开不归本代码管。

## 7. 视频转码等待 `waitForVideoReady`

放在 **`createDraftForApproval`**（子牙：publisher 只负责建、不判对错），在 `validateDraft` 之后、`publishDraftPaused` 之前，只对私信类型。此时账户里什么都没建 → 失败只记一条 `failed`，无孤儿，`PublishFailure.step` 不用加 `'video'`。

- `GET /{video_id}?fields=status`，读 `status.video_status`：`ready` → 通过；`error` → 立即失败；**其它任何值 / 字段缺失 / 解析不了 → 一律当「没好」继续等**（魏征）。
- 错误分类按 Meta 的 `error.code` / `is_transient`，**不按 HTTP 状态码**（限流常是 HTTP 400）：限流 / 临时类（code 1、2、4、17、32、341、613，`is_transient=true`，HTTP 429 / 5xx，网络错误）→ 继续等；其它 4xx（视频不存在 / 无权限）→ 立即失败。
- 错误分类补充：Meta 限流还有 `80004` 等广告类限流码，一并算「继续等」；`code 190` / `OAuthException`（令牌失效）→ 立即失败并写明「授权失效」；**响应体不是 JSON 的 4xx**（分类不了）→ 立即失败，429 例外。
- 时间：每次请求 15 秒超时（随剩余期限收紧，不低于 1 秒）；**所有视频共用一个总期限**，默认 **25 秒**（`intervalMs` 默认 4000）；**每一轮对所有没好的视频同时查**（串行的话 4 条各卡 15 秒，一轮就 60 秒）。`timeoutMs` 不是有限数 / `intervalMs` 小于 500ms 当没给，回到默认（防热循环）。`sleep` / `now` 可注入。**25 秒够不够没有实测依据**（视频是提前上传的，转码多半已完成）；不够就如实报「稍后重试」，不会假装成功。
- 超时 → `{ok:false, reason:'timeout'}`，文案「等了 N 秒视频仍在转码，广告没建，稍后重试」。

**整次请求预算（回应魏征：期限要覆盖写、回读、回滚三段）**。`maxDuration = 120` 是 Vercel 概念、本仓部署在 Render，真实代理上限**未核实**；按常见的 100 秒当保守上限，再留余量，整次请求最坏一路 ≈ 25（等）→ 45（写到此为止）→ 55（读与否的分界）→ +15（并发回读）→ +15（并发补暂停）→ 落账，约 ≤ 92 秒：

| 阶段 | 规则 |
|---|---|
| 等转码 | 总共 ≤ 25s |
| 建（写） | `stopWritingAt = startedAt + 45s`：过了这个点不再发起新的写，直接停手 + 回滚 + 记 `failed` |
| 回滚（删） | 每次删 8s 超时；过了 `giveUpRollbackAt = startedAt + 80s` 就不再试，**没删的 id 全部进 `orphans`** |
| 回读 | 若此时已过 `startedAt + 55s`，不读，按「回读不到 = 查不出来」记 `blocked`（建出来的都是暂停的）。读广告组 / 广告 / 系列状态三件**并发**，≤15s |
| 补暂停 | `not_paused` 时三层**同时**发，`deadlineAt = startedAt + 92s`，过了的如实报「没来得及」|

**「建成了但没拿到 id」**（魏征：15 秒超时会让它更常发生）：请求超时 / 断网时不知道 Meta 有没有建成。这类失败，publisher 把「未确认是否已建成：广告系列/广告组/创意/广告「名字」」写进 `orphans` 并带进账本，提醒人去 Meta 后台按名字核对。**不采用「先写 pending 账行」的做法**：它要改所有类型的账本流程和状态词表，超出本轮。**仍未覆盖**：整个请求被平台中途杀掉时，已建对象没入账 —— 列入未解决。

## 8. 失败回滚

沿用现有「逆序删，删不掉进 `orphans`」。补强与补测：创意步被拒时系列 + 广告组被删回去、`orphans=[]`；`graphDelete` 失败的 id 如实上报。**已知缺口（沿用，写明）**：`graphDelete` 只试一次；请求超时的「可能已建成」（含 HTTP 5xx 网关超时）只记名字不自动清理（§7）。

## 9. 测试清单（定向跑，不跑全量）

- `ad-draft`：私信三件套参数；`language` 格式（`en-NZ`→`en`，`English` 被拒）；缩略图缺失被拒、非 https 被拒；多语言（声明不一致 / 文字体系不一致）被拒；创意 > 4 被拒；陌生 kind 被拒；坏形状 `creatives` 不抛；原有「两种草案落点都不是私信」改成只针对原两种类型。
- `ad-publisher`：私信四步请求体逐字段断言，序列化后**不含** `link` / `messenger_doc`；所有写请求 `status===PAUSED` 且全程无 `ACTIVE`；`MESSAGE_PAGE` + `app_destination`；创意步被拒 → 回滚干净；删不掉如实上报；截止时间已过 → 停手回滚；陌生 kind 抛错；拆分后原有 12 个测试仍绿。
- `asset-upload`：`waitForVideoReady` —— 立即 ready；处理中后 ready；超时；`status` 缺失 / 未知值继续等；HTTP 400 + 限流 code 继续等；HTTP 400 + 非限流立即失败；多视频共用总期限；`video_status=error` 立即失败。
- `draft-and-gate`：私信全链路等待 → 建 → 回读 → 落账；`approveDraft` 对私信 / 陌生 / 缺失 kind 都拒且 **fetch 零调用**；转码超时记 `failed` 且不调 publish；红线传递与 `redlinesChecked`。
- `draft-redlines`：命中（含全角、零宽、标点变体、空白折叠）；`undefined` 与 `[]` 区别（私信拒 / 放行，其它类型不查）；`loadDraftRedlines` 出错返回 `null`、过滤空白条目；`brand_redline_in_readback` 同样走折叠。
- `created-as-expected`：`not_paused`（含读不到）、`messaging_adset_mismatch`、`ad_count_mismatch`（含 0 条）、`brand_redline_in_readback`；`not_paused` 时 `pausePublished` 被调用且结果入账。
- `route`：红线被加载并传入。`play-vocabulary`：新增陷阱存在。
- 完成后：对改过的源文件做**变异自检**（把 PAUSED 改 ACTIVE、把白名单改黑名单、去掉缩略图校验，测试必须变红，且红的是对应的测试名）。

## 10. 当场试跑方案（**动手前必须 PM 本人同意**；同意前只做单测与本地干跑）

会建 1 个系列 + 1 个广告组 + 1 个创意 + 1 条广告，全部暂停、不花钱，回读后立刻删，账户恢复原样。账户：CTS 个人广告账户（Pengyu Deng）。

- **阶段 A（验 Meta 接受这组参数，不验 ME 代码）**：用 Meta 广告官方连接器，按 §3 参数表建暂停对象 → 读回 → 删。验 §3 里三条「猜的」，另验：Meta 自动问候语在回读里读不读得到（§5）。视频用账户里**已有**的（连接器「上传视频」对该账户暂未开放）。
- **阶段 B（验 ME 自己的代码）**：必须在带令牌的服务器上调 `createDraftForApproval`。本机拿不到生产令牌，**我不读任何 `.env*`**。怎么拿到带令牌的环境 = 未解决项（见 §11）。
- 回执（对象 id、时间、回读报告原文、删除结果含删不掉的 id）写 `docs/ledger/evidence/`，PR 正文「## 当场试跑」引用。阶段 B 没跑通前 PR 正文如实写「未当场试跑 + 原因」，不写「可上线」。

## 11. 未解决项（汇报时原样交出）

1. 阶段 B 试跑怎么拿到带令牌的环境（PM 决定）。
2. CTS 红线名单是否含 `98 years`（改生产数据，PM 决定）。
3. 请求被中途杀掉时已建对象未入账；POST 超时但实际建成的 id 丢失；`graphDelete` 只试一次（现有缺口，不属本轮）。
4. 通用 `/draft` 仍信请求里的 `videoId`（不过素材闸；全局令牌兜底时 A 客户理论上能用 B 客户的视频号，`token-manager.ts:87`）—— 新类型扩大了这个口子，第 2 步收口；`boost-post` 建 ACTIVE；`ads.reactivate_campaign` 能开系列 —— 第 2 步。
5. `end_time` 在建的时刻就固定了，等人点头隔几天，实际跑的天数会少于 `describeDraft` 所说；晚了 Meta 还会拒绝开启 —— 第 2 步开启时重算。
7. **上线前核对**：生产库 `flywheel_actions` 里有没有 `status=awaiting_approval` 但 `draft.kind` 缺失的旧记录 —— 白名单上线后它们会被「开」拒掉（本窗口没有读生产库，未核对）。
8. 账本里 `draft.kind` 若被人改成 `lead_form`，白名单就失效（需要 `flywheel_actions` 写权限；全仓只找到 `record()` 一处写入点）。更牢的做法是开启前再读一次 Meta 上广告组的落点 / 目标 —— 本轮不做，第 2 步一并。
6. 缩略图 URL 若是会过期的签名链接，会在创意步失败（已有回滚，但需用稳定链接）。

## 12. 审查意见处置（第一轮）

| 来源 | 意见 | 处置 |
|---|---|---|
| 子牙 1 | 加 kind 漏改会静默建错 | 采纳：三处全改穷举（Record / switch+throw）|
| 子牙 2 | 红线复用 `scanRedlineHits`；补读 `avoid_words` / `excluded_topics` | 采纳：`loadDraftRedlines` + `foldForRedline` |
| 子牙 3 | `publishDraftPaused` 90 行超限 | 采纳：拆 `adSetBodyFor` / `publishCreatives` |
| 子牙 4 | 视频等待挪进 draft-and-gate | 采纳，`step:'video'` 取消 |
| 子牙 5 / 魏征 4 | 超时预算 | 采纳：每请求超时 + 总期限 + 等待 40s + 创意 ≤ 4；请求被杀的缺口如实列出 |
| 子牙 6 | `expect` 不改闸门入参 | 采纳：新文件 `created-as-expected.ts` |
| 子牙 7 / 魏征 | 审批页绿按钮 | 采纳 |
| 子牙 8 | 红线行为变化写进 PR | 采纳（§4-3）|
| 魏征 1 | 开启拒绝改白名单；`reactivate_campaign` | 白名单采纳；`reactivate_campaign` 接受并写明（§6）|
| 魏征 2 / 3 | 回读验 PAUSED、0 条创意 | 采纳（§5）|
| 魏征 5 | 错误按 code 分类；缺失当没好 | 采纳（§7）|
| 魏征 建议 | 私信类型红线 fail-closed；读回买家文案再扫；语言显式声明；坏形状不抛；未知 kind 抛错；缩略图优先级 | 全部采纳 |
| 魏征 建议 | NFKC / 零宽 | 采纳（`foldForRedline`）|
| 魏征 建议 | `end_time` 随审批延迟变短 | 列入未解决（第 2 步）|
| **实现后** 子牙 必改1 | `creatives:[null]` 红线检查抛 500 | 采纳：`draftTexts` 过滤坏条目；全链路用例 |
| 子牙 必改2 | 两个函数 >50 行 | 采纳：拆 `waitForTranscode / publishBudgetFor / launchReportFor / recordGate` |
| 子牙 建议 | 预算串行项并发、补暂停有期限；注释里的客户事实 | 采纳 |
| **实现后** 魏征 必改1 | `language:5` 抛错 | 采纳：可选字段统一做字符串形状校验 |
| 魏征 必改2 | `loadDraftRedlines` 坏格式当空 | 采纳：任何意外形状返回 `null` |
| 魏征 必改3 | 短词子串误杀 | 采纳：ASCII 整词匹配 + `redlinesSkipped` 不静默 |
| 魏征 必改4 | 时间预算串行 | 采纳：转码探测并发、回读并发、补暂停并发；数字收紧 |
| 魏征 建议 | 5xx 算可能已建成；`approveDraft` 再读 Meta 加固；kind 缺失旧记录核对；NaN/0 防护；`eng`/`en` | 5xx、NaN/0、两位语言码采纳；Meta 再读与旧记录核对列入未解决 |
| 魏征 建议 | 回滚缺口 | 沿用并写明，不属本轮 |
| **第二轮** 魏征 必改1 | `not_paused` 只记账 | 采纳：`pausePublished()` 补暂停并入账 |
| 魏征 必改2 | 期限覆盖写 / 回读 / 回滚 | 采纳：分阶段预算表（§7）|
| 魏征 必改3 | 超时放大「建成无 id」| 部分采纳：名字进 `orphans`；不做 pending 账行（超范围）|
| 魏征 必改4 | `loadDraftRedlines` 出错 / 空串 | 采纳：返回 `null`、过滤空串 |
| 魏征 必改5 | 红线影响面写进 PR | 采纳 |
| 魏征 建议 | `language` 自报 / 格式、`foldForRedline` 范围、错误码清单 | 采纳 |
| 子牙 必改1 | 页面隐藏条件用同一个函数 | 采纳 |
| 子牙 必改2 | 红线扫描不进 `ad-draft.ts` | 采纳：`checkDraftRedlines` 在 `draft-redlines.ts`，由 draft-and-gate 调 |
| 子牙 建议5 | 抽 `gateReadback()` | 采纳 |

## 13. Reuse Statement

- **复用**：`AdDraft` / `validateDraft` / `metaTripletFor`；`publishDraftPaused` 的四步与逆序回滚；`createDraftForApproval` 的 建→回读→闸门→落账；`launch-readback` 私信检查与 `dominantScript`；`scanRedlineHits`；`PLAY_CATALOG.messenger_direct`；`clients.brand_redline_phrases` + `master_briefs`；`flywheel_actions` 账本。
- **platform-shared（新增）**：`messenger_conversation` 类型；`waitForVideoReady`；`checkCreatedAsExpected`；`loadDraftRedlines`；`APPROVABLE_KINDS` 白名单。
- **industry-specific**：无。
- **client-specific**：无写进共享代码。CTS 的「1928 / 98 years」只经客户配置字段进入，不出现在 `src/`。
- **客户名 / ID / 私有事实进 shared runtime？** 否。
- **学习层**：本轮无学习写入。
- **对账（tier-gate）**：实现落点与决策时分类（L3 Connector 上的打法）一致。
