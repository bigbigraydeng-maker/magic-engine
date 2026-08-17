# ME 2.0 进度地图 —— 成熟度判定标准 + 当前快照

> **这份文档回答一个问题**：ME 2.0 的每个组件到底做到哪了 —— 不是"声称"做到哪，是**拿证据反推**做到哪。
>
> 判定标准（M0–M5、四问）是**稳定的**，取自代码 `src/lib/product-map/maturity.ts` 与 `operational-snapshot.ts`。
> 快照部分是**时间点**数据，会过期，每份都标了 as-of 日期。
>
> 相关：[STATE.md](./STATE.md) · [ROADMAP.md](./ROADMAP.md) · WP00 契约冻结 [specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md](./specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md)

---

## 1. 这套东西是干嘛的

ME 2.0 由一批组件拼成（内核、能力、模块、适配器、编排…）。「Product Map」是 Git 里的一份**组件登记表**（`src/lib/product-map/`），它只存组件的身份、语义、依赖和**证据**；每个组件做到哪一步的判定，由代码从证据当场推导，不由人手填。

护城河式的设计目标一句话：**让「我觉得做完了」这句话在结构上失效** —— 没有证据，谁都升不上去。

可视化界面是 PR #994（进度看板），尚未上线；在它之前，进度用本文的快照 + 随时可重跑的推导脚本查看。

---

## 2. 成熟度 M0–M5 怎么判定（稳定判据）

成熟度是一把**严格累积的梯子**。每一级要拿到对应证据才算达到；到第 N 级，第 1～N 级的证据必须**全齐**，断在第一个缺口。

| 台阶 | 大白话 | 拿什么证据才算到这一级 |
|---|---|---|
| **M0 登记** | 有这个想法，登记在册 | 登记即得 —— 只要它进了登记表就是 M0 |
| **M1 契约冻结** | 规矩定死了：要什么、边界在哪、验收标准 | 有一份**冻结的**契约（spec 文档 / 代码里的版本常量）。提案稿不算。<br>老组件（legacy）：认领的代码路径真实存在 |
| **M2 已实现** | 代码写完、合并进主线了 | 有一个 `role='implements'` 的 PR，且 GitHub 确认**已合并**。<br>老组件：认领的代码在磁盘上真实存在 |
| **M3 已接线** | 接进了真实调用链 | 有真实调用证据（`importer` / `caller_route` / `caller_cron` / `wired_registry`），且 ref 指向仓库内真实文件 |
| **M4 生产验证** | 生产真跑过、有回执 | 有可审计的生产执行证据：`production_run`（一次运行 ID）或 `production_data`（生产库里它产出的数据）。**只对 ME2 原生组件开放** |
| **M5 持续运营** | 反复在跑、能归因到业务结果 | ≥2 条 `recurring_outcome`，且观察日**不同天**。一次性跑通不算 |

### 三条铁律

1. **严格累积** —— 缺中间任一级，上面再高的证据也不算数。例：某组件生产真跑过（M4 证据在），但缺"真实调用方"（M3 证据），它照样卡在 M2。
2. **不能靠"声明"往上爬** —— 最终等级 = `min(自己声明的, 证据能撑到的)`。声明高于证据只会得到一个"过度声明"警告，不会真升级；声明 M4/M5 却对应证据为空 = 直接报错，进不了主线。
3. **老组件（legacy）封顶 M3** —— 它天天在生产干活是事实，但"是否已纳入 ME2 七层 / Kernel 治理"是另一回事。legacy 的 production/learning 证据必须为空，不许借成熟度把它夸大成 M4/M5。它的生产人生由 `operationalStatus` 表达。

### 为什么没有"migration 已 apply"这一档

migration apply 证明的是 **provisioning**（schema 存在），不是"生产验证"。而且账本版本号不可信、判 apply 只认对象存在性、纯代码层核验不了 —— 所以"表建了没"记进 blocker（`kind: 'provisioning'`），不当成成熟度证据。

---

## 3. 四个运营真相问题（与成熟度同源，不建第二套真值）

每个组件另外展示四个由机器证据回答的问题。三态：`yes` / `no` / `unknown`。

| 问题 | 判 `yes` 的条件 | 判 `no` 的条件 |
|---|---|---|
| **代码进主线了吗** | 有 `implements` PR 且 GitHub 说已合并（带日期） | PR 明确处于非合并状态 |
| **生产依赖真存在吗** | 有 `production_data` 证据（带日期） | 有 `provisioning` 类 blocker |
| **有真实调用方吗** | 有 `integrationEvidence`（带日期） | 有明确写"零调用方"的 blocker |
| **生产真跑过吗** | 有 `production_run` 证据（带日期） | `operationalStatus = not_operating` |

三条规矩：

- **没查过 = `unknown`，不是 `no`** —— 界面不装懂。
- **docs / Issue / 对话只能当线索，不能单独把格子填成 `yes`**。
- **`yes` 必须由**机器核验**的、带真实日期的证据支撑** —— 证据 `verification ∈ {repo_verified, sync_verified}`，或 PR 事实 `source==='github_sync'`。人工手填的 `manual_claim` / `manual_snapshot` 即便带了日期也**只判 `unknown`**（人手写个日期不算机器确认）。所以在实时同步（#992）上线前，四问的正向格大量诚实显示"待核验"。

> 证据优先级（继承 WP00 §2）：生产对象存在性 ＞ origin/main 代码 ＞ main migration ＞ docs ＞ Issue/PR ＞ 对话记忆。

---

## 4. 当前快照 · as of 2026-08-17

