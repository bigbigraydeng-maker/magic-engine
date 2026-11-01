# 社媒起号学习卡 · 第一轮只读验证记录

- **日期**：2026-10-19 ｜ **风险级**：C（只有文档与卡片索引，不碰 src）
- **范围**：`docs/skill-cards/2026-10-19-social-*.md` 共 9 张卡、每卡 1 个能力点，共 9 点
- **权限**：生产库只读 SELECT（Supabase 项目 glbdnayojixmexgofbsd）+ 仓库只读 grep；未发帖、未下架、未回复、未改设置、未调用任何平台接口、未读评论人姓名/正文细节（只做分类计数）
- **规则**：SO-09（数字带来源、窗口、样本量；n<5 不下结论；缺失不是 0）；交接卡 `2026-10-19-social-learning-handoff-97`

## 0. 结论

**9 个点没有一个能给出「成立」或「不成立」。** 8 个判 `cannot_check`，1 个判 `not_applicable`；0 个进 `verifying` / `adopted`。

原因只有两类：**①库里没有「单条帖子的表现数据」**（只有页面级 7 天汇总和 4 行早期回执），所以所有「哪种开头/栏目/趋势更好」都分不了组；**②几个平台 ME 根本没接**（Threads、Instagram、TikTok 数据、YouTube 分析）。这不是学习卡有问题，是验证所需的数据管线还没通。

## 1. 数据口径（读了哪些表，各自能回答什么）

取数时间 2026-10-19，全部 SELECT。

| 表 | 行数/窗口 | 实际内容 | 能回答 / 不能回答 |
|---|---|---|---|
| `content_work_orders` | 123 行（2026-07-06~10-18） | 状态：published 21、superseded 56、review_rejected 28、in_review 6、dead_letter 6、archived 5、rendered 1。`published_ref` 21/21 都是 Facebook（CTS 20、Oztop 1） | 能数「发了多少、哪个平台、有没有风格标签」；不能给表现 |
| 同上 brief 字段 | 已发 21 条 | `viral_style_directive` 2/21、`creative_recipe` 1/21、含 trend/series 字样 0/21 | 开场类型、栏目、趋势借用都没有结构化标签 |
| `content_posts` | 304 行 | 已发状态 12 条且 `published_at` 全空；多为草稿，来源多为看板/LinkedIn/抓取 | 无表现，无法使用 |
| `social_plans` | 95 行（05-23~10-06） | platform 全部 = facebook，5 个客户 | 说明没有 Instagram/TikTok/Threads 计划 |
| `story_packs` / `story_items` | 3 / 54 | 全是 facebook_story 图片：PENDING 36、SENT 11（CTS，10-14~10-19）、BLOCKED 5、MISSED 2；只有 2 条有 `last_check_result` | 只有发送状态，没有观看/互动 |
| `social_post_measurement_receipts` | 4 行（CTS，2026-09-06~09） | window 4h×2、72h×2；values 只有 likes 1~2、comments 0；shares 标 `omitted_unverified` | 样本 n=4 且无观看/留存；近 30 天 0 行 |
| `flywheel_actions` / `flywheel_outcomes`（社媒） | `factory_reel_publish` 24 动作 / 0 结果；`social.comment_auto_reply` 40 / 0；`social.publish_post` 3 / 1 | 结果回写基本为空 | 「发了→量→回写」闭环没跑通 |
| `flywheel_metrics`（`social.fb.*`） | 148 行/键，4 个客户，2026-08-01~10-19 | 页面级每日滚动 7 天：posts、reactions、comments、shares、top_post_score、days_since_last_post。CTS（62 天）：posts_7d 平均 1.2，reactions_7d 平均 1.8（最大 14），comments_7d 平均 0.6（最大 4），shares_7d 恒为 0（与回执里 shares 未核实并存，**不能当真 0**）；top_post_score 在 442~449 之间几乎不动 | 页面级趋势；不能归因到单条、单种开头 |
| `social_comment_engagements` | 110 行（仅 CTS Facebook，06-24~10-09） | praise 45、other 41、spam 13、question 8、complaint 3；挂在 0 条工厂 Reel 帖上 | 评论有入库与分类；没连到选题/表现 |
| `platform_oauth_connections` | 连接表（只读 provider/scopes/状态，未读令牌） | meta：4 个有效、3 个出错（出错的权限更窄）；google_youtube 1 个（readonly/force-ssl/upload）；tiktok 1 个（user.info.basic + video.publish，访问令牌 10-14 已过期，从未同步）；无 threads、无 instagram | 能回答「接没接、有什么权限」 |
| `youtube_publish_receipts` / `social_sources` | 0 / 0 | – | Shorts 无回执；旧「社交源」表为空 |
| 代码只读 grep（`src/`） | – | 没有 Threads 接口、没有 Trial Reels、没有 TikTok Creator Search Insights、没有 YouTube engagedViews；Instagram `/insights` 只出现在广告与智能摘要里，不是自然帖 | 接入现状 |

