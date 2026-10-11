# Story 自动发布（Facebook + Instagram）— 设计稿 v0.2（子牙 + 魏征第一轮审后修订，未批，未开工）

> **v0.2：第一轮审查两人都判「需改后再审」（子牙 2 阻塞 + 若干必改；魏征 1 阻塞 + 9 必改）。§12.1 逐条处置；正文已按处置改过，与 §12.1 冲突时以 §12.1 为准。本稿仍未经第二轮审查，不能当作已审定稿。**

- 窗口：84 号 · 日期：2026-10-12 · 风险级别：**A**（对外发布 + 授权 + 不可逆副作用）
- 基线：HEAD `6ecfa2790`，`origin/main` 本地记录 `ef7413949`（未刷新，只能称本地快照）
- 状态：**只出方案**。不写代码、不改库、不向任何主页发任何东西。PM 回「批」之前不派代码；代码一律由 DeepSeek 写。
- 起因：PM 2026-10-12 在 74 号窗口撤销了 [10-10 设计稿](./2026-10-10-daily-plan-auto-publish-design.md)里「IG 图文、Story 不做」的决定——Story 可以做，并要加大内容量。
- 关联：[每日计划自动发布 §12/§16/§18](./2026-10-10-daily-plan-auto-publish-design.md) · [社媒发布治理 v0.2](./2026-09-29-social-content-publish-governance-v0.2.md) · [广告手册 §5 内容规则](../sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md) · [CTS 总方案 §3.2e](../clients/cts/2026-10-11-cts-ads-master-plan-v1.0.md)

---

## 0. PM 版结论（先看这里）

**第一件事：能做，分三刀，第一刀不碰数据库、不发任何东西。**
Facebook 主页 Story 有官方发布接口，照片和视频都行；Instagram Story 也有。要不要新的应用审核：Instagram 发布权限文档写「需要标准或高级访问」，**我没向 Meta 求证 CTS 这个应用够不够**，按「未核实」处理，第一刀用真实调用验。

**第二件事：有 4 个硬条件，现在有 2 个没满足。**
①CTS 的 Instagram 还没登记进商务账户（你名下 10-16 到期那张卡）。②发 Instagram 要一个**独立的新授权**，不能动现有 Facebook 授权（动了会把现有连接悄悄弄断）。③Story **没有「定时发」接口**（文档没写），所以必须到点由系统当场发，错过就不补。④Story **发出后不能靠接口撤回**（文档没写），所以「发之前」的闸要比图文 Post 更严。

**第三件事：量加大后，瓶颈不在审核，在「素材事实库够不够」。**
每天 3 条 Story + 2 条图文 + 每周 3 条 Reel，一周约 38 条要审。我的办法是：机器闸先挡掉格式、价格、禁用词、来源缺失；苏东坡 / 马良审内容；你**一周只点一次「整包授权」**，不是 38 次——但那一次点击要求你**确认看过价格类、带地名画面、视频类每一条**（§4.4-2），不是闭眼点。但事实库现在有多少条**我没数过**（未核实），开发前必须先盘点，不够就先降量，绝不编。

**第四件事：设计稿批下来之前，CTS 员工在 Meta Business Suite 手动发。**
一页操作清单在本文 §9，可以今天就交给员工用。

**待你一句话定（一次一件）：** 审查通过后，量先按「每天 1 条 Story 起步、事实库够了再升到 3 条」，还是一开始就 3 条？
回 `起步` 或 `直接3条` 就行。（这一条不挡审查，审完再回我即可。）

---

## 1. 平台层级判定（Tier Gate · Full，按 CLAUDE.md 铁律 0 与 me-platform-tier-gate）

- **被判定对象**：「已审核 + PM 已整包授权的 Story，到点由系统提交给 Facebook 主页 / Instagram，并在 24 小时内回读效果」。
- **层级**：**L1 既有「社媒」支柱 Act 段的扩展 + L3 Meta Connector 的新增方法。不是新能力线，不新增支柱，不占候选名额（红线 3 显式排除 L3）。**
  - 发布方法加在既有 `src/lib/meta/page-posts.ts` 旁（Facebook 主页 Story 的照片 / 视频两个方法）；Instagram 另起一个 Instagram 适配器文件，放同一个 `src/lib/meta/` 目录，不新开第二套 Meta 客户端。
  - 授权 / 回执 / 开关 / 待办全部沿用每日计划那套，不新造一套治理。
- **换客户测试 ✓**：客户名、主页号、Instagram 账号、时段、每日条数、到期日全部来自授权回执与客户配置。换成 East Inter 或悉尼地产客户，共享代码不改。**CTS 专属的一切（路线图卡、出发日卡、销售窗口到 11/30）只进客户配置与素材库，不进共享代码。**
- **换行业测试 ✓**：价格闸「有报价才核对」，没有报价的行业直接过；行业差异（发布时段、卡片模板）进 Profile / 配置。**唯一需要警惕的**：「Story 不放链接、靠回复引导」是 Meta 接口限制（§3.5）造成的，不是旅游行业判断，写在 Connector 层而不是 Playbook 层。
- **红线**：1 ✓ 不包装升级 · 2 ✓ 无客户事实进共享代码 · 3 ✓ 不直建 L1 · 4/5 ✓ · 6 不适用（非 L1）· 7 ✓。
- **PM 拍板项**：无新支柱 / 新版本 / 抽佣。数据库迁移（§5）属 A 级，须 PM 本人批。

---

## 2. 现状核实（对照代码与台账，不凭记忆）

