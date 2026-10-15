# ME「经营测算器」设计 v0.2（一页，已吸收子牙一轮）· 116 号 · 2026-10-16

- 决定：PM 2026-10-16 原话：「还是不要做成动态的了，不方便我们多场景模拟。你还是只把这个计算器功能做到 ME，数据先不用打通。可以保存不同的模拟场景。」→ **取代**同日的「利润监控（只读，动态）」设计（`2026-10-16-promo-plan-scale-profit-monitor-design-v0.2.md` 搁置，不删）。
- 风险级：**A**（新增一张表 = 数据库结构；新增页面和接口，含写入）。资源优先级（§11）：频率 中（每次排广告预算都想试几套数）/ IMPACT 中 / 收入 中 → P2；PM 已明确要做。
- 平台层级：**旅游行业版剧本的候选（L2）**。计算器的产品结构是 Tour / Tailor-made，只有 CTS 一家证据，**不进共享默认**；公式放行业模块，客户数字只在场景里。不新增能力线。

## 1. 它是什么
推广计划之外、CTS 客户页里的一个页面「经营测算」：**手填参数 → 立刻算出**年度利润；**可保存多个命名场景，随时对比两个场景**。不读真实数据，不写 Meta，不改任何计划、预算或授权，不构成加预算依据。

## 2. 公式（逐字搬自公开计算器 `cts-business-calculator.pages.dev` 的脚本，2026-10-16 读取；监督方也已独立取脚本验证）
输入：年度广告投入、每条线索价 CPL、线索到付款成团转化率、Tour 占比、Tour 每单人数与人均价、Tailor-made 每单人数与人均价、佣金前毛利率、Sales 佣金率、年度人工成本、CTS 年度服务费成本、额外增加 Sales 人数。
计算：线索 = 广告 ÷ CPL；订单 = 线索 × 转化率；加权每单人数 R = 占比×Tour每单人数 + (1−占比)×定制每单人数；游客 = 订单 × R；销售额 = 订单 ×（占比×Tour每单人数×Tour价 + (1−占比)×定制每单人数×定制价）；佣金率取 min(毛利率, 佣金率)；公司留存 = 销售额 ×（毛利率 − 佣金率）；**利润 = 公司留存 − 广告 − 人工 − CTS 服务费**；每位游客公司留存 = 加权人均价 ×（毛利率 − 佣金率）；每位游客广告成本 = CPL ÷（转化率 × R）；打平游客数 = ⌈固定成本 ÷（每位留存 − 每位广告成本）⌉；Sales 需求 = ⌈线索 ÷ 6000⌉（25 条/天 × 240 天，**计算器预设，来源未证实**）。边界：CPL ≥ 0.01，人数 ≥ 0.1，百分比夹在 0–100；除零显示「无法计算」。
**黄金测试**：用计算器默认值（广告 60000、CPL 7、转化 5%、人工 100000、服务费 60000、佣金 10%、Tour 80%、1.6 人 × 3500、定制 2 人 × 4000、毛利 20%）必须得出：利润 40,571、销售额 2,605,714、游客 720、订单 429、线索 8,571、打平 575 人（2026-10-16 在线页面实读）。
**不引入**任何 CTS 实测值作默认；「毛利按成交渠道分」（直接 20% / Agent 或 Sales 10%）由用户在毛利率、佣金率两格自己填。

