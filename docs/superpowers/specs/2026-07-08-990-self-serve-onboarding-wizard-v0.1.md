# $990 自助 Onboarding 向导 · spec v0.1（草案 · 待 3 审）

> **v1 已实现（2026-07-08 夜，commit 53b99ffa）**：向导页 `/dashboard/clients/[id]/onboarding` + `GET onboarding/status`（推进度）+ `POST onboarding/complete`（Step5 服务端触发诊断，修那个堵点）。5 步全接现有路由，26 测试过、tsc 干净、Cloudflare build 绿。
> **⚠️ 激活开关未翻**（故意）：新注册仍落 `/brief`。要让向导成落地页，改 `src/lib/auth/self-serve-routing.ts` 的 `buildBriefPath` → `/onboarding`（一行）。留待 PM 在预览 URL 亲验向导后再翻——翻了每个真实新注册都走此向导，不宜未 live 测就默认启用。
> **仍待办**：per-step 跳过/求助的独立持久化（需 migration，PM 拍）· 服务城市字段写入路径 · $99 前移销售话术（非代码）· 放量前的成本 DoS DB 原子锁（见 §7.1）。

> 起草：2026-07-08（子牙）。**状态：草案，未拍板、未动手。** 需子牙(架构) + 魏征(挑刺) + 板桥(C 端客户视角) 三审 + PM 拍板后才进实现。
>
> 派生自：[$990 增长引擎启动包 spec](./2026-07-07-990-growth-engine-package-v1.md)（服务边界事实源）。本文只定义**自助 onboarding 采集环节**的产品形态，不改服务边界。
>
> 目标：把 $990 中小客户的 onboarding **采集环节**（上传 / 绑定 / 授权）变成客户**自己在 ME 里走完的向导**，把 FDE 从"逐个催收 + 代填"里解放出来，守住 **B5 单客户 ≤15 FDE 小时**红线。FDE 月付轨**不走本向导**（仍由我们后台代配，见 onboarding SOP 拆分）。

## 0. 双轨边界（本 spec 的前提）

| | **FDE 月付轨** | **$990 自助轨（本 spec）** |
|---|---|---|
| `client_portal_users.access_type` | `paid_client` | `self_serve` |
| onboarding 谁做 | 我们后台代配 | **客户自己走向导** + 上门兜底 |
| 入口 | FDE dashboard 各页 | **`/dashboard/clients/[id]/onboarding`** |

> **实测结论（2026-07-08 亲测）**：`/portal/*` 是死代码（layout 无条件重定向 + middleware 308），自助客户实际生活在 `/dashboard/clients/[id]/*`，按 tier 门控。所以向导是 **dashboard 路由**，不是 portal 页。

## 1. ✅ D1 前置 BLOCKER — 已修复（2026-07-08，四审通过）

原问题：`self_serve` 被 `requirePaidClientAccess` 挡在连接器 + 绑定路由外，"绑定账户"这一 onboarding 核心动作对 $990 客户是死的。