| 项 | 核实结果 |
|---|---|
| 现有 Facebook 发布 | `publishPagePhotoPost` 在 `src/lib/meta/page-posts.ts`；全仓 `src/lib` 里没有 Story 发布调用（grep 过 `story` / `STORIES` / `photo_stories` / `video_stories`，命中的都是读取侧 `readPageStoryId`，那是读「帖子的 story_id」，**与 Story 功能无关，名字撞了**） |
| 自动发布骨架 | 已合并：授权表、尝试表、Inngest 每小时发布器、今日待办、`confirm-unknown`。**默认只演练，真发开关没开，10 项清单没做完**（10-10 稿 §18）。Story 能复用的是「授权绑版本、两层开关、占位先于发送、不确定不重试」这些**做法**，不是直接复用表——见 §5 |
| Instagram | 无发布线。10-07 台账卡：改走 Meta 官方接口「能做，暂缓」；SOP 写明授权**必须是独立新用途，不改动现有 Facebook 授权** |
| CTS Instagram 账号 | 专业号 chinatravelservices，已挂在 CTS Tours 主页下，**未登记进商务账户**（台账卡 `2026-10-09-cts-instagram-register-into-business`，`verify_by` 2026-10-16，要 PM 或 Pengyu 本人登录 Instagram 点，约 3 分钟） |
| 广告的 Story 版位 | 总方案 §3.2e：广告用 9:16 素材会自动适配 FB/IG 快拍版位。**那是广告，不是自然发布的 Story，两件事别混** |

---

## 3. Meta 官方接口核实（读官方文档，2026-10-12；读不到的标「未核实」）

出处（均为 Meta 官方，2026-10-12 通过网页抓取读取；抓取工具返回的是摘要，**没有逐字对照原网页，凡关键数字开发前须再读一次原文**）：
[A] https://developers.facebook.com/docs/page-stories-api
[B] https://developers.facebook.com/docs/instagram-platform/content-publishing
[C] https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights
[D] https://developers.facebook.com/docs/graph-api/reference/page/insights

### 3.1 Facebook 主页 Story [A]

| 能做什么 | 做法（文档所述） |
|---|---|
| 照片 Story | ① 向 `/{page_id}/photos` 上传，`published=false`；② `POST /{page_id}/photo_stories`，带 `photo_id`；返回 `success`、`post_id` |
| 视频 Story | ① `POST /{page_id}/video_stories`，`upload_phase=start`，得到 `video_id` 与 `upload_url`；② 上传（`file_url` 指向托管文件，主机必须是 `rupload.facebook.com`，或直接传二进制）；③ 可选 `GET /{video_id}?fields=status`；④ `POST /{page_id}/video_stories`，`video_id` + `upload_phase=finish` |
| 列出 Story | `GET /{page_id}/stories`，每条有 `post_id`、`status`（PUBLISHED / ARCHIVED）、`creation_time`、`media_type`、`media_id`、`url`；可 `since` / `until`。**要看已归档的 Story，主页的「Story 归档」必须开着** |
| 权限 | `pages_manage_posts`、`pages_read_engagement`、`pages_show_list`；用商务系统用户时另需 `business_management`；操作者在主页上要有 `CREATE_CONTENT` 任务权限 |
| 规格 | 照片：jpeg/bmp/png/gif/tiff，≤10MB；视频：mp4，**9:16**，推荐 1080×1920、最低 540×960，24–60 帧，H.264/H.265，音频 AAC-LC 48kHz；时长文档自相矛盾（规格写 3–90 秒，限制处写不超过 60 秒）——**我们的 Story 视频一律 ≤15 秒，绕开这个矛盾** |
| **限制** | **「之前已发布成帖子的照片 / 视频，不能再拿来发 Story」**；托管文件所在网站的 robots.txt 若屏蔽 `facebookexternalhit`，会被拒；fbcdn 链接不接受 |
| **未写 / 未核实** | **是否支持定时发布（`scheduled_publish_time`）：文档没写，按「不支持」设计**；删除 / 撤回接口：没写；频率限制：没写；贴纸 / 链接：没写；Story 的观看 / 点击 / 回复指标：只有一个「Stories Insights Reference」的链接，**未读到具体指标** |

### 3.2 Facebook 主页 Story 的效果数据 [D]

主页 insights 文档的 Stories 一节只有 `post_activity_by_action_type`（「有多少人把你的主页帖子**分享成**了 Story」），**没有 Story 的观看 / 触达 / 点击 / 回复指标**。结论：**Facebook 侧 Story 的效果数据，官方文档里读不到——标「未核实」**。回读这一侧只做「存在性核对」（`GET /{page_id}/stories` 看它是否 PUBLISHED），不假装有观看数。

### 3.3 Instagram Story [B]

| 项 | 文档所述 |
|---|---|
| 创建 | `POST /{IG_ID}/media`，`media_type=STORIES`，`image_url` 或 `video_url`（必须在公网可访问） |
| 发布 | `POST /{IG_ID}/media_publish`，`creation_id` = 容器 id；返回媒体 `id` |
| 查状态 | `GET /{container_id}?fields=status_code`，建议每分钟一次、最多 5 分钟 |
| 账号条件 | **必须是 Instagram 专业账号**（CTS 已是）。Story 一节没写必须关联主页；若关联的主页要求「Page Publishing Authorization」而没完成，发布会被拦 |
| 两种登录方式 | ① Instagram Login：`graph.instagram.com`，Instagram 用户令牌，权限 `instagram_business_basic` + `instagram_business_content_publish`；② Facebook Login：`graph.facebook.com`，主页令牌，权限 `instagram_basic` + `instagram_content_publish` + `pages_read_engagement`（若主页角色经商务账户授予，另加 `ads_management` / `ads_read`）。两种都要标准或高级访问 |
| 频率 | 每 24 小时滑动窗口 100 条 API 发布（`media_publish` 上计）；文档**没说 Story 是否计入** |
| **未写 / 未核实** | **Story 在两种登录里分别支不支持：文档没分开写**；Story 的比例 / 时长 / 格式要求：**没写**（只写了 JPEG 是唯一支持的图片格式）；贴纸 / 链接 / 文案：**没写**；删除接口：没写；`alt_text` 对 Story 不适用 |

**我选哪条登录路线（设计决定，待子牙二审）**：走 **② Facebook Login（主页令牌）**——现有令牌管理（`token-manager.ts` / `page-binding-service.ts`）围绕主页令牌建好，复用最多。**代价**：要新增 `instagram_basic` / `instagram_content_publish` 两个权限，**这必须走独立的新授权**（10-07 SOP 与记忆「改 OAuth 范围会悄悄弄断现有连接」两处都这么要求），不许在现有授权里加范围。Story 在这条路线下是否真能发：**未核实，第一刀必须用真实调用验证**，验不过就改走 ① 或停。

### 3.4 Instagram Story 的效果数据 [C]

