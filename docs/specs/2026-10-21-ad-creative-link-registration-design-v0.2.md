# 广告 ↔ 成片 关联行（ad_creative_links）补链设计 v0.2 · 只设计，未写代码 · 119 号 · 2026-10-21

> v0.2 = 吸收子牙+魏征对 v0.1 的复审（结论「修后再进」）+ 122 台账 v0.7 §12.11–13 的对齐。取代 v0.1。
> 风险级：**A**（归因的真相源；有迁移、有触发器、会写生产库）。设计阶段需复审；排在推广期扫描之前（PR-2.0）。**未写代码。**

## 0. 先说结论（含一个 10-21 新读出来的事实，它改变了绑定的做法）

1. **新事实（只读 Meta 核对，CTS 官方户 4 条在投广告的创意）**：创意对象的 `object_story_spec.video_data.video_id` 保留的是**广告库里的原视频编号**（A2=`28843889985273791`、B3=`3626096160888481`，正是素材池条目的 `ref`）；而创意顶层 `video_id` 与快照 `creative_video_ids` 记的是 Meta 生成的**衍生副本**（`2052942792039743` 等）。
   - 含义：**广告 → 素材池条目这一跳，可以直接读创意的 `object_story_spec.video_data.video_id` 与 `ref` 精确相等**，是 Meta 记录的、创建后人改不了的事实，**不需要靠别名**。别名（`alias_refs`）降为「创意不是用 `object_story_spec` 建的（引用现成帖子）」时的兜底，并且**别名不参与绑定继承**（见 §2.3）。
   - 对其他设计的连带影响：推广期扫描的匹配键应新增「路 0：创意 `object_story_spec.video_data.video_id`」（快照要多存这一列 `creative_source_video_ids`，见 §6）；v0.4 §1 的三路匹配键相应改成四路。
2. **现状（沿 v0.1）**：`ad_creative_links` 全表 4 行全是 `unresolved`，只有 `winner_reel_sync` 一个调用点；`boost_post_api` **已退役**（路由返回 410，一键建广告 helper 10-06 已删，有架构测试防回归），**不接线**。ME 自己的建广告路径只有 `publishDraftPaused`（草稿建成暂停广告）。
3. **帖子 id 精确命中对库内视频永远对不上**（沿 v0.1 §0.2）：工单发布的是主页 Reel 草稿，广告用的是广告库视频，三个 id 互不相同。所以绑定走「广告库视频 → 工单」，而这一跳需要**可核验的来源**（§2），不能只靠标题里的 8 位前缀（谁能往广告库传视频、起个带前缀的标题，谁就满足）。

## 1. 绑定模型（沿用素材池，不新增表）

```
广告(ad_id) ─创意 object_story_spec.video_data.video_id(路0)/帖子id(路1)─► 素材池条目(ref) ─work_order_ref(+binding_strength)─► 工单
```
- 判定顺序（纯函数 `decideCreativeLink` 扩展，仍「绝不猜」）：①路1：帖子 id 精确命中唯一已发布工单 → `published_post_id`；②路0：创意源视频 id == 唯一素材池条目 `ref`，且该条目的绑定强度 ≥ 2 → `asset_binding`；强度 = 1（仅标题核验）→ 只写 `asset_binding_provisional`，**不算内容绑定**；③其它 → `unresolved` + 具体原因（无视频 id / 视频不在素材池 / 条目没绑工单 / 命中多条）；两路冲突 → `unresolved`。
- `link_method` 取值：`published_post_id` | `asset_binding` | `asset_binding_provisional` | `unresolved`。**内容绑定类 = 前两个**（台账 observed_live 只认这两个，与 122 v0.7 一致；`provisional` 一律不放行）。

## 2. 「素材池条目 → 工单」的绑定：强度分级（回应「绑定可构造」）

条目新增 `work_order_ref`（工单 id）与 `binding_strength`（1/2/3）、`binding_set_by`、`binding_set_at`。**只能由受限入口写**（`requireGlobalAdmin`，写入人由会话派生；通用保存接口既不接受也不抹掉——沿用 PR 2967 的保护与「先读版本再读内容、带版本比较写入」的乐观锁，`work_order_ref` 的写入也走 `writeConfigCas`，不会被整池读改写覆盖）。

