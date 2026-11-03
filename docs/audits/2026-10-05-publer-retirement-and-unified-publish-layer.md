# 取消 Publer + 统一发布层：盘点与方案

日期 2026-10-05 · 性质：**只读盘点 + 出方案，未改任何代码、未改数据库、未发布、未取消任何订阅** · 风险级别：C（纯文档）· 后续实施各步见 §5
**版本：精简版（2026-10-05 晚，按 PM「瘦身」范围收窄；经 CTS 广告窗口转达，范围文件已读）。** 完整版（统一入口 + 通行证 + 发布许可 + 对账 + Instagram）的设计已降级存档在 §5.5。
基线：仓库 `claude/sweet-albattani-fb0347`，HEAD `0c069021d`，本地 `origin/main` 同值（**未 fetch，只能称本地快照**）；生产库只读（Supabase 项目 `glbdnayojixmexgofbsd`）。
姊妹文档：[Remotion 接工厂方案 v0.3](../specs/2026-10-05-remotion-into-video-factory-plan-v0.3.md)（在 `zen-herschel` 窗口，尚未合入主干）· [社媒发布治理 v0.2](../specs/2026-09-29-social-content-publish-governance-v0.2.md)（**其核心已于 2026-10-02 合入，PR #2193**）。

---

# 一、结论（给 PM）

1. **Publer 可以取消，而且 ME 里几乎没人在用它。** 生产库里：用 Publer 发出的帖子 **0 条**（`content_posts.publer_post_id` 全库为空）、Publer 拉回来的互动数据 **0 条**、没有任何客户绑定 Publer 账号。近 90 天真正发出去的内容**全部走 Facebook 原生直发**（CTS 3 条、Oztop 1 条、讲课号 2 条）。
2. **但「没人在用」不等于「可以直接取消」，有两件事必须先办：**
   ① **库里查不到的人手操作**：PM/FDE 如果直接登录 Publer 网站手动排过帖，ME 完全看不见。需要 PM 在 Publer 后台看一眼「过去 90 天已发 + 已排期」的数字（见 §6 第 1 条）。
   ② **ME 里还有 6 个能经 Publer 发帖的入口**，其中 2 个闸极松（见 §2）。订阅一取消它们会变成报错（反而更安全），但应先把它们正式关掉并装上「有人调用就报警」，再取消。
3. **精简版只做一个 A 级 PR，不造新的「统一层」。** 工厂的 Facebook Reel 发布和每日计划的 Facebook 图文发布，已经是 ME 最严的两条外发路径，10-02 合入的治理已覆盖其中一部分，**不动**。本轮只做：① Publer 总开关（装在发帖函数里）并关掉 6 个入口；② 修 Reels 路由两处真漏洞（文案可被请求覆盖、账号不校验归属）；③ 把现有价格检查接进每日计划图文的发帖函数；④ 去掉 Publer 的互动拉取。**推迟**（有触发条件才做）：通行证式发布闸、发布许可闸、发了没回执的事后对账、Instagram 适配器。
4. **Instagram 是取消 Publer 真正会失去的唯一能力**（还有 LinkedIn），但现在没有任何客户在经 Publer 发 Instagram（CTS 没有 IG）。ME 的 Meta 应用**目前没有 Instagram 发布权限**，且**当前有一次应用审核正在进行，期间不能再提交新的审核**——这条路有周期，要提前排。
5. **日期**：Publer 套餐 Business，每月 28 号续费（据 CTS 发票记录推算，**需 PM 在 Publer 后台核实**），每次 NZ$33.24（含税）。**下一次扣费预计 10 月 28 日，硬截止 10 月 26 日前取消**。**精简版下最早安全取消日：约 10 月 10 日**（第 1 步合入当天，前提是 PM 的 Publer 后台数字已回、没有排期）；若 PM 愿意不等代码，最早可提前到「PM 看完后台、FDE 确认没人手动用」的当天（约 10 月 7–8 日），代价是 ME 里几个入口报错而不是友好提示。**日期是估算**（取决于 PM 回数字的时间、代码审查和 PM 回「合」的速度）。详见 §6.3。
6. **费用转嫁**：Publer 费用一直按成本价写进 **CTS** 的「第三方订阅」发票（INV-2026-006/010/013/018 含 Publer），其它客户没有。**取消后下一轮发票要把这一行去掉。** 另有一处需 PM 知晓：发票备注写「Publer 用于 CTS 的 Facebook、Instagram 排期发布」，而库里找不到用 Publer 发过 CTS 帖子的记录，CTS 也没有 Instagram（§7）。
7. **§11 优先级**：见 §8。关口子 + 取消（P3，按 PM 拍板插队，有 10/28 硬日期）· 价格检查接发帖函数 + Reels 两处校验（P2）· 统一发布许可闸 / 对账 / Instagram（**PM 瘦身后推迟**，§11 原打分见 §8）。

---

# 二、问题 1：所有发布口子盘点

**方法**：子代理逐个读源码（给 file:line），我抽查了 4 处（webhook、每日计划发布、Reels 发布、schedule），结论与子代理一致；其余行号**未逐行复核**，实施前需重新核实。生产环境变量是否已配**未查**。