- 可用指标（文档的 STORY 行）：`views`、`reach`、`replies`、`shares`、`navigation`（带 `story_navigation_action_type` 拆分：`TAP_FORWARD / TAP_BACK / TAP_EXIT / SWIPE_FORWARD`）、`link_clicks`、`profile_visits`、`profile_activity`、`follows`、`total_interactions`、`reposts`、`facebook_views`；`impressions` 对 2024-07-02 之后创建的媒体已弃用；`total_views` 仅 Facebook Login。
- **Story 指标只保留 24 小时**（文档原话「only 24 hours」）。文档建议订阅 `story_insights` webhook 抢在过期前拿；**该 webhook 不支持 Instagram Login**（所以选 Facebook Login 还多一个好处）。数据可能延迟最长 48 小时（通用说明）。
- **值小于 5 时接口返回错误码 10**——所以小号的 Story 很可能读不到数。**必须记成「没测成」，不是 0。**
- `replies` 在欧洲 / 日本用户创建的 Story 上恒为 0；澳新不受影响。
- 权限：Facebook Login 下 `instagram_basic` + `instagram_manage_insights` + `pages_read_engagement`。

### 3.5 对设计的硬约束（从上面推出来的）

1. **没有定时接口 → 到点当场发。** 不能像图文 Post 那样「交给 Facebook 定时」。错过窗口（晚于预定时间 N 分钟，N 暂定 20，配置项）就判 `MISSED_WINDOW`，**不补发**——24 小时就消失的内容，迟到一小时等于发错时段。
2. **没有撤回接口 → 发送前闸加严，发送后只能手动删 + 等 24 小时自然过期。** 图文 Post 的「撤回墓碑」机制对 Story 不成立；取而代之的是「发送前一刻再复核授权 + 内容指纹」（§4.3）。
3. **链接 / 贴纸：文档没写，「按不支持设计，待真实调用验证」（不是已查实不支持）→ Story 的行动号召只能靠「回复」。** 总方案里「点击贴纸」指标在自动发布路径上**没有来源**；`link_clicks` 在没有链接贴纸时没有意义。设计里回读指标取 `views / reach / replies / shares / navigation`，不承诺点击。**人工在 Business Suite 里加链接贴纸是否可行：未核实**（§9 里员工如实记录）。
4. **Facebook：用过的图 / 视频不能再发 Story。** 这直接限制素材：**Story 必须用「没发过帖子的专属文件」**；从已发布 Reel 里剪片段做 Facebook Story，是否被判「已用过」：**未核实，第一刀用一次真实调用验证**；验不过前，Reel 片段只做 Instagram Story。
5. **视频一律 ≤15 秒、9:16、1080×1920**，绕开时长矛盾；照片 JPEG。

---

## 4. 目标行为与架构

### 4.1 人话版

1. 每周内容团队出一个**「Story 周包」**：7 天 × 每天若干条，每条带正文、画面、来源、发布时段、发布渠道（FB / IG / 两者）。
2. 每条先过**机器闸**，再过**苏东坡 / 马良**审核（生产方 ≠ 质检方）。
3. PM 在后台看一页**整包预览墙**（每条的最终画面 + 文案 + 来源 + 机器闸结果，**有问题的排最前**），点**一次**「授权这一包」。授权绑**这一版周包的每一条内容指纹**。
4. 到点，系统逐条走全部闸、当场发、读回执、24 小时内按计划回读效果。
5. 任何一步拦下或失败：**不静默**，变今日待办（说清 what / how / 直达链接）。没授权、被撤、内容被改过（指纹变了）：**永远不发**。

### 4.2 流程与事件（Inngest，CLAUDE.md 铁律 3）

```
内容团队出周包 ─▶ story.pack.drafted
机器闸 + 苏东坡/马良审 ─▶ story.item.reviewed          （只推进，不等于授权）
PM 整包授权 ─▶ POST .../story-pack/authorize ─▶ story.pack.authorized   （写授权回执，先演练、全闸过才让授权）
Inngest 定时发布器 cloud-story-auto-publish（每 5 分钟 NZ 时区；Story 要按「条」到点，不能每小时一次）
  函数配置：`retries: 0`、`concurrency: {limit: 1}`（沿用现有每日计划发布器，防重叠与 step 重试致重复发帖）；
  一次扫描只做「领取 + 发送」，**不在扫描里长时间轮询**：Instagram 容器状态查询（最长约 5 分钟）拆成独立事件 `story.ig_container.created` 由另一个函数接力，避免一次扫描拖过 5 分钟与下一轮重叠。
  for 每条「到点且授权有效」的 (item, channel)：
    step.run(claim)      ─ 占位（唯一键 (item_id, channel)），先占后发
    step.run(precheck)   ─ 发送前一刻再复核：授权仍有效（**读库不读缓存**）/ 内容指纹一致 / 开关 / 白名单 / 价格闸 / 客户与活动状态 / 同包熔断状态；**并重新下载实际要交给 Meta 的文件重算哈希**（见 §4.4-2）
    step.run(publish)    ─ Instagram 两段式：先建容器，**容器 id 立刻落库**再发布；崩溃后不得重建容器；异常变数据，不抛
    step.run(receipt)    ─ 有 provider 回执就记 PUBLISHED_UNVERIFIED，写 story.publish.attempted
    step.run(confirm)    ─ 回读 GET /{page_id}/stories 或 IG 媒体；确认了升为 PUBLISHED；**回读失败不降级、不重发**，只出待办
  崩溃后规则：任何 CLAIMED 超过 10 分钟（配置项）仍无终态的行，下一轮一律转 UNKNOWN_OUTCOME + 待办，**永不自动重发**（Story 没有撤回接口，比图文更要紧）。
  回读器 cloud-story-insights-readback：见 §7
失败/拦截/不确定 ─▶ 今日待办（拉模式，沿用 price-fact-items.ts 的做法）
```

事件名（业务可读）：`story.pack.drafted` · `story.item.reviewed` · `story.pack.authorized` · `story.pack.revoked` · `story.publish.attempted` · `story.publish.confirmed` · `story.insights.captured` · `story.circuit.tripped`。

### 4.3 机器可读回执（每个阶段都有，字段齐）

