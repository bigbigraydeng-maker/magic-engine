# 社媒内容发布治理 v0.2 — 结构化审核 + 鉴权收紧 + 熔断，照广告支柱那套严格程度

**起因**：2026-09-28 East Inter 事故（见 [PITFALLS D14](../PITFALLS.md)）——负责该客户的窗口另写脚本直接调 Muapi 生成视频、直接调 Facebook `/videos` 发布，两条视频已发布在客户 Facebook 主页，完全没有声音、文案数字编造。窗口自己写「已完成、没问题」，没有任何独立质检。

**PM 要求**（经小秘书转达 2026-09-29）：参照广告自动化那套已建成的严格程度（Kernel 授权 + 熔断器 + 审计记录），给社媒内容发布补一套对应的治理，不能再靠专员窗口自证。

**作者**：苏东坡（内容专业视角，检查清单 + 工厂链路三写入点）+ 子牙（架构、鉴权修法、双链路现状核实）。**审查**：魏征第一轮已过（v0.1 → v0.2 的两个 BLOCKER 由第一轮审出，见 §7）；v0.2 待第二轮。

**v0.1 → v0.2 变更**：魏征第一轮审出两个 BLOCKER——① v0.1 把整套清单错挂在只处理图片 Post、从不处理视频的 `daily-plan` 链路上，真正跑视频发布的是 `content_work_orders`/factory 链路，两次事故一次没提；② `daily-plan/post-review` 的审核鉴权（`requirePaidClientAccess`）可以被客户自己团队满足，"结构化清单强制真审核"这句话不成立。v0.2 把两条链路都摸清楚、分别挂对地方，并补上鉴权修法。**这版是否已经补全，仍待魏征第二轮**，不能自认为已经修好。

---

## 0. 这份设计解决什么，不解决什么（先划边界，避免 PM 以为一份设计堵两种漏洞）

Eastinter 事故其实是两个不同性质的漏洞叠在一起：

| 漏洞 | 性质 | 谁来堵 |
|---|---|---|
| ① 内容压根没走任何审核链路，另开脚本直接调生成 API + 发布 API | **绕开链路本身**——不是链路内部审核不严，是根本没进链路 | 另一张实施卡「视频工厂唯一出口技术闸门」（静态 CI 检查，PR #2177，已签字，待 #2175 合并）。它自己也承认一个固有局限：新文件只要物理放进 `src/lib/factory/` 目录，就会被当成"安全区"放行，不验证是否真的被 `daily-plan`/factory 任一条审核链路实际调用——跟本设计的边界是同一个洞的两面 |
| ② 就算进了某条链路，现在的审核记录要么是自由文本、要么审核人可以是客户自己 | **链路内部的审核深度和鉴权都不够** | **本设计**——结构化清单 + 鉴权收紧 |

本设计**假设内容已经进入了 `daily-plan`（图片 Post）或 `content_work_orders`/factory（视频/Reel）其中一条链路**——这是现状仅有的两条有审核概念的路径。它**不解决**"如何防止有人另开脚本完全跳过这两条链路"，那是①的范围，也不解决"新文件放进 `src/lib/factory/` 目录但没被真正接线调用"这个更细的绕法（同样是①那张卡承认没做的部分）。**①②两张卡必须同一里程碑合并验收，缺一个都还会再出一次 Eastinter**——这不是文字上的划界，是两张卡各自的验收标准里都要互相引用对方，任一张卡的"已知洞"部分显示对方还没合并，就不能对 PM 说"这类事故已经堵住"。

---

## 1. Reuse-First：两条链路的现状，哪些可以直接扩，哪些要新建

按 CLAUDE.md §0 平台化闸门，动手前先把现状查清楚，下面每一条都是子牙 + 苏东坡各自读代码核实过、互相复核过的，不是猜的。

### 1.1 链路 A —— `daily-plan` → `post-review` → `publish-queue` → `publish`（**只处理图片 Post，不处理视频**）

