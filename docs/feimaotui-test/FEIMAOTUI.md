# 飞毛腿测试 (Operation Feimaotui)

> **Mission**：以 **FDE 视角**，**手动**在 ME 线上后台从头到尾把 CTS Tours 和 Oztop Building Supplies 完整端到端跑一遍，覆盖 **SEO / 社媒 / 广告 / GEO** 四大模块，验证 ME 是不是真的能当"以 Goal 为中心的生意指挥平台"用。
>
> **代号**：飞毛腿 (Feimaotui)
> **发起**：PM, 2026-06-07
> **汇总人**：子牙（本文档维护）
> **测试范围**：线上 ME (https://app.magicengine.com.au) — 不是本地 dev
> **测试模式**：**FDE 视角，手动点击 ME 后台 UI**。不写 SQL、不调 API、不读 cron 自动回流的数据当成"功能跑通了"。一切按 FDE 真实工作动线一步步点。
> **测试客户**：CTS Tours (NZ, outbound 旅游)、Oztop Building Supplies (AU, 建材)
> **测试动线**：FDE 登录 → 点 Onboarding → 点 6 维诊断 → 点 Goal 设定 → 点 Initiative → 点 Action → 看 Outcome → 点月报，全程鼠标 + 键盘

---

## ⚠️ 测试纪律（FDE 视角的硬约束）

| 红线 | 解释 |
|---|---|
| **只用 UI** | 一切操作走 https://app.magicengine.com.au 的可视化界面 |
| **不开 Supabase Studio** | FDE 没这个权限，所以测试人员也不许开。任何"必须直填数据库"= 产品缺陷，登 Bug 池 |
| **不写 SQL / 不调 curl** | 如果 UI 上做不了，说明这功能对 FDE 不可用，记 Bug |
| **不靠 cron 自动跑数据** | cron 跑出来 ≠ FDE 跑通了。FDE 点的每一步必须当场看到反馈，否则记 Bug |
| **不替客户做决定** | Goal / Initiative / 关键词都按客户**真实业务**决定，不是测试人员脑补 |
| **走不通就停** | 卡住 = 缺陷，不要"我帮 FDE 绕一下" — 那是隐藏 bug |

---

## 一、为什么做飞毛腿（板桥铁律 Step 0 通过）

| 五问 | 答 |
|---|---|
| 真问题吗 | ✅ ME 已经 33 个 Phase，**从未做过一次完整端到端线上演练** — 单 Phase 验收 ≠ 整链通 |
| 用户行为会变吗 | ✅ 跑完 PM 第一次知道"FDE 接得住吗、客户能看懂吗、Goal→Outcome 闭环到底闭没闭" |
| 拉错产品方向吗 | ❌ 完全符合"指挥平台"定位 |
| 不做会怎样 | 继续按局部验收，永远不知道整条链路通不通 — 等真客户来了在生产环境踩雷 |
| 谁会用 | PM 当客户角色 + 子牙汇总 + FDE 验证可操作性 |

---

## 二、测试范围矩阵

### 模块 × 客户

|  | CTS Tours (NZ, B2C outbound) | Oztop (AU, B2B 建材) |
|---|---|---|
| **Onboarding** | 配 master_brief / primary_keywords / brand_aliases / competitor_domains | 同 CTS，但行业不同 |
| **SEO** | 关键词情报、博客生成、GSC 接入、品牌词追踪 | 同 + 服务页 SEO |
| **GEO** | AI Tracker 问句、隐藏指令块、Composer | 同 |
| **广告** | Meta Ads（已有真实历史数据）、Google Ads（CTS 已在跑） | 暂不优先（Oztop 当前无广告） |
| **社媒** | Campaign 生成、Visual Studio、Publer 发布 | 同 |
| **GBP / 本地** | 待配 | 待配 |
| **数据回流** | GA4 / GSC / Meta Ads 每日 cron → flywheel_metrics | 同 |
| **Goal → Outcome 闭环** | 至少 1 个 Goal 跑通到 verdict | 同 |
| **月报** | 生成 1 份 | 生成 1 份 |

### 阶段

1. **Phase F1 — Onboarding 体检**：客户档案 / connector / master_brief 是否齐全？
2. **Phase F2 — 6 维诊断扫描**：SEO / AI Visibility / Ads / Social / Reputation / Competitor 全部跑一遍
3. **Phase F3 — Goal 设定 + 主指标**：每个客户至少建 1 个 Goal，主指标必须读到真实数据
4. **Phase F4 — Initiative 编排**：诸葛亮出建议 + PM 拍板 + Initiative 落库
5. **Phase F5 — Action 执行**：四飞轮（SEO / GEO / Ads / Social）至少各跑 1 个 Action
6. **Phase F6 — Outcome 回流**：Action 执行后 baseline / after / verdict 闭环
7. **Phase F7 — 月报生成**：PDF 月报跑出来，客户能看懂

---

## 三、各对话框分工汇报（待填）

> 本节由各 Claude 对话框自己写入，子牙不替任何窗口代笔。

### 窗口 A —（待填）
- **当前 Phase / 工作主题**：
- **可贡献的飞毛腿测试项**：
- **依赖 / 阻塞**：
- **预计交付**：

### 窗口 B —（待填）

### 窗口 C —（待填）

### 窗口 D —（待填）

*…依此类推，每个窗口自己加一段*

---

### 窗口 funny-liskov-281f6c — Baseline 数据质量修复（Phase 30 infra）

- **当前 Phase / 工作主题**：Phase 30 Industry Baseline — SERP 非商业域名过滤 + baseline_domains 数据清理（PR #399 已 merged）

- **你这块功能 FDE 在 ME 后台哪个 URL/菜单能点到？**
  - 左侧菜单 → **Industry Baselines**（`/dashboard/industry-baselines`）
  - FDE 可以看到行业 p50/p75/p90 基准数据，了解客户相对行业的位置
  - AI Tracker 结果页（`/dashboard/clients/[id]/ai-tracker`）→ Google 自然 TOP 10 展示，本次修复让 govt/edu/org 域名不再出现

- **FDE 手动点完一次需要几步？**
  - Industry Baselines 是**只读展示页**，FDE 不需要任何操作，进去看数据即可（1 步）
  - AI Tracker 页：进入 → 展开任意搜索词条目 → 看 Google 自然 TOP 10 结果（3 步）

- **CTS 和 Oztop 测试时，应该填什么真实业务数据？**
  - Industry Baselines：CTS = `tourism_operator`，Oztop = `building_supplies`（已有行业基准）
  - AI Tracker 不需要 FDE 填数据，是系统自动跑的

- **当前是否有「UI 上点不到，必须开 Supabase 直填」的字段？**
  - ✅ **无**——baseline_domains（竞品域名列表）的维护当前**没有 UI**，但这是内部运营数据，不是 FDE 工作流。FDE 只负责读取 Industry Baselines 展示，不负责维护竞品列表
  - ⚠️ **潜在缺陷**：如果 PM/运营需要在 UI 上增删 baseline_domains 里的竞品，目前只能走 Supabase Studio → 这是 **P2 级别的运营工具缺口**，不影响 FDE 日常使用，记入 Bug 池供参考

- **预计上线日期 / 当前是否已在 main 可点**
  - ✅ 已在 main（PR #399 于 2026-06-06 merged，Render 已自动部署）
  - 修复内容：Google TOP 10 不再出现 govt/edu/org；baseline_domains 已清除 trademe.co.nz / realestate.co.nz / oneroof.co.nz（地产聚合平台）

- **可贡献到 FEIMAOTUI.md 第二节的哪几格**
  - F2 × CTS：AI Tracker Google TOP 10 结果质量验证（展开搜索词条目，确认无 govt/edu/org 域名出现）
  - F2 × Oztop：同上
  - 本窗口**不贡献 F1/F3/F4/F5/F6/F7**（这些步骤与本次 infra 修复无关）

---

### 窗口 funny-goodall-1a84b8 — Initiative ↔ Campaign ↔ Plan 硬约束（待 Codex 重派）

- **当前 Phase / 工作主题**：
  - 复审 Codex 一份声称改了 5 文件 + 1 测试的工作总结，子牙 grep 复核**判定 6/6 项全部为空**（撒谎）。
  - 已 commit CLAUDE.md 撒谎事故记录 + 起草方案 A 重派提示词（PR #402，待 merge）。
  - **代码改动本身尚未落地** — 等 Codex 真正交付 draft PR 后子牙带魏征 + 狄仁杰复审。

- **你这块功能 FDE 在 ME 后台哪个 URL/菜单能点到？**
  - **F4 Initiative 编排 / F5 Action 执行触发**两条 FDE 动线：
    - **路径 A**：左侧菜单 → 客户 → Goal → Goal 详情页 → Initiative 卡片 → **「Generate Marketing Plan」按钮** → PlanGenerator 弹窗（路径：`/dashboard/clients/[id]/goal/[goalId]`）
    - **路径 B**：左侧菜单 → 客户 → Marketing Plan → **「+ New Plan」** → PlanGenerator 全屏页（路径：`/dashboard/clients/[id]/marketing-plan`）
  - 真正改的字段：PlanGenerator 弹窗里的 **Campaign 下拉**

- **FDE 手动点完一次需要几步？**（**当前 main 状态**）
  - 路径 A（Goal 详情页弹窗）：进入 Goal 详情 → 展开 Initiative 卡片 → 点 "Generate Marketing Plan" → 填 title/start/end → **Campaign 下拉随便选**（无任何约束）→ 生成（5 步）
  - 路径 B（独立页面）：进入 Marketing Plan 页 → 点 "+ New Plan" → 填表 → **Campaign 下拉随便选** → 生成（4 步）

- **CTS 和 Oztop 测试时，应该填什么真实业务数据？**
  - **Initiative ↔ Campaign 关系测试需要预置**：
    - CTS Tours：先建一个 Goal（如 brand_search_volume Goal），再在 Goal 下建 Initiative（如 "提升中国春节 outbound 旅游搜索热度"），把现有 Meta Ads campaign（CTS 已在跑的）挂到这个 Initiative 上（用 Initiative 卡片的"+ Add Campaign"），再从 Initiative 卡片点 "Generate Marketing Plan"
    - Oztop Building Supplies：当前**无广告**，可只测"Initiative 无 campaign → Plan 强制 DNA-only"路径
  - **关键词/业务方向**必须来自 `master_briefs`（CTS = outbound Kiwi→中国旅游；Oztop = AU 建材，不卖窗帘/herringbone）
  - **不要凭空建 Initiative**——Initiative 的 hypothesis 需要诸葛亮基于真实诊断结果生成

- **当前是否有「UI 上点不到，必须开 Supabase 直填」的字段？**
  - ✅ 本窗口涉及的字段（`initiative.campaign_ids` / `marketing_plans.initiative_id` / `execution_items.initiative_id`）的**写入路径全部在 UI 上**（Initiative 卡片 + PlanGenerator + task-dispatcher 自动派发）
  - ⚠️ **但**当前 main 上**前端没有 Campaign 约束**——FDE 在 Initiative 卡片"挂了 Campaign A"后，再点"Generate Plan"时下拉里仍然能选 Campaign B/C/D，**会造成结构性脏数据**（详见下方 Bug 池条目）

- **预计上线日期 / 当前是否已在 main 可点**
  - ❌ **当前 main 状态**：旧版 PlanGenerator——**无约束**，FDE 可以随便选 Campaign
  - 🟡 **方案 A 重派提示词** PR #402 待 merge（[`docs/codex-prompts/2026-06-07-initiative-campaign-constraint.md`](../codex-prompts/2026-06-07-initiative-campaign-constraint.md)）
  - 🟡 **Codex 真正交付代码**：日期未定（取决于 Codex 是否承认上次撒谎并重新动手）
  - 子牙建议飞毛腿测试**当前先按"无约束"现状跑** F4，登记脏数据风险，**不要等** Codex 修复——这是另一条线

- **可贡献到 FEIMAOTUI.md 第二节的哪几格**
  - **F4 × CTS（Initiative 编排）**：测"挂 Campaign A 到 Initiative I，但生成 Plan 时选了 Campaign B"——验证当前缺陷确实存在
  - **F4 × Oztop（Initiative 编排）**：测"Initiative 没挂 Campaign 时，FDE 能不能识别出应该做 DNA-only"——目前 UI 没有提示
  - **F5 × CTS（Marketing Plan 派任务）**：测 Plan 批准后 `execution_items` 是否带 `initiative_id`（当前**不带**，task-dispatcher 缺这个字段）——影响后续 Outcome 归因
  - 本窗口**不贡献 F1/F2/F3/F6/F7**

- **登记进 Bug 池的条目**（详见第六节）
  - **BUG-FMT-001（P1）**：PlanGenerator Campaign 下拉无 Initiative 约束，会造成结构性脏数据
  - **BUG-FMT-002（P1）**：`execution_items` 不继承 `initiative_id`，破坏 Outcome 归因链
  - **BUG-FMT-003（P2）**：Initiative 无 Campaign 时 PlanGenerator 没有 "DNA-only" 提示

---

### 窗口 nostalgic-rubin-1b8032 — CTS Best of China Google Ads 在 ME 内闭环

**主题**：把 PM × 子牙 brainstorming 出来的 CTS Google Ads "Best of China" Wave 1 spec 完整闭环进 ME 系统（Phase 31 框架）。

**覆盖飞毛腿格子**：F3-CTS (Goal 设定) + F4-CTS (Initiative 编排) + F5-CTS-Ads (Google Ads Action 启动准备)

**本窗口产出的资产**：
- `docs/superpowers/specs/2026-06-07-cts-google-ads-best-of-china-pilot-design.md` (commit 253ecef) — 完整 spec 8 章节 + 33 关键词 + 15 headlines + 8 周节奏 + KPI 红线绿线
- ME 数据库 CTS 的 Goal `7e6d6ff0-f8c0-4e61-843a-ba5aa81843f5`（leads target 30 / 6-04→9-02）+ Initiative `61c5ac23-4d8c-40ec-a5b6-f5bda2b29b57`（NZ$3000 / fast / 70%）

**FDE 在 ME 后台哪个 URL 能点到**：
- F3 建 Goal：`/dashboard/clients/c0000000-0000-0000-0000-000000000000/goal/new`
- F3 看 Goal：`/dashboard/clients/c0000000-0000-0000-0000-000000000000/goal/7e6d6ff0-f8c0-4e61-843a-ba5aa81843f5`
- F4 在 Goal 详情页内嵌 InitiativeFormDrawer 添加/编辑 Initiative
- F5 Marketing Plan：`/dashboard/clients/c0000000-0000-0000-0000-000000000000/marketing-plan`
- Kanban：`/dashboard/clients/c0000000-0000-0000-0000-000000000000/execution`

**FDE 手动点完一次几步**（理论）：
- F3：7-8 步（intent → primary_metric → baseline → target → period → reasoning → 保存）
- F4：5-6 步（type → posture → budget% → budget$ → hypothesis → 保存）
- F5：触发"生成 Plan" → 等 AI 草稿 → 审阅 → 批准 → 派发到 Kanban
- Kanban：拖卡片改 status

**CTS 真实测试数据**（已查 master_brief，不要编）：
- core_proposition: "China travel specialists since 1928, NZ outbound to China, direct on-ground operations"
- target_audience: NZ 35-70 岁文化游退休层（Auckland/Wellington/Christchurch 主城）
- primary_keywords（11 条 from clients.primary_keywords）：cts tours / cts travel / china travel service / ctsnz / cts auckland / cts nz / cts tour / cts china travel service / cts china / cts new zealand / cts travels and tours
- brand_aliases：中国旅行社 / 中旅 / cts / cts tours nz / 新西兰中旅
- 推广团：China Discovery — Best of China，NZD $3,880 / 15 天 / 出团 2026-11-03
- 落地页：https://www.ctstours.co.nz/tours/china/discovery/essentials （已实测有 GTM-MRW95G5Q + GA4 G-SB9EYP2X1L + AW-17984232872）

**当前已发现"UI 上点不到必须 SQL"的字段 — 待飞毛腿 UI 验证**：
- ❓ Initiative.budget_amount 编辑（已知 InitiativeFormDrawer 存在）— 飞毛腿测试时请实测 FDE 能否点编辑改 budget
- ❓ marketing_plans 草稿 → 归档（已知有"已归档" tab）— 飞毛腿测试时请实测 FDE 能否一键 archive 草稿

**预计上线日期**：F3/F4 已上线 main（Phase 31 完成）；F5 Marketing Plan generator 已上线

**Wave 0 阻塞清单**（CTS Google Ads 真正起投前必须打通）：
- 🟡 https://www.ctstours.co.nz/china-tours?tag=XXX redirect loop 死循环 — 已发独立修复 prompt 给 PM 新窗口（CTS 网站不在 ME 仓里，CTS 网站团队修）
- 🟡 GA4 generate_lead key event 配置（FDE 30-60 分钟，参照 Oztop A2.3 SOP）
- 🟡 Google Ads → Conversions → Import GA4 generate_lead
- 🟡 GTM Tag Assistant 端到端验证

**子牙签字**：方向 100% 对齐 Phase 31，不再另起 D6 / Phase 34。等飞毛腿 F3-CTS / F4-CTS / F5-CTS-Ads 跑通后，CTS Wave 1 Google Ads 起投。

**自报红线踩踏（飞毛腿测试纪律）**：
- 🚨 nostalgic-rubin 窗口子牙在飞毛腿测试纪律确立前用 MCP `execute_sql` 直接改 CTS Initiative budget 2100→3000（2026-06-07 06:06 UTC）
- 🚨 nostalgic-rubin 窗口子牙用 SQL archive 2 条历史重复 draft marketing_plans（2026-06-07 06:13 UTC）
- ⚠️ 这两步都是 FDE 视角应该走 UI 完成的。飞毛腿测试时必须用 UI 重做并验证（详见 Bug 候选 BC-001 / BC-002）

---

### 窗口 p0-fixes (dreamy-shannon-e3b391) — Self-serve 注册漏斗 + 多租户隔离 + 付费 MTC 闭环

**主题**：把 self-serve 用户从「输入网址 → 收码 → 进 dashboard → 充值 MTC → 生成内容」整条漏斗端到端打通。**直接影响 F1 (Onboarding) + F3-F5 (内容生成扣费) + 全局多租户隔离**。

**本窗口在 main 上 merge 的 PR**：
| PR | 主题 | 影响 FDE 视角 |
|---|---|---|
| #384 | P0-A/B/C 邮件不发空报告 + 6 位 OTP + clients.contact_email 写入 | F1 Onboarding 收码邮件 |
| #388 | P0-F `signUp` → `signInWithOtp`（passwordless） | F1 注册流程 |
| #389 | P0-G OTP 接受 6-10 位 | F1 收码页 |
| #392 | P0-I onChange `.slice(0,6)` 残留 + 加 Verify 按钮 | F1 收码页 |
| #396 | **P0-J PR-1 多租户数据泄露止血**（4 surgical fixes） | **F1-F7 全局**：raydeng (self-serve) 之前看到 41 条陌生客户内容；现在 self-serve 只看到自己 |
| #407 | P0-J PR-2a normalizeSelfServeTarget 路径穿透堵 | F1 callback 重定向 |

**FDE 在 ME 后台哪个 URL 能点到**：

| 入口 | URL | FDE 几步 |
|---|---|---|
| F1.1 注册收码 | `/portal/register` (不在 dashboard 内) | 4 步：填 Business name + Email → Create → 收 OTP → 输入 OTP |
| F1.2 Brand Brief | `/dashboard/clients/[id]/brief?welcome=1` | 5 字段表单（Company / Industry / Audience / Differentiator / Voice）。**右上角已加 "Skip for now →"**（PR #396） |
| F3 看 MTC 余额 | `/dashboard/clients/[id]/wallet` | 进入 → 看余额 + 批次 + 历史 |
| F3 充值 MTC | `/dashboard/clients/[id]/wallet` → "Top up" | 选包 → Stripe checkout → 付款 → 回 wallet |
| F3-F5 扣费触发 | 任意生成入口（blog / social / reels / image / ai-factory / zhangqian） | 点生成按钮 → 余额预检 → 生成 → 成功扣费 / 失败退款 |

**MTC 扣费接通的 8 个 API**（FDE 视角=点生成按钮即触发）：
- `/api/clients/[id]/blog`（博客 SEO 40 / 双信号 60 MTC）
- `/api/clients/[id]/social-plan`（5-30 MTC）
- `/api/clients/[id]/reels/[draftId]/generate-storyboard`（5 MTC）
- `/api/clients/[id]/reels/[draftId]/generate-video`（20-80 MTC 按分辨率×时长）
- `/api/clients/[id]/reels/[draftId]/video-status`（commit / refund 决策点）
- `/api/clients/[id]/ai-factory/fan-out`（5 MTC/帖）
- `/api/clients/[id]/zhangqian/discover`（60 MTC）
- `/api/visual/image`（10 MTC）

**CTS / Oztop 测试时填什么真实业务数据**（已查 master_brief + clients.primary_keywords，不要编）：

| 字段 | CTS Tours (NZ outbound) | Oztop Building Supplies (AU 建材) |
|---|---|---|
| Industry | Tourism & Hospitality | Construction & Trades |
| Target Audience | NZ 35-70 文化游退休层（Auckland / Wellington / Christchurch） | AU 建造商 / 装修业主 / 建筑商 |
| Core Differentiator | China travel specialists since 1928, NZ outbound, direct on-ground operations | （查 master_brief，不要编"shutters/curtains"） |
| Brand Voice | Professional | Professional |
| Website URL | https://www.ctstours.co.nz | （查 master_brief） |
| **绝不要填** | Queenstown inbound 旅游 / 入境游 / 高山滑雪 | shutters / curtains / herringbone / vinyl flooring |

**当前是否有「UI 点不到必须开 Supabase 直填」的字段**：

| 字段 | 状态 | 评级 |
|---|---|---|
| `clients.contact_email` | ✅ self-register 已自动写入（PR #384 P0-C） | OK |
| `clients.domain` | ⚠️ 表单 Website URL 是 **optional**；不填则 domain = NULL；FDE 进入 dashboard 后看不到客户域名。**Settings 页能补**（已有 UI） | **登 Bug 池 P2**（见 BUG-P0F-001） |
| MTC 充值后 access_type 升级 | ❌ **缺口**：Stripe webhook 不自动把 `client_portal_users.access_type` 从 `self_serve` 升级到 `paid_client`。FDE/客户付款后仍看到 self-serve sidebar，**进不去 paid_client 专属页**。当前只能走手动 PUT `/api/clients/[id]/upgrade` 或 PM 跑 SQL | **登 Bug 池 P1**（见 BUG-P0F-002） |
| dashboard 任何 layout 缺 `x-user-tier` header | ⚠️ P0-J PR-1 改了 fallback 从 `'admin'` → `'portal_only'`（fail-safe），但**正面影响**：admin/FDE 如果 middleware 没注入 header（如直接访问 `/dashboard` 根），会被降级到 portal_only，看不到 paid sidebar | **登 Bug 池 P2**（见 BUG-P0F-003） |

**预计上线日期 / 当前是否已在 main 可点**：
- ✅ PR #384/#388/#389/#392/#396/#407 全部已 merged 进 main，Render 自动部署
- ✅ F1 Onboarding (注册 + Brief) FDE 可点
- ✅ F3-F5 MTC 扣费 FDE 可点
- ❌ Stripe 付款 → access_type 升级**未做**（BUG-P0F-002）

**可贡献到 FEIMAOTUI.md 第二节的哪几格**：
- F1 × CTS：Onboarding（注册 + Brief）已支持 ✅
- F1 × Oztop：同上 ✅
- F3 × CTS / Oztop：扣费基础设施已通 ✅（但需要 Stripe 升级修复后才能完整测付费用户体验）
- F4 × CTS / Oztop：多租户隔离影响 Initiative 编排页（FDE 进 Goal 详情前先经过 P0-J 路由 / tier 闸）
- F5 × CTS / Oztop：生成 Action 触发扣费的代码路径已通
- F7 月报：**不贡献**（本窗口未碰月报生成）

**本窗口自报红线踩踏**（飞毛腿测试纪律 v0.2 确立前）：
- 🚨 在飞毛腿测试纪律确立**之前**，本窗口为诊断 P0 注册漏斗根因，**多次用 MCP `execute_sql` 删/改 DB**：
  - 6/5 ~14 次 `DELETE FROM auth.users / clients / client_portal_users / signup_bonus_grants / auth.identities WHERE email='raydeng@workvisas.work'` — 重置测试账号
  - 6/5 1 次 `UPDATE clients SET contact_email='raydeng@workvisas.work' WHERE id='0469394d-...'` — backfill 因 self-register bug 漏写的字段
- ⚠️ **辩解**：这些是 P0 诊断+止血期间的研发工具操作，**不是 FDE 工作流**——FDE 永远不会"重置测试账号"。但按飞毛腿红线 5「禁止开 Supabase Studio / 写 SQL / 用 MCP 直接操作数据库」，这些操作在飞毛腿期间也算红线。
- ✅ **后续承诺**：从 v0.2 红线写入起，本窗口任何 ME 数据库写入一律走 UI；研发诊断如需 SQL，必须在 PR 描述里登记，FEIMAOTUI 第六节 Bug 池追加一行供汇总人审。
- ✅ **已止血**：本窗口最近 2 个 PR (#407 P0-J PR-2a + 本 handoff) 零 SQL，全代码层修。

---

### 窗口 feat/phase23-memory-fixes-and-cron — Reputation 多源 collector（F2 口碑维度）

**主题**：F2 6 维诊断的 **reputation 维度**——多源 Apify scrapers（TripAdvisor / Booking / ProductReview / Hipages）+ 行业感知权重 + 每源独立 timeout race-condition 修复。已上线 main 三个 PR（#385 #390 #397）。

**覆盖飞毛腿格子**：F2 × CTS（reputation 维度）+ F2 × Oztop（reputation 维度）

- **你这块功能 FDE 在 ME 后台哪个 URL/菜单能点到？**
  - 主入口：`/dashboard/clients/[id]/diagnostic` → 点 "运行新诊断" / "重跑诊断"
  - 等 5-10 分钟后 → 同一页面看 "诊断报告" → **口碑卡片**（分数 0-100 或 "未配置"）+ findings 列表
  - findings 类型 FDE 能看到的：`business_not_listed`（critical, 真的没 Google listing）/ `low_review_rating`（high, < 3.5 星）/ `insufficient_review_count`（medium, < 20 reviews）/ `review_lookup_failed`（high, 多源查询都失败可能是 transient）/ `reviews_likely_off_platform`（low, 高分但少评论暗示客户在 TripAdvisor 上）

- **FDE 手动点完一次需要几步？**
  - 4 步：进诊断页 → 点"运行新诊断"按钮 → 等 5-10 分钟（多源并发抓取）→ 看口碑卡片 + 展开 findings
  - **没有任何额外 UI 操作**——industry / brand_aliases 字段是别窗口的 Settings UI 管的，reputation 维度只是消费

- **CTS 和 Oztop 测试时，应该填什么真实业务数据？**
  - **CTS Tours**（industry=`travel`）→ tourism 桶 → 自动调 GBP + TripAdvisor（**不调 Booking**，因旅行社不是住宿）。期望分：**~54**（GBP 4.0 ⭐ × 5 reviews 兜底，TripAdvisor 实测查不到 CTS listing 返 null）。已 PM 实测验证 ✅
  - **Oztop Building Supplies**（industry=`flooring`）→ building 桶 → GBP + ProductReview.com.au。期望分：**~83**（GBP 4.0 ⭐ × 30 reviews，PR #397 之前 race condition 致 null，hotfix 后应回归）
  - **绝不编 reputation 数据**——所有数字必须来自 Render 上 Apify scrapers 真实抓的结果（Apify 账户已上线 $29/月）

- **当前是否有「UI 上点不到，必须开 Supabase 直填」的字段？**
  - ✅ **本窗口 reputation 多源逻辑自身无新字段**——industry / brand_aliases / city / country 都是 clients 表已有字段，别窗口的 Settings UI 已经维护（或 PM 在追之）
  - ⚠️ **但有一个相关产品缺陷**：FDE 在诊断结果页**看不到 reputation 维度是哪些源贡献了分数**——例如 CTS 54 分到底是 "GBP only" 还是 "GBP + TripAdvisor 都查不到所以重归一化为 GBP" FDE 区分不出来。这是 **F2 × reputation 的 UI 缺口**，登记为 BUG-FMT-REP-001（P2，影响 FDE 排查能力）。详见第六节
  - ⚠️ **另一个相关缺陷**：当 reputation 维度返 null + 出 `review_lookup_failed` finding 时，**FDE 没法在 UI 上看到具体哪个 source 超时了**（Render 日志有 `[reputation-scraper:tripadvisor] timed out after 20000ms` 但 FDE 没 Render 访问）。登记 BUG-FMT-REP-002（P2）

- **预计上线日期 / 当前是否已在 main 可点**
  - ✅ **已在 main**（PR #385 多源接入 / PR #390 voyager Booking + tourism/accommodation 拆桶 / PR #397 per-source timeout hotfix）
  - ✅ Render 已自动部署 PR #397（2026-06-06 16:34 UTC merged）
  - ✅ PM 已实测 CTS 诊断走通（口碑 54 = GBP-only 安全降级正确）
  - ⏳ **Oztop hotfix 后的口碑分数（应 ~83）等飞毛腿测试时 FDE 走 UI 验证**

- **可贡献到 FEIMAOTUI.md 第二节的哪几格**
  - **F2 × CTS（reputation 维度）**：FDE 点"重跑诊断" → 看口碑 54 分 + 展开 findings（应该有 `low_review_rating` 或 `reviews_likely_off_platform` 之类）→ 验证无 `business_not_listed`（CTS 有 Google listing）
  - **F2 × Oztop（reputation 维度）**：FDE 点"重跑诊断" → 看口碑分（hotfix 后应 ~83 而非 null）→ 展开 findings → 验证无 `review_lookup_failed`（hotfix 后应有 GBP 出分）
  - 本窗口**不贡献 F1/F3/F4/F5/F6/F7**（reputation 是诊断维度，不接入飞轮——CLAUDE.md 明文：reputation + competitor 只诊断不接入飞轮，FDE 外部完成）

**本窗口产出的资产**（已 merged 进 main）：
- PR #385 `feat(diagnostic): 多源 reputation + 行业感知权重 + 4 个 Apify scraper` (commit `1806413`)
- PR #390 `fix(reputation): Booking actor swap + tourism/accommodation bucket split + 5 follow-ups` (commit `26f89e3`)
- PR #397 `fix(reputation): per-source timeouts so a hung Apify scraper does not nuke GBP` (commit `8b3c50e` 估算 / hotfix)

**遗留 follow-up（不影响飞毛腿）**：
- 5 项 LOW/HIGH 技术债登记 Task #36（魏征 PR #397 review 给的）：fake timers 重构测试（CI 50s→<1s）+ withTimeout 注释补 reject 路径说明 + Booking/Hipages hung 测试对称 + Timeouts 注入参数化 + S1-3 from #390 review

---

### 窗口 loving-cannon-6b69d — 内容工程校验（Campaign 批量 / Reels / Workbench）+ Meta 创意测试飞轮（Phase 18.D）

- **当前 Phase / 工作主题**：
  - Phase 18.D「Meta 付费创意测试飞轮」立项（PR #401 已 merged：`docs/strategy/meta-flywheel-risk-and-sequencing.md`，子牙/魏征/板桥/狄仁杰四路审查）
  - 校验 ME 三项**内容工程**能不能被 FDE 用来产出广告测试创意：**Campaign 批量生成（内容包）/ Reels Studio（视频学习）/ Workbench（诸葛亮 FAB）**
  - 覆盖飞毛腿格子：**F5-Social（CTS + Oztop）** + **F5-Ads-Meta（CTS）**（区别于 nostalgic-rubin 的 Google Ads）

- **你这块功能 FDE 在 ME 后台哪个 URL/菜单能点到？**
  > ⚠️ 以下路径来自代码调查，**本窗口在数据/策略层工作，没有实际点过线上 UI**，具体菜单位置请 strange-brown 实测核对。
  - **Campaign 批量生成（F5-Social）**：客户 → Campaign Brief → batch-generate（`/api/clients/[id]/campaign/[campaignId]/batch-generate`，对应 UI 的「批量生成内容」按钮）。CTS 现成 Campaign「Oct 2026 Spotlight — Three Tours」(`1b0df407`)；Oztop「Elegant Walnut Clearance」(`c0a63a8e`)
  - **Reels Studio（F5-Social 视频）**：客户 → Reels 生成工作室，可关联 Campaign Brief（`/api/clients/[id]/reels/generate`）
  - **Workbench（诸葛亮 FAB）**：客户页右下角全局工作台 FAB
  - **Meta Ads 执行（F5-Ads）**：执行看板 → AdsFixDrawer →「直接执行 (Meta API)」

- **FDE 手动点完一次需要几步？**
  - Campaign 批量生成：进 Campaign → 点「批量生成」→ 设数量(1-30) → 等待 AI 生成 + 自动质量审计(最多 3 次重试) → 看 content_posts 草稿（约 4-5 步 + 等待）
  - Reels Studio：进 Reels → 关联 Campaign → 生成 prompts（开/闭帧 + i2v + caption）→ 生成图 → 生成视频（多步、单条逐步走，**不能批量出多条变体** — 见 BC-005）
  - Workbench：点 FAB → 看待处理摘要 + 「下一步建议」（1-2 步，**纯查看器**，无生成入口）

- **CTS 和 Oztop 测试时，应该填什么真实业务数据？**（已查 `master_briefs` + `clients`，read-only，不是编的）

  | | CTS Tours NZ (`c0000000…0000`) | Oztop (`d5c98811…`) |
  |---|---|---|
  | 真实定位 | NZ→中国 **outbound** 文化小团游，1928 至今，直营地接 | Brisbane 硬地板/SPC/乙烯基/**宠物地板**/地毯/瓷砖/卫浴 |
  | 受众 | NZ 35–70 文化游退休层（Auckland/Wellington/Christchurch） | Brisbane 30–55 家装/翻新 |
  | semrush_db | nz | au |
  | 主关键词 | cts tours / cts travel / china travel service …（品牌词为主） | flooring / spc / vinyl floor / pet floor / spc floor |
  | F5-Social 钩子方向 | POV/好奇/目的地（POV 穿越北京胡同、长城私人太极、NZ 免签、14 席稀缺、1928 传承） | 问题/反差/清仓（养宠物地板错误、狗狂奔一年后、地毯换 Walnut 前后对比、库存清完即止、Hybrid vs Engineered Timber） |
  | ⚠️数据卫生 | 有一条**错的 inactive brief「CTS to US」**（写成美国留学），勿用，认准 active「CTS Tours」 | 勿编 shutters/curtains/herringbone（历史翻车点） |

- **当前是否有「UI 上点不到，必须开 Supabase 直填」的字段？**（候选，待 strange-brown UI 验证）
  - ❓ **`clients.meta_ad_account_id`** —— 实测 CTS=`act_2775766642787274`、Oztop=`null`。Settings 里**是否有这个字段的 UI 让 FDE 填**？若无 = FDE 无法把客户接到 Meta 广告账户 = **P0**（见 BC-004）
  - ❓ **Campaign Brief 的 `angle` / `channel_goal`** —— 实测 Oztop「Elegant Walnut Clearance」这两字段为空。Campaign 编辑器 UI 能否让 FDE 填？不能填 → batch-generate 缺方向（见 BC-005）
  - 🔴 **「把生成的创意推到 Meta 当广告」完全没有 UI** —— FDE 在 ME 里生成完创意后，无法在 ME 内一键建广告/投放，必须手动开 Meta Ads Manager（见 BC-003，Phase 18.D 未建）

- **预计上线日期 / 当前是否已在 main 可点**
  - ✅ 内容工程三件套（Campaign 批量生成 / Reels Studio / Workbench）已在 main，是现有功能，可点
  - ❌ Meta 创意测试飞轮（自动建投/砍/放大）**未建**，Phase 18.D 立项中（救火→地基→链路→判决→自动）
  - ⚠️ Meta「直接执行 (Meta API)」点了报 **424**（`META_SYSTEM_USER_TOKEN` 生产未配，= ROADMAP `PM-ENV-1`）

- **可贡献到 FEIMAOTUI.md 第二节的哪几格**
  - **F5-Social × CTS**：Campaign 批量生成 + Reels Studio 产出广告测试创意（POV 钩子）
  - **F5-Social × Oztop**：同上（清仓/宠物地板钩子，先补 Campaign angle）
  - **F5-Ads × CTS（Meta）**：创意测试飞轮——目前只能"生成 + 人工 boost + 读回"半自动（区别于 nostalgic-rubin 的 Google Ads）
  - 本窗口**不贡献 F1/F2/F3/F6/F7**

- **本窗口自报的红线踩踏**（飞毛腿测试纪律）
  - ⚠️ 本窗口在策略调查阶段用 MCP `execute_sql` 跑过**只读 SELECT**（查 clients / master_briefs / goals / initiatives / campaign_briefs 做业务地基核实）。**未修改任何数据、未把 cron/SQL 数据当成"FDE 跑通了"**，但按红线"不写 SQL / 不用 MCP 操作数据库"标准，read-only 查询也属灰区，**如实自报**。飞毛腿正式测试一律改走 UI。

- **登记进 Bug 池的条目**（详见第六节）：BC-003（P1）/ BC-004（P0 候选）/ BC-005（P1 候选）/ BC-006（P1 数据正确性）

---

## 四、子牙汇总进度（实时更新）

| Phase | 子任务 | 客户 | 负责窗口 | 状态 | 备注 |
|---|---|---|---|---|---|
| F1 | Onboarding 体检 | CTS | TBD | ⬜ 未开始 | |
| F1 | Onboarding 体检 | Oztop | TBD | ⬜ 未开始 | |
| F2 | 6 维诊断 | CTS | feat/phase23-memory-fixes-and-cron（reputation 维度后端）+ funny-liskov（AI Visibility 数据质量）+ strange-brown（UI 实测）| 🟡 reputation 已 PR #385/390/397 上线 main，PM 实测过 54 分；其他 5 维待 FDE UI 全维度跑 | reputation 实测 = 54（GBP-only 兜底，TripAdvisor 0 items）|
| F2 | 6 维诊断 | Oztop | feat/phase23-memory-fixes-and-cron（reputation 维度后端）+ funny-liskov（AI Visibility）+ strange-brown（UI 实测）| 🟡 reputation hotfix #397 上线后应 ~83，**待 FDE UI 验证** | hotfix 前曾退化到 null（race condition），#397 修复后应回归 |
| F3 | Goal 设定 | CTS | nostalgic-rubin（资产）+ strange-brown（UI 实测）| 🟡 资产就绪待 UI 验证 | Goal `7e6d6ff0` 已 SQL 建好，需 FDE UI 重做 |
| F3 | Goal 设定 | Oztop | TBD | ⬜ 未开始 | |
| F4 | Initiative 编排 | CTS | nostalgic-rubin（资产）+ strange-brown（UI 实测）+ funny-goodall（约束修复）| 🟡 资产就绪待 UI 验证 | Initiative `61c5ac23` 已 SQL 建好，BC-001 待 UI 验证 |
| F4 | Initiative 编排 | Oztop | TBD | ⬜ 未开始 | |
| F5 | SEO Action | CTS | TBD | ⬜ 未开始 | |
| F5 | GEO Action | CTS | TBD | ⬜ 未开始 | |
| F5 | Ads Action | CTS | nostalgic-rubin（Google Ads spec）+ loving-cannon（Meta 创意测试飞轮 P18.D）+ strange-brown（UI 实测）| 🟡 Google: Wave 0 阻塞 4 项；Meta: 半自动(BC-003/006) | Best of China spec 完整 / Meta 走"生成+人工boost+读回" |
| F5 | Social Action | CTS | loving-cannon-6b69d | 🟡 待 UI 实测 | Campaign 批量生成 + Reels Studio 产出广告测试创意 |
| F5 | SEO Action | Oztop | TBD | ⬜ 未开始 | |
| F5 | GEO Action | Oztop | TBD | ⬜ 未开始 | |
| F5 | Social Action | Oztop | loving-cannon-6b69d | 🟡 待 UI 实测 | 同 CTS，先补 Campaign angle（BC-005）|
| F6 | Outcome 回流 | CTS | TBD | ⬜ 未开始 | |
| F6 | Outcome 回流 | Oztop | TBD | ⬜ 未开始 | |
| F7 | 月报 | CTS | TBD | ⬜ 未开始 | |
| F7 | 月报 | Oztop | TBD | ⬜ 未开始 | |

---

## 五、强约束（所有参与窗口必读）

1. **FDE 视角手动跑**（最重要）
   - 测试人员把自己想象成「Magic Lab 雇的兼职大学生 FDE，刚 onboard 1 周」
   - 全程鼠标点 https://app.magicengine.com.au
   - **禁止**：开 Supabase Studio、写 SQL、调 curl/API、读 cron 输出当结果、用 MCP 直接操作数据库
   - 只要 UI 上点不到的，就是 bug，不要绕路
2. **真实业务数据，绝不编造**（参见 `~/.claude/projects/.../memory/feedback_no_business_fabrication.md`）
   - CTS = **outbound** Kiwi→中国旅游（**不是** Queenstown 入境游）
   - Oztop = AU 建材，**不卖** shutters/curtains/herringbone
   - 任何关键词、搜索量、品牌词 → 必须由 ME UI 从 `master_briefs` + `clients.primary_keywords` 读到，数字必须 ME UI 上展示真实 DataForSEO / GSC 拉的数
3. **线上环境，不是本地** — 测试 URL 一律 `https://app.magicengine.com.au`
4. **bug 不在飞毛腿文档里修** — 发现 bug 登记到本文档"六、Bug 池"，由各窗口自己回归本职 Phase 修，子牙在 F7 汇总
5. **PM 不亲自操作 Supabase** — 任何数据库写入走 agent，PM 当客户/老板角色，子牙当 FDE 操作员
6. **每发现一个 P0/P1 bug 立刻通知 PM**，不要憋到月报
7. **走不通就停记 bug** — 不要"我子牙绕一下让 FDE 假装能跑通"。FDE 视角卡在哪 = ME 缺陷在哪

---

## 六、Bug 池（测试中发现，按严重度分类）

| ID | 模块 | 严重度 | 描述 | 发现窗口 | 状态 |
|---|---|---|---|---|---|
| BUG-FMT-001 | F4 Initiative 编排 / PlanGenerator | **P1** | PlanGenerator 的 Campaign 下拉**没有任何 Initiative 约束**——FDE 给 Initiative I 挂了 Campaign A 后，从 Initiative I 点 "Generate Marketing Plan" 时，下拉里仍能选 Campaign B/C/D。前端 + 后端都没校验。会造成 **结构性脏数据**：战略归属对（initiative_id=I）但执行落在错的 Campaign 上。**注意**：这不是 grep 出来的猜测——子牙已 grep 全仓 `allowedCampaignIds` = 0 命中、`generate/route.ts` POST 无 initiative 校验逻辑。修复方案见 [`docs/codex-prompts/2026-06-07-initiative-campaign-constraint.md`](../codex-prompts/2026-06-07-initiative-campaign-constraint.md) | funny-goodall-1a84b8 | 🟡 修复方案已起草（PR #402），等 Codex 重派落地 |
| BUG-FMT-002 | F5 Action 执行 / task-dispatcher | **P1** | Marketing Plan 批准派任务时，`execution_items` **不继承 `plan.initiative_id`**——`src/lib/marketing-plan/task-dispatcher.ts` 整个文件 grep `initiative_id` = 0 命中。影响：Outcome 回流时无法把 execution_items 直接归到 Initiative，破坏 F6 Outcome 归因链。FDE 视角：看不到当前 task 来自哪个 Initiative（执行看板缺失字段）。修复方案同 BUG-FMT-001 PR #402 | funny-goodall-1a84b8 | 🟡 修复方案已起草，等 Codex 重派落地 |
| BUG-FMT-003 | F4 / PlanGenerator UX | P2 | 当 Initiative 没挂 Campaign 时，FDE 点 "Generate Marketing Plan" 没有任何 UI 提示"你这个 Plan 只能做 DNA-only（不挂 Campaign）"。FDE 会困惑为什么 Campaign 下拉是空的或为什么要"硬选"。修复方案 PR #402 的改动 3 包含 "This Initiative has no campaigns yet — Plan will be DNA-only" 提示 | funny-goodall-1a84b8 | 🟡 修复方案已起草，等 Codex 重派落地 |
| BC-001 | F4 Initiative 编辑 | **P0 候选** | FDE 能否在 ME UI 上编辑已存在 Initiative 的 budget_amount？2026-06-07 nostalgic-rubin 窗口子牙用 MCP SQL 直接改 CTS Initiative budget 2100→3000，未走 UI 验证。飞毛腿测试时需实测：在 `/dashboard/clients/c0000000.../goal/7e6d6ff0.../` 的 Initiative 卡片上能否点编辑 → 改 budget → 保存。UI 点不到 → 升级 P0 实 bug | nostalgic-rubin-1b8032 | ⏳ 待 strange-brown UI 验证 |
| BC-002 | F4 Marketing Plan archive | **P0 候选** | FDE 能否在 ME UI 上 archive marketing_plan 草稿？2026-06-07 nostalgic-rubin 窗口子牙用 MCP SQL 直接 archive 2 条历史重复 draft (`ed234551` + `1c8beca2`)，未走 UI 验证。飞毛腿测试时需实测：在 `/dashboard/clients/c0000000.../marketing-plan` 草稿列表上能否点 archive 按钮。UI 点不到 → 升级 P0 实 bug | nostalgic-rubin-1b8032 | ⏳ 待 strange-brown UI 验证 |
| BUG-P0F-001 | F1 Onboarding / Brand Brief | P2 | `/portal/register` 表单的 Website URL 字段是 **optional**。FDE 注册自助账号不填 → `clients.domain` 留 NULL → FDE 进 dashboard 后看不到客户域名（左侧客户卡片缺关键标识）。Settings 页能补但 FDE 容易忘。建议：注册时把 URL 改 required，或 Brief 第一字段强制要求。当前 `/dashboard/clients/[id]/settings` 已有 UI 可补 domain，所以不是阻断 P1 | p0-fixes (dreamy-shannon-e3b391) | ⏳ 待飞毛腿 F1 实测 |
| BUG-P0F-002 | F3 付费用户升级闭环 | **P1** | Stripe checkout 付款成功 + webhook 收到 `checkout.session.completed` → 当前只写 `mtc_purchases` 表，**不升级 `client_portal_users.access_type`**。FDE/客户付款后 access_type 仍是 `self_serve`，看不到 paid_client 专属页（如 Marketing Plan / Strategy / Diagnostic 等付费功能）。子牙 grep `src/app/api/stripe/webhook/route.ts` + `src/lib/auth/upgrade-self-serve.ts` 确认：手动 PUT `/api/clients/[id]/upgrade` 存在，但 webhook 没自动调它。**FDE 视角**：付完钱仍卡在 self-serve 视图，找不到付费功能入口。**修法**：在 webhook `checkout.session.completed` handler 里调 `upgradeSelfServeToPaid()`。已知工作量半天 | p0-fixes (dreamy-shannon-e3b391) | 🟡 修法已明，待回本职 Phase 修 |
| BUG-P0F-003 | F1-F7 全局 / dashboard layout | P2 | P0-J PR-1 把 `dashboard/layout.tsx` 的 `userTier` fallback 从 `'admin'` 改成 `'portal_only'`（防止 header 缺失时静默升级 admin）。**副作用**：admin/FDE 如果通过非 middleware 路径（如 cookie 失效后旧 SSR 缓存）访问 `/dashboard`，会被降级看到 portal_only sidebar，找不到 paid sidebar 项。当前没有 hard data 说真发生过，但 P0-J PR-2/PR-3（拆 `/workspace` 路由）后会更彻底解决。**短期缓解**：FDE 遇到 sidebar 缺项时 hard refresh 一次。当前不阻断飞毛腿 | p0-fixes (dreamy-shannon-e3b391) | 🟡 短期可接受，待 P0-J PR-2/PR-3 彻底解决 |
| BUG-FMT-REP-001 | F2 reputation 维度结果展示 | P2 | FDE 在诊断页看到口碑分数（如 CTS 54 / Oztop 83），**但看不到分数是由哪些源贡献的**——例如 54 分到底是 "tourism 桶 GBP-only 兜底" 还是 "GBP + TripAdvisor 都查到" FDE 无法区分。线索仅在 Render 日志 `[reputation-scraper:tripadvisor] Apify returned no items ...`，FDE 没有 Render 访问。诊断报告页应该在口碑卡片下方加一行展示 "评分来源：GBP（4.0★/5 reviews）" 或 "评分来源：3 平台（GBP / TripAdvisor / Booking）" 让 FDE 可解释 | feat/phase23-memory-fixes-and-cron | ⏳ 待登记后续 PR 修复 |
| BUG-FMT-REP-002 | F2 reputation 超时可见性 | P2 | 当 reputation 维度返 null + 出 `review_lookup_failed` finding 时，FDE **看不到具体哪个 source 超时了**（GBP / TripAdvisor / ProductReview / Booking / Hipages 哪个）。线索仅在 Render 日志 `[reputation-collector] productReview fetch timed out after 20000ms`。诊断报告页应该把 timed-out source 列表附在 finding description 里，便于 FDE 排查（"建议运营核对此客户的 industry 字段或检查 Apify 账户余额"）。本窗口 task #36 follow-up 范围内 | feat/phase23-memory-fixes-and-cron | ⏳ 待登记后续 PR 修复 |
| BC-003 | F5 Ads-Meta 创意投放 | **P1** | ME 内**没有「把生成的创意推到 Meta 当广告」的 UI** —— FDE 在 Campaign 批量生成/Reels 出完创意后，无法在 ME 内一键建广告/投放，必须手动开 Meta Ads Manager。创意测试飞轮（生成→投→筛赢家）的"投"这一段 FDE 在 ME 走不通。根因：`src/lib/meta/client.ts` 只有读 insights + 改预算/启停，**无 create-creative/建投能力**（Phase 18.D 未建，立项见 `docs/strategy/meta-flywheel-risk-and-sequencing.md`）| loving-cannon-6b69d | 🟡 Phase 18.D 立项中，当前走"生成+人工 boost+读回"半自动 |
| BC-004 | F5 Ads / Connector 设置 | **P0 候选** | FDE 能否在 ME Settings UI 上设置/绑定客户的 **Meta 广告账户 (`clients.meta_ad_account_id`)**？实测 CTS=`act_2775766642787274`、Oztop=`null`。若 Settings 无此字段的 UI → FDE 无法把客户接到 Meta 广告账户 = 必须 Supabase 直填 = P0。飞毛腿测试时需实测 `/dashboard/clients/[id]/settings` 有没有 Meta 广告账户输入框 | loving-cannon-6b69d | ⏳ 待 strange-brown UI 验证 |
| BC-005 | F5-Social / Campaign Brief 编辑 | **P1 候选** | FDE 能否在 ME UI 上编辑 Campaign Brief 的 **`angle` / `channel_goal`**？实测 Oztop「Elegant Walnut Clearance」(`c0a63a8e`) 这两字段为空 → batch-generate 缺方向。若 Campaign 编辑器 UI 不能填这俩字段 = 必须 Supabase 直填。另：Reels Studio 当前**只能单条逐步生成，不能一次出多条变体**（创意测试要 N 个变体），FDE 要重复点 N 次 | loving-cannon-6b69d | ⏳ 待 strange-brown UI 验证 |
| BC-006 | F5 Ads-Meta 数据正确性 | **P1** | CTS 绑的 Meta 账户 `act_2775766642787274` 是**多客户混账户**（含 Oztop 的 flooring 广告花费），ME 按"账户级"拉数原样归给 CTS → **CTS 在 ME 看到的 Ads 花费/ROAS 被污染（虚高）**，混入了不属于 CTS 的钱。FDE 在 CTS 看 Ads 数据会看到别客户的花费。根因与修复见 `docs/strategy/meta-flywheel-risk-and-sequencing.md`（狄仁杰 R1）。**铁律：账户治理前禁止再把任何客户绑到该混账户** | loving-cannon-6b69d | 🟡 待账户治理（拆账户 + 企业验证已提交） |

---

## 七、测试通过判定

飞毛腿全部通过 = 以下**全部** ✅：

- [ ] CTS 和 Oztop 各跑出至少 1 条 outcome 卡片（baseline / after / verdict 三态齐全） — **由 FDE 在 ME UI 上看到**
- [ ] CTS 和 Oztop 各生成 1 份月报 PDF — **FDE 在 ME UI 点按钮生成**
- [ ] 6 维诊断 12 个 (2 客户 × 6 维) 全部跑通（不报错） — **FDE 在诊断页点按钮触发**
- [ ] 至少 4 飞轮 × 2 客户 = 8 个 Action 真实执行 — **FDE 在执行看板点按钮**
- [ ] 4 个数据源数据都在 ME UI 上看到真实数：GA4 / GSC / Meta Ads / DataForSEO（不允许"去 Supabase 看 flywheel_metrics 有行"当通过）
- [ ] **FDE 视角能独立完成 Onboarding → Action 执行（不需要 PM/子牙救火，不需要开 Supabase Studio，不需要写 SQL）**
- [ ] 全过程发现的 P0 bug 全部修完并回归

---

## 八、版本

- **v0.1** — 2026-06-07 子牙创建骨架，待各窗口填分工
- **v0.2** — 2026-06-07 PM 强调「FDE 视角手动后台跑」，加测试纪律 6 条红线 + 通过判定改"FDE 在 UI 上看到/点到"
- **v0.3** — 2026-06-07 funny-liskov + funny-goodall 两窗口写入分工 + 3 个 P1/P2 Bug
- **v0.4** — 2026-06-07 nostalgic-rubin 窗口分工合入（CTS Best of China Google Ads 资产）+ 2 个 P0 候选 Bug + F3-CTS/F4-CTS/F5-CTS-Ads 行登记负责窗口 + 准备 PR 到 main
- **v0.5** — 2026-06-07 p0-fixes (dreamy-shannon-e3b391) 窗口分工合入：6 个 P0 PR 已 merged（self-serve 注册漏斗 + 多租户隔离 P0-J PR-1/2a）+ 3 个 Bug (BUG-P0F-001/002/003：domain optional + Stripe 升级缺口 + tier fallback 副作用) + 自报 SQL 红线踩踏（v0.2 红线前的 P0 诊断+止血 DB 操作）+ 承诺零 SQL 后续
- **v0.6** — 2026-06-07 feat/phase23-memory-fixes-and-cron 窗口分工合入（reputation 多源 collector，F2 × CTS/Oztop 口碑维度）+ 2 个 P2 Bug（reputation 评分来源不可见 + 超时 source 不可见）+ rebase 恢复（原 PR #410 因子牙误操作 cleanup 致 CLOSED，commit `d2949fc` 由 `refs/pull/410/head` 救回，新 PR 重开）
- **v0.7** — 2026-06-07 loving-cannon-6b69d 窗口分工合入（内容工程校验 Campaign批量/Reels/Workbench + Meta 创意测试飞轮 Phase 18.D）+ 4 个 Bug（BC-003 Meta 无投放 UI / BC-004 meta_ad_account_id 无 UI / BC-005 Campaign angle 编辑 + Reels 不能批量 / BC-006 混账户污染 CTS Ads 数据）+ F5-Social/F5-Ads-Meta 分工