每条事件 / 回执至少包含：`request_id`、`client_id`、`pack_id`、`item_id`、`source_record_id`（素材事实库条目编号）、`channel`（`facebook_story` / `instagram_story`）、`status`、`provider_receipt`（Facebook 返回的 `post_id` / Instagram 的媒体 `id`，**没有则为 null，不许伪造**）、`authorization_id`、`authorization_state`、`content_hash`、`mode`（`DRY_RUN` / `LIVE`）、`provider_impact`（`NONE` / `STORY_PUBLISHED`）、`cost_usd`（0）、`created_at`。

`status` 取值：`DRY_RUN` · `CLAIMED` · `PUBLISHED_UNVERIFIED`（拿到 provider_receipt，回读还没确认）· `PUBLISHED`（**必须有 provider_receipt 且回读确认**；回读失败只停在上一档，不降级、不重发）· `BLOCKED`（带 `reason_code`）· `FAILED_FINAL` · `UNKNOWN_OUTCOME` · `MISSED_WINDOW` · `SKIPPED_NOT_AUTHORIZED`。

### 4.4 Fail-closed（沿用每日计划做法，Story 更严）

1. 没有 PM 授权回执 → 不发。授权人只认全局管理员名单（`isGlobalAdminEmail`），授权带到期日（默认 7 天，对应周包），发送前复核授权人仍在名单。**授权沿用两段式激活**：先写未激活行 → 发 `story.pack.authorized` 事件 → 再激活（`activated_at`）；事件或激活失败按 id 回滚；读授权的所有地方只认「已激活 + 未撤 + 未过期」（同 10-10 稿 §16）。同一周包同一时刻只许一份有效授权（部分唯一索引，对应现有 `daily_plan_auto_publish_auth_active_plan_idx`）。
2. **授权不是橡皮图章**：授权按钮前必须显示「审查结论 + 风险摘要」，PM 必须勾选「已看过全部 N 条；其中价格类 M 条、带地名画面 K 条、视频 V 条已逐条打开」才能点——这三类**每条单独列出、默认折叠不可跳过**。「预览墙看 10 分钟」只是我的未实测估计，**首周手动过渡期与首批授权后按实测改本稿**，不拿它当设计依据。
3. 授权绑**每条内容指纹** = 正文 + 画面文件哈希 + 来源 + 渠道 + 时段 + `client_id` + `page_id` / Instagram 账号编号 + 授权到期日。指纹变了 = 授权对这一条失效，**不是整包失效、也不是悄悄放行**。
   **指纹必须覆盖「真正发出去的那个文件」**：素材以公网地址交给 Meta（Instagram 是 Meta 自己去抓，Facebook 视频走 `rupload` 的 `file_url`），所以必须用**不可变存储路径**（带内容哈希的文件名，写入后不可覆盖），且 `precheck` 重新下载该地址、重算哈希，与指纹比对；对不上 = `BLOCKED(FILE_CHANGED)`。这同时回应 10-10 稿 §16.6 的「预览与确认之间的内容绑定」缺口。
3. 两层开关，默认只演练：`STORY_AUTO_PUBLISH_LIVE` 严格等于 `true`，**且**客户在 `STORY_AUTO_PUBLISH_CLIENTS` 名单，**且**渠道在 `STORY_AUTO_PUBLISH_CHANNELS` 名单（Instagram 单独开，因为它依赖独立授权与商务账户登记）。任一不满足 = 走完全部检查、不调 Meta、只写演练回执。
4. 失败分类沿用 10-10 稿 §6：「确定没发出去且可重试」「确定没发出去重试没用」「不确定有没有发出去」；**不确定的绝不自动重试**，由 PM 去主页 / Instagram 核对后用 `confirm-unknown` 类接口登记真相。Story 因没有撤回接口，**不确定类的处理优先级高于图文**：待办里要写「24 小时内会自己消失，但在那之前客户看得见」。
5. 整包暂停口径：同一周包里任一条在授权前演练被拦，该条不入授权范围并出待办；**已授权后发现某条有问题**，PM 点「停这一条」或「停整包」，发布器 `precheck` 读库即停（要有测试：停了之后下一轮零 Meta 调用）。已发出去的只能手动删（待办里写清路径：Business Suite → 内容 → Story → 删除，见 §9）。
5b. **熔断（`story.circuit.tripped`）触发条件**：同一周包里任一条出现 `UNKNOWN_OUTCOME`、或被人工标记「已手动删除」、或同一渠道连续 2 条 `FAILED_FINAL` → **同包后续条目自动暂停**，出一条待办，PM 逐条确认后才解封。原因：Story 无撤回，一条出事时后面的不能照发。
6. 客户非 `active`、活动非 `active`、主页 / Instagram 账号编号与授权不一致（`PAGE_ID_MISMATCH` 同类）→ 不发。

---

## 5. 数据库（A 级，须 PM 本人批；本稿只写需求，不建表）

10-10 稿的尝试表唯一键是 `(plan_id, date)`——**一天最多一条**，与「每天 3 条 Story × 2 渠道」**结构上冲突**。选项：

- **建议（待子牙二审）**：新增 `story_pack_items`（周包条目：内容指纹、状态、渠道、时段）与 `story_publish_attempts`（唯一键 `(item_id, channel)`）两张小表，授权复用 `daily_plan_auto_publish_auth` 的思路但**另建 `story_pack_auth`**（授权绑 `pack_id` 与条目指纹集合），均走 service-role 模板 `FOR ALL TO service_role USING (true)`。
- 备选：改现有尝试表唯一键。**不推荐**——动已上线的表会碰 Facebook 图文自动发布的占位逻辑，风险叠加。

补充：RLS 必须写 `TO service_role`；授权表加「同一周包同时只有一份有效授权」的部分唯一索引；Instagram 新授权的令牌**用独立存储位，不覆盖现有主页令牌记录**；新授权的权限清单同时列 `instagram_manage_insights`（回读要用）。
**部署顺序**：先建表，再上代码（10-10 稿 §16 的教训）。

---

## 6. 内容规格（Story 专用；文案红线沿用，不重写）

