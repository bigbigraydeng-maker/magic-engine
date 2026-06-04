# CTS / Oztop 真实业务开发计划（草案 — 待魏征审）

> 日期 2026-06-04 · 焦点客户：CTS Tours NZ + oztop · PM 定调：**这俩客户主要要「曝光 + 客资(leads)」，不是线上订单/营收**

## 0. PM 三条决策（本计划的边界）

1. **订单/营收 Goal（A2.3）降级**：CTS/Oztop 短期不搬线上交易，`orders_count`/`monthly_revenue` 是错配指标 → A2.3 不优先
2. **能 PM 手动连的先手动连**：不为「配一下就好」的事写代码
3. 魏征审完才定开发计划

---

## 1. 真实数据现状（DB 实测 2026-06-04）

### 1.1 曝光数据底座 — ✅ 已齐全且每天更新

| 指标 | CTS | Oztop | metric_key | 采集 |
|------|-----|-------|-----------|------|
| GSC 曝光 impressions | 48,256 | 7,006 | seo.gsc.impressions | ✅ daily cron |
| GSC 点击 clicks | 616 | 155 | seo.gsc.clicks | ✅ daily |
| GSC 平均排名 | 14.8 | 18.7 | seo.gsc.avg_position | ✅ daily |
| GA4 sessions | 525 | 384 | seo.ga4.sessions | ✅ daily 3am |
| GA4 users | 397 | 277 | seo.ga4.users | ✅ daily |

→ **曝光这条线 ME 已经天天在采，数据新鲜。**

### 1.2 客资(leads) — ❌ 完全空

- flywheel_metrics 里**没有任何 conversions / leads / form 指标**
- auto-fetch.ts **已支持** `form_submissions` / `leads_count`（读 GA4 conversions = key events）
- 缺口：CTS/Oztop 的 GA4 **没标记 form_submit/generate_lead 为 key event**，所以 GA4 conversions 采不到 → 飞轮无客资数据
- SOP 已存在：`docs/sops/ga4-lead-gen-key-event-setup.md`

### 1.3 AI 可见度 — ⚠️ CTS 旧、Oztop 空

| | CTS | Oztop |
|--|-----|-------|
| geo.query.mention_rate | 0.3（停在 2026-05-18） | ❌ 无 |
| ai_visibility_runs | 1452 | 20 |
| active GEO directive | ✅ v4（05-05） | ✅（05-25） |
| ai_visibility_score auto-fetch | ✅ A2.1-γ 刚上线 | ✅ |

→ 功能就绪，但**没有 daily cron 持续刷新**，数据老化。

### 1.4 关键词排名 — ⚠️ CTS 停更、Oztop 全空

| | CTS | Oztop |
|--|-----|-------|
| serp_rankings | 10（停在 2026-05-01） | ❌ 0 |
| keyword_snapshots | 3（06-04） | ❌ 0 |
| primary_keywords 配置 | 0 个 | ✅ 5 个 |

→ Oztop 配了关键词却 0 排名数据。**无自动 cron**，靠手动触发。

### 1.5 Goal 现状 — 指标全错配

| 客户 | Goal | metric_key | current_value | 问题 |
|------|------|-----------|--------------|------|
| CTS | 新西兰曝光 | brand_search_volume | null | ✅指标对，但 draft 状态没触发 |
| CTS | ME营销Wave1 | orders_count | null | ❌错配（A2.3降级） |
| Oztop | 电商获客5w | monthly_revenue | null | ❌错配（A2.3降级） |
| Oztop | Walnut库存 | inventory_units_remaining | null | ✋天生手填+已archived |

→ **6 个 Goal 没一个用上曝光/客资指标**，全是错配或占位。

---

## 2. PM 手动清单（零开发 — 你先做掉）