## 2.1 走 Publer 的口子（6 个能真发 + 1 个回调 + 1 个定时拉数）

| # | 入口 | 谁调用 | 鉴权 | 发什么 | 看不看工厂/审核 | 评估 |
|---|---|---|---|---|---|---|
| P1 | `POST /api/publer/create-post` | 内容页（单发/批量） | `requirePaidClientAccess` | 已批准帖子的图片或视频 → FB/IG 等 | 只看 `content_posts.status='approved'`（内容页点过批准）+ 价格闸；账号须是客户连接器里绑定的 | 中。批准人 = 发布人（9/29 PM 已接受风险）|
| P2 | `POST /api/publer/schedule` | 素材页 | `requireDashboardClientAccess` | 指定素材 → 任意 Publer 账号 | 只看素材 ready + 价格闸；**`account_id` 调用方传入、不校验属于该客户** | **高**。能发到工作区里别的客户的号（9/29 已接受风险）|
| P3 | `POST /api/clients/[id]/reels/[draftId]/publish` | Reels 工作台 | `requireDashboardClientAccess` | Reel 视频 → FB/IG | 只看 `reels_drafts.status='video_ready'`；**无价格闸、文案可被调用方覆盖、账号不校验归属**；这是旧 Muapi 出片线，**绕开工厂** | **最高**（9/29 盘点漏了这条）。我读源码确认：`captionOverride` 直接发出 |
| P4 | `POST /api/clients/[id]/content-posts/[postId]/publish` | UI 调用方**未确认** | `requireDashboardClientAccess` | 纯文字 | 只看 approved；账号找不到时兜底用 `accounts[0]` / 同平台任一账号 | 高（可能发到别家账号）|
| P5 | `PATCH /api/clients/[id]/content-factory/[postId]`（LinkedIn 分支） | 内容工厂页「确认」 | `requireDashboardClientAccess` | LinkedIn 文字，确认即发 | 账号严格绑定、防双发；无价格闸 | 中 |
| P6 | cron `linkedin-progress-post-mon/thu` | 定时（周一/四） | CRON_SECRET | ME 自家产品动态 → LinkedIn | 总闸 `LINKEDIN_PROGRESS_POST_ENABLED` 默认关；程序自己把状态写成 approved 后发，**无人审** | 中（默认关）|
| P7 | `POST /api/webhooks/publer-published` | Publer 回调 | **完全无鉴权、无签名**（我读源码确认） | 不发帖，只把帖子改成 `published` + 写回流 | 无 | 中。只能改库里已有 `publer_post_id` 的帖子，而库里一条都没有 → 目前无可利用对象；Publer 是否真配了这个回调**未确认**|
| P8 | cron `social-engagement-pullback`（每天 UTC 4 点） | Render 定时 | CRON_SECRET | 不发帖。三段：Publer 互动 → 飞轮指标；TikTok 主页指标；FB 实时 feed 指标 | — | Publer 那一段库里 **0 条**写入，而且 `page-metrics-sync.ts` 注释说它曾连续数周写 0 条 |
| — | `GET /api/publer/accounts` | 设置页 | 只要登录 | 返回**整个 Publer 工作区**账号列表 | 无 | 信息泄露（所有客户账号名）|
| — | `GET /api/publer/draft/[assetId]`、`POST /api/publer/quick-post` | 素材页 / 社媒计划 | dashboard 权限 | 不外发（读文案 / 写草稿） | — | 低 |

## 2.2 原生直发的口子（不经 Publer）

| # | 入口 | 谁调用 | 鉴权 | 发什么 → 哪里 | 看不看工厂/审核 |
|---|---|---|---|---|---|
| N1 | cron `factory-publish-worker`（每小时 5 分）→ `publish-worker` → `facebookReelAdapter` | Render 定时 | CRON_SECRET | 工厂成片 Reel → FB 主页（Graph `video_reels` v25.0）+ 首评 | **最严**：工单须 approved/publish_failed；人工+自动两份清单全过；`publish_target` 存在；页名须与客户品牌一致（防发错号）；正文红线闸；视频地址校验；`FACTORY_PUBLISH_LIVE` 默认只发草稿；`findExisting` 防双发 |
| N2 | `POST /api/clients/[id]/campaign-daily-plan/publish` | 每日计划页 | `requirePaidClientAccess` | 图文 → FB 主页（`/photos`），可定时 | **很严**（我读源码确认）：须审核 PASS 且 `reviewer_role=admin`、清单通过、有入队回执、`plan_revision`/`review_revision` 对齐、图片来自该客户素材库、幂等键、默认 `no_publish` |
| N3 | `…/campaign-daily-plan/recall` | 每日计划页 | `requirePaidClientAccess` | **删**已发帖 | 需 `approved` + `publish_authorization` |
| N4 | 讲课片 `lecture-publish`（挂在 N1 的 cron 里）；`PATCH …/lecture` 只登记请求 | 讲课工作台 | `requireDashboardClientAccess`（9/29 已接受风险）| FB Reel 或 **TikTok** 视频 | 公开发布前须校准字幕、默认草稿、防双发；**不查工单清单** |
| N5 | `luban/tools.ts` 的 `publish_to_gbp` | agent 工具 | **未确认** | Google 商家页贴子 | **未确认** |
| — | `social/facebook-publisher.ts`（`/v18.0/{page}/feed`）、`xiaohongshu-publisher.ts` | **无生产调用方**（死代码，仅测试引用）| — | — | 应随本方案清理，避免成为未来旁路 |