| 强度 | 含义 | 怎么得到 | 能产生什么 |
|---|---|---|---|
| **3 · ME 上传** | 这个广告库视频是 **ME 自己从该工单的 `final.mp4` 上传的**（上传时系统记下 `video_id ↔ work_order_id`） | 要求素材上传走 ME 的上传路径（`meta/asset-upload`），上传完成当场写绑定；**手工在 Meta 后台/MCP 上传的拿不到这一级** | `asset_binding`（强） |
| **2 · PM 认定** | PM 在「可用于广告的视频」页对该视频点「批准」时，页面并排显示该视频的预览和被绑定工单的名称/出片预览，PM 点确认＝**PM 对「这条视频就是这条工单的成片」签字**，记 `approved_by`/时间 | 复用现有批准入口，批准前必须已有 `work_order_ref`（强度 1 的临时绑定）；批准动作把强度升到 2 | `asset_binding`（以 PM 认定为根；台账 `link_strength` 如实标 `pm_attested`） |
| **1 · 标题核验** | Meta 读到视频存在且 `ready`、标题含工单 id 前 8 位、创建时间晚于工单 | 受限入口 `POST creative-pool/work-order-ref` 读 Meta 与库核验后写 | **仅 `asset_binding_provisional`**，不算内容绑定 |

- 为什么这样分：标题前缀是人写的，**只能当「候选建议」**；真正的根要么是系统自己的上传记录，要么是**有权批准素材的 PM 本人的确认**——这和现有规矩一致（素材入池本来就要 PM 批准，不新增「谁说了算」，只是把绑定纳入同一次签字）。
- 不做：不比对视频内容哈希。Meta 的视频会重新编码，下载的 HD 副本与原始文件字节不同，哈希比对不可靠（需要更复杂的内容指纹，列入后续）。
- 一个工单只能绑一个素材池条目；一个条目只能绑一个工单；已绑定后换绑 → 409，要换走「带 PM 授权的回滚路径」（本期不做自动入口）。
- **别名不继承绑定**：`alias_refs` 只负责「这个创意视频 id 是该素材」这一步识别（兜底路径），不得因为加入别名就继承 `work_order_ref`。别名加入本身也要**核归属**：只接受「在客户登记账户的广告创意里，其创意源视频 id（`object_story_spec`）等于该素材 `ref`」的衍生视频 id；读不到/对不上 → 拒绝（所以别名不再能凭人填）。已批准素材增减别名仍按 PR 2967 的规则降回候选。

## 3. 交付一：ME 内建广告路径写关联行

- **只接 `publishDraftPaused`（`ad-publisher.ts`）**：新增登记路径 `me_ad_launch`；创意里本来就有 `videoId`（库内视频），建成广告后立刻 `linkAdToCreative`（永不抛异常，失败吞掉并大声记日志）。
- `AD_CREATION_PATHS` / `AdCreationPath` 这个封闭类型：**移除已退役的 `boost_post_api`**（有 10-06 的架构测试，不再接线）；新增 `me_ad_launch`、`manual_register`、`backfill_2026_10`（登记入口与回填也要有合法的 `created_by`，否则类型/CHECK 会拒绝）。
- 草稿阶段的广告是暂停状态，**仍然写关联行**（归因要的是「这条广告是哪条片」）。

## 4. 登记入口与每日自动登记

- **主路径是每日自动扫描登记**（Inngest 定时，只读 Meta + 写关联行）：对客户登记账户里「没有关联行」的在投/近期广告，读 Meta 取创意（`object_story_spec.video_data.video_id`、`effective_object_story_id`、`created_time`），按 §1 判定后写入。**登记结果全由 Meta 读回 + 库核验得出，不含任何人填信息**；这样不依赖「74 号建完记得调」。
- 会话路由 `POST /api/clients/[id]/ad-creative-links/register` **只留补登**：请求体只收 `{ ad_id }`；鉴权用 **`requireGlobalAdmin`**（不是 `guardAdmin`），行里记 `registered_by`；先读后写（见 §5）。**「无会话时由 119 代调」这个人工依赖取消**。
- 手建广告的超上限检查（2999 设计）在登记入口里做 warn 模式，见 PR 2999。

## 5. 写入语义与触发器（与台账 v0.7 §12.11 对齐，收紧「更强证据」）