- `CampaignDailyPostReviewDecision`（`src/lib/campaign/daily-plan.ts:112`）：现状 `{ verdict: PASS|NEEDS_REVISION, reason: string|null, reviewed_at, reviewed_by_user_id }`。`reviewed_by_user_id` 来自 `post-review/route.ts:186` 的 `access.user.id`，是 `requirePaidClientAccess` 鉴权中间件给出的真实登录身份。
- `publish-queue/route.ts:157`：`review?.verdict === 'PASS'` 才允许一条帖子进发布队列；`publish/route.ts:127`：发布前拿 `review_revision` 跟存的 `review_meta.revision` 比对一致，不匹配 409；`daily-plan/route.ts:535` 每次整份快照 POST 重新生成 `plan_revision`，内容一改旧审核自动作废——**这条 revision 链路是真实有效的，没有"审的是 A 版、发的是 B 版"的路径**（魏征第一轮核实过 `bundleSchema`/`CampaignDailyCommandSchema` 强制整份替换、不允许部分合并，结论成立）。
- `publish/route.ts:30,306`：发布走的是 `publishPagePhotoPost`——**全仓 `grep publishPageVideoPost|/me/videos|Reel` 挂在 `campaign-daily-plan` 目录下零结果**。`daily-plan.ts:322-328` 自己的注释也写着 `bundle.reel` 的 `media_status` "WP1 has no real-output verification path……may never assert READY"——这条链路里的 Reel 概念现在连"有没有产出"都判不了。
- **鉴权缺口**：`requirePaidClientAccess` 放行 tier 包括 `paid_client`，`access-types.ts` 把 `client`/`dashboard`/`both` 这几种 `access_type` 全部映射进 `paid_client`——**客户自己 portal 团队的成员可以直接 PATCH `post-review`，自己给自己的内容打 PASS**，`reviewed_by_user_id` 就是他自己，全程不需要任何 ME 员工碰这条内容。

**结论**：这条链路只服务图片 Post，Eastinter 那种视频事故根本不会经过它——v0.1 把整套视频检查清单挂在这里是选错了对象。但它自己的鉴权洞是真实存在的，要修（见 §2.3）。

### 1.2 链路 B —— `content_work_orders` → `review-actions.ts`/`review-apply.ts` → `publish-worker.ts`（**真正处理视频/Reel 的链路**）

- 审核入口 `POST /api/factory/work-orders/[id]/review`（`route.ts:3` 注释原文"authz=guardAdmin(点击前 403)"），鉴权是 `guardAdmin()`/`requireAdmin()`——判的是 `getUserPermissions(email).role === 'admin'`（`require-admin.ts:27-28`），来自 `whitelist.ts` 的环境变量白名单，**跟链路 A 的 `requirePaidClientAccess` 是完全不同的两套机制**，客户身份够不着这个接口。
  - 唯一的例外/caveat：`whitelist.ts:47-57` 有 `DEMO_ADMINS` 机制，给"演示/试用账号"发一个限定在某个客户范围内的 admin 身份——这个白名单是 ME 自己配的环境变量，不是客户能自己发的，跟链路 A 那种"客户自己就能给任意邮箱开 portal 账号"不是一回事。但如果销售流程里把一个 `DEMO_ADMINS` 账号发给了外部人，这个人理论上能过 `guardAdmin()`。低概率、ME 自己控制的边缘情况，记录在案，不因此重新收紧。
- **三个不同的写入时机点，不是一个**：
  1. **完成时自动扫**（人还没开始审）：`complete-work-order.ts:221` 调 `scanContentQualityFlags`（竞品品牌/占位字幕/叙述人称不符，Jev AI 判），结果写进 `output.quality_flags`（约 290 行）。这套是既有的**软判据**——命中只标记，工单照样 100% 进 `in_review`，不自动拦截。
  2. **approve 时**：`review-apply.ts:50-58`，`review_ref`（JSONB，`Record<string, unknown>`）用 spread 合并写入 `{ ...reviewRef, approved_by, approved_at }`。
  3. **reject_quality 时**：`review-apply.ts:75-90`，**不碰 `review_ref`**，走顶层列 `status='review_rejected'` + `reject_category`/`reject_reason`，然后重开一张新工单，把 `review_feedback`/`reopened_from` 写进新工单的 `brief`——这条打回路径比链路 A 强：链路 A 打回只能让审核人重填，这里能把"具体哪几项没过"直接喂给下一轮生成。