## 2. 逐点验证表

| 卡 / 点 | 检验方法（需要什么） | 数据来源 | 窗口 | 样本量 | 判定 | 下一步 |
|---|---|---|---|---|---|---|
| hook-first-frame / `hook_matches_promise` | 按「开场类型」分组，比较同平台同主题的单条继续观看/平均观看/分享（需：开场类型标签 + 单条观看类指标 + 每组 n≥5） | `content_work_orders.brief`、`social_post_measurement_receipts`、`flywheel_metrics` | 2026-07-13~10-18 | 已发 21 条（FB）；有风格标签 2；单条回执 4 行且无观看指标；每组 n<5 | **cannot_check** | 工厂出片时写入「开场类型」标签；单条观看数据接入（见缺口 1、2）；两者齐备且每组 ≥5 条后重验 |
| recurring-series / `series_format` | 识别同一栏目的帖子，看回访/关注/分享变化（需：栏目字段 + 单条或按栏目汇总的指标） | `content_work_orders.angle/brief` | 同上 | 21 条；结构化栏目字段 0 | **cannot_check** | 给工单加栏目字段（缺口 3）；有字段后同栏目 ≥5 条再验 |
| comment-led-ideas / `comments_as_signal` | 评论→选题→后续内容→表现，看回流是否可追踪（需：评论到选题的关联、评论挂到帖子） | `social_comment_engagements`、`content_work_orders` | 06-24~10-09 | 评论 110（question 8、complaint 3）；关联到工厂 Reel 帖 0 | **cannot_check** | 评论入库已有，缺「评论→选题」关联与「帖子→评论」对齐到工厂帖（缺口 4） |
| native-storytelling / `trend_as_input` | 比较「借用趋势」与「未借用」同平台同类型的可用指标（需：趋势标签 + 单条指标） | `content_work_orders.brief` | 同上 | 21 条；趋势标签 0 | **cannot_check** | 工单加「选题来源：趋势/常青」标签（并入缺口 3） |
| short-video-metrics / `shorts_views_vs_engaged` | 看 ME 能否读到 Shorts 的 Views 与 Engaged views 并分开呈现（需：YouTube 分析读取权限与代码） | `platform_oauth_connections`（权限）、`youtube_publish_receipts`、`src` grep | 2026-10-19 现状 | 连接 1；Shorts 回执 0；engagedViews 读取代码 0 | **cannot_check** | 只有读取/上传权限，没有分析权限；按 YouTube 公开文档 Engaged views 属分析接口，待核；若要做需单独申请授权（涉及权限范围变更，需 PM，见缺口 5） |
| tiktok-search-insights / `tiktok_search_demand` | 在已授权账号上记录搜索主题与内容缺口，对照已发主题（需：账号可见该工具 + 人工只读查看） | `platform_oauth_connections` | 2026-10-19 现状 | 连接 1（令牌已过期、从未同步） | **cannot_check** | 该工具是 TikTok 应用内功能、仅部分地区；ME 无接口。先恢复连接（缺口 6），再由人工只读看一次并记录地区可用性 |
| instagram-trial-reels / `instagram_trial_reels` | 需 Instagram 发布能力 | `content_work_orders.published_ref`、`social_plans`、`src` grep | 现状 | 已发 21 条全是 Facebook；计划 95 条全是 Facebook | **not_applicable** | Instagram 发布能力上线后重评（PR 2756、2897 在途，均未合并） |
| instagram-best-practices / `instagram_best_practices_panel` | 在已授权 IG 账号的专业面板读建议类别并与同账号历史对照（需：IG 账号连接与只读指标） | `platform_oauth_connections` | 现状 | Instagram 连接 0 | **cannot_check** | 等 IG 原生接入（PR 2897，只做身份）并取得只读指标权限（缺口 7） |
| threads-insights / `threads_weekly_insights` | 看 Threads 周报字段与窗口（需：Threads 连接与权限） | `platform_oauth_connections`、`src` grep | 现状 | Threads 连接 0；代码 0 | **cannot_check** | ME 没有 Threads 能力线；是否要做先走平台层级门（缺口 8），不是验证问题 |

判定统计：`cannot_check` 8 · `not_applicable` 1 · `verifying` 0 · `adopted` 0 · `tried_failed` 0 · `already_in_me` 0。