**画面**
- 竖版 **9:16**，1080×1920。**上下各留约 250px 安全区**给界面（头像条、回复框）；文字与 logo 不进这两条带。Reel 的安全区（y270–1248）是另一套，Story 以本条为准，**数值是 PM 给的约数，第一刀用 Facebook / Instagram 真实预览截图验一次再定死**。
- 字幕 / 文字：短句大字（中老年受众，沿用 CTS 记忆），不快闪；每条 Story 画面停留时长由 Meta 决定（图片默认几秒，**未核实**），所以**一条 Story 只讲一件事**。
- logo 完整清晰；画面里**不烧价格和日期**（沿用手册 C-10 ④，价格写在文案里，降价不用重做图）。**Story 没有可点链接的前提下，价格要不要出现在 Story 里**：建议**不放具体价格**，只放「某地出发 / 含什么」，价格引导到回复或主页——这是设计建议，PM 可改。
- 带地名的画面只用已核对可靠的镜头；真实产品 / 真实价格画面只能用客户自己提供的素材（CLAUDE.md §8）；客人肖像 PM 未拍板，**一律不用**。

**文案红线（沿用 [手册 C-11](../sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md) 与 CTS 总方案）**
不写余位 / max / 限人数 / 免签 / 航司；不写 cheapest / lowest；不写原价 / 现价 / 立省；不编评价；价格只写官网可溯措辞，**发前核官网实测页面**；AU / NZ 英语拼写；对外不出现真实供应商名；客户禁用词读 `clients.brand_redline_phrases` + `master_briefs`。发布前复用既有两道价格闸（`price-claim-gate` / `price-fact-gate`）。

**每条必须记录来源**（机器强制非空，缺 = 拦）：
`source_record_id`（事实库条目）· `website_ref`（官网页面 URL + 核对日期）· `visual_ref`（素材编号 + 来源标签：客户实拍 / 客户提供 / 图库 / 工厂生成）· `place_verified`（带地名画面是否核对过）。**无来源就是 `BLOCKED`**，不是警告。

**新增检查项（魏征审出的缺口）**
- **画面里烧进去的字**：机器闸只管文案管不到图。9:16 图 / 视频里的字（价格、余位、免签、航司）要加**图片文字识别 + 苏东坡 / 马良逐图核对项**（HUMAN 项，留审核记录）；识别引擎现在没有，**列为刀一的前置调研，不假装已有**。
- **视频必须有声音（有配乐 / 人声之一）+ 有字幕**：沿用 D14 事故教训；音轨检测引擎现在不存在（治理 v0.2 §4 已承认），第一版靠 HUMAN 项逐条听过并记录。
- **带地名画面**：`place_verified` 不是布尔，要记**核验人 + 核验时间 + 依据**。
- **客人肖像**：PM 未拍板，**默认不用**；机器无法识别人脸，所以做成 HUMAN 项「本条画面不含可辨认的真人面孔，或有书面授权」并留记录，**不写成机器已保证**。
- **行动号召落在「回复」**：Story 无链接，号召只能是「回复了解」。所以必须有人接这些回复：**回复 SLA（暂定工作日 4 小时内，配置项，PM 可改）与接收人由 74 号定**；没人接就不要发带「回复」号召的 Story。
- **Facebook 专属**：画面文件**不得出现在任何已发布帖子 / Reel 里**（§3.5.4）。机器闸依赖素材表的「已用于帖子」标记，**该标记的写入方 = 每次 Post / Reel 发布成功的回执写入处（共用发布核心、工厂发布器各加一行写入）**；标记缺失时按「未知」处理，**拦截而不是放行**；此项第一刀就要建，否则这道闸是空的。

---

## 7. 发出后「效果回读」窗口与指标

Story 24 小时就消失，**回读窗口比图文 Post 的 T+4h / T+72h 短得多**，而且 Instagram 的 Story 指标本身只留 24 小时。

| 时点 | 动作 | 渠道 |
|---|---|---|
| T+0（发送后立即） | 回读确认：Facebook `GET /{page_id}/stories` 看到该 `post_id` 且 `PUBLISHED`；Instagram 取媒体 id 与 `media_product_type` | 两个 |
（下面的 T+2h / T+12h / T+22h 只是**节奏选择，没有数据依据**；首批实测后再调。）

| T+2h | 第一次取指标 | Instagram |
| T+12h | 第二次 | Instagram |
| **T+22h** | **最后一次，必须在 24 小时过期前**；同时订阅 `story_insights` webhook 作双保险（文档建议；Facebook Login 才支持） | Instagram |
| T+24h 后 | 核对状态变 `ARCHIVED` / 已过期；写总回执 | 两个 |

**指标**：`views`、`reach`、`replies`、`shares`、`navigation`（拆 `TAP_FORWARD / TAP_BACK / TAP_EXIT / SWIPE_FORWARD`，用来看「点前进 vs 点退出」，这是 Story 里最能说明内容有没有留住人的信号）、`total_interactions`、`profile_visits`、`follows`。`link_clicks` 只在确有链接贴纸时记录（自动路径恒无）。
**口径规矩**：①读不到一律记 **「没测成」**，**绝不写 0**；并且把「**延迟未到**（数据可能晚到最长 48 小时，Story 窗口内读不到不等于永远没有，若 Story 被加入精选则过期后仍可能到）」与「**永久读不到**（错误码 10 样本太小、权限缺失）」分开记两种状态；`navigation` 各子项同样带样本量。`story_insights` webhook 订阅失败 = 出待办，不静默；②对照只用「动了 / 没动 / 没测成」三态，**不写归因**（样本小）；③每个数字带样本量（几条 Story、各自触达多少）；④Facebook 侧**没有**官方观看指标（§3.2），不要拿 Instagram 的数字替它说话；⑤`facebook_views` 是 Instagram 文档里的指标名，含义（Instagram Story 同步到 Facebook 的观看？）**未核实**，先只记录不解读。
写入既有测量记录，不新建一套；回读函数也是 Inngest 定时函数（每 30 分钟扫一遍「在窗口内且未回读」的条目），写 `cron_run_logs`。

---

## 8. 量与瓶颈

**目标（PM 暂定，未最终确认）**：每天 3 条 Story、2 条图文 Post、Reel 每周 3 条 → 一周 21 + 14 + 3 = **38 条**要审；销售窗口只到 11/30，所以 10/12–11/30 是约 7 周的密集期，12 月起减量。

### 8.1 审核和 PM 点通过会不会成为瓶颈