**不是外发入口的**：Airtable 旧同步 `review-sync.ts` 只做审片双向同步、不发布；`execution/route.ts` 只读 `publer_post_id` 做状态展示；评论自动回复/私信不是发帖；`poster-studio` 没找到发布代码（只在文档里提到调度，**未确认**）。`scripts/` 里没有直接调发布接口的脚本（只有 `doctor.sh` 的健康探测）。

## 2.3 三个必须正视的事实

1. **没有任何 Publer 入口检查工厂状态**（`content_work_orders` / `review_ref`）。`create-post` 里的 `approved` 只是「内容页点过批准」，不是「工厂审片通过」。→ 在 Publer 还开着时，**经 Publer 发的内容完全绕开工厂审核**。这正是 PITFALLS D14 的形状。
2. **脚本直调 Meta/Publer 接口**（D14 本体）没有技术闸。仓库里现在没有这类脚本，但 CI 只有「对外写模块清单」`src/lib/kernel/boundaries.ts`（把 `@/lib/publer/client` 列为只准 `capabilities/` 目录引用，另有「只准变短」的历史豁免名单），**拦不住本机临时脚本**。
3. **Meta 的发帖权限现在靠「有角色的人亲自授权」**：ME 的 Meta 应用已上线（live mode）、企业验证通过，但**应用审核通过的权限只有 openid / public_profile / email**，`pages_manage_posts` 等没有高级访问。现在能发，是因为客户主页的页面令牌来自对该应用有角色的人（PM）。库里 Meta 授权共 7 条：**4 条有效、3 条已报错**（NAL 令牌被拒、NZCPE 和 Roman 会话失效）——原生直发的授权**本身很脆**，不是取消 Publer 才暴露的，但取消后没有 Publer 兜底。

---

# 三、问题 2：谁在真用 Publer

**查到的（生产库只读，查询时间 2026-10-05）：**

| 查什么 | 结果 |
|---|---|
| `content_posts.publer_post_id` 非空（全库 296 条，2026-05-01 起）| **0** |
| `flywheel_actions.vendor` 含 publer（近 90 天及全表文本搜索）| **0**（原生发布记为 `oztop_facebook` 5 条、`meta_graph` 2 条）|
| `flywheel_metrics` 来源含 publer（全表）| **0** |
| `reels_drafts` / `content_work_orders` / `social_plans` / `campaign_briefs` / `clients` / `datasource_usage_*` / `execution_logs` 文本含 publer | **0** |
| `execution_items` 文本含 publer | 3 条，均为 2026-06-08 的老记录 |
| `client_connectors`（共 20 行）文本含 publer，即客户绑定了 Publer 账号 | **0**（`social` 连接器只有 CTS 一行，且无配置内容）|
| 近 90 天已发布的内容（按表） | `content_work_orders` 已发布：CTS 3、Oztop 1（都是原生 Graph，回执含 `video_id`/`page_id`）；`content_posts` 已发布：讲课号 2（7/31）|
| 已排期但未发出的 | `content_posts` 状态 `scheduled`：6 条——NAL 5 条（5 月，早已过期、无 Publer 编号）、CTS 1 条（9/22 创建、无排期时间、无 Publer 编号，**来源未查清**，不是 Publer 排期）。库里**没有**未来时间的排期 |
| `reels_drafts` 近 90 天 | CTS 9 条（5 条 `video_ready` 停在 7/18，**没有一条发布**）、East Inter 5 条 draft |

**没查到的（不能当成零）：**
- **Publer 网站里自己的发帖/排期历史**——ME 读不到（密钥在 Render 环境变量，本次不碰）。PM/FDE 手动在 Publer 网页里排的帖子，库里一律不会有。
- 5 月份 NAL 的 11 条已发布帖（facebook+tiktok）发布通道不明（早于 90 天，且无 Publer 编号）。
- Publer 的套餐、续费日、付款卡：ME 里查不到。**能推算的**：发票记录写明 Business 套餐、PayPro Global 收款、NZ$33.24/月（含 GST，不含 GST 为 NZ$28.90），2026-08-28 续费、下次 09-28（据此推算下次 10-28，**待 PM 核实**）。

---

# 四、问题 3：Publer 提供而 ME 没有的功能