## 3. 最重要的发现

1. **没有单条帖子的表现数据。** 近 30 天单条回执 0 行；全库仅 4 行（CTS，2026-09-06~09，只有点赞/评论）。页面级 7 天汇总存在，但无法归到某条、某种开头。
2. **社媒「发了→量→回写」没闭环**：`factory_reel_publish` 24 个动作、0 个结果；评论自动回复 40 个动作、0 个结果。
3. **已发内容几乎都没有结构化标签**：开场风格 2/21、配方 1/21、栏目 0、趋势 0——即使有数据，也分不了组。
4. **已发全是 Facebook 且集中在 CTS**（20/21），Story 全是图片且只有发送状态；Instagram/TikTok/Threads/Shorts 在 ME 里都没有可读的表现数据。
5. **几个平台连接本身有问题**：TikTok 访问令牌 10-14 已过期且从未同步；Meta 有 3 个连接处于出错状态；YouTube 只有读取/上传权限。

## 4. 想让社媒学习真正闭环，还缺哪些数据管线

在途 PR 以 2026-10-19 `gh pr list --state open` 为准；「相关」不等于「已覆盖」。

| # | 缺口 | 谁能补 | 在途 PR |
|---|---|---|---|
| 1 | **表现回执接下一轮计划**：Reel 转公开后的 4h/72h 测量接线，回写到下一轮选题（`factory_reel_publish` 0 结果） | 97 号（社媒统筹）+ 开发窗口 | 2381（Reel 发布后起草广告，相关但不是测量）；2451（自动发布看门狗，相关）；2817（草稿不再记成已发布，相关）；**无直接补测量的 PR** |
| 2 | **单条 Reel 观看数据**（video_views 日同步） | 开发窗口 | **1913**（per-reel video_views daily sync，开放，最后更新 2026-09-23；是否仍可用待核） |
| 3 | **工单结构化标签**：开场类型、栏目/系列、选题来源（趋势/常青）、配方 | 106 号（工厂）+ 97 号定义 | 无 |
| 4 | **评论数据对齐**：评论挂到工厂帖；「评论→选题→后续内容」关联；question 类落入选题池 | 97 号 + 开发窗口 | 2190（评论自动回复卡死待办，相关）；无直接对齐的 PR |
| 5 | **Shorts 指标可见性**：YouTube 分析权限与读取（涉及授权范围，要 PM） | 开发窗口 + PM | 2708（补写 Shorts 回执，相关但只是回执）；无分析读取的 PR |
| 6 | **各平台账号连接状态**：TikTok 令牌过期；Meta 3 个出错连接；需要连接健康报警进待办 | 97 号 + 开发窗口 | 2895（Meta 授权回调身份，相关）；无 TikTok 重连的 PR |
| 7 | **Instagram 只读指标**（原生接入后） | 开发窗口 | 2897（只做身份）；2756（跟发下线） |
| 8 | **Threads**：ME 没有该能力线；先走平台层级门判断是否要做 | PM + 统筹 | 无 |
| 9 | **Story 发后量**（现在只有发送状态） | 开发窗口 | 无 |
| 10 | **shares 的真实值**：页面汇总里 shares_7d 恒为 0，但回执里 shares 标「未核实」，需要先区分「0」和「没取到」（SO-09） | 开发窗口 | 无 |

## 5. 没验证到的

- 没验证任何「某做法对 ME 客户更好」的主张；样本不足或字段不可读。
- 没有查任何平台应用内页面（Instagram 专业面板、TikTok Creator Search Insights、YouTube Studio），因为本轮无授权可看的账号，且不登录。
- 没读评论具体文字，只用分类计数。
- 没有核实 YouTube 权限范围与分析接口的对应关系（以官方文档为准，标「待核」）。
- 2026-10-19 当天才上线的 Reel 转公开动作，量还没有产生；待 72h 回执出来后再验。
- 其他在途 PR（2875、2876）里新增的社媒卡不在本轮范围。

## 6. 复验触发条件

满足以下任一项，开新一轮：缺口 1+2 补齐且工厂 Reel 公开后 72h 回执 ≥5 条；缺口 3 上线且每个分组 ≥5 条；Instagram/YouTube 分析权限获批。台账 `2026-10-19-social-learning-first-verification-result` 的到期日为 2026-11-02。

## Reuse Statement

复用现有 L1 学习机制（技能卡机器索引、学习库页面、台账），无新系统、无新代码。无客户私有数字写入共享规则；客户名只出现在本审计记录里的样本说明，不进规则手册。
