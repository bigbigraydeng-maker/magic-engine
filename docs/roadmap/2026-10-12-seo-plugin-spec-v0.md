# SEO 插件说明书 v0（草案，对照新版 Extension Contract v1.1）

日期：2026-10-12（NZ）｜写入者：77 号窗口｜风险级别：C（纯文档，不是实现，不改任何运行代码）
平台层级门（Inline）：SEO 属既有六支柱之一；本文不新增能力线；CTS 内容格式属连接器适配/客户配置，不进共享逻辑；无需登记候选。
资源排序（质量闸 §11）：SEO 插件化——频率低（一次性设计）/ IMPACT 关键度中（Act 与 Check 的接点）/ 收入关联待验证 → 一个以上低、没有两个高 → 不抢 Social P0 的资源；本文只花文档成本。

---

## 0. 一页结论

1. 新版没有 SEO 的业务逻辑，只有零件：`google_search_console`（读每日与热门词）、`wordpress`（建草稿/发布，带回读）、`github_site`（提交文件，带回读）。说明书把老版 SEO 现有功能映射成「1 个 pillar 插件 + 缺的 2 个连接器」。
2. 老版 SEO 评估（2026-10-11）里的 4 个缺陷与 4 条设计边界，在说明书里**写成硬约束**（见 §5），让新版插件从第一天就不犯。
3. **这份说明书不要求现在写 Python。** 规则尚未冻结，且 SEO 的主要使用者 CTS 留在老版。建议顺序：先在老版把缺陷修掉并积累真实效果证据 → 俊东冻结规则 → 再按本说明书在新版写插件。
4. 新版现状已实测可用（本机跑通：检查、类型、62 步迁移、4 项隔离探针、测试 1890 通过 / 1 失败（疑似未构建前端）、生成骨架的 2 个测试通过）。

---

## 1. 插件身份（Manifest 草案）

| 字段 | 草案值 | 说明 |
|---|---|---|
| `id` | `seo` | 能力名一律以 `seo.` 开头（契约硬约束） |
| `kind` | `pillar` | 支柱插件 |
| `version` | `0.1.0` | 冻结前随意，冻结后只加不改 |
| `permissions` | `seo:read`、`seo:write`、`seo:act` | scope 格式须为 `<域>:(read\|write\|act)`；每条要写理由（≥4 字） |
| `requires` | 无（连接器另列） | 不依赖其他插件 |
| `data` | `ext_seo`（自己的库表：目标页绑定、关键词到页面的唯一映射、监控登记） | 禁止改 Core 表，只引用 id |
| `impact_stages` | inspect / measure / prescribe / check / tune（五个全声明） | 声明了必须全实现；Act 不在内，永远走 Kernel |
| `failure.on_paid_step_failure` | `escalate_to_human` | 契约只允许这一个值 |
| `events` | 发布：`seo.page.applied`、`seo.page.activation_verified`；订阅：`seo.rank.sampled` | 名称业务可读（与 CLAUDE.md §3 一致） |
| `ui` | 一个菜单「SEO」，页面：机会列表、待核实、观察中（表格式） | 新版用声明式表格页，不写前端；动作按钮挂在自己的能力上 |
| `pii_fields` | 空 | SEO 不收个人信息 |

## 2. 能力清单（CapabilityDecl 草案）

契约要求：`stage=act` 必须 `requires_verify`；有对外副作用必须声明 `idempotency_key_fields`；对外副作用的能力永远要人审；每个能力要有 JSON Schema 的输入输出。

| 能力名 | 阶段 | 对外副作用 | 幂等键 | 老版对应 | 备注 |
|---|---|---|---|---|---|
| `seo.opportunity.rank` | inspect | 否 | — | `seo-agent` | 输出必须带目标 URL、证据 id、市场/语言、数据新鲜度与回退原因 |
| `seo.target_page.resolve` | inspect | 否 | — | `seo-weekly-list` 预诊断 | 关键词 → **唯一**排名页；歧义转人工，不生成改某页的指令 |
| `seo.page.read_facts` | inspect | 否 | — | seo-meta-cycle 的“取旧标题/描述” | 生成前先读原页面事实（标题、描述、正文要点）；需要「页面读取」连接器（见 §6 缺口） |
| `seo.title.propose` | prescribe | 否 | — | `seo-meta-cycle` 生成器 | 输入含原页面事实 + 目标词搜索量/难度 + 前 3 名标题；保留事实保护、保护页、冷却期 |
| `seo.blog.draft` | prescribe | 否 | — | `weekly-blog` + 草稿质量检查 | 通过 WordPress `post.create_draft` 或 GitHub `file.commit` 落草稿 |
| `seo.page.apply_meta` | **act** | **是** | `customer_id, target_url, change_version` | seo-meta-cycle 执行 + `pr-sync` | `requires_verify=True`：核验方式 = 读取线上页面真实标题/描述，与预期一致才算生效 |
| `seo.blog.publish` | **act** | **是** | `customer_id, asset_id, version_id` | `blog-publisher` + `pr-sync` | WordPress `post.publish` 带 `post.publish_read_back`；GitHub 路径 `pull_request.read_back` |
| `seo.rank.sample` | measure | 否 | — | `rank-sampler` | 多次采样、记录市场与地区（老版缺陷 #4 的修法） |
| `seo.page.monitor` | check | 否 | `activation_id, window_hours` | `post-publish-monitor`（72/168 小时） | 由「已核实生效」事件自动触发，不靠手动脚本 |
| `seo.report.weekly` | check | 否 | — | `weekly-report` | 只展示已有 Outcome，不另算 |