> 数据来源：主线登记表 + GitHub 实时 PR 状态。**这是时间点快照，会过期**；判据（第 2、3 节）才是稳定的。
>
> ⚠️ **四问一栏读法**：实时同步（#992）尚未上线，当前登记册的证据全是人工声明（`manual_claim` / `manual_snapshot`）。按第 3 节的机器核验规则，正向格一律显示**"待核验"**，不显示"是"——这不是没进展，是"还没被机器确认"。等同步任务跑一次、GitHub 事实进库后，这些格子才会填上真实的"是/否"。**成熟度（M 列）不受此影响**，它是另一套判据。

**总览**：25 个组件，跨 5 条业务线。**经机器核验的生产运行：0**（同步未上线）。GEO 那条线有 **2 个**组件有真实生产运行记录（Roman Baseline），但目前是人工声明、未机器核验，四问显示"待核验"。达到 M5 的：**0 个**。

**成熟度分布（不受机器核验影响）**：M0 · 1｜M1 · 1｜M2 · 5｜M3 · 15｜M4 · 3｜M5 · 0

**在等 PO / 总控室拍板（2 件）**：
- **执行内核** —— 授权把内核 4 张表建到生产（不建表，整个执行链路空转）。
- **GEO Module v1（WP05）** —— 页面台账余项完成后授权实施。

> 四问列格式：代码进主线 / 生产依赖 / 真实调用方 / 生产跑过。"待核验"= 有人工声明但未机器核验（见上方读法）。

### GEO · AI 可见度（全线最靠前，唯一有真实生产运行记录的业务线）

| 组件 | 成熟度 | 四问（正向格 = 待核验，未上线同步） |
|---|---|---|
| GEO 测量执行（WP04）`capability.geo-measurement-runtime` | M4 | 待核验 / 未知 / 未知 / 待核验※ |
| GEO baseline 引擎接线（WP04A）`adapter.geo-baseline-openai` | M4 | 待核验 / 未知 / 未知 / 待核验※ |
| GEO 测量不可变存储（WP03）`platform.geo-measurement-store` | M4 | 待核验 / 待核验 / 未知 / 否 |
| GEO 测量契约（WP02）`platform.geo-measurement-contract` | M3 | 待核验 / 未知 / 未知 / 否 |
| GEO Module v1（WP05）`module.geo-visibility` | M1 | 未知 / 未知 / 未知 / 否 · **等授权** |
| 行业品牌别名登记册 `registry.industry-brand-canonical` | M3 (legacy) | 未知 ×4 |

※ 这两个组件有真实的 Roman Baseline v1 生产运行（2026-08-12），证据在册但是 `manual_claim`；机器核验（同步上线）后"生产跑过"会转为"是"。

### 共享内核与能力（地基：大多已建成，还没接上真实调用）

| 组件 | 成熟度 | 四问 |
|---|---|---|
| 执行内核 `platform.execution-kernel` | M2 | 待核验 / 否 / 未知 / 否 · **等你授权建表** |
| Action Bridge `platform.action-bridge` | M2 | 待核验 / 未知 / 未知 / 否 |
| Growth 契约 `platform.growth-contract` | M2 | 待核验 / 未知 / 否 / 否 |
| 内核审批边界（K-WP01A）`platform.kernel-approval-boundary` | M0※ | 待核验 / 未知 / 未知 / 否 |
| 站点页面台账 `registry.canonical-page-inventory` | M2 | 待核验 / 未知 / 否 / 否 |
| Page Optimization `capability.page-optimization` | M2 | 待核验 / 未知 / 未知 / 否 |
| Meta 平台接口 `adapter.meta` | M3 (legacy) | 未知 ×4 |

※ 登记表是旧快照：服务端边界 #962 与审批界面 #1001 其实都已合并，成熟度还没在登记表里更新 —— 这正是自动同步（PR #992）要修的。

### SEO（大量既有能力在跑，尚未纳入 ME2 治理）

`capability.seo-build-publish-package`（M3, ME2 原生）· `module.seo-diagnosis`（M3, legacy）· `capability.seo-blog-publish`（M3, legacy）· CMS/GSC/Keyword Intelligence 等 5 个 legacy 适配器（均 M3）。

### 社媒 / 广告（均为 legacy 在跑，尚未纳入治理）

社媒：视频工厂 `playbook.social-video-factory`、Publishing Hub 适配器（均 M3 legacy）。
广告：广告优化闭环 `playbook.ads-optimisation-loop`、Google Ads 适配器（均 M3 legacy）。

> **"未知"偏多是正常的**：证据自动同步（PR #992）还没接上，很多运营真相暂时只能诚实标"未知"，而不是编一个"是"。

---

## 5. 怎么重新生成快照

登记表在 `src/lib/product-map/registry/`。推导逻辑在 `maturity.ts`（成熟度）+ `operational-snapshot.ts`（四问）。把当前登记表 + GitHub 实时 PR 状态喂进去即可重算 —— PR #992（同步）上线后这一步会自动化，PR #994（控制台）会把它变成 ME 后台的实时页面。

**收口队列进度**（2026-08-17）：
- ✅ **#1005**（登记表模型纠正 B1–B4）—— 已合并（commit `96bb20d4`；Codex 三轮共 7 条，全部处理）。
- ✅ **同步建表 migration `20260815000001`** —— 已 apply 到生产（5 表 + RPC + service-role RLS，0 匿名泄露，按对象存在性核实）。含未分类队列表 `product_map_unclassified_work`。
- 🔄 **#992**（同步可观测性对账 + `codeInMain` 校验 PR `base_ref==main`）—— 对账中。
- ⏳ **#994**（控制台 / 进度看板界面，含动态未分类队列）—— 排在 #992 之后。

> 另有一件**独立**的 PO 授权待办：把**执行内核**的 4 张表（`action_runs` 等）apply 到生产 —— 那跟上面的同步表是两回事，内核链路仍在等它。