## 3. 保存与对比（唯一的新数据）
- **表** `public.me_calculator_scenarios`（迁移文件 `supabase/migrations/20261016100000_business_calculator_scenarios.sql`，文件头写「service-role only; apply only after explicit PM approval」）：`id uuid pk`；`client_id uuid not null references public.clients(id)`；`name text not null`，检查 trim 后长度 1–80；`inputs jsonb not null`，检查是 object 且 `pg_column_size` ≤ 8KB；`formula_version smallint not null default 1`；`created_by text not null`（非空）；`created_at / updated_at timestamptz not null default now()`；`unique (client_id, name)`（已兼作按客户列表的索引）。**每客户最多 50 个：用插入前触发器在库里强制**（数到 50 就拒绝，防两个同时请求都通过），接口把「重名」「超限」映射成不同错误码。`updated_at` 没有通用的自动更新函数，**接口每次写入时显式写**，乐观锁靠它（读时带出，写时 `eq(updated_at)`，不匹配回 409）。RLS 抄 `crm_booking_members` 的写法：`FOR ALL TO service_role USING (true) WITH CHECK (true)`，并 `revoke all … from anon, authenticated`。
- **接口**（不新增定时任务，不碰 `render.yaml` 与 `cron/registry.ts`；纯手填、无外部副作用，不需要 Inngest）：`GET/POST /api/clients/[id]/business-calculator/scenarios`，`PATCH/DELETE …/scenarios/[scenarioId]`。鉴权用 **`requirePlanApproverAccess(clientId)`**（`src/lib/auth/client-access.ts:161`：先过付费客户门，再要求内部账号，客户员工 403）；另外校验 clientId 是真实客户，且该客户行业开关 `industryFeatureFlags(industry).business_calculator` 为真。
- **页面入口**：在客户页「经营工具」区加入口卡（`src/app/dashboard/clients/[id]/page.tsx` 该区），**只对旅游行业客户显示**：在 `src/lib/clients/industry-features.ts` 加一个行业开关 `business_calculator`（沿用 `TRAVEL_KEYWORDS`）。页面本身**服务端也做内部账号判断**，不能只靠接口 403、也不能只用 `ServerFeatureLock`（它放行付费客户，客户员工能打开页面看到内部财务假设）。
- **公式模块**放行业层 `src/lib/crm/industry/travel-business-calculator.ts`（纯函数，旁边是已有的 `travel-booking-rule.ts`），不放共享层；校验器按白名单字段与数值范围，**缺字段用默认值，多余字段拒绝**。
- **公式版本**：`formula_version` 随场景存；公式将来升级时，载入旧场景带「按 v1 公式算」标记，可手动「用新公式重算」，不静默改旧数字。
- 页面：左输入、右结果、下方「场景」栏（保存当前 / 载入 / 改名 / 删除）与「对比 A、B」两列差值表。计算全在浏览器纯函数里实时跑，**服务端只存取参数，不算数**（避免两套公式）。少按钮：只有「保存」「载入」「删除」「对比」；无导出、无自动保存。
- **复用说明**：仓库里没有「一客户多条、用户自起名」的现成表，场景表是新建；复用的是 `crm_booking_tracker` 迁移的表结构与 RLS 写法、`requirePlanApproverAccess`、`industry-features.ts` 的行业开关。公式来源：公开计算器 `cts-business-calculator.pages.dev` 的脚本，2026-10-16 读取（监督方也独立取过脚本核验）；黄金数字同日读自线上页面。

## 4. 明确不做
读真实花费/订单/官网价；动态监控与提醒；和推广计划、今日待办打通；多币种；非旅游行业模型；Sales 工资以外的人力模型。

## 5. 验收与当场试跑
单测：黄金测试、各边界与除零、校验器拒绝未知字段/越界值、50 个上限、重名；接口：未登录 401、客户员工 403、乐观锁冲突 409。当场试跑：本地起页面，输入默认值核对黄金数字，存两个场景、对比、改名、删除；数据库迁移先在草稿 PR 里，**合并与上线前问 PM 回「合」**。

## 6. 请审查人重点打
①公式搬运是否与脚本逐项一致（含取整与夹逼）；②计算只在前端，保存的 `inputs` 与将来公式升级的兼容（要不要存公式版本号）；③权限与 RLS 模板；④Tour/Tailor-made 语义落在行业模块而不是共享层；⑤数字页面会不会被读成对客户的承诺或预算授权（页首固定「内部模拟，不构成预算依据」）。