- **解析成功的行写一次不可改**：`creative_ref` 非空且 `link_method ∈ {published_post_id, asset_binding}` 时，任何会改 `creative_ref/link_method/creative_source/post_id` 的 UPDATE 报错；**同时拦 `DELETE` 和 `TRUNCATE`**（只拦 UPDATE 会被「删除再插入」绕过）。允许：`unresolved` / `asset_binding_provisional` → 内容绑定类，**升级一次**；反过来不行。
- **「出现更强证据时更新」整句删除**。换绑只能走带 `created_by` 的回滚/回填路径，且要 **PM 授权**（A 级迁移或受审脚本）。
- `persistLink`（现为无条件 `upsert onConflict`）改成：已存在 resolved 行时 **do nothing**；登记入口先读后写：已解析且结果相同 → **幂等成功**；已解析且结果不同 → 409 `link_already_resolved`，不写。
- 迁移（A 级，apply 要 PM 显式 go）：①触发器（UPDATE/DELETE/TRUNCATE）；②新增可空列 `ad_created_at timestamptz`（台账「广告晚于请求」用它，替代最早快照近似）；③新增可空列 `registered_by`、`link_strength`；④`post_id` 现为 `NOT NULL`——视频创意可能没有帖子 id，**改为可空**并加 CHECK（`link_method = 'published_post_id'` 时必须非空）；⑤`link_method`/`created_by` 的取值若有 CHECK 同步扩展。

## 6. 快照与扫描要配套的一列

`ad_entity_snapshots` 现在只存创意顶层 `video_id`（衍生副本，`portfolio/snapshot.ts` 的 `normalizeAd`）。为了让路 0 能在快照上算（扫描、每日登记都读快照），新增 `creative_source_video_ids text[]`：取创意 `object_story_spec.video_data.video_id`（含轮播/动态素材的各子项）。这与推广期设计 v0.4 §6「快照扩采」是同一次迁移（PR-2a），不单独再加一次。

## 7. 存量回填（只出方案，不写库；沿 v0.1 §5，口径收紧）

1. **只读试跑（dry-run）**：对客户登记账户里的在投广告（以 Meta **实时读**为准，不用滞后快照），按 §1 判定，输出表：广告 id、创意源视频 id、命中的素材池条目、将写入的 `link_method`/`creative_ref`，或 `unresolved` 原因；附汇总。
2. **官网户 4 条在投广告**（10-21 读到）：源视频 id = A2/B3 的 `ref`；A2 条目需绑定工单 `6149a614…`、B3 绑定 `812221fd…`。**回填写 `asset_binding_provisional`，不写 resolved**——因为这两条素材是人工上传到广告库的（强度只有 1），要升到内容绑定需要 PM 在批准页对「视频=工单」签字（强度 2）。PM 签字后由一次受审的升级写入完成。
3. 个人号（已欠款停用）老广告：绝大多数无源视频在素材池 → `unresolved`，如实留白，不回填猜测。
4. 写库前：PM go（A 级）；`created_by='backfill_2026_10'`；绝不覆盖已 resolved 的行；回读核对行数；回滚 = 按 `created_by` 删除（需 PM 授权；触发器放行该回滚路径的做法在实施设计中写明）。

## 8. 与 122 台账的对齐（已达成一致的部分）
- observed_live 认内容绑定类（`published_post_id`、`asset_binding`），`unresolved`/`provisional` 不放行；台账 `provider_ref.link_strength` 如实标 `post_id`（强）/ `me_upload`（强）/ `pm_attested`（经 PM 认定）。
- 「广告晚于请求」改用关联行的 `ad_created_at`（§5 新列），为空才回落最早快照并标近似。
- 创意请求的目标（`ad_account_id/campaign_id/adset_id`）两步填（122 已知）。

## 9. 未核实 / 待决
- **未核实**：对「用现成帖子建的广告」（`object_story_id` 形态，无 `object_story_spec`）源视频 id 读不到——走路1 或别名兜底；`meta/asset-upload` 现在是否会返回并留存 `video_id`（强度 3 的前提）；轮播/动态素材的 `object_story_spec` 形态。
- **待 PM 决定（不替定）**：强度 2（PM 认定）是否可接受作为「内容绑定」的根，还是要求必须强度 3（只能经 ME 上传）。后者更严，但 74 号手工上传的素材都拿不到。
- 本稿不改变「不新增表/不新增合同」的立场：只给素材池条目加字段、给 `ad_creative_links` 加列与触发器。
