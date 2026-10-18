# Reel「授权后单条转公开」受控动作 · 设计稿 v0.2（97 号，2026-10-18）

- 性质：只是设计稿，没写代码、没写库。**风险级 A**（发布路径、对外不可逆）。实现 PR 必须保持草稿、正文写「风险级别：A」，PM 本人回「合 N」钉 SHA。
- v0.2 = v0.1 + 三审（子牙架构 / 魏征挑刺 / 狄仁杰攻击验证，禁 Codex）全部意见。三审结论均为「需改稿后复审」，本稿即改稿；**改稿后须复审一轮（第 10 节）才能派人写代码**。
- 依据：origin/main `bd8a2d638` 工作树（本地引用）；生产库只读。Render 环境变量读不到，凡依赖它的结论标「未验证」且按 fail-closed 处理。
- 范围（统筹 10-18 定）：**首版只含单条转公开动作。** 存量 3 条补登记、缺首评补发不在首版，另走一次 PM 点头；11 张草稿单不批量，等动作上线后回读区分。

## 0. 一句话
「仅 PM 名单内管理员、绑定单条工单、预览→一次性令牌确认后」才转公开：先核对 Facebook 上草稿真实文案与红线，再抢占授权，调现成 `promoteReelToPublished`，**先写流量记录、再写工单**，用 Facebook 上的真实发布时间，最后由现有补发任务发信号让测量接线通过；并保证不会顺带触发 Instagram 跟发。

## 1. 为什么断（不变）
工厂 Reel 没有代码调用 `promoteReelToPublished`（`facebook-reel-adapter.ts:242`，仅讲课片 `lecture-publish.ts:147` 在用），人手转公开不回写；测量接线 `rebindFactoryReelAction` 要求流量记录（`flywheel_actions.action_type='factory_reel_publish'`）`payload.video_state==='PUBLISHED'` 且 `published_at` 与事件一致。存量 3 张（`fa4fdd89`、`7ed7645b`、`e29b0986`）工单已 PUBLISHED、流量记录仍 DRAFT，适配器按设计拒绝。

## 2. 动作流程（顺序不许调换）
路由：`POST /api/factory/work-orders/[id]/promote`（新增，与 `review` 路由同目录）。按钮放工厂页 `dashboard/factory/page.tsx:257` 的「发布时存为草稿」徽章旁，**以及 PM 实际使用的收件箱 `ReviewInbox.tsx:354` 的同一徽章处**，仅 `status='published'` 且 `video_state='DRAFT'` 时出现。请求体只允许 `{confirm, preview_token}`；`video_id`、`page_id`、`client_id` 一律从库里取。

1. **权限（三审 M1；范围说明）**：`ADMIN_EMAILS` 是全体内部管理员名单而非仅 PM，首版接受这个范围；如需只限 PM，另加专用名单。`requireSession` 只用 `getUser()`、未看邮箱是否已验证，**注册是否强制邮箱验证：未验证**，实现前须核 Supabase 设置。`requireGlobalAdmin()` **再叠加** `isGlobalAdminEmail`（只认 `ADMIN_EMAILS` 精确名单，不认公司域名；自动发布撤销路由已这样用）。记 `authorized_by`。不用 `guardAdmin`。
2. **前置校验（任一不过 4xx，不碰 Meta；一律 fail-closed）**：
   - 工单 `status='published'`、`published_ref.video_state='DRAFT'`（`superseded`、`measuring`、`closed` 等一律拒绝）。
   - 人工与自动清单都通过（`checklistPasses`）。
   - `published_ref.page_id == 当前 target.page_id == 流量记录 payload.page_id`，三者一致；`published_ref.video_id` 与流量记录一致。
   - **流量记录必须恰好 1 行**（按 `work_order_id` + `client_id` + **`action_type='factory_reel_publish'`**——同一工单可能还有 `factory_reel_instagram_crosspost` 行，不加会查到 2 行被永久拒绝），0 行或多行都拒绝；测试覆盖「有 Instagram 行时仍能转公开」。
   - `expect_brand` 为空 → 拒绝；Meta 不返回视频 `from` → 拒绝；工单无 `master_brief_id` → 拒绝（三处原代码是 fail-open，实现必须改成缺失就拒）。