**结论**：这条链路的鉴权本身没有洞（客户够不着），本设计对它的改动是往这三个写入点里补结构化清单，不需要修鉴权。

### 1.3 Kernel 层——`social.*` 已经是登记过的目标态，不是新提案

`docs/agents/14-sudongpo.md` §七（`docs/specs/2026-09-28-pillar-agents-capability-memory-kernel-v0.1.md` §4.3 的落地）已经把 `social.publish_post`（对应链路 A）/ `social.publish_reel`（对应链路 B）登记为 Kernel ActionKey，**恒 `human_only`**，现状标注"未建"。`OutwardApproval`（`src/lib/kernel/types.ts:168`）是 `human_only | bounded` 的封闭联合类型，落地时走已有的 `human_only` 分支，不需要新开授权模式。本设计不重新走层级门，只交付"`human_only` 这一步的审核内容和鉴权该是什么样"。

### 1.4 熔断范式——已有先例，用它的判别联合形状，不是它的类型本身

`src/lib/conversions/ai-auto-review-circuit-breaker.ts`：规则表 + 纯函数 `detect(input) → CircuitBreakerVerdict`，`CircuitBreakerVerdict = { tripped: false } | { tripped: true; rule: CircuitBreakerRule; detail: string }`。社媒熔断照抄这个判别联合的形状，不新造一套字段名。

---

## 2. 落地方案

共用类型（两条链路都用，避免各写一套）：

```ts
export type ContentCheckItemKey =
  // A类·基础可用性（服务器自动判，不接受调用方传入结果）——本类是这次事故暴露的新类别，只对 Reel 有意义
  | 'audio_track_present_nonsilent'
  | 'resolution_aspect_ratio_correct'
  | 'subtitle_timing_aligned'
  | 'cover_frame_not_blank_or_placeholder'
  // B类·事实grounding（来源字段服务器校验非空且格式合法；内容是否真支持这句话必须人工核对）——两条链路都要
  | 'factual_claims_have_source'
  | 'factual_claims_source_verified'
  // C类·爆款配方与既有红线（人工判，机器不代判"好不好"）——安全区/BGM/Reel格式只对 Reel 有意义，logo/素材来源两条链路都要
  | 'viral_recipe_hook_matched'
  | 'safe_zone_text_in_bounds'
  | 'logo_watermark_present'
  | 'subtitle_short_and_large'
  | 'asset_provenance_labeled'                // 素材有没有来源标签（可升 AUTO：client_assets.provenance 非空即过）
  | 'asset_provenance_matches_claim_context'  // 标了之后有没有被正确使用：真实产品/价格/门店承诺画面必须是客户实拍，图库/AI 生成不能冒充——不能升 AUTO
  | 'bgm_segmented_with_fades'
  // D类·发布铁律（服务器自动判）——两条链路都要
  | 'format_is_reel'
  | 'cta_in_first_comment_not_body'
  | 'first_comment_link_has_tracking_params'

export type CheckItemJudge = 'AUTO' | 'HUMAN'

export interface ContentCheckItemResult {
  key: ContentCheckItemKey
  judge: CheckItemJudge
  passed: boolean
  detail: string | null       // AUTO 写判定依据；HUMAN 判 false 时必填原因
  source_ref: string | null   // 仅 B 类必填：官网 URL / 客户资料路径 / brief 引用；其余类恒 null
}
```

