# $990 自助 Onboarding 向导 · spec v0.1（草案 · 待 3 审）

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

## 1. 🔴 前置 BLOCKER（不解决向导无意义 · 必须 PM 先拍）

**自助客户当前被守卫挡在连接器门外。** 连接器 `POST /api/clients/[id]/connectors/[anchor]/connect` 与 `GET .../status` 用 `requirePaidClientAccess` → `self_serve` tier 直接 **403 `paid_only`**。而素材上传 `/api/clients/[id]/assets` 用 `requireDashboardClientAccess`（self_serve 可过）。**门控不一致，且"绑定账户"这一 onboarding 核心动作对 $990 客户今天是死的。**

- **决策点 D1**：是否放开 `self_serve` 走连接器 connect/status？
  - 该守卫是 paid-only **有历史原因**（注释引用过一次真实数据泄露：self_serve 曾能看 `/dashboard/content`、`/dashboard/visuals` 聚合数据）。**不能简单翻标志位。**
  - 推荐路径：**新增 `requireOnboardingClientAccess(clientId)`**——允许 `self_serve` **仅**访问 onboarding 必需的连接/上传/档案写入路由（connect/status/assets/{field} 对称路由），但**不**放开聚合数据页。即"能配自己的，看不到别人的、也看不到 paid-only 聚合视图"。
  - 这一步触碰**鉴权/隔离核心** → 按 CLAUDE.md 必须 **狄仁杰实施后攻击验证**。

## 2. 向导步骤（5 步 · 全部复用已有路由，零新表优先）

> 设计原则：每步**复用现成对称路由**，不重造。可跳过、可回来续（resumable），不硬 gate（板桥：小老板一次填不完很正常）。进度存 `clients.onboarding_completed_at` + 每步用已有字段是否有值推断。

| 步 | 标题 | 客户做什么 | 复用的后端 | 写入 |
|---|---|---|---|---|
| 1 | 生意档案 | 确认/补全 名称·行业·服务城市·主关键词 | light-brief + primary-keywords 路由 | `clients.brief_fields` / `brief_completed_at` / `primary_keywords` |
| 2 | 网站 | 填域名；无网站 → 触发 $99 单页站分支（转 FDE 队列） | `PATCH /api/clients/[id]`（domain） | `clients.domain` |
| 3 | 连接账户 | GBP（真 OAuth）· GA4/GSC（真 OAuth）· Meta（标记+手填 ad account） | google/gbp OAuth + connectors/connect | `platform_oauth_connections` / `client_connectors` / `meta_ad_account_id` |
| 4 | 上传素材 | logo · 作品照 · 老客户名单（评价引擎用） | `POST /api/clients/[id]/assets`（已允许 self_serve） | `client_assets`（bucket `visual-assets`） |
| 5 | 完成 | 确认提交 → 触发首次诊断 + 通知 FDE「已自助 onboard，可上门/远程复核」 | 诊断 runner + 通知 | `onboarding_completed_at` |

**Step 3 诚实边界（板桥红线）**：只有 GBP/GA4/GSC 是真「一键授权」；Meta/Google-Ads 是「填账户 ID + 标记连接」，UI 文案不能写成"一键授权 Meta"，要写"填入你的 Meta 广告账户 ID / 授权我们的商务权限"。

## 3. 上门 kickoff 的定位（B2 不破）

自助向导是**主路**，不是取代上门。水电/屋顶老板很多搞不定 OAuth → **「自助优先 + 上门兜底」**：
- 能自己走完的：省 FDE 工时。
- 卡在 Step 3 授权的：FDE 上门那一次（B2 承诺）当场帮连。
- 向导 Step 5 完成通知 FDE，FDE 看哪些步骤客户没走完 → 上门重点补哪几步。

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

## 7. 待 PM / 审查决策

- **D1**（头号）：放开 self_serve 走 onboarding 连接器的方式 = 新守卫 `requireOnboardingClientAccess`？还是别的隔离方案？（狄仁杰必审）
- **D2**：per-step 完成勾选存哪（跟 PR #533 决策合并）？
- **D3**：向导是否 hard-gate（没走完不给用其他功能）还是 resumable 软引导？（板桥倾向软引导）
