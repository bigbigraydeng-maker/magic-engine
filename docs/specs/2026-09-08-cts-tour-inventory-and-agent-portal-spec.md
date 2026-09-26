# CTS Tour 库存管理 + Agent 门户 —— 需求单（已作废，改由外部程序员承接）

**状态**：⚠️ **本方案作废，ME 不再自建。** 2026-09-15 PM 拍板：CTS 已委托外部第三方程序员独立开发同一需求（Tour 库存/订单/团期/代理商门户），ME 不重复造这套系统。ME 改为通过对方系统的**导出文件 + AI 识别**方式半自动同步订单数据，不做实时 API/webhook 对接。新需求文档见 [`docs/clients/cts/2026-09-15-tour-booking-system-external-vendor-requirements.md`](../clients/cts/2026-09-15-tour-booking-system-external-vendor-requirements.md)。
以下内容保留作历史参考（当年调研的现状仍然有效，只是"由谁来建"变了）。

~~**状态**：需求已理清，未设计未开发，未获 PM「可以开发」明确许可（照 CLAUDE.md 铁律，大任务开工前先审）。~~
**来源**：2026-09-07 CTS tour 上架窗口里 PM 提出，从主线剥离出来单独开窗口做。
**这份文档的目的**：让接手的窗口不用重新调研一遍现状，直接从"已知现状"出发设计。

---

## PM 原话（一字不改）

> "CTS 团队无法在后台看到还有多少个 Tour，每个 tour 的招募情况，agent 怎么自主订 tour，能查看到 tour 的 available seat"

拆解成三件独立但相关的事：

1. **Tour 列表**——CTS 员工在 ME 后台看不到"现在总共有多少个 tour 在卖"
2. **每 tour 招募情况**——每个 tour 卖了多少个座位、还剩多少、谁报的名（分直招/代理）
3. **Agent 自主订 tour**——外部旅行代理（agent，不是 AI agent，是卖 CTS 团的中介/分销商）需要一个门户，能自己看 available seats 并下单，不用打电话问 CTS

---

## 已查明的现状（2026-09-07 核实，供新窗口直接采信，不用重查）

### Tour 数据在哪
- **不在数据库，在代码里**：`chinatravel` 仓（`/Users/raydeng/Projects/chinatravel`，独立 Next.js 站，不是 ME 仓）的 `src/lib/data/tours.ts`
- 7 个产品 / 8 个出发团（2026-09-07 刚上架 4 个 2027 新团）
- 每个 tour 有 `maxGroupSize` 字段（如 Golden China = 12），但这是**硬编的容量上限**，不是"已订/剩余"的动态库存
- **没有座位追踪字段**：`departureDates` 只是日期数组，`departurePricing` 只是价格，都没有 seats_taken / seats_available

### 客户管理（CRM）已经有，但是"人"的维度不是"团"的维度
- ME 里已有 CTS CRM 工作台：`/dashboard/clients/<cts_client_id>/crm/today` + `/crm/all`（PR #678 已合并上线）
- 管理的是 335 个联系人 + 634 条触点 + 9 档销售阶段（new → contacted → quoted → **deposit_paid** → **paid_full** → 等终态）
- **这套东西回答的是"这个人现在到哪一步了"，回答不了"Golden China 11月团还剩几个位置"**

### 关键缺失：`contact_deals` 表——2026-07-28 PM 拍板要建，至今没建
记忆原文（`project-cts-crm-workbench-in-me.md`）：
> "deal 表（承接付款 + PM 早先要的定金管理）：contact_deals = tour + source_channel(直招 direct / 代理 agent + agent_name) + deposit_amount/paid_at + total_amount/paid_full_at。即「按 tour 分组、直招 vs agent 拆分」的定金视图，付款事件驱动 stage 自动跳档。"

这张表的设计**当时就已经想好了**（tour + 直招/代理拆分 + 定金/全款两笔），但一直没建。**这就是"每个 tour 招募情况"缺失的直接原因**——没有一张表记录"谁报了哪个团、付了多少钱"。