不进插件的东西：具体客户的内容文件格式（CTS 的 WordPress 文件结构属连接器适配）、客户价格与术语（客户配置）、旅游行业打法（Travel Playbook）。

## 3. 五阶段怎么落（StageHandler）

**Inspect（只能引用 Core 给的证据 id）**
证据：GSC 每日/热门词（`site.daily` / `site.top`）、页面读取结果、排名采样、客户目标市场与语言。
输出 GrowthState：当前覆盖了哪些词和页、证据新鲜度、缺口（`gaps`）。某类证据缺失 = 明写缺口，不补零、不借别的客户的值。

**Measure（至少 1 条 Baseline，否则不得假装能证明 Impact）**
基线 = 目标页 + 目标词 + 市场 + 窗口内的点击/曝光/平均排名，带样本量与可比条件（`comparability`）。同一词不同市场/设备不混算。没有可信基线 → 返回空，让循环停下。

**Prescribe（处方必须带验证口径与 not_doing）**
一次处方 = 一个具体动作（`seo.page.apply_meta` 或 `seo.blog.publish`）+ 预期影响 + 风险/可逆性 + 验证窗口与到期时间 + 「这次不做什么」（例如不动保护页、冷却期内不改同一页）。成本封顶写入 `cost_mtc`。

**Check（Outcome：未知就是未知）**
先判**是否真的生效**（读线上页面），再判**排名/点击是否改善**：
- 没读到线上页面事实 → `unknown`，不得输出排名上涨结论（老版缺陷「上线状态未知仍给排名上涨判断」）；
- 窗口内证据不足 → `insufficient_evidence`，不带数值；
- 有前后值与证据才可给 positive / negative / no_change，并写 caveats（季节性、并行动作、搜索量变化）。

**Tune（必须改变后续决策）**
结果进入客户私有学习（`core.learnings` 的 client 层）：继续 / 调整 / 暂停 / 证据不足，并在下一轮 `seo.opportunity.rank` 里被读取。行业层、全局层晋升需要来源与兼容性复核，不在本插件内自动做。

## 4. 与 Kernel / 连接器的接口

- Act 动作通过 `build_actions(...)` 把 `ActionDefinition` 装进 Kernel（参考 `extensions/ads/actions.py`）；插件自己不 import `app.kernel`。
- 对外动作永远进人工审核；审核通过 ≠ 发布授权，授权另走既有授权对象（与老版 Social 的结论一致）。
- 连接器分工：
  - 已有：`google_search_console`（读）、`wordpress`（草稿/发布 + 回读）、`github_site`（提交 + 回读）。
  - **缺：**①公开页面读取（取线上标题/描述/正文，用于生效核验）——可作为 `_sites` 或新连接器的 `Read`；②排名采样来源（老版用 DataForSEO 的封装）——新版没有对应连接器。两者需和俊东商量：做成连接器，还是共用现有。

## 5. 把老版缺陷写成约束（设计掉，而不是以后再修）

| 老版缺陷（SEO 评估 2026-10-11） | 说明书里的约束 |
|---|---|
| PR 合并被写成“已核实上线” | 三态分开记录：`applied`（动作完成）→`activation_verified`（线上页面读到预期内容）→`measured`（效果窗口取数）。生效时间 = 核验时间，不是合并时间 |
| 关键词预诊断确认 B 页，任务却指向 A 页 | `seo.target_page.resolve` 返回唯一页；任务 URL 与基线都绑定该页；歧义→待核实，不产出执行指令 |
| 发布后监控没有自动入口 | `seo.page.monitor` 只能由「已核实生效」事件触发，事件 id 用稳定的动作 id 去重，并关联原动作 |
| 指标适配器未传客户目标市场 | 所有取数请求带客户的市场/语言；市场写入证据的来源信息；不改全局默认来代替客户配置 |
| 排名观察与改动验收混在一起 | 先 `activation_verified`，再谈排名；上线状态未知时不输出排名结论 |
| 标题生成前没有原页面事实 | `seo.title.propose` 的输入必须含 `seo.page.read_facts` 的结果 |
| Tune 没进学习 | 结果写 `core.learnings`（client 层）并被下一轮读取，记录采纳/拒绝理由 |
| 机会来源没有新鲜度与置信度 | `seo.opportunity.rank` 的每条机会带证据 id、新鲜度、回退原因；回退数据标「待核实」，不当作可执行 |