不会——**前提是把「审」和「授权」拆开、把重复劳动交给机器**：

| 环节 | 谁 | 怎么批量，又不绕过「生产方≠质检方」 |
|---|---|---|
| 生产 | 内容团队（75 号）+ 工厂 | 出周包；**自己写「没问题」不算审查** |
| 机器闸（每条必过，零人工） | 系统 | 9:16 与安全区、禁用词、价格闸 ×2、来源非空、素材「已用于帖子」标记、事实库条目存在且在有效期、同一事实 14 天冷却 |
| 内容审（每条必审） | **苏东坡 / 马良**（不同于生产方的独立角色） | 按周包**批量**审，用结构化清单（沿用治理 v0.2 的 `ContentCheckItemResult` 形状：来源核实、素材来源与使用场景相符等 HUMAN 项）；**一包一次会话**，不是一条一条开 |
| PM 授权 | **PM 本人，一周一次** | 看整包预览墙（机器闸 + 审查结论汇总，**异常排最前**），点「授权这一包」；授权**不替代**审查，**审查通过也不等于授权**（10-10 稿口径） |

**PM 时间**：一周 38 条，若只看 10 分钟平均每条 15 秒，会变橡皮图章——所以授权界面按 §4.4-2 强制逐条打开价格 / 地名 / 视频三类，**时间预算首周实测后再定，不预设 10 分钟**。本节里的 38 条、14 天冷却、「每事实 3 种画面」都是**设计假设**，不是已测数字。
**会成为瓶颈的地方**：①苏东坡 / 马良一周要审 38 条的**排队时间**；②**机器闸里「事实库条目在有效期」**会因事实库不够而大量拦截。两者都用「一周一包、周五出下周包」的节奏摊开。**绝不允许**为赶量降低审查——审查没跟上就**减发**，不是跳审。

### 8.2 素材事实库有多大？不够怎么补？

**现状：我没有数过，标「未核实」。** 已知零散事实（来自总方案与台账，不是盘点结果）：2027 全年 25 个班期已录入；9:16 路线图卡「已有 3 张可用」；75 号有 10/12–10/18 一周 7 条图文文案（逐句标官网出处）；Reel 5 条待点、2 条已发。
**容量算法（让 PM 看得懂「为什么不够」）**：一个「事实」（例如某条线路的出发日 + 含什么）配一种「画面形式」才算一条可发内容；同一事实 × 同一画面 **14 天内不重复**（配置项）；**另加：同一 `fact_id` 每 7 天最多 N 条（N 暂定 2，配置项），与画面形式无关**——防止同一个出发日只换卡片样式连发。**Reel 片段在「Facebook 能用已发 Reel 的剪辑」验证通过前，按 0 个计入 Facebook 渠道容量**；「仅 Instagram」的画面不计入 Facebook。每天 3 条 Story → 14 天要 **42 个「事实 × 画面」组合**；若每个事实平均能配 3 种画面（路线图卡 / 出发日卡 / Reel 片段），至少要 **~14 个有官网出处且已核对的事实**，**还要再扣掉已用于图文 Post 的画面**（§3.5.4）。25 个班期理论上够，但「有官网出处且已核对」的才算数，**实际可用数要开发前盘点**。
**第一刀之前必做的盘点**（读库 / 读官网，不凭印象）：把事实库建成一张表（`fact_id / claim / website_ref / checked_at / visuals[] / place_verified / last_used_at`），数出「今天就能发的有效组合数」，据此**倒推可持续的每日条数**。盘点数字出来前，**不承诺 3 条**。

**不够时怎么补（全部有红线）**：
1. **官网新内容**：每个班期 / 线路页的真实信息拆成多个小事实（含什么、出发城市、停留天数），每条带 `website_ref`，**一定要拆得有出处，不拆成编造**。
2. **客户提供的素材**：Dropbox 里视频 / 图片 / 音乐都有授权（PM 10-06 说过，不再问）；真实产品 / 真实价格的画面**只能用这类**。
3. **图库（Unsplash / Pexels）**：只用于氛围画面，**不得冒充真实产品 / 真实价格 / 真实门店承诺**；带地名的画面先核对地点真实。
4. **工厂生成的卡片模板**（路线图卡 / 出发日卡）：改参数不改模板，沿用既有出片手册。
5. **绝对不做**：编造评价 / 见证、凭空造「已有 N 人预订」、用客人肖像（PM 未拍板）、为凑数重复发同一条。
**事实库见底的自动反应**：机器闸发现「有效组合 < 未来 3 天需求」→ 今日待办「Story 素材不够发，建议本周把量降到 X 条」，**不是静默重复**。**原则：宁可停发，不得放宽来源要求、不得拿同一事实换皮凑数**。

---

## 9. 过渡期：CTS 员工在 Meta Business Suite 手动发 Story（一页操作清单）

**适用**：本设计稿批下来、自动发布上线之前。**这是人工做法，不碰任何代码。**
**范围**：CTS 的 Facebook 主页（CTS Tours）与 Instagram（chinatravelservices）。Instagram 通过主页关联在 Business Suite 里发，**是否能直接发 Instagram Story：未核实**——员工第一次发时如实记，发不了就只发 Facebook，并在留痕表备注。