**通用约束**：
1. A/D 类由服务器自己跑校验函数算出，不接受调用方传值——跟仓库现有"服务器重新解析、不信调用方"同一原则。
2. B 类 `source_ref` 为空或不是合法 URL / 已知客户资料路径前缀 → 直接拒绝提交，不能人工瞎填"已核实"却不给来源。这是**纯数据存在性检查**，不是 AI 判据，没有假阳性空间，可以硬阻断（对照 §2.4 的哲学区分）。
3. C 类 v0.2 全部先按 `judge: 'HUMAN'` 落地；坐标类阈值明确的项和"字段非空"类项具备升 AUTO 的条件，`asset_provenance_matches_claim_context` 因为是内容判断、永远不能升 AUTO；升级节奏留作后续事项。

### 2.1 链路 B（Reel/`content_work_orders`）—— 苏东坡草拟，三个写入点各自扩

```ts
// ① 完成时自动跑，跟 scanContentQualityFlags 挂同一个点（complete-work-order.ts:221 附近）
interface WorkOrderOutput {
  quality_flags: QualityFlag[]                     // 既有不动
  quality_checklist_auto: ContentCheckItemResult[]  // 新增：A类四项 + format_is_reel
}

// ② 人工审核时要填的项，approve/reject_quality 请求体都带
checklist_human: ContentCheckItemResult[]  // B类两项 + C类六项 + D类里CTA首评/追踪参数两项，judge 全 'HUMAN'

// ③ approve 存进 review_ref（复用 review-apply.ts:58 已有的 spread 写法）
review_ref: { ...reviewRef, approved_by, approved_at, checklist_human }

// ③' reject_quality 不碰 review_ref，新增顶层列跟 reject_category/reject_reason 一起写；
//    没过的项折进重开工单的 brief，下一轮生成能直接吃到"哪几项没过"（比链路 A 强）
newBrief.review_checklist_failed_items = checklist_human.filter(c => !c.passed).map(c => c.key)
```

**approve 的服务器强制**：`checklist_human` 每项 `passed` 必须 `true`，**且** ① 自动算好的 `output.quality_checklist_auto` 每项也必须 `passed`，两个都过才能 approve；任一没过引导审核人走 `reject_quality`，不接受"人工看了但没管机器报的错"。

**鉴权**：链路 B 现有的 `guardAdmin()` 已经是"只有 ME 内部身份能操作"，不需要额外修改（见 §1.2 caveat，`DEMO_ADMINS` 残余风险已记录）。

### 2.2 链路 A（Post/`daily-plan`）—— 结构化清单

`CampaignDailyPostReviewDecision` 新增 `checklist: ContentCheckItemResult[]`（只用得上 B 类两项 + C 类 logo/素材来源两项 + D 类两项，A 类视频专属项在这条链路上不适用，字段留空或省略）。约束同上。

**A 类不适用不是没人管，是既有 readiness 阶段已经覆盖同等语义**：`computeReadiness()`（`daily-plan.ts:449`）的 `client_asset_provenance`（`:482` `assetProvenanceOk`）会服务器验证 `image_asset_id` 真能在这个客户名下解析出有效资产，`format_completeness.post` 判完整性——图片"是不是坏的/空的/占位图"这层意思，在这条链路上是发布前置闸而不是本设计新加的 checklist 项，两边不重复也不遗漏。

### 2.3 链路 A 的鉴权修法（子牙）—— 这是 v0.2 相对 v0.1 新增的部分，直接回应 BLOCKER 2

不新建鉴权机制，复用已有的 `role` 字段：`requirePaidClientAccess` 返回的 `ClientAccessResult.role: 'admin' | 'client-viewer'`（`client-access.ts`）。`role: 'admin'` 只有两条路能拿到——`DEMO_ADMINS`/`ADMIN_EMAILS` 环境变量（ME 自己配），或 `client_portal_users.scoped_admin=true`（DB 列，全仓搜过 `src/app/api/`，没有任何接口允许调用方写这一列，只能 ME 内部直接改库）。这跟链路 B `guardAdmin()` 判的是**同一个 `role==='admin'` 语义**，两条链路的鉴权语义因此统一。