3. **读回 Meta 并扫红线（狄仁杰 H1）**：读回草稿视频的 `description`、`published` 状态与真实发布时间。红线闸 `scanPublishCaption` **扫读回的 Meta 实际文案**（先剥零宽字符、NFKC 归一化、去标点再匹配），同时与 `buildReelPostCaption(brief.copy)` 比对，不一致 409「草稿文案与库不一致」。读回文案本身可被有主页权限者改，所以指纹（第 4 步）把它纳入，确认时再读一次比对。**比对前归一化**：去零宽字符、NFKC、折叠空白、剥掉 Meta 可能追加的链接包装/话题标签格式；实现者必须在测试页面当场试跑，确认归一化后能稳定相等，否则会永远 409。**转公开后立即再读一次并重扫红线**，未通过则生成今日待办（尽力防护：检查与转公开之间、转公开之后仍可能被有主页权限的人改文案，无法根治）。
4. **预览（`confirm:false`）**：返回客户、页面、视频 id、读回文案、首评文本、清单通过时间，**服务端生成一次性 `preview_token`**。令牌只存哈希，存放在流量记录行 `payload.promote_preview`（不新建表；写入同样在第 3 节的互斥锁内做读-改-写，避免两个管理员同时预览互相覆盖，被覆盖者重新预览即可）：`promote_preview[邮箱哈希] = {token_hash, work_order_id, fingerprint, expires_at(5 分钟), used:false}`（**按管理员邮箱分槽**，两位管理员同时预览互不覆盖；令牌用加密级随机数、至少 128 位，比较哈希用恒定时间比较）；绑定管理员邮箱，别的管理员拿不到、用不了。指纹 = hash(video_id + 读回文案 + 首评文本 + `review_ref.approved_at`)（子牙复审：不放工单 `updated_at`，审片预算修改等无关写入会刷新它造成误报 409；`updated_at` 只留给互斥锁）。预览不写任何业务字段（只写这个预览记录）。
5. **确认（`confirm:true`）**：校验 `preview_token`（哈希匹配、邮箱一致、未过期、未用过），**重读工单、流量记录与 Meta 并重算指纹**，不一致 409。通过后抢占授权（第 3 节）并把令牌标 `used`。
6. 若 Meta 回读已是公开（人手已转过）→ 不调转公开，进「只同步」分支（第 5 节）。否则调 `promoteReelToPublished({target, videoId})`，复用 `resolveTarget`（需从 `publish-worker.ts:67` 导出，实现 PR 里说明是对既有文件的小改动）。
7. **写库（顺序固定，三审 H3/M3）**：
   1. 先写 `flywheel_actions`：按 `id + client_id` 更新并**校验命中行数恰好 1**，否则中止进 `db_pending`；字段 `video_state`、`published_at`、`permalink`、`first_comment_id`。**必须是读-改-写合并，不得整体覆盖 payload**（以免冲掉授权回执和 `promote_preview`）。
   2. 再写工单 `published_ref`：`video_state='PUBLISHED'`、`published_at`（与上一步**同一个值**）、`permalink`、`ig_crosspost_blocked:true`（第 6 节），清掉旧 `event_ids`；**写前重读工单**：校验 `status='published'` 且 `video_state` 仍是 DRAFT，把改动合并进新读到的 `published_ref`，用**新读到的** `updated_at` 做比对（不用旧值——Meta 调用与此步之间 Instagram 可能已写过工单），失败最多重试 3 次，再失败才进 `db_pending`。
   理由：补发任务（每小时 05 分）只看工单；先写流量记录再写工单，补发任务看到 PUBLISHED 时流量记录一定已对齐，事件不会被适配器以 `not_published` 拒绝（拒绝后不重试，且事件 id 24 小时内去重，测量会永久无声丢失）。
8. 补首评：`facebookReelAdapter.ensureFirstComment({target, videoId, idempotencyTag: woId, message})`，文案 `buildReelFirstComment(brief.copy.endcard, id)`；**重入时第 8 步永远执行**（自带幂等）。失败不回滚公开，回执 `first_comment_status='failed'` + 待办。
9. 信号：**交给现有每小时补发任务发**（它筛 `video_state='PUBLISHED'` 且无 `event_ids`），动作本身不直接发，避免与它抢写 `published_ref`（魏征 M3）。如要更快，实现可把 `emitReelPublishedEvent` 改成条件更新后在动作里调，但必须保持 7→9 的先后。
10. 授权回执标 `consumed`。

**不依赖全局开关是有意设计**：本动作绕过 `FACTORY_PUBLISH_LIVE` 这道全局阀，改由「按条授权」负责；PR 正文必须写明（狄仁杰 L5）。