| Publer 功能 | ME 里的现状 | 取消后 | 替代 / 缺口 |
|---|---|---|---|
| **多平台**：Instagram（图/Reel）| **完全没有**（全仓无 `media_publish` / `instagram_content_publish`）；Meta 授权范围里也没有 Instagram 权限 | 会失去 | 缺：Instagram 适配器 + 权限（见下）。**精简版推迟**，触发条件见 §5.1 |
| **LinkedIn** | 只有 Publer（用途：ME 自家产品动态 cron，**默认关**；客户的 LinkedIn 内容工厂分支 P5）| 会失去 | 低频；建议先保持人工（`manual-linkedin-items` 已把 Publer 后台列为人工步骤），要自动化再单独做 LinkedIn 适配器 |
| Facebook 图/视频/文字 | 原生已有：工厂 Reel（N1）、每日计划图文（N2）。**纯文字帖没有原生路径**（Publer 的 `status` 类型）| 文字帖会失去 | 工厂和每日计划是图/视频；若要文字帖，在统一层加一个 `/feed` 适配器（小）|
| TikTok | 代码写「靠 Publer」，**实际已有原生 `tiktok-adapter.ts`**（分块直传）；但 TikTok 应用**还没建/没过审**（env 表标「待建应用」），过审前只能「仅自己可见」| 无影响 | 需建 TikTok 应用并过审（独立事项）|
| 小红书 / 抖音 | Publer 本来就不支持；Magic Lab Class 的帖子里出现过这两个平台 → 一直是人工 | 无影响 | 人工 |
| GBP（Google 商家页）| 原生 Google 接口，不经 Publer | 无影响 | — |
| YouTube | 未发现任何实现 | 无影响 | 未确认 |
| **排期**（定时发）| Publer 的 `schedule`。原生：Facebook 图文可定时（N2 的 `scheduled_publish_time`）；Reel 靠 cron 每小时扫，**没有「指定几点几分发」的能力** | 会失去精确排期 | 缺「指定时间放行」Reel 能力。**精简版不做**（发布量小）；将来需要时在发布 cron 里加一个 `not_before` 即可，不依赖发布许可闸 |
| **数据回拉**（点赞/评论/分享）| Publer 那段 **0 条写入**；Facebook 实时 feed 指标已原生（`syncPageMetrics`）；TikTok 主页指标已有 | 无影响 | Instagram 指标将来随 IG 适配器一起做 |
| **绕过 Meta 应用审核** | 无 | 隐性失去 | Publer 自己有通过审核的 Meta 应用，客户授权 IG 不需要 ME 过审。取消后 ME 要自己过 |

**Instagram 发布需要什么（Meta 只读查询结果，2026-10-05）：**
- ME 的 Meta 应用（`1752513682785923`，应用名 Magic Engine）：**live mode，企业验证通过**，隐私政策/条款链接齐全。
- **审核状态**：当前有一次提交**正在审核中**（申请的是 `pages_messaging`），所以**现在不能再提交新的权限申请**；已通过的权限只有 openid / public_profile / email。
- 代码请求的授权范围（`meta-oauth/client.ts`）**不含** `instagram_basic`、`instagram_content_publish`。
- 技术条件（Meta 官方规则，**本次没有真实测试验证**）：① Instagram 必须是**专业号（商业/创作者）并绑在 Facebook 主页上**；② 需要 `instagram_basic` + `instagram_content_publish`；③ 只对「对 ME 应用有角色的人」管理的账号免审核可用（标准访问），客户自己登录授权需要高级访问（走应用审核）；④ Instagram Reel 发布是「先建容器 → 轮询 → 发布」，**没有草稿模式**，容器 24 小时过期；⑤ Instagram 也是由 Meta 去拉视频公开地址，所以 v0.3 的「按哈希命名、不可覆盖路径」同样适用。
- 加授权范围会让**已连接的客户授权静默失效**（记忆里有过这个坑）。做法：新增一个独立的授权用途（`platform_oauth_connections.purpose` 已有此列，现有值 `legacy`/`meta_ads_read`），不动现有连接。
- **哪些客户有 Instagram 专业号**：本次**未查**（需在 Instagram 适配器那一步先盘点；CTS 已确认没有）。

---

# 五、问题 4：统一发布方案

## 5.0 平台层级判定（me-platform-tier-gate · Inline）

- **[Tier]** 精简版**不新增任何层**：改的是既有「社媒」支柱下的发帖函数（L3 Connector 适配器）和既有价格闸；Publer = 待退役的 L3。原完整版的「统一入口」属执行段基础设施（L1，不新增能力线），已推迟。**不新增支柱、不占候选名额、不用登记。**
- **[红线]** 红线 1（不包装升级）：不叫「XX 智能层」，只是把已有闸收口到一处。红线 2/4/5：闸里不出现客户名/行业判断；`publish_target`、`expect_brand` 是客户配置（L4）。红线 3：CTS 是发现者，但适配器本身是 L3，不涉及「单客户直建 L1」。
- **[继续]** 判定完，归位既有能力 → 不停等。

## 5.1 瘦身后的范围（精简版，取代本文件早先的「统一入口 + 通行证」完整版）

**来源**：2026-10-05 `优化 CTS 广告计划` 窗口转达「PM 回『瘦身』」，范围文件 `docs/specs/2026-10-05-content-foundation-trimmed-scope.md`（在 `zen-herschel` 工作副本 / PR #2239 分支，**我读了该文件；PM 本人的原话我没见到**）。理由（范围文件原意）：9/28 事故是脚本直调接口，函数里的闸拦不住；当前发布量很小，防不住真事故的复杂设计不做。完整版已存档在 §5.5，触发条件出现再拉回。