| # | 动作 | 客户 | 为什么零开发 | 预期效果 |
|---|------|------|------------|---------|
| M1 | CTS「新西兰曝光」Goal 改 draft→active | CTS | auto-fetch 只处理 active goal | brand_search_volume 自动填上（~166） |
| M2 | 给 CTS/Oztop 各建 1 个曝光 Goal，指标选 `organic_traffic` 或 `ai_visibility_score` | 两家 | 这些 metric_key auto-fetch 已支持 | Goal 进度自动读 GSC/GA4 |
| M3 | 给 CTS/Oztop 各建 1 个客资 Goal，指标选 `leads_count` | 两家 | auto-fetch 已支持，hybrid | 配合 M4 后能读 |
| M4 | CTS/Oztop GA4 标记 form_submit/generate_lead 为 key event | 两家 | SOP 已有，纯 GA4 后台操作 | 客资数据流进 ME |
| M5 | CTS 连 GBP（口碑数据源） | CTS | Oztop 已连，纯 connector 授权 | CTS 口碑变真实数据 |
| M6 | CTS 配 primary_keywords（现在 0 个） | CTS | 纯 Settings UI 填 | 为关键词排名追踪铺路 |

> M1/M2/M3 依赖 auto-fetch 的 cron 真在跑 — **开发侧 D0 先核实 cron 状态**（见下）

---

## 3. 开发计划草案（真需要写代码的）

> 排序原则：贴「曝光+客资」真实 KPI × 修复成本低 × 两家都受益

### D0（前置核实，0.5h，不算开发）
确认 A2 的 auto-fetch **到底有没有 cron 在定时跑**，还是只在打开 Goal 页时按需 fetch。
- 若有 cron：M1 改 active 后会自动填 → PM 手动清单成立
- 若无 cron / 按需：要确认 CurrentValueCell 是否前端实时 fetch（A2.1 是前端 fetch）
- **产出**：一句话结论，决定 M1-M3 是否真的零开发

### D1 🔴 关键词排名 daily cron（最贴 Oztop SEO 真实场景）
- **问题**：Oztop 做 SEO 却 0 排名数据；CTS 停在 05-01
- **方案**：复用现有 DataForSEO + `keyword-snapshots.ts` + 各客户 primary_keywords，加一个 daily/weekly cron 自动抓排名写 serp_rankings + keyword_snapshots
- **依赖**：CTS 需先配 primary_keywords（M6）；Oztop 已有 5 个
- **成本**：~半天（有现成 collector，只缺定时触发）
- **受益**：两家都有排名追踪，SEO 反馈回路闭合

### D2 🟡 AI 可见度 daily cron（曝光第二战场 GEO）
- **问题**：geo.* 数据 CTS 停 5月、Oztop 空；ai_visibility_score 老化
- **方案**：给 AI tracker 加 daily cron 持续刷新 ai_visibility_snapshots + geo.query.* metrics
- **成本**：~半天（tracker 逻辑已有，缺定时）
- **受益**：曝光的 AI 战场数据鲜活，Goal 的 ai_visibility_score 有数

### D3 🟢（待 D0 结论）leads/form 飞轮接入校验
- 若 M4 配好 GA4 key event 后，确认 fetchFormSubmissions 真能读到 conversions 并写飞轮
- 可能纯验证，也可能要补一段 GA4 conversions → flywheel_metrics 的采集（现在飞轮里没有 conversions）
- **成本**：待 D0/M4 后定

---

## 4. 明确不做

- ❌ A2.3 订单/营收数据源（PM 降级）
- ❌ GEO-B+ 任何后续（PM 已叫停）
- ❌ 库存类 Goal（天生手填）

---

## 5. 给魏征的审查问题

1. **方向**：把焦点从「订单/营收」转到「曝光(GSC/GA4/AI)+客资(GA4 conversions)」，对 CTS/Oztop 真实 KPI 是否成立？有没有更该优先的？
2. **D1 关键词 cron**：是不是真有现成 collector 可复用？还是会变成大工程？DataForSEO 调用配额/成本有没有坑？
3. **PM 手动清单可行性**：M1-M6 真的零开发吗？有没有哪条其实需要代码（特别是 M1 改 active 能不能真触发 auto-fetch）？
4. **D0 必要性**：auto-fetch 有没有 cron 这件事，是不是必须先查清才能定 M1-M3？
5. **leads 数据链**：GA4 conversions → 飞轮这条路，现在飞轮里 0 conversions 数据，是「没配 key event」还是「采集代码没接」？D3 会不会其实是个隐藏的中等工程？
6. **遗漏**：有没有哪个「曝光/客资」的真实缺口这份计划漏了？