## 3. 授权怎么按条记录（不新建表；三审改位置）
- **只存一份，放流量记录**：`flywheel_actions.payload.promote_authorization`（该行只有发布/转公开流程写，冲突面小）。工单侧不复制第二份授权数据（避免两份不一致、被覆盖），`published_ref` 只带 `promote_request_id` 一个引用。**不放 `review_ref`**：它是审片回执，`publish-worker.ts:190-196` 每次发布前重验，且 `review-apply.ts`、`review-sync.ts`、`revive/route.ts` 都是读后整体写回，会互相覆盖。
- 内容：`{authorized_by, authorized_at, work_order_id, video_id, page_id, fingerprint, request_id, status: claimed|consumed|failed|meta_published_db_pending, claimed_at}`。
- **互斥锁放在流量记录 `payload` 里的版本号，不碰工单（终检结论，取代子牙上一轮的「工单 `updated_at` CAS」）**：`flywheel_actions` 没有 `updated_at` 列（`20260517000001_flywheel_data_skeleton.sql:18-30`），而工单 `updated_at` 会被 Instagram 轮询写手（`instagram-crosspost-store.ts:133-141` 的 `writeOutput`，草稿模式每 10 分钟都可能碰）改动——CAS 触碰会让进行中的 Instagram 回执写入落空，第 7.2 步又隔着一次 Meta 调用，期间任何 Instagram 写入都会让它命中 0 行。所以：
  - `payload` 内放 `promote_rev`（uuid）。promote 对该行 `payload` 的**所有**写入走：读 `payload` → 合并 → `update({payload: 新}).eq('id',…).eq('client_id',…).eq('payload->>promote_rev', 旧rev)`（首次用 `.is('payload->>promote_rev', null)`），同次写入换新 `promote_rev`，`.select('id')` 判命中行数。数据库对单行 UPDATE 先加行锁再重判 WHERE，并发请求只有一个命中。
  - 0 行命中：预览写入重读重试 3 次；抢占授权那次直接 409。
  - 预览令牌槽、`claimed` 状态、`used` 标记都在同一次 UPDATE 里完成，天然原子。租约放在 `payload.promote_authorization.claimed_at`，不依赖 `updated_at`。
  - 该行目前只被 `writeThreeBooks` 插入一次、没有别的写手更新（已 grep 全仓）；若以后有人改这行 payload 却不带版本号会绕过锁——实现里加代码注释，并加测试「别的写手不冲掉回执」。
- 授权回执和 `promote_preview` 仍存 `flywheel_actions.payload`，在上述版本号保护下做**合并式读-改-写**（不得整体覆盖 payload）。前提成立：`factory_reel_publish` 行目前只被 `publish-worker.ts:348-367` 插入一次，promote 是该行 payload 的唯一后续写手；实现仍须加测试，防止以后别的写手冲掉回执。不需要迁移，**新表也不做**。
- **租约**：`claimed` 超过 5 分钟视为过期，可重新抢占，但**重新抢占必须重新走「预览→确认」拿新令牌**（旧令牌第 5 步已标 `used`，崩溃后的旧请求会被拒，提示「请重新预览」），且重抢后第一步是读回 Meta 状态：仍是草稿则按正常流程继续，已公开则只同步。第 3 步读回与第 6 步 `promoteReelToPublished` 内部的预读是**故意重复**（一个用于红线与指纹，一个用于幂等）。`failed` 与 `meta_published_db_pending` 均可重入。
- 若乐观锁不可行，才考虑数据库函数（需迁移，A 级，另报）。**新表仍不做。**

## 4. 失败与重复点击
- 并发/双击：第二个请求乐观锁失败 → 409。
- Meta 调用失败（视频不属本页、视频已被删除、回读 3 次仍未公开）：`status='failed'` + 人话原因（**区分「视频已不存在」与「不属本页」**），**原因文本必须过 `sanitizeFailReason`，token 不得进库/日志/待办**；工单仍 DRAFT，可再点。
- Meta 成功但写库失败：回执 `meta_published_db_pending` + 待办；再点时回读发现已公开，只做同步写库，不重复调 Meta。
- 进程中途崩溃：靠租约过期恢复（第 3 节）。
- 首评失败/信号失败：不回滚公开，信号由补发任务兜底。
- 不用 `finish`：再调会报 1363130（2026-10-11 CTS 真机验证）。