| 项 | 做法 |
|---|---|
| **谁发** | CTS 指定 1 位**主发人**和 1 位**代班**（姓名由 74 号 / PM 填，**我不替你们点名**）。主发人休息日代班接手，不许空档 |
| **每天几次** | 暂按 **3 个时段**（具体钟点由 74 号定；**我没有任何「几点最好」的证据，不给默认值**）。起步量按 §0 PM 的选择（`起步` = 每天 1 条） |
| **发什么** | **只发「当周 Story 周包」里状态为「已通过」的条目**。周包由 75 号每周五给出（含：9:16 图 / ≤15 秒视频、逐字文案、来源、指定时段、渠道）。**一个字都不改**；想改 = 退回 75 号 |
| **素材放哪** | 暂定 Dropbox：`CTS/Story/<周起始日期>/`，文件名 `日期_时段_条目编号.jpg/mp4`（**路径是我的提议，实际目录由 74 号确认后改本表**）。**Facebook 用的图 / 视频不得是已经发过帖子的文件**（Meta 限制，§3.5.4）——周包里已标好「FB 可用 / 仅 IG」 |
| **发前核对（30 秒）** | ①文案里有价格的，打开官网对应页面看一眼，不一致就**不发**，记原因；②画面里不得出现客人面孔；③有疑问一律**不发**，记「待查」，不要自己判断 |
| **怎么发** | Business Suite → 创建 Story → 选 Facebook / Instagram（可用哪个选哪个）→ 传文件 → 粘贴文案 → 发布。**不加链接贴纸 / 投票贴纸**，除非周包明确要求（要求时员工如实记：贴纸能不能加、加了之后的点击数在哪看——这是 §3.5.3 的未核实项，需要人工实测） |
| **怎么留痕（每条必填，当天填）** | 共享表一行：`日期 / 时段 / 条目编号 / 渠道 / 实际发布时间 / 发布人 / Story 截图（发完立刻截）/ 备注（没发的写原因）`。**没截图 = 视为没发**。放哪：暂定 Dropbox 同目录下 `留痕.xlsx`（同上待 74 号确认） |
| **发错了怎么办** | 立刻在 Business Suite 删除该 Story（Story 本身 24 小时会自动消失，但**错了不要等**）；留痕表标红并**当天告诉 74 号**；涉及价格 / 余位等红线的另告 PM |
| **效果怎么读** | 发布后 **22 小时内**，在 Business Suite / Instagram 洞察里读该 Story 的 观看、触达、回复、分享，**填进留痕表**（**24 小时后 Instagram 就读不到了，晚了就是「没测成」，不要估**）；Facebook 侧如果找不到观看数，如实写「没有」，不要填别的数 |
| **价格证据** | 带价格的 Story，发前把官网对应页面**截图存进同一目录**（证明核对过） |
| **独立抽查（防自填自查）** | 每周 **74 号随机抽 3 条**留痕，对照 Facebook / Instagram 主页实际 Story 列表与截图；对不上记入周汇总。执行人、留痕人、抽查人不是同一个人 |
| **发错了怎么办（时限与负责人）** | 发现后 **30 分钟内**主发人删除并告诉 74 号；涉及价格 / 余位等红线的，74 号 **当天**告诉 PM |
| **每周** | 周日汇总：发了几条 / 没发几条及原因 / 平均观看与回复（带条数）→ 给 74 号。**这份留痕是自动发布上线后做对照的基线** |
| **不许做** | 不许自己写 / 改文案 · 不许用周包之外的图 · 不许用客人肖像 · 不许写余位 / max / 免签 / 航司 · 不许用没核对过地点的带地名画面 |

---

## 10. 三刀交付与上线前置（每刀单独验收、单独回滚）

**顺序铁律：刀一验证不过就停，不建表（不先花刀二的钱）。**
**刀一（零数据库、零真发）**：Facebook 主页 Story 的照片 / 视频两个发布方法 + Instagram 适配器（只写不调线上）+ 结构化错误；全部单测；**真实 Graph 试跑**（见下）验证 §3.5 的三个未核实项（IG Story 在 Facebook Login 下能否发；Reel 剪片段能否发 FB Story；Story 是否支持 `scheduled_publish_time`）。
**刀二（A 级迁移，PM 本人批）**：§5 的表 + 授权 / 撤销 / 预览墙接口 + 内容指纹；**仍没有任何自动发布**；授权接口回包带 `note: "Recorded only. The automatic publisher is not running yet."`（沿用 10-10 稿 §15）。
**刀三**：Inngest 发布器 + 回读器 + 待办 + 看门狗 + 界面（界面上线前过 Impeccable，首次使用要先获准下载检查程序）；默认只演练；PM 说 go 才开真发。

**真发开关前置（全部满足才许设环境变量）**
1. 10-10 稿 §18 的 10 项清单（共享部分：占位丢失待办、手动与自动互斥、看门狗误报、`client_status = active` 等）已完成。
2. CTS Instagram 已登记进商务账户（台账卡 10-16）+ **独立新授权**已完成 + 主页没有未完成的 Page Publishing Authorization。
3. §3.5 三个未核实项已用**真实 Graph 调用**验证并回写本稿。
4. **真实试跑**：Story 没有定时 / 撤回接口，**无法做「远期定时 + 立即撤回」**。方案：①优先找**非客户测试主页 / 测试 Instagram 账号**发 1 条；②没有，则只放 **CTS 1 条、PM 当面看着、发完立刻手动删、对账回执**，需要 PM 明确说 go。**当场试跑的每次结果写进 PR 的「## 当场试跑」**，没跑通不说「做好了」。
5. 事实库盘点完成并据此定下首周条数；Facebook 与 Instagram 渠道分别单独开（先 Facebook，Instagram 等 2 满足后）。
6. 回读器在手动过渡期已用人工数据对过一遍口径。

**当场试跑口径（本设计稿阶段）**：只写文档，**没有任何代码、没有任何外部调用被执行**，除了读 Meta 官方文档。

---

## 11. 明确不做

Instagram 图文 / Reel 自动发布（另立项）· 改审核清单语义 · 改价格闸逻辑 · 链接贴纸 / 投票贴纸 / 提问贴纸的自动添加 · Story 的广告投放（广告自有版位，另由广告线管）· 多客户同时上线（先单客户 + 演练）· 用客人肖像 · 为凑量编造内容。

## 12. 审查安排（A 级，CLAUDE.md §4）

设计阶段：子牙（架构）+ 魏征（挑刺）**两个不同 agent 独立**审；面向客户看得见的按钮与待办文案另请板桥过一眼；实施完补狄仁杰攻击验证（能否绕过授权 / 指纹 / 开关发出去）。A 级 PR 保持草稿，正文写「风险级别：A」，机器不合，PM 回「合」才合。

### 12.1 审查意见逐条处置（第一轮：子牙 + 魏征，2026-10-12，两人互不通气）

两人总判断都是「需改后再审」。下表「采纳」= 已写进正文；「部分采纳」说明差别；没有「不采纳」项。

