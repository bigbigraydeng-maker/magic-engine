# Reel「授权后单条转公开」受控动作 · 设计稿 v0.1（97 号，2026-10-18）

- 性质：只是设计稿，没写代码、没写库。**风险级 A**（发布路径、对外不可逆）。实现 PR 必须保持草稿、正文写「风险级别：A」、三审（子牙+魏征+狄仁杰攻击验证）、PM 本人回「合 N」并钉 SHA。
- 依据：本地 origin/main `ad7cc7e1d`（未刷新）；生产库只读；106 号的定位结论（同一根因）。
- 范围：只修「草稿转公开不回写、测量接线被拒」这一个断点。不改全局发布开关、不新建表。

## 0. 一句话
做一个「仅全局管理员、绑定单条工单、授权后才转公开」的动作：先写授权回执，再调现成 `promoteReelToPublished`，成功后**同时**改工单与流量记录的 `video_state`/`published_at`，再发 `me/factory.reel.published`，让测量接线自动通过。

## 1. 为什么断（两个同根问题合一）
- 工厂 Reel 没有任何代码调用 `promoteReelToPublished`（`facebook-reel-adapter.ts:242`；全仓只有讲课片 `lecture-publish.ts:147` 在用），所以转公开只能人手，人手不回写。
- 测量接线 `rebindFactoryReelAction` 要求流量记录（`flywheel_actions`，`action_type='factory_reel_publish'`）的 `payload.video_state==='PUBLISHED'` 且 `payload.published_at` 与事件一致。存量 3 张（`fa4fdd89`、`7ed7645b`、`e29b0986`）工单已是 PUBLISHED，流量记录仍是 DRAFT，适配器按设计拒绝，测量回执为 0。

## 2. 动作流程（顺序不许调换）
路由：`POST /api/factory/work-orders/[id]/promote`（与现有 `review` 路由同目录，新增）；按钮放工厂页 `dashboard/factory/page.tsx:257-260` 已有的「发布时存为草稿」徽章旁，仅在 `status='published'` 且 `video_state='DRAFT'` 时出现。

1. 权限：`requireGlobalAdmin()`（排除限客户的演示账号），记 `authorized_by`。不用只判角色的 `guardAdmin`。
2. 前置校验（任一不过直接 4xx，不碰 Meta）：工单 `status='published'`、`published_ref.video_state='DRAFT'`、人工与自动清单都通过（`checklistPasses`）、`published_ref.video_id` 与流量记录一致、页名匹配 `expect_brand`、重跑 `scanPublishCaption`。
3. **预览一步**：先 `confirm:false` 返回「将公开哪一条：客户、页面、视频 id、成片指纹、文案」，不写任何东西；确认后 `confirm:true` 才继续。
4. 回读 Meta 该视频的 `published` 状态：已是公开（人手已转过）→ 跳过 Meta 调用，只做同步写库（见第 5 节）。
5. 写授权回执并**抢占**（条件更新，见第 3 节）。
6. 调 `promoteReelToPublished({target, videoId})`（代码内幂等：已公开则跳过 POST）。
7. 成功后同一步改两处，取返回的同一个新 `published_at`：
   - `content_work_orders.published_ref`：`video_state='PUBLISHED'`、`published_at`、`permalink`；**清掉旧 `event_ids`**（否则 `emitReelPublishedEvent` 的短路不再喊，publish-worker.ts:409-412）。
   - `flywheel_actions.payload`：`video_state`、`published_at`、`permalink`、`first_comment_id`（与工单一致）。
8. 补首评：`facebookReelAdapter.ensureFirstComment({target, videoId, idempotencyTag: woId, message})`，文案用 `buildReelFirstComment(brief.copy.endcard, id)`；草稿阶段首评被跳过，转公开后不会自动补。失败不回滚转公开，写进回执 `first_comment_status='failed'` 并进今日待办（有 what/how/href）。
9. 发 `me/factory.reel.published`（`buildReelPublishedEvent`）并把 `event_ids` 写回；失败也不回滚，靠现有每小时 `reconcileMissingReelEvents` 补发（它筛 `video_state='PUBLISHED'` 且无 `event_ids`）。
10. 授权回执标 `consumed`。

**决策（不问 PM）**：事件在动作里直接发，补发任务只做兜底；不另加「手动确认发事件」闸（授权已在第 3 步，事件不对外发布）。**重要**：授权校验和 Meta 调用必须都先于第 7 步写库，否则每小时补发任务会在授权前就把事件喊出去（它只看 `video_state`）。

## 3. 授权怎么按条记录（不新建表、不复用全局开关）
选项 A（推荐）：写进 `content_work_orders.review_ref.promote_authorization`（jsonb，不改表结构），并复制一份到流量记录 payload：
`{authorized_by(email), authorized_at, work_order_id, video_id, page_id, content_fingerprint(video_id+成片路径哈希), request_id, status: claimed|consumed|failed}`。
- 谁：`authorized_by`；何时：`authorized_at`；哪一条：`work_order_id`+`video_id`；绑定内容：`content_fingerprint`。预览返回指纹，确认必须带回，不一致返回 409（照 Story 授权做法）。
- 只对这一条有效、一次性；全局 `FACTORY_PUBLISH_LIVE` 不参与，也不被改动。
选项 B（不推荐）：只写 `published_ref.promoted_note` 文本——无法机器校验、绑不住视频。
若以后要跨工单审计，才需要新表，那是另一张 A 级卡，本稿不做。