## 5. 时间取值（三审 H2）
- 新转公开：`published_at` = `promoteReelToPublished` 成功返回的时刻（真正对外可见的时刻），可作 T0。
- **真实时间的保底**：调 Meta 之前先把 `promote_called_at` 写进授权回执；崩溃重入时取「Meta 读到的时间 → 否则 `promote_called_at` 并标 `estimated:true`」，它是上界，比 `now` 靠谱（Meta 的 `created_time`/`updated_time` 是否可信仍未验证）。
- **重入沿用已写的值**：若流量记录里已写入 `published_at`（7.1 成功、7.2 失败后重入），两处一律沿用该值，**不再从 Meta 重取**（否则两处时间对不上，测量接线再次拒绝）；只有流量记录尚无新值时才按下条取值。
- 「已公开→只同步」分支：**不得用 `now`**（`promoteReelToPublished` 已公开分支返回 `new Date()`，会让老帖子「变新」重新进入 IG 48 小时窗口、污染 T+4/T+72）。改从 Meta 读真实发布时间（`created_time` / `updated_time` 哪个可信：**未验证**，实现者先实测）；读不到就写 `published_at_estimated:true` 并回执标 `late_backfill`。

## 6. Instagram 不变量（三审一致高危，设计层面硬措施）
**事实**：Instagram 跟发不靠事件，是每 10 分钟轮询库：`status='published'` + `platform='facebook'` + `published_at` 在 48 小时内（`instagram-crosspost-store.ts:79-84`、`instagram-crosspost.ts:303`）；live 时只放行 `video_state='PUBLISHED'`（`instagram-receipt.ts:395-400`）。转公开把 `video_state` 改 PUBLISHED、`published_at` 刷成「现在」，这条就变成合格候选。要真发还需四个开关到位（`FACTORY_PUBLISH_LIVE`、`FACTORY_INSTAGRAM_LIVE`、`..._LIVE_CLIENTS` 点名、`..._ENABLED_CLIENTS` 点名）；**CTS 是否在名单里：未验证**。
**措施（A 为准，B 作附加证据）**：
- A：第 2 节第 7 步写工单时同时写 `published_ref.ig_crosspost_blocked:true`，并在 `instagram-crosspost.ts` 逐条循环的**最开头**跳过带标记的行——一次覆盖 `listCandidates`/`decideSweep` 决策、`reconcileExisting` 对账、末尾 `emitMissingEvents` 补发三处（对账动作不受 `decideSweep` 的 skip 约束，所以不能只改决策函数），三处各加测试。这是改 Instagram 代码，范围比 v0.1 估计的大，但这是唯一让「转公开不引发 IG 外发」成立的方式。该标记只由 promote 动作写；工单侧其他写手（`recordPublished` 等整体写 `published_ref`）会不会清除它，**实现必须核**并加测试。
- B：上线前在 Render 读出这 4 个变量留证据；CTS 不在名单内更稳。
- 动作代码不引用 `instagram-*` 模块；**测试**：转公开之后跑一遍 `runInstagramCrosspost` 的候选筛选，断言该工单不在候选里、不产生任何 Publer/IG 调用。
- Publer 删除 PR 2756 合并后，整条 IG 交叉发布代码被删除，这条风险随之消失，措施 A 可撤。

## 7. 存量补登记与首版范围
- **不在首版上线范围**：3 条存量（`fa4fdd89`、`7ed7645b`、`e29b0986`，均 CTS）补登记（改流量记录对齐 + 重发事件）另走一次 PM 点头，写库前先报统筹每个字段旧值→新值。T+72 已过，回执必须标 `late_backfill:true`，不当标准快照。去重：事件 id 固定为工单+视频（`reelPublishedEventId`），首次事件窗口内重发会被吞；3 张都已过窗口，重发有效；测量登记另有唯一约束，不会重复建测量。
- `7ed7645b`、`e29b0986` 缺首评：补首评是对外可见动作，单列让 PM 点头，首版不做。
- 另 11 张 CTS 草稿单（均已人工审通过；`cc876dc3` 为 superseded 须排除）：`9fcb4ae6`、`e8c5b66a`、`4bd78644`、`00f23d78`、`fd7e3e5a`、`2ef627ff`、`cb752a8f`、`46fb06b8`、`bb6b51b7`、`ef24296d`、`59282423`。是否已被人在 Facebook 手动公开**未验证**；动作上线后回读自动区分，不批量转公开，哪几条由 PM 与 74 号定。

## 8. 回滚
- 代码回滚：还原实现 PR；不影响每小时发布任务；全局开关未动。
- 单条公开的 Reel **不能改回草稿**（只能删帖=永久删除），所以防线放在授权前：预览、一次性令牌、读回文案红线、指纹、按条授权。撤下只能 PM 在 Facebook 手动处理并登记。
- 数据回滚：授权回执与对齐字段是同一行的 jsonb 合并更新；回滚前先导出旧值清单留档，按条还原。