2026-08-06 的一次群发唤回信记录也印证了这个缺口：
> "ME 没有按团追踪报名名单的表(`contact_deals` 还没建)，PM 明确接受"可能有已报名这两团的人也收到报满信"的风险，没有等名单。"

### Agent 门户：完全空白
- ME 仓 `src/app/portal/` 目录存在但几乎是空壳（`self-serve` 注册向导用的，不是给外部旅行代理用的分销门户）
- **没有 agent 账号体系**（区分于 ME 自己的员工账号 / 客户端 portal 账号）
- **没有"只读库存 + 下单"的对外接口**
- `contact_touchpoints` 的 channel 枚举里虽然有 `source='sheet_followup'` 等痕迹，但没有 agent 归属字段贯穿到位

---

## 需要新建的东西（草案，供设计阶段参考，非最终方案）

### ① Tour 库存核心（最基础，其余两件事都依赖它）
- 新表：把 `chinatravel/tours.ts` 里的 tour + 出发团数据同步/镜像进 ME 数据库（或至少加一张"出发团库存"表，`tour_slug` + `departure_date` + `seats_total` + `seats_taken`），否则"还剩几个位置"无源头
- **平台化考量**（CLAUDE.md 强制门）：这张表要不要做成"所有客户通用"的 tour/departure 库存模型，而不是 CTS 专属？如果 Oztop/Roman 之类未来也卖 tour/预约制产品，这个表要能复用。**开工前必须先过 `me-platform-tier-gate` skill 判层级**。

### ② `contact_deals` 表（2026-07-28 已设计，直接捡起来实施）
- 字段：`contact_id` + `tour_slug`（或 tour 库存表外键）+ `departure_date` + `source_channel`(direct/agent) + `agent_name` + `deposit_amount`/`deposit_paid_at` + `total_amount`/`paid_full_at`
- 付款事件驱动现有 CRM 的 `contact_stage_events` 自动跳档（这条逻辑当年也设计过，见 memory）
- 有了这张表就能回答"Golden China 11月团报了几个、剩几个"

### ③ Tour 列表/招募看板 UI（给 CTS 员工用，ME 后台内）
- 新页面：`/dashboard/clients/<cts_id>/tours`（或类似路径），列出所有在售 tour + 出发团，每行显示 seats_taken/seats_total，点进去看报名名单（关联 ① ②）

### ④ Agent 门户（对外，给旅行代理用，风险级最高）
- 需要新的账号体系（agent 登录，跟 CTS 员工/PM 账号分开、跟客户自己的 portal 账号也分开）
- 只读库存视图（能看 available seats，不能看其他 agent 的客人）
- 下单流程：agent 提交订单 → 冻结座位（防超卖）→ CTS 员工确认/收款 → 座位真正扣减
- **涉及外部第三方登录 + 座位并发扣减（防超卖是经典竞态问题）+ 可能的资金往来（代理佣金）**——这是四件事里风险最高、最该谨慎设计的一块，建议放在①②③验证完之后再做，不要一次性糊在一个 PR 里

---

## 建议给新窗口的开工顺序

1. 先过 `me-platform-tier-gate` skill，判定"tour 库存"这个能力属于平台层还是 CTS 专属（这决定表结构设计成什么样）
2. 设计阶段召子牙（架构）+ 魏征（挑刺）至少 2 审（CLAUDE.md「大任务必须 ≥2 审」——新建表 + 新对外 endpoint，触发条件已满足）
3. 先做①②③（内部可控），Agent 门户④单独排后面，且④涉及外部账号体系必须再加一轮安全复审（狄仁杰）
4. **任何一步涉及新建 migration / 新对外 endpoint，动手前必须 PM 显式「可以开发」**——这是 2026-07-28 那次留下的教训，同一个功能已经被 PM 喊停过一次

---

## 相关 memory（新窗口开工前建议读一遍）
- `project-cts-crm-workbench-in-me.md` —— CRM 阶段模型、`contact_deals` 设计草案、已知堵点
- `project_cts_site_repo_tracking.md` —— chinatravel 仓位置、tours.ts 数据结构
- `project-cts-mailchimp-email-system.md` —— 2026-08-06 唤回信因为没有 `contact_deals` 而接受的风险案例