## 4. 失败与重复点击
- 重复点击/并发：第 5 步用条件更新抢占（仅当 `review_ref->promote_authorization` 为空或 `status='failed'` 时写入 `claimed`），第二次请求读不到抢占成功，返回 409「正在处理/已处理」。
- Meta 调用失败（含视频不属本页、回读 3 次仍未公开）：`status='failed'` + 原因，工单仍是 DRAFT，页面显示失败原因，可再点（再点会重新预览、重新抢占）。
- Meta 成功但写库失败：工单仍显示 DRAFT，但视频其实已公开。再点一次时第 4 步回读发现已公开，只补同步写库，不重复调 Meta。另在回执标 `meta_published_db_pending`，进今日待办。
- 首评/事件失败：见第 2 节 8、9，不回滚公开。
- 不用 `finish`：再调会报 1363130（2026-10-11 CTS 真机验证过）。

## 5. 存量补登记（写库前先报统筹，PM 点头后才做）
**3 张已公开、无回执**：`fa4fdd89`、`7ed7645b`、`e29b0986`（均 CTS）。
- 做法：对每张走同一个动作的「已公开→只同步」分支：改 `flywheel_actions.payload`（`video_state`/`published_at`/`permalink`/`first_comment_id`）与工单 `published_ref` 对齐，清 `event_ids`，重发事件。
- 去重窗口：事件 id 固定为工单+视频（`reelPublishedEventId`），首次事件窗口内重发会被吞；3 张都已过窗口，重发有效；测量登记另有唯一约束，不会重复建测量。
- **T+72h 已过**：10-12 的两条补登记测的是「现在的累计数据」，不是严格 T+4/T+72 快照；回执必须标注 `late_backfill: true`，不得当标准 T+4/T+72 数据使用。
- `7ed7645b`、`e29b0986` 缺首评：补首评是对外可见的动作，**单独列出让 PM 点头**，不随同步一起做。
- 写库前报统筹：每条要写的字段旧值→新值清单。

**另 11 张 DRAFT（近 60 天，全 CTS，均已人工审通过，另有 1 张 `cc876dc3` 为 superseded 须排除）**：`9fcb4ae6`、`e8c5b66a`、`4bd78644`、`00f23d78`、`fd7e3e5a`、`2ef627ff`、`cb752a8f`、`46fb06b8`、`bb6b51b7`、`ef24296d`、`59282423`。是否已被人在 Facebook 手动公开：**未验证**（库里看不出）。动作上线后第 4 步回读会自动区分；是否要公开哪几条由 PM/74 号决定，本稿不批量转公开。

## 6. 回滚
- 代码回滚：还原实现 PR，不影响现有每小时发布任务；全局开关未动。
- **单条公开不可撤回到草稿**（Meta 不支持把公开 Reel 改回草稿；只能删帖，属永久删除）。所以防线放在授权前：预览一步、成片指纹、人工清单通过、按条授权。撤下只能 PM 在 Facebook 手动处理并登记。
- 数据回滚：授权回执和对齐字段是追加/覆盖同一工单的 jsonb，回滚方式是按预先记录的旧值逐条还原（存量补登记前先导出旧值清单留档）。

## 7. 验证与当场试跑要求（实现 PR 必须）
- 单元测试：权限（演示账号被拒）、指纹不一致 409、并发抢占只一个成功、已公开跳过 Meta、Meta 成功写库失败可重入、清 `event_ids` 后事件被补发、不改全局开关。
- 当场试跑：用一个**测试页面/测试视频的草稿**（不是客户页面）走完整链路，看到工单与流量记录对齐、事件发出、适配器登记 `social.publish_post` 并展开 T+4/T+72；拿不到测试页面则写明原因，并开台账卡 `verify_by` = 首条真转公开当天。**不得借试跑公开客户真实 Reel。**
- 写代码默认走 DeepSeek（CLAUDE.md §5）；A 级设计稿送审前，库里字段形状以本稿第 1–2 节实查为准，实现者复核。

## 8. 与其他工作的边界
- 106 号只做定位、不做修；其结论（转正要同步流量记录、事件 id 去重、`event_ids` 短路、T+72 已过）已全部并入本稿。
- 后续 B 级「表现回执接进下一轮计划」依赖本动作先把数据跑起来，另开。
- **Instagram 不变量（统筹 10-18 要求）**：「转公开」只做 Facebook。动作代码不得 import 或调用任何 Instagram 交叉发布模块，也不得读写 `FACTORY_INSTAGRAM_*` 开关。查证：origin/main 上 IG 交叉发布走 Publer，须同时满足 `FACTORY_PUBLISH_LIVE`、`FACTORY_INSTAGRAM_LIVE`、`FACTORY_INSTAGRAM_LIVE_CLIENTS` 点名、`FACTORY_INSTAGRAM_ENABLED_CLIENTS` 点名四样才真发，缺一样只存草稿，未配则一条都不处理（`cron/factory-publish-worker/route.ts:63-64`、`ENV.md:196,201,202`）。CTS 是否在名单里：Render 变量读不到，**未验证**；按 fail-closed 处理，即使在名单里本动作也不触发它。另外 Publer 删除 PR 2756 合并后，整条 IG 交叉发布代码被删除，这个风险随之消失。测试：断言动作模块不引用 instagram-*，且转公开后不产生任何 Publer/IG 调用。
- **首版范围（统筹 10-18 定）**：首版只含单条转公开动作。存量 3 条补登记、缺首评补发**不在首版上线范围**，另走一次 PM 点头；补首评是对外可见动作单列。第 2 节第 8 步「补首评」在首版只对**本次新转的这一条**执行（授权预览里写明会补首评），存量不动。

## 9. 没验证到的
Meta 对重复 `published=true` 的真实行为（代码已绕开）；Inngest 控制台是否能看到 10-11/12/13 适配器拒绝记录；74 号实际用哪个页面操作；11 张 DRAFT 在 Facebook 上的真实状态；Render 上 `FACTORY_INSTAGRAM_ENABLED_CLIENTS` 的值。