## 9. 验证与当场试跑（实现 PR 必须）
- 单元测试：演示账号被拒；不在 `ADMIN_EMAILS` 名单被拒；跳过预览直接 confirm 被拒；令牌过期/复用/换管理员被拒；指纹不一致 409；预览后文案被改 409；Meta 草稿文案含红线词被拒（含零宽字符绕过用例）；并发请求用 `promote_rev` 版本号只一个成功；租约过期可恢复且只走读回分支；已公开跳过 Meta 且不用 `now`；流量记录 0 行/多行被拒；`expect_brand`/`from`/`master_brief_id` 缺失被拒；页面三方 id 不一致被拒；写库顺序（先流量记录后工单）；其他写手不冲掉授权回执；清 `event_ids` 后补发任务补发；不引用 instagram 模块且不进 IG 候选，`recordPublished` 与 `emitReelPublishedEvent` 写回后 `ig_crosspost_blocked` 仍在；失败原因脱敏；两位管理员同时预览互不覆盖；重入沿用已写 `published_at`；IG 循环最开头跳过带标记的行（决策、对账、补发三处各一条）。
- 当场试跑：用**测试页面/测试视频的草稿**（不是客户页面）走完整链路，看到工单与流量记录对齐、补发任务发信号、适配器登记 `social.publish_post` 并展开 T+4/T+72；拿不到测试页面则写明原因并开台账卡 `verify_by` = 首条真转公开当天。**不得借试跑公开客户真实 Reel。**
- 写代码走 DeepSeek（CLAUDE.md §5）；Reuse Statement：动作平台共享，适用于任何配了 `publish_target` 的客户，实现代码里不出现客户名或工单 id。

## 10. 三审意见处理对照
| 来源 | 意见 | 本稿处理 |
|---|---|---|
| 子牙 H1 / 魏征 M1 / 狄仁杰 M2 | 授权抢占不原子、放 review_ref 会被覆盖 | 第 3 节：只存一份在流量记录；**互斥锁用流量记录 `payload.promote_rev` 版本号（该表无 `updated_at`；工单 `updated_at` 被 Instagram 写手碰，不适合）** + 租约 |
| 三人 | 转公开触发 IG 跟发 | 第 6 节：跳过标记 + 留证据 + 测试 |
| 子牙 H3 / 魏征 M3 / 狄仁杰 M3 | 写库顺序与补发任务抢写，事件被拒后永久丢 | 第 2 节第 7 步：先流量记录后工单，同一 `published_at`，信号交补发任务 |
| 魏征 H2 / 狄仁杰 H2 同类 | 已公开分支 `published_at` 用 `now` | 第 5 节 |
| 狄仁杰 H1 | 红线闸扫库文案而非 Meta 实际文案 | 第 2 节第 3 步 |
| 狄仁杰 M1 | 域名管理员可触发；预览可绕过 | 第 2 节第 1、4、5 步：名单叠加 + 邮箱绑定的一次性令牌 |
| 子牙 M1 | 流量记录 0/多行 | 第 2 节第 2 步 |
| 魏征 M2 | 崩溃卡死 | 第 3、4 节租约与可重入状态 |
| 子牙 M3 / 魏征 M4 | 指纹太弱 | 第 2 节第 4 步指纹 |
| 魏征 M5 | 收件箱徽章、`resolveTarget` 私有 | 第 2 节、第 6 步 |
| 子牙 M5 | 首评失败无补救 | 第 2 节第 8 步重入永远执行 |
| 狄仁杰 M4 / L1 | 三处 fail-open | 第 2 节第 2 步 |
| 狄仁杰 L2 | 失败原因脱敏 | 第 4 节 |
| 魏征 L2 | 补发任务是每小时不是每 10 分钟；基线重钉 | 已更正；基线 `bd8a2d638` |

**复审点**：子牙 + 魏征 + 狄仁杰各复审一轮，只看上表是否闭合、有无新漏洞；通过后才派 DeepSeek 写代码。

## 11. 没验证到的
CTS 是否在 `FACTORY_INSTAGRAM_*` 名单（Render 变量读不到）；Meta 能否读到视频真实发布时间（`created_time` vs `updated_time`）；`promote_rev` 的 jsonb 路径过滤（`payload->>promote_rev`）在 PostgREST 下的 null/不存在行为（实现者先在测试库实测）；`flywheel_actions.payload` 是否原本有 `first_comment_id`；`recordPublished` 等写手是否会清除 `ig_crosspost_blocked` 或整体覆盖 payload；存量工单现状（沿用 10-18 实查）；74 号实际用哪个页面（已覆盖两处）。