## 6. 老版模块 → 新版去向

| 老版模块 | 去向 | 说明 |
|---|---|---|
| `seo-agent` | 重写为 `seo.opportunity.rank`（业务规则照搬：评分、回退） | 老版输出要补目标 URL/证据/基线/验收约定 |
| `seo-patrol`、`seo-weekly-list` | 重写为 inspect/prescribe 的定时触发（新版 jobs/调度） | 保留去重、在途上限、数据新鲜度检查 |
| `seo-meta-cycle` | 重写为 `seo.title.propose` + `seo.page.apply_meta` | 事实保护、保护页、冷却期、关键词门槛必须保留 |
| `weekly-blog`、`blog-publisher`、`pr-sync` | `seo.blog.draft` / `seo.blog.publish`，动作落到 WordPress / GitHub 连接器 | PR 合并只记合并，生效另核验 |
| `rank-sampler`、`rank-verdict` | `seo.rank.sample` + check 阶段 | 多次观察、谨慎趋势判断；需要排名来源连接器 |
| `post-publish-monitor` | `seo.page.monitor` | 72/168 小时窗口照旧 |
| GSC 读取 | 新版 `google_search_console` 已有（只读） | 不重做 |
| CTS 内容文件格式 | 连接器适配（`github_site` / `wordpress` 的客户配置） | 不进共享逻辑 |

## 7. 三层归属（平台 / 行业 / 客户）

- **平台层**：上面全部能力与阶段规则（对任意客户、任意行业成立）。
- **行业层（Playbook）**：旅游、地产、物流各自的关键词打法、标题模板、季节性——只放行业共识，不放单客户事实。
- **客户层（配置/私有记忆）**：目标市场与语言、保护页清单、冷却期、内容文件格式、品牌红线。
- 自检：把 CTS 换成一个悉尼地产客户，这份说明书里的能力名、阶段规则、约束是否要改？**不需要**；需要改的只有客户配置与 Playbook。

## 8. 待俊东对齐的问题

1. Extension Contract 什么时候冻结？冻结前写的插件是否接受后续调整？
2. 「公开页面读取」「排名采样」做成新连接器，还是放进已有 `_sites`？
3. `ext_seo` 自己的库表由插件自带迁移（像 ads 那样）是否 OK？
4. 新版有没有真实客户可以用来验证？（没有的话效果证据只能来自老版。）
5. 定时触发（每周机会/监控）用新版 jobs 队列还是外部调度？

## 9. 建议的推进顺序与不做的事

1. 先在老版修 SEO 评估里的缺陷（由 73 号/SEO 相关窗口按优先级排期，不挤占 Social P0）。
2. 老版修完并跑出至少一轮真实「改动 → 上线核验 → 效果」的证据后，请俊东确认冻结规则。
3. 再由唯一写入者按本说明书在新版 `extensions/seo/` 写插件（`uv run python -m app.sdk.scaffold seo ...` 生成骨架；代码默认交 DeepSeek 写、我审）。
4. 不做：现在写 Python；在老版里并行造一套新框架；把 CTS 的内容格式写进共享代码；把本说明书当作启用或迁移的授权。

## 10. 验证与限制

- 本文依据：老版 SEO 评估（固定基线 `8f16acaf1`）、新版仓库 `574b875` 的 `docs/CONTRACT.md`、`app/sdk/*`、`extensions/{ads,google_search_console,wordpress,github_site}`，以及本机对新版的实际运行。
- 未运行：老版 npm 测试/构建（文档变更）。未核实：新版线上服务、其生产客户、连接器与真实平台的联通（测试用模拟传输）。
- 能力名、幂等键、权限范围是**草案**，实现前要对照冻结后的契约逐项校验。

## 11. Reuse Statement

复用：老版 SEO 现有模块与评估结论；新版 Extension Contract v1.1、`ads` 插件与三个现有连接器的结构。新增：无共享代码。industry-specific：仅提及 Playbook 归属，未写入具体行业判断。client-specific：未写入客户事实。与 tier-gate 决策时的分类一致（既有支柱，Inline）。