**现在做（小而有证据，一个 A 级 PR）：**

| # | 做什么 | 说明 |
|---|---|---|
| ① | **Publer 总开关** `PUBLER_PUBLISH_ENABLED`（默认关）：装进 `schedulePost()` 函数内部 + 6 个发帖入口返回「已停用」+ `accounts` 接口收口 + 每次被碰写一条回执并进今日待办 | 可随时打开回滚，不删代码。这是取消 Publer 的安全前提之一（§6）|
| ② | **Reels 路由两处真漏洞**（`reels/[draftId]/publish/route.ts`）：删掉请求体 `caption` 覆盖（只发库里 `fb_caption`）；`account_id` 必须属于该客户（按客户连接器里 `publer_account_ids` 绑定校验）| 几十行。**注意**：库里目前**没有任何客户绑定 Publer 账号**（§3），所以修完后这条路由对所有客户都是「拒绝」，效果等同关闭——与①叠加，开关将来重开时也不会再是漏洞 |
| ③ | **价格检查接进发出函数入口**：把现有 `judgeOutgoingPost` 调用装进 `publishPagePhotoPost`（每日计划图文）函数内；`schedulePost` 只装①的开关，**不再额外接价格检查** | **这一条是我的建议，和转来的字面要求（「schedulePost 等」）略有不同，请 PM/对方窗口确认**：Publer 几周内就取消，给 `schedulePost` 接价格检查是写完就删的代码；真正长期有用的接入点是 `publishPagePhotoPost`。如果 PM 坚持两处都接，加约半天，不影响取消日期。函数需新增必填参数 `clientId`；命中价格但无依据 → 抛错并写 `social.publish.blocked`；出错/查不到一律拦 |
| ④ | `social-engagement-pullback` 去掉 Publer 那一段（TikTok / Facebook 两段保留）；隐藏 UI 里的 Publer 按钮 | Publer 那段库里 0 条写入 |

**③ 的已知限制（如实）**：`judgeOutgoingPost`（`content/price-claim-gate.ts:90`）**没有图就不拦**——对视频 Reel（没有 `imageUrl`）等于不生效；工厂 Reel 只靠品牌红线闸 `scanPublishCaption`。这一缺口由底座「统一事实检查」（范围文件：只接视频、广告、社媒三个渠道，先 `dry_run` 再开硬闸）去补，**本方案不补**。另外，每日计划图文和工厂 Reel 目前**都不经过** `judgeOutgoingPost`（它全仓只有 3 个 Publer 路由在用），所以③是「第一次给最严的原生图文路径加价格检查」，不是「重复加固」。

**不做（PM 瘦身）/ 推迟（有触发条件才做）：**

| 项 | 状态 | 触发条件 |
|---|---|---|
| 通行证 `OutgoingPass`、`OUTGOING_FUNCTIONS` 注册表、反向扫描、sha256 凭证 | 不做 | 第二次绕闸事故（范围文件）|
| 统一入口 `publishOutward()`、视频工厂「发布许可」闸（v0.3 §1b；v0.3 的外部成片入口已砍）| 暂不做 | 同上 |
| 事后对账巡检（每日读主页帖子 vs 回执，抓「没留回执的帖」）、静态扫描 | 推迟 | 同上。**我的意见（供 PM 取舍，不是越权加码）**：这是仓库里唯一能发现 D14 型「脚本直调」的办法，成本只是一条每日定时任务，出现下一档预算时建议第一个拉回 |
| Instagram 适配器（含授权用途、权限申请、哪些客户有 IG 的盘点）| 推迟 | 有客户真有 Instagram 账号要发（范围文件）。§4 的权限事实留档备查 |
| LinkedIn 适配器 / 文字帖 / TikTok 应用过审 | 推迟 | 同上，原本就是 P3 |
| 讲课片口子（N4）鉴权过松 | 不处理 | 仍按 9/29 台账「PM 接受风险」|

## 5.2 分步计划（精简版）

| 步 | 做什么 | 风险级 | 谁审 | 当场试跑（不借试跑真发）| 前置 |
|---|---|---|---|---|---|
| **1** | 上表 ①②③④ 合成**一个 PR**。DeepSeek 写、Claude Code 审 diff 跑测试（CLAUDE.md §5 默认分工）；分支 `feat/` 前缀，PR 保持草稿，正文 `风险级别：A`；A 级合并须 PM 在对话里回「合」| **A**（碰外发函数 + 价格闸）| 代码 PR 按范围文件「流程瘦身」：子牙 + 魏征；**无新增对外入口，狄仁杰不必参与**；本方案文档只审一次 | ① 用测试客户把 6 个入口各调一次 → 全部「已停用」、**零次外部请求**、各留一条回执，今日待办出现一条测试告警；② Reels 路由带 `caption` 覆盖、带别的客户的 `account_id` 各一次 → 都被拒；③ `publishPagePhotoPost` 用 `no_publish` 模式：带无依据价格的文案 → 拦；干净文案 → 通过；④ `social-engagement-pullback` 以 `dry_run` 触发一次 → TikTok/FB 两段有回执、Publer 段缺席 | 无（PM 的 Publer 后台数字**不是**写代码的前提，是取消的前提）|
| **2** | **PM 在 Publer 官网取消订阅**（PM 自己点）| — | — | 取消后看 Publer 设置页显示的「已取消/到期日」| §6.1 条件 |
| **3** | 取消满 30 天、无报警后，删 Publer 代码与环境变量（`PUBLER_API_KEY/WORKSPACE_ID`）、`doctor.sh` 探针、`boundaries.ts` 里 `@/lib/publer/client` 及相关冻结测试、死代码 `facebook-publisher.ts` / `xiaohongshu-publisher.ts`；保留 `content_posts.publer_post_id` 列不删 | A（改内核边界清单）| 子牙 + 魏征 | `type-check` + 相关测试 + 确认无引用 | 步骤 2 满 30 天 |