```ts
export interface CampaignDailyPostReviewDecision {
  verdict: CampaignDailyPostReviewVerdict
  reason: string | null
  reviewed_at: string
  reviewed_by_user_id: string
  reviewer_role: 'admin' | 'client-viewer'   // 新增：服务器从 access.role 直接抓，不接受调用方传值，跟 reviewed_by_user_id 同一审计原则
  checklist: ContentCheckItemResult[]
}
```

**服务器强制**：`verdict === 'PASS'` 要求 `reviewer_role === 'admin'`。`client-viewer` 身份提交的审核，服务器只接受它变成 `NEEDS_REVISION`——**client-viewer 仍然可以标记"有问题"**（客户自己发现问题也是有效信号，不该被这条修法一并堵死），只是不能自己把 verdict 判成 PASS。

### 2.4 为什么两种严格度能共存（AI 软判据 vs 数据硬阻断）

`content-quality-guard.ts` 的现有哲学：AI 判官猜的东西只标记转人工，工单照样 100% 进 `in_review`，不自动拦截——因为 AI 判断有假阳性概率，不能让机器替代人做最终判断（跟本仓库另一条教训"AI 探测失败不能当成测出来是零"同一个哲学：AI 输出的可靠性有限）。本设计新加的 B 类"来源字段是否为空"是纯粹的数据存在性检查，没有判断成分、没有假阳性空间，所以能做成硬阻断——它不是 AI 判的，不违反"AI 判的东西不能硬拦"这条哲学。两种严格度不是"这次突然变严了"，是两类不同性质的检查各自该有的严格度。

---

## 3. 社媒熔断器（套用 §1.4 的判别联合形状）

```ts
export type SocialCircuitBreakerRule =
  | 'repeat_a_class_failure'   // 同一生产来源 N 天内 ≥2 次 A 类（基础可用性）不过
  // 后续可加：post_hidden_spike / report_spike（发布后信号，与 v0.2 的"发布前"信号互补）

export type SocialCircuitBreakerVerdict =
  | { tripped: false }
  | { tripped: true; rule: SocialCircuitBreakerRule; detail: string }
```

熔断的触发对象是"生产来源"，不是"客户"——同一个客户可能有多条生产来源，熔断要精确到来源，不能连坐整个客户的所有内容。判断"同一生产来源"依赖 §0 表格①：`command_meta`（`daily-plan.ts:81`）现在只有 `source/received_at/raw_summary`，没有任何区分"谁触发"的字段。①张卡若最终收口到唯一发布凭证，来源标识应该长在那份凭证里；这次先用粗粒度替代（`campaign_id` + 触发方式），但要明确这个粗粒度精确不到"同一客户专员窗口另开的脚本"这个 Eastinter 事故的确切颗粒度——具体接线留到①落地后再定，v0.2 先把判据定下来。

---

## 4. 已知洞 / 后续事项（不许只留在这里）

- **AUTO 判定引擎目前不存在**：全仓搜索 `ffprobe`/`ffmpeg` 用法，没有一处做音轨/响度/黑帧检测；`recipe.ts` 的 `music.loudness_lufs` 是调用方自填字段，不是重新测量文件本身。§2 约束 1"服务器自己跑校验函数"这句话背后目前没有可以跑的函数，A 类落地前要先建这层基建，不算这次设计范围内已解决。
- **"生产者身份"字段现在不存在**：熔断的"生产来源"标识只能先用粗粒度枚举代替，见 §3。
- **§0 表格①**：静态闸门（PR #2177）已签字，但承认拦不住"本地跑一次从不提交"，也拦不住"新文件放进 `src/lib/factory/` 但没被真正接线调用"——本设计假设的"内容已进入审核链路"这个前提，最终成不成立取决于①的落地程度，不能算本设计已经解决。
- **`DEMO_ADMINS` 残余风险**（§1.2）：低概率、ME 自己控制，记录在案，不因此重新收紧链路 B 的鉴权。
- **C 类六项现在全部 HUMAN 判**：等落地跑一段时间、误判率评估过后再挪类。
- **旁支观察，本设计不处理**（苏东坡发现）：苏东坡手册第八条"社媒发布铁律"写"一律用 Reel 格式（不发普通图文动态）"，但链路 A 现在唯一能真正发布出去的就是图片 Post（§1.1）。这条铁律当初是特指"视频类内容不能退化成图文"，还是字面意义上禁止任何图片 Post，需要更早的决策上下文才能判断，不该由写设计文档的人一并拍板，留给 PM 或后续窗口视需要再查。