| # | 来源 | 严重度 | 意见 | 处置 |
|---|---|---|---|---|
| 1 | 子牙 | 阻塞 | 每 5 分钟发布器会重叠 / step 重试致重复发帖 | **采纳**：`retries:0`、`concurrency:1` 写进 §4.2；Instagram 容器轮询拆独立事件 |
| 2 | 子牙 | 阻塞 | 占位后崩溃的状态没定义；IG 两段式容器 id | **采纳**：§4.2 加 CLAIMED 超 10 分钟转 UNKNOWN_OUTCOME、永不自动重发；容器 id 先落库、不重建 |
| 3 | 子牙 | 必改 | 指纹缺 page_id/client_id/到期日；缺两段式激活 | **采纳**：§4.4-1、-3 |
| 4 | 子牙 | 必改 | 「素材已用于帖子」标记无写入方 | **采纳**：§6 指明写入点，缺失按未知拦截，刀一就建 |
| 5 | 子牙 | 必改 | 回读不应是 PUBLISHED 前置 | **采纳**：新增 `PUBLISHED_UNVERIFIED`，回读失败不降级 |
| 6 | 子牙 | 必改 | 停一条要读库不读缓存 + 测试 | **采纳**：§4.4-5 |
| 7 | 子牙 | 必改 | 新授权令牌独立存储；`instagram_manage_insights` 入权限清单 | **采纳**：§5 补充 |
| 8 | 子牙 | 建议 | Connector 限制写进 Connector 层契约 | **采纳**：实现 PR 须落字（§1 已写） |
| 9 | 子牙 | 建议 | 授权表部分唯一索引；RLS 必写 TO service_role | **采纳**：§5 补充 |
| 10 | 子牙 | 建议 | §3.5.3 「无链接」从硬约束降为「按不支持设计，待验」 | **采纳** |
| 11 | 子牙 | 建议 | T+22h 遇夏令时切换日需确认 | **采纳为实现验收项**：回读时间用 Pacific/Auckland 计算，切换日各一条测试（两个切换日 10 月初与 4 月初） |
| 12 | 魏征 | 必改 | 整包授权成橡皮图章；10 分钟是未实测估计 | **采纳**：§4.4-2 强制勾选 + 三类逐条打开；§8.1 改为实测后定 |
| 13 | 魏征 | 必改 | 指纹没覆盖 Meta 实际抓取的文件 | **采纳**：§4.4-3 不可变路径 + precheck 重下重算哈希 |
| 14 | 魏征 | 必改 | 无撤回、无熔断触发条件 | **采纳**：§4.4-5b 熔断条件；待办写人工删除路径 |
| 15 | 魏征 | 必改 | claim 后重放 | **采纳**（同子牙 #2） |
| 16 | 魏征 | 必改 | Reel 片段计入容量，但自己承认未核实 | **采纳**：验证前按 0 计，仅 IG 画面不计 FB |
| 17 | 魏征 | 必改 | 事实拆分诱导凑数；冷却只按事实×画面 | **采纳**：加每事实 7 天上限；「宁可停发」写明 |
| 18 | 魏征 | 必改 | 画面烧字、视频无声、place_verified 无核验人、回复无人接、肖像是人工项 | **采纳**：§6 新增检查项；文字识别 / 音轨检测引擎现在不存在，已明写为刀一前置调研与 HUMAN 项，不假装已有 |
| 19 | 魏征 | 必改 | 回读：延迟未到 vs 永久读不到；webhook 失败；子项样本量 | **采纳**：§7 |
| 20 | 魏征 | 必改 | 先验证再建表 | **采纳**：§10 顺序铁律 |
| 21 | 魏征 | 阻塞 | 手动留痕无防伪、无时限负责人 | **采纳**：§9 增价格证据、每周 74 号抽查 3 条、30 分钟删除时限 |
| 22 | 魏征 | 建议 | §0 与 §3.3 对「应用审核」说法矛盾；100 条上限是否含 Story 未核实；估算数字标注 | **采纳**：§0 改为未核实；§8 标注设计假设；100 条已在 §3.3 标「文档没说」 |
| 23 | 魏征 | 建议 | 20 分钟补发窗与 5 分钟扫描的最大延迟 | **采纳为实现验收项**：最大延迟 = 扫描间隔 5 分钟 + 20 分钟窗口，测试覆盖 |
| 24 | 魏征 | 信息 | Meta 的 IG 页面把 Story 写成 "publish a reel"，疑为笔误 | 已在 §3.3 提到；**刀一真实调用验证**，不凭文档定 |

**仍待第二轮审查确认的点**：①授权复用旧表还是新建 `story_pack_auth`（我建议新建，子牙一轮认可方向）；②Instagram 登录路线 Facebook Login 的选择；③熔断条件的阈值（连续 2 条 FAILED_FINAL）是我的设计选择，无数据依据。**第二轮由子牙 + 魏征各再审一次修订稿，过了才请 PM 批。**

## 13. Reuse Statement（设计稿级）

- **复用**：`src/lib/meta/page-posts.ts` 的发布错误分类与 `PagePublishError`；`token-manager` / `page-binding-service` 的主页令牌；每日计划的「授权绑版本 / 两层开关 / 先占后发 / 不确定不重试 / 今日待办拉模式」做法；`price-claim-gate` + `price-fact-gate`；`ContentCheckItemResult` 结构化清单形状；`isGlobalAdminEmail`；既有测量记录；`sendInngestEvent`。
- **新增且属平台共享**：Story 周包 / 条目 / 内容指纹契约、Story 发布方法（Facebook 主页 + Instagram 适配器）、Story 回读器、事实库条目契约（`fact_id / website_ref / checked_at / visuals[] / place_verified`）。
- **行业相关**：发布时段、卡片模板、事实冷却天数（均为配置 / Profile，不进共享代码）。
- **客户相关**：白名单、主页 / Instagram 账号编号、授权内容、CTS 路线图卡与出发日卡素材。
- 共享代码里没有任何客户名 / 客户 ID / 行业判断。
- 学习：本轮不产生学习记忆；手动过渡期的留痕是后续「几点发最好 / 哪种画面留人」的**基线**，在样本够之前不下结论，也不升到行业 / 全局层。
- 决策时分类与实现落点是否一致：**待实现后对账**。

## 14. 版本

- **v0.2（2026-10-12）**：按第一轮审查（子牙、魏征）修订，处置见 §12.1。未经第二轮审查。
- **v0.1（2026-10-12）**：初稿，84 号窗口。未经任何审查。