## 5.3 事件与回执（CLAUDE.md §3，缩小到够用）

只用一个事件 `social.publish.blocked`，回执含：request_id、client_id、platform、来源编号（帖/草稿/素材）、`no_publish=true`、原因（`publer_retired` / `price_claim_unbacked` / `account_not_owned` / `caption_override_rejected`）、created_at。`publer_retired` 同时进今日待办（what：谁碰了已停用的 Publer 入口；how：看这条是谁/哪个页面触发；href：该客户内容页）。其余事件族（`requested` / `published` / `unreceipted_post_detected` / `permit_*`）随 §5.5 推迟。

## 5.4 与已有设计的关系

| 已有设计 | 现在怎么接 |
|---|---|
| 治理 v0.2（审核清单、`reviewer_role=admin`、熔断）10-02 已合入 | **不动**，每日计划图文和工厂 Reel 的现有闸原样保留 |
| 治理 v0.2 §0 ①「视频工厂唯一出口技术闸门」(PR #2177) | 不在本方案范围；其合入状态**未确认** |
| 台账 `2026-09-29-social-publish-gate-risk-accepted`（讲课片 + 两个 Publer 口子，PM 接受风险，`verify_by=2026-10-13`）| 步骤 1 合入后，其中两个 Publer 口子的风险**自然解除**；讲课片口子不动。步骤 1 合入后要更新该卡 |
| v0.3 §1b 发布许可、§3「Publer 适配器」| §1b 按瘦身**暂不做**；v0.3 §3 那句「Publer 适配器只在要发 Instagram 时才需要」**本方案修正**：不做 Publer 适配器，将来要发 Instagram 就做原生适配器（推迟项）。v0.3 §1b 里「Publer 口子收口前纪律是 CTS 成片不经 Publer」→ 步骤 1 合入后可删 |
| 客户内容底座第 0 步「发布层兜底闸」| 缩成本方案 ③（只接 `judgeOutgoingPost`），不再有通行证；底座第 4 步（统一事实检查）只交付判定函数，将来替换 `judgeOutgoingPost` 即可，调用位置不变 |

## 5.5 存档：被瘦身掉的完整设计（触发条件出现再用，不在本轮范围）

早先版本曾设计：① `publishOutward()` 统一入口，闸的顺序「内容闸 → 发布许可（v0.3 §1b）→ 哈希重算 → 签发通行证 → 发出函数」；② `OutgoingPass`：所有发出函数签名必须带通行证，通行证绑定 `sha256(最终文案 ‖ 素材哈希 ‖ 目标账号 ‖ client_id)`，发出前重算，改动即失效；③ 注册表 `OUTGOING_FUNCTIONS`（`schedulePost`、`scheduleSocialPost`、`publishPagePhotoPost`、`facebookReelAdapter.publish`、`tiktok-adapter`、`publishToFacebook`）+ 反向扫描（发布请求特征出现在注册表之外即测试失败）+ 行为测试；④ 每日对账巡检 + CI 静态扫描；⑤ Instagram 适配器（独立授权用途 `ig_publish`，容器 → 轮询 → 发布）。**为什么推迟**：见 §5.1，脚本直调接口时函数内的闸拦不住，且当前发布量小。**发出函数与调用点清单**（本地快照 2026-10-05，我重新 grep 过）：`schedulePost` ← `reels/.../publish`、`publer/schedule`、`publer/create-post`、`flywheel/social-post-publish.ts:202`；`scheduleSocialPost` ← `content-posts/.../publish`、`content-factory/[postId]`（LinkedIn）、`linkedin-progress/run.ts`；`publishPagePhotoPost` ← `campaign-daily-plan/publish/route.ts:314`；`facebookReelAdapter` ← `publish-worker`（含讲课片）；`tiktok-adapter` ← 讲课片；`publishToFacebook` 无生产调用方。
---

# 六、问题 5：取消 Publer 的安全清单

> **取消是 PM 在 Publer 官网自己点的动作，我不替你取消。** 下面是条件和顺序。

## 6.1 取消前必须全部满足

| # | 条件 | 怎么验 |
|---|---|---|
| 1 | **Publer 后台没有未发出的排期帖**，且近 90 天的发帖数你认可 | PM 登录 Publer，看 Calendar / Posts 里「已排期」和「过去 90 天已发布」的数字（回我数字即可）|
| 2 | **（建议，非硬性）** ME 里 6 个口子已关（第 1 步合入、PM 回「合」）——不先关也安全（口子本来就没人用，订阅一取消它们只会报错），但先关能让用户看到「已停用」而不是「出错了」，并留下报警 | 第 1 步 PR 的当场试跑回执 |
| 3 | **（建议，非硬性）** 关闭后观察 7 天，今日待办里**没有**「Publer 口子被调用」告警——想要更稳就等，赶日期就跳过 | 看 `social.publish.blocked` 回执 |
| 4 | 没有客户正在用 Publer 手动排期（PM/FDE 口头确认）| 问 FDE |
| 5 | 下一轮 CTS 发票已确定去掉 Publer 一行 | 见 §7 |
| 6 | 没有计划在 Publer 上发 Instagram/LinkedIn（或已接受改人工）| PM 确认 |

## 6.2 依赖 Publer 的东西清单（取消后受影响）

6 个发帖入口 + `accounts` 接口；`publer-published` 回调；`social-engagement-pullback` 的 Publer 段；UI：内容页、素材页、Reels 工作台的「Publishing Hub」弹窗、设置页 `OtherDataSourcesPanel` 的 `PublerRow`；`SocialPlanSection` 的 quick-post（只写草稿）；LinkedIn 自家动态 cron（默认关）与 `manual-linkedin-items`；`doctor.sh` 探针；`src/lib/kernel/boundaries.ts` 与若干架构冻结测试（`kernel`、`growth`、`page-optimization`、`geo-measurement*`）；`src/lib/capabilities/index.ts`、`product-map/registry/social.ts`、`mcp/vendor-filter.ts`、`billing/usage-tracker.ts`、`ads/creative-link.ts`、`flywheel/vocabulary.ts` 里的 Publer 字样；STATE.md / ENV.md / ARCHITECTURE.md 等文档。

## 6.3 日期（精简版；**都是估算**）

| 日期 | 事 |
|---|---|
| 10-05（今天）| 方案出；PM 去 Publer 后台看「过去 90 天已发 / 已排期」数字（CTS 广告窗口已替 PM 去要）|
| ≈10-07 ~ 10-08 | PM 回数字 + FDE 确认没人手动用 → **硬性条件（1、4、5、6）全满足的当天 = 最早「不等代码」可取消日**；代价：ME 里 6 个入口报错而不是「已停用」|
| ≈10-09 ~ 10-10 | 第 1 步 PR 合入（精简后体量小：DeepSeek 写 ~1 天 + 子牙/魏征审 ~1–2 天 + PM 回「合」）→ **最早「建议」取消日 ≈10-10**，也是本方案给出的**最早安全日期** |
| ≈10-17 | 若想按 §6.1 条件 3 观察满 7 天 → 取消窗口 10-17 ~ 10-26 |
| **10-26** | **硬截止**（已加日历提醒）|
| 10-28（推算）| Publer 下一次自动扣费 NZ$33.24。**取消生效时点是否在当期末，需 PM 在 Publer 设置页核实**（我没验证 Publer 的取消规则）|
| 取消后 30 天 | 第 3 步删代码 |

**瘦身对日期的影响**：完整版要等「发布许可闸 + 统一入口」（A 级，依赖 v0.3 的 1a）才算准备好，最早约 10-12 且赶 10-26 很紧；精简版只剩一个小 PR，最早安全日提前到约 10-10，10-26 前有一周以上余量。若第 1 步审查拖延，可以不等它先取消（见 6.1 条件 2、3 已标「建议、非硬性」）。

## 6.4 取消后怎么回滚

- **ME 这边**：第 1 步用总开关，不删代码 → 把 `PUBLER_PUBLISH_ENABLED` 改回开即可恢复（第 3 步删代码之前都可以）。注意 Reels 路由两处校验是永久修复，重开后该路由仍会因「没有客户绑定 Publer 账号」而拒绝，如要真重新使用须先绑定账号。
- **Publer 那边**：重新订阅 Business 套餐；账号连接可能需要重新授权；重新使用前必须重新走 §6.1 条件 1。
- **第 3 步之后**：回滚 = 恢复被删代码的 PR + 重配环境变量，工作量中等，所以要等 30 天观察。

---

# 七、客户费用

- 发票工具（Dropbox `发票生成器`）全目录搜 Publer：**只出现在 CTS 的发票里**——INV-2026-006（4–6 月，含套餐升级共 4 笔）、010、013、018（9 月周期），按**成本价、不加价**转嫁，NZ GST 另计。010/013/018 在台账里标「已付」；006 的状态本次未核。其它客户没有。
- **取消后账单**：下一轮 CTS「第三方订阅」发票去掉 Publer 一行。9-28 那笔（若已扣）仍属上一周期，已含在 INV-2026-018 里。10-28 若取消成功则无这一笔。
- **需 PM 知晓的一处**：INV-2026-006 备注写「Publer 用于 CTS 的 Facebook、Instagram 及其他平台的排期发布」；而库里没有任何 Publer 发帖记录，CTS 也没有 Instagram 账号。**可能的解释**是 PM/FDE 手动在 Publer 网页里用过（库里看不到）——这正是 §6.1 条件 1 要核实的。是否要向 CTS 说明或调整历史账单，是业务决定，**我不判断**。

---

# 八、§11 优先级

| 事项 | 频率 | IMPACT 闭环关键度 | 收入关联度 | 结果 |
|---|---|---|---|---|
| **A. 关 Publer 口子 + 取消订阅**（第 1、2、3 步）| 低（库里 0 次使用，口子被点到是偶发）| 中（不卡 Act 主路径，但是一批绕开审核的外发口）| 低（省 NZ$33/月，且转嫁给 CTS）| 两低一中 → **P3**。**按规则本应暂缓；因 PM 2026-10-05 已拍板取消，且 10-28 有硬扣费日、工作量小（一个 PR），按 PM 插队处理** |
| **B. 价格检查接每日计划发帖函数 + Reels 路由两处校验**（第 1 步 ②③）| 低（Reels 路由库里 0 次使用；图文价格违规偶发）| 中（拦错误内容，不卡 Act 主路径）| 高（客户主页上出现编造价格 = 客户直接看到）| 高中低 → **P2**（排队，合进第 1 步一起做，几乎不增加工作量）|
| C. 统一发布许可闸 / 通行证 / 事后对账（**已推迟**）| 高 | 高 | 高 | 高高高 → §11 原结果 **P0**。**PM 以「当前发布量很小（CTS 工厂总共真发过 3 条）、通行证防不住脚本直调」为由瘦身推迟，属 PM 的业务取舍，触发条件见 §5.1**；风险是：D14 型脚本直调目前仍然没有任何技术闸，也没有事后发现手段 |
| D. Instagram 适配器（**已推迟**）| 中（有 IG 的客户数**未知**）| 高 | 中 | 高中中 → P2；触发条件：有客户真有 IG 账号要发 |
| E. LinkedIn / TikTok 过审 / 文字帖 | 低 | 中 | 低 | **P3**，写进待认领 |

按 §11.4：以上是我算的，PM 只需决定「同意这个顺序」还是「有业务原因插队」。

---

# 九、风险与未确认项

- Publer 站内历史、套餐规则、回调是否配置：**未确认**，靠 PM 核实。
- 生产环境变量（`PUBLER_*`、各客户令牌）是否已配：**未查**（不读密钥）。
- 哪些客户有 Instagram 专业号：**未查**。
- Instagram 在「标准访问」下对 ME 管理的客户号是否直接可发：官方规则推断，**未实测**。
- 治理 v0.2 的 PR #2193 合入内容我只看了文件清单与关键代码，**未逐项核对它是否覆盖了 v0.2 §2 全部项**；`daily-plan` 链路的 `reviewer_role` 已在 N2 里看到生效。
- 本报告的行号来自子代理读源码，**我抽查了 4 处，其余未复核**。
- 「客户内容底座规划 v0.3」与「瘦身范围」文件只在 `zen-herschel` 窗口的工作副本 / PR #2239 分支里，**未合入主干**；我读了瘦身范围全文，规划 v0.3 只读了第 0 步与 §9。**「PM 回瘦身」是 CTS 广告窗口转述，PM 本人的原话我没见到**；本方案只是文档收窄（可随时恢复完整版，完整版备份在 §5.5），转述足够，但若 PM 实际的范围与范围文件不同，以 PM 为准。
- 最早安全日期里的「第 1 步合入 ≈10-09~10-10」是我对 DeepSeek 实现 + 审查 + PM 回「合」的**估算**，不是承诺。
- 本报告和台账卡**未提交、未推送**。

---

# 十、Reuse Statement

- **复用了什么（精简版）**：现有价格闸 `judgeOutgoingPost`（接进 `publishPagePhotoPost`）、每日计划发布链路与 10-02 合入的审核清单/`reviewer_role`/熔断（原样保留）、`facebookReelAdapter` / `publish-worker`（不动）、`client_connectors.config.publer_account_ids` 绑定（用于 Reels 路由归属校验）、Inngest 事件+回执约定（只用 `social.publish.blocked`）、今日待办「需要你动手」栏。
- **真正 platform-shared 的新增**：Publer 总开关（临时，第 3 步随 Publer 一起删）、`publishPagePhotoPost` 的价格检查（`clientId` 必填参数）、`social.publish.blocked` 事件。**没有新层、没有新表、没有新 cron。**
- **industry-specific**：无。
- **client-specific**：无新增（`publish_target`、账号绑定、发票转嫁都在既有客户配置里）。
- **有没有把客户名/ID/行业判断写进 shared runtime**：没有；本报告里的客户名只出现在证据与账单段落，不进代码方案。
- **学习**：无新增 memory 层写入；「Publer 在 ME 里几乎零使用」是 client-private 事实（账务口径），不升级。
- **落点一致性**：与 tier-gate 的 Inline 判定一致，且比决策时更小：完整版曾含 L1 基础设施「统一入口」，PM 瘦身后只剩既有 L3 适配器内的改动，无新能力线。