---

## 5. Reuse Statement

- **复用**：`CampaignDailyPostReviewDecision`（扩字段）、`content_work_orders.review_ref`（扩字段，spread 写法不变）、`review-apply.ts` 现有的 approve/reject_quality 分支、`postReviewDecisionSchema` 的 `superRefine` 校验范式、`requirePaidClientAccess`/`guardAdmin` 两套既有鉴权（`role==='admin'` 语义统一复用，不新建）、`publish-queue`/`publish` 现有的 revision 比对链路、`ai-auto-review-circuit-breaker.ts` 的判别联合形状、`social.publish_post`/`social.publish_reel` 已登记的 Kernel ActionKey（`human_only` 分支）。
- **新增**：`ContentCheckItemKey`/`ContentCheckItemResult` 结构化清单类型、`reviewer_role` 字段、`SocialCircuitBreakerRule` 熔断规则表——都是 platform-shared，不含任何客户名/客户 ID/行业专属逻辑。
- **客户/行业专属**：无。
- **本次实现落点与决策时的分类是否一致**：本设计不涉及新增 L1 Capability——`social.*` 的 Kernel 接入在 9-28 已判过层级，本次只是把两条已定目标态里"审核内容与鉴权"这段细节补完。

---

## 6. 待办

- [ ] 魏征第二轮对抗审查（v0.1 → v0.2 的修正是否补全两个 BLOCKER；是否有第三条链路或第三种绕过被漏掉）
- [ ] 板桥非技术视角（FDE/PM 要点开的审核 UI，需要板桥过一遍可用性）
- [ ] PM 拍板：C 类六项升 AUTO 的评估节奏、§3 熔断跟①的接线顺序、`DEMO_ADMINS` 残余风险是否接受
- [ ] AUTO 判定引擎（音轨/分辨率/字幕时间轴检测）作为独立后续实施卡，不在本设计的第一版 PR 范围内
- [x] ~~通过后开 A 级实施 PR~~ **改为**：设计定稿 + §8 交接说明齐全即收尾。PM 2026-09-29 拍板本设计的**实现**交给 Codex + DeepSeek 承接，苏东坡（Claude）继续做审查角色不写代码，子牙（Claude）不开实施窗口。这份文档定稿是 Claude Code 这边的终点，不再往下跟实现。

---

## 7. 修订记录

- **v0.2（2026-09-29）**：魏征第一轮审出两个 BLOCKER 后返工。苏东坡摸清链路 B 三个写入点（自动扫/approve/reject_quality），子牙摸清链路 A 鉴权洞并给出 `reviewer_role` 修法，双方互相复核对方的代码引用（约 10 处 file:line 逐条核实）。
- **v0.1（2026-09-29）**：初版，误将结构化清单挂在只处理图片 Post 的 `daily-plan` 链路上，未覆盖 Eastinter 实际事故的视频发布路径；`daily-plan/post-review` 鉴权洞未被发现。

---

## 8. 交接给 Codex + DeepSeek（实现方，本节假设读者没有这次对话的上下文）

PM 2026-09-29 拍板：本设计的实现由 Codex + DeepSeek 承接，不在 Claude Code 这边开发窗口。以下信息假设实现方对本次讨论过程一无所知，只看这份文档和仓库本身。

### 8.1 开工前必读（按本仓库协作规矩，不是本设计独有）