**已落地修复**（commit a6a4f150 + f8caaa3a）：
- 新增 `requireOnboardingClientAccess(clientId)`——放行 admin/paid_client/**self_serve**，隔离与 `requireDashboardClientAccess` 完全一致（只能碰自己 client），**不**触碰 paid-only 聚合页。
- 守卫替换清单（**6 个路由**，四审子牙纠正了初版"半修"——只改 2 个漏了真正绑数据的 4 个）：
  `connectors/[anchor]/connect` · `connectors/status` · **`gsc/sites`** · **`gsc/sync`** · **`ga4/sync`** · **`platform/gbp`**
- Step 2 域名写入：**新增窄路由 `PATCH /api/clients/[id]/domain`**（onboarding 守卫，只允许写 `domain`）。主表 PATCH 仍 admin-only（它能改 `plan_tier`/`monthly_mtc_cap` 计费字段，绝不放给自助客户）。
- **成本 DoS 防护**（狄仁杰/魏征 H1）：`startAdvancedDiscovery` 加 in-flight 去重（已有 pending/running 的 advanced job 就复用），self_serve 无法靠狂点 connect 刷爆外部 API 预算。
- anchor 路径参数白名单校验（防脏数据入 `client_connectors`）。
- 顺手补 `brief/route.ts` GET/PUT 的裸奔越权洞（独立 commit）。
- 狄仁杰攻击验证：SAFE（无 IDOR、无提权、无回归）；测试变异验证过（魏征）。22/22 auth+dedup 测试通过。

## 2. 向导步骤（5 步 · 全部复用已有路由，零新表优先）

> 设计原则：每步**复用现成对称路由**，不重造。可跳过、可回来续（resumable），不硬 gate（板桥：小老板一次填不完很正常）。进度存 `clients.onboarding_completed_at` + 每步用已有字段是否有值推断。

| 步 | 标题 | 客户做什么 | 复用的后端 | 写入 |
|---|---|---|---|---|
| 1 | 生意档案 | 确认/补全 名称·行业·服务城市·主关键词 | light-brief + primary-keywords 路由 | `clients.brief_fields` / `brief_completed_at` / `primary_keywords` |
| 2 | 网站 | 填域名；无网站 → **$99 单页站分支（必须签约时已谈妥，见 §3.1）** | **新窄路由 `PATCH /api/clients/[id]/domain`** | `clients.domain` |
| 3 | 连接账户 | GBP（真 OAuth）· GA4/GSC（**有则连、没有则"我们帮你建"**）· Meta（标记+手填 ad account，仅种草轨） | google/gbp OAuth + connectors/connect + gsc/ga4/platform 路由（均已 onboarding 守卫） | `platform_oauth_connections` / `client_connectors` / `meta_ad_account_id` |
| 4 | 上传素材 | logo · 作品照 · 老客户名单（评价引擎用） | `POST /api/clients/[id]/assets`（已允许 self_serve） | `client_assets`（bucket `visual-assets`） |
| 5 | 完成 | 确认提交 → 触发首次诊断 + 通知 FDE「已自助 onboard，看哪几步没走完 → 上门重点补」 | **见下方 🔴 Step5 堵点** | `onboarding_completed_at` |

**🔴 Step 5 堵点（2026-07-08 完整链路走查发现，第三个半修）**：`diagnostic/run` 与 `diagnostic/runs` 是 `requirePaidClientAccess` → self_serve **403 撞墙**，自助客户走完 Step 1-4 却触发不了自己的 before 基线诊断。**修法不是翻守卫**——诊断跑 6 个外部采集器（与 advanced discovery 同属高成本），直接对 self_serve 放开 = 又开一个成本 DoS 面。**正确做法**：Step 5「提交完成」是一个**服务端动作**（专用 onboarding-complete 端点，onboarding 守卫）——内部用 service role 触发这一次诊断 + 复用去重/节流 + 通知 FDE；客户**不直接调** `diagnostic/run`，诊断对普通面板照旧付费门控。链路走查确认 Step 1-4 + OAuth 全通，仅此一处堵。

**Step 3 硬规则（板桥红线，四审确立）**：

1. **GA4/GSC 必须按"有/没有"分叉**（spec 内部矛盾修复）：$990 客户多半**没有** GA4/GSC（是我们帮建的交付项，见 SOP 权限分级）。所以默认**不显示"连接"按钮**，显示：「网站访问数据工具你多半还没有——这是我们帮你免费装好的其中一项，现在跳过就行。」**只有**已检测到客户已有账户时才显示"连接"。**绝不能**让没有 GA4 的老板去点"连接一个你没有的东西"。
2. **Meta/Google-Ads 严禁写"一键授权"**：写「有 Facebook 广告账户?填一下账户编号（一串数字）+ 授权投放权限。还没有?正常，上门帮你开。」
3. **每个平台都要有「👉 我搞不定 / 不知道账号 → 上门那天帮我连」按钮**：点了**不算失败、不 block、直接把这项写进 FDE 上门清单**（skip = 主动登记求助，不是静默跳过）。这需要一个轻量 skip 标记（见 §4 per-step 状态）。

### 3.1 $99 单页站岔口（板桥高危骂街点）

**$99 绝不能是老板在无人屏幕上第一次看到。** 老板签的是 $990，向导里突然弹"再付 $99" = 100% 觉得被 bait → 退款/差评。

- **筛选前移到签约**：冷邮件/销售话术/签约对话必须先问"你有没有网站?"，无网站的当面讲清"$99 单页站是门票"。
- **向导只做"已知确认"，不做"首次告知"**：Step 2 若签约已知无网站，文案是「我们说好的 $99 单页站，建在**你自己域名**下，这是你的资产 →」。

## 3. 定位（板桥纠正：上门为主，自助压缩上门时长）

⚠️ **初版把帽子戴反了。** 对奥克兰小 trades 老板，现实是**上门帮连才是主路**（反正 B2 承诺每客户至少上门一次，顺手连账户本就在计划内），自助向导真正能省的是 Step 1/2/4（档案/域名/素材）——**Step 3 授权老实说主要靠上门**（板桥估真自助率 <10%）。

正确定位：**「上门为主路，自助压缩上门时长」**。老板上门前把能填的先填好，上门那趟只干"连不了的账户"这一件硬活。

**🔴 工时红线警告（B5）**：**必须**按"上门为主"重估 onboarding 工时，别按"自助率高"估——否则系统性低估。一个卡在 Step 3 的老板，上门现场帮连 GBP（还得先找回登录权）+ 找 Meta ID + 装 GA4 + 装表单，轻松吃 **3–5 小时** + 奥克兰堵车。100 家全这样，**光 onboarding 就吃掉 15h 红线的 1/3~1/2**。产品/运营的工时模型全部按此算，15h 才守得住。

## 3.2 轨道升级衔接（板桥补：self_serve → paid_client）

$990 客户 90 天后续约月付时，`access_type` 从 `self_serve` 翻 `paid_client`，权限要求从"轻"升到 FDE 轨硬门槛（GA4 Editor 必给）。**谁在何时翻、怎么跟客户解释"$990 时没要、现在要"**——两份 SOP 都要补一段"轨道升级 checklist"。**高工时预警客户**（无网站 + 种草轨 + 搞不定自助 三重叠加）签约时就识别出来，调预期或调定价。

## 4. 复用 vs 新建（省人工排序）

- **直接复用**：assets 上传路由、各 `/{field}` 对称路由、light-brief、google/gbp OAuth、诊断 runner。
- **需抽取**：settings 页各 Panel（GbpPanel / PrimaryKeywords / BrandAliases / CompetitorDomains / social-handles）现在是内联，抽成可复用组件供向导 + settings 共用。连接器 UI 是 769 行内联，抽 `ConnectorCard`/`OAuthButton`。
- **需新建**：`/dashboard/clients/[id]/onboarding` 向导壳（复用 `StepIndicator` pattern）+ 步骤完成度推断 + D1 的 `requireOnboardingClientAccess` 守卫。
- **零新表**：进度用现有字段推断；如需显式 per-step 状态，与 PR #533 的「打勾持久化」决策合并（复用 execution_items 或一张小表，PM 拍 migration）。

## 5. 验收（实现阶段亲测清单）

1. self_serve 用户能走完 5 步且**只能**碰自己 client 的数据（狄仁杰攻击验证跨 client 越权）。
2. self_serve **仍被**挡在 `/dashboard/content`、`/dashboard/visuals`、`requirePaidClientAccess` 路由外（D1 不能顺手放开聚合数据）。
3. 每步可跳过、可回来续；进度正确推断。
4. Meta/Google-Ads 文案不出现"一键授权"误导。
5. 无网站 → $99 单页站分支正确转 FDE 队列（不假装能自助建站）。
6. 单元 + 集成测试覆盖 D1 新守卫的**变异测试**（故意放开 paid-only 聚合，测试须 fail）。

## 6. 明确不做（本期）

- 不做 Meta/Google-Ads 真 OAuth（现状是标记连接，扩真 OAuth 是独立任务）。
- 不复活 `/portal/*` 死代码。
- 不改 $990 服务边界（那是 v1 spec 的事）。
- 不替代上门 kickoff。

## 7. 决策状态（四审后更新）

- **D1** ✅ 已定 + 已修：新守卫 `requireOnboardingClientAccess`，6 路由放开 + 域名窄路由 + 成本 DoS 去重，狄仁杰验过 SAFE。
- **D2** per-step 勾选 → 子牙定：**向导 v1 用纯推理发货（字段有值即完成，零新表），不被 PR #533 拖住**。唯一推不出的是"主动跳过 vs 还没做"——skip 标记作 fast-follow（若 #533 是同一持久化原语可合并，否则单开 `onboarding_steps_skipped jsonb`，PM 拍 migration）。§2 Step 3 的"搞不定→上门"按钮依赖这个 skip 标记。
- **D3** → 子牙+板桥共识：**resumable 软引导**（可跳过、可回来续，不 hard-gate）。
- **待确认（子牙）**：Step 1 的"服务城市"落哪个字段？`light-brief` 只写 company_name/industry/target_audience/... **不含服务城市**；主关键词走独立 `primary-keywords` 路由。实现前钉死写入路径，别留没有后端的输入框。

## 7.1 已接受风险（PM 拍板 2026-07-08）· ⚠️ 放量前必办

**成本 DoS 残留** — advanced discovery 的去重是 app 层非原子（SELECT→INSERT），且 basic discovery 有先于本次的 MTC precheck 竞态。app 层已挡「串行狂点」+「连过再点」（first-connect gate + in-flight dedup），残留仅「同一瞬间并发 burst」能钻 TOCTOU 窗口多花外部 vendor 预算。影响面：攻击者只能触发**自己 client** 的诊断，烧的是共享外部 API 费。

- **PM 决策**：**beta 期接受**（客户少、均为真人熟人，无脚本攻击动机）。
- **🔴 放量前必办（gate 到"陌生人自助注册开放"那一刻）**：加 DB 部分唯一索引
  `CREATE UNIQUE INDEX ... ON client_discovery_jobs(client_id, job_type) WHERE status IN ('pending','running')`（service_role 模板，PM 拍 migration）让入队原子化；并考虑 advanced 接 MTC 计价 / 完成后冷却窗。**没做这条之前不得对公开注册放量。**

## 8. 四审结论（2026-07-08）

| 审 | 结论 | 已纳入 |
|---|---|---|
| 子牙(架构) | APPROVE-WITH-CHANGES | D1 半修→补 6 路由+域名路由；docstring 诚实化；纯推理发货；服务城市待确认 |
| 魏征(挑刺) | APPROVE-WITH-CHANGES | 成本 DoS 去重；anchor 白名单；500 边界测试 |
| 板桥(C 端) | 方向对·改 5 处 | Step3 GA4/GSC 分叉；搞不定按钮；上门为主重估工时；$99 前移签约；轨道升级 checklist |
| 狄仁杰(攻击) | SAFE-WITH-CAVEATS→已补 | 成本 DoS + anchor 已修；隔离无洞 |