- `CLAUDE.md`（本仓库权威规矩：中文汇报、风险分级、Git 纪律、客户数据红线）——尤其 §0 平台化闸门、§4 大任务多审、§6 Git、§8 客户数据红线。
- `docs/agents/14-sudongpo.md`（苏东坡手册，本设计的内容专业依据）、`docs/PITFALLS.md` D14（East Inter 事故原始记录）。
- 本文档 §1（两条链路现状核实，全部带 file:line，实现前应重新核实一遍，代码可能已经变化）。

### 8.2 本设计范围内要改的文件（起点，不是穷举）

- `src/lib/campaign/daily-plan.ts`：`CampaignDailyPostReviewDecision` 加 `reviewer_role`、`checklist` 两个字段（§2、§2.2、§2.3）。
- `src/app/api/clients/[id]/campaign-daily-plan/post-review/route.ts`：加 `verdict==='PASS'` 要求 `reviewer_role==='admin'` 的服务器校验（§2.3），`reviewer_role` 从 `access.role` 服务器端直接抓，不接受调用方传值。
- `src/lib/factory/complete-work-order.ts`（约 221/290 行附近）：`output` 新增 `quality_checklist_auto` 字段（§2.1 ①）。
- `src/app/api/factory/work-orders/[id]/review/route.ts` + `src/lib/factory/review-actions.ts`（`parseReviewBody`）+ `src/lib/factory/review-apply.ts`（`applyApprove`/`applyQualityReject`）：接入 `checklist_human`（§2.1 ②③③'）——魏征第二轮指出这几处**当前完全没有 checklist 相关字段**，是需要新增代码的部分，不是改现有校验。
- 新增文件：`ContentCheckItemKey`/`ContentCheckItemResult`/`CheckItemJudge` 类型定义（建议放 `src/lib/campaign/` 或抽到两条链路都能 import 的共享位置，具体放哪由实现方决定，不是本设计强制）。
- 新增文件：`SocialCircuitBreakerRule`/`SocialCircuitBreakerVerdict`（§3），依赖 §0①「视频工厂唯一出口技术闸门」落地情况，实现前先查该闸门当前状态（`docs/ledger/2026-09-29-video-factory-bypass-gate.md`）。

### 8.3 验收标准

- 每处新增的服务器强制（§2 通用约束 1-3、§2.1 approve 双通过条件、§2.3 `reviewer_role` 硬性要求）都要有对应测试，覆盖"正常通过"和"应该被拒绝"两侧，不能只测 happy path。
- 至少一条集成测试复现 §1.1 描述的 East Inter 事故形状在**新代码生效后**会被拦住（例如：`reviewer_role='client-viewer'` 提交 `verdict='PASS'` 必须被拒；`checklist_human` 缺一项 `passed:false` 时 approve 必须被拒）。
- 按 CLAUDE.md 要求做当场试跑，不接受"测试写了但没跑过"。
- 涉及数据结构 + 鉴权收紧，属于 A 级：分支用 `feat/` 前缀（不要用 `claude/`）；PR 保持草稿，正文单独一行 `风险级别：A`；找子牙 + 魏征三方审（跨会话消息，窗口名含"子牙"）过了才能转正；合并前必须 PM 在执行合并的那个窗口亲口说"合"，转述不算数。这条流程跟本仓库其它 A 级 PR 完全一致，不是本设计额外加的门槛。
- 台账卡：交付时补一张 `docs/ledger/` 卡，`done_ref` 指向实现的 PR 号。

### 8.4 明确不在这次实现范围内（已在 §4/§6 记录，重复提醒避免范围蔓延）

- AUTO 判定引擎（真正的音轨/分辨率/字幕时间轴检测）——现在没有可跑的函数，是独立的后续实施卡，不是这次要顺手建的基建。
- §0①「绕开工厂/绕开审核链路直接发布」——另一张已签字的闸门卡（PR #2177），不是本设计范围。
- 2026-09-29 另查出的三条现存发布口子权限过松（讲课片、两个 Publer 接口）——PM 已拍板「先不动」，接受风险，见 `docs/ledger/2026-09-29-social-publish-gate-risk-accepted.md`。**这不是本次实现范围**，除非 PM 后续单独决定处理，不要顺手一起改。
