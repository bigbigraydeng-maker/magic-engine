# Oztop Building Supplies — Phase 31/33 策略执行层案例沉淀

**客户**：Oztop Building Supplies（Brisbane，AU）  
**行业**：建材 / SPC 地板 / 电商  
**市场**：AU（semrush_db: au）  
**记录日期**：2026-06-05  
**数据快照**：基于 Supabase production 截至 2026-06-05 晨

---

## 1. 背景

Oztop 是 ME 第二个 Phase 31/33 试点客户，与 CTS 并行推进。与 CTS（旅游/服务业）不同，Oztop 是电商属性更强的建材供应商，核心挑战是**清仓特定 SKU**（Walnut SPC 地板），这决定了 Goal 形态与 CTS 完全不同——不是增长型 Goal，而是**清仓型（target_direction=decrease）Goal**。

---

## 2. 诊断基线

| 维度 | 2026-05-13 | 2026-05-31 | 变化 |
|------|-----------|-----------|------|
| **整体分** | 71 | 19 | **-52** ⚠️ |
| **Reputation** | 71 | 72 | +1（稳定）|
| **AI Visibility** | — | 11 | 新上线 |
| **Ads** | — | 0 | Meta BM 受限 |
| Competitor | — | — | 未跑 |
| SEO | — | — | 未接通 |

**关键发现**：
- 整体分从 71→19 的大幅下滑是**AI Visibility 11 分拉低了平均分**，不是 Reputation 变差。这是新维度上线导致的分数稀释，不代表客户实际状况恶化。
- Oztop Reputation 72 是两个试点客户中最高的，说明其 Google Business Profile 和线上评价状况良好。
- SEO 维度至今未接通——Oztop 是 AU 市场，DataForSEO / SEMrush 覆盖 AU 域名需要确认 API 配置。

---

## 3. Goal 战略层（Phase 31/32）

Oztop 当前有 **4 个 Goals**（1 active + 3 archived）：

### Goal 1（Active）：Oztop Walnut 地板清仓
- **Metric**：monthly_revenue / Baseline 0 → Target 50,000 AUD
- **Period**：2026-06-04 → 2026-08-03（60 天，比标准 90 天更短）
- **Initiative**：「Oztop Walnut SPC 电商清仓推广」— demand_generation / terminal / 1 initiative

### Goal 2（Active）：Brisbane 品牌曝光
- **Metric**：brand_search_volume / Baseline 48 → Target 100（+108%）
- **Period**：2026-06-04 → 2026-09-02
- **备注**：无 Initiative，尚未配战略层

### Goal 3（Active）：Oztop 自然流量增长
- **Metric**：organic_traffic / Baseline 402 → Target 600（+49%）
- **Period**：2026-06-04 → 2026-09-02
- **Measurement**：auto（P31.X.2 已接通 ga4_traffic_snapshots）
- **Initiative**：1 个（待确认类型）

### Goal 4（Active）：Oztop AI 可见度提升
- **Metric**：ai_visibility_score / Baseline 0 → Target 30
- **Period**：2026-06-05 → 2026-09-05
- **备注**：无 Initiative

### 已归档 Goals
- **OZTop 电商获客销售月 5w AUD**（archived，无 verdict）— 早期版本，被新的清仓 Goal 替代
- **Oztop Walnut 地板库存 500→0 件**（archived，**verdict=partial**）— Phase 32 清仓型 Goal 首次尝试，target_direction=decrease，结果是 partial（50-80% 进度）

---

## 4. 清仓型 Goal：最重要的经验

**Oztop 是 ME 第一个验证清仓型（decrease）Goal 的客户。**

Phase 32 引入 `target_direction=decrease` 后，Verdict 公式为：
```
progress = (baseline - current) / (baseline - target)
confirmed ≥ 80% / partial 50-80% / reversed <50%
```

「Walnut 库存 500→0」的 verdict=**partial**，说明：
1. 公式本身运作正确，能正确计算清仓进度
2. 60-90 天内将 500 件 SPC 地板清零是**激进目标**，partial 是合理结果
3. **下次设 Goal 时建议**：清仓类 Goal 设更保守的 target（如 500→200），或拆分为多个 sprint

---

## 5. 执行层数据

**执行看板 action 统计**（截至 2026-06-05）：

| 维度 | pending | in_progress | completed | 合计 |
|------|---------|------------|-----------|------|
| seo | 8 | 2 | **17** | 27 |
| social | 50 | 3 | 0 | 53 |
| ai_visibility | 3 | 1 | 0 | 4 |
| ads | 1 | 2 | 0 | 3 |
| reputation | 2 | 3 | 0 | 5 |
| **合计** | **64** | **11** | **17** | **92** |

**核心观察**：
1. **SEO 完成率最高（17/27 = 63%）**——Oztop 是两个客户中 SEO 执行最扎实的，FDE 在这个维度最活跃
2. **Social 积压严重（53 个 actions，0 completed）**——与 CTS 相同的问题，社媒内容制作是整个执行层的最大瓶颈
3. Oztop 的总 action 数量（92 个）比 CTS（61 个）多 50%，说明诊断生成的 action 量与客户业务复杂度基本匹配

---

## 6. Phase 31/33 在 Oztop 身上验证的设计

### ✅ 验证成立

**1. 电商清仓场景完整跑通**
- 从 Phase 32 清仓 sub_type → target_direction=decrease → Verdict partial 的完整链路，Oztop 是第一个走完的客户

**2. SEO 执行高完成率证明平台可用**
- 17 个 SEO actions completed 说明 FDE 能在 ME 内实际完成工作，不只是登记

**3. Auto-fetch organic_traffic 可用**
- Oztop baseline 402 sessions/mo 通过 P31.X.2 自动读取，验证了 GA4 快照连通

### ⚠️ 发现的设计缺口

**1. Social action 积压是系统性问题**
- 50+ social actions pending，FDE 看到长长的列表会产生「无从下手」的感觉
- **建议**：在执行看板为 social 维度加「本周焦点」标记，或按 campaign 分批显示

**2. 多个 Goal 无 Initiative**
- Brisbane 品牌曝光、AI 可见度提升两个 Goals 没有 Initiative
- 说明 FDE 设了指标但还没想清楚「用什么行动来达成」
- **ME 可以做的**：在 Goal 详情页加「子牙建议 Initiative」功能（调用 Sonnet 根据 Goal 类型生成 2-3 个 Initiative 草稿）

**3. 清仓 Goal 的 metric 选择有争议**
- 「Walnut 地板库存 500→0」用 inventory_units_remaining（decrease），而「Walnut 地板清仓」用 monthly_revenue（increase）——同一个清仓场景，两个 Goals 用了不同的衡量维度
- **建议**：为清仓类 Goal 提供标准模板，固定用 inventory_units_remaining 或 revenue，避免混用

---

## 7. 数字备忘（供下次 Verdict 用）

| Goal | Baseline | Target | 到期日 | 自动获取 |
|------|---------|--------|--------|---------|
| Walnut 清仓（月营收） | 0 AUD | 50,000 AUD | 2026-08-03 | 手动 |
| Brisbane 品牌搜索量 | 48 | 100 | 2026-09-02 | keyword_snapshots ✅ |
| 自然流量 | 402 | 600 | 2026-09-02 | ga4_traffic_snapshots ✅ |
| AI 可见度 | 0 | 30 | 2026-09-05 | 待接通 |

**最近到期**：Walnut 清仓 Goal 2026-08-03（只剩约 60 天）——需要 FDE 每 2 周检查进度

---

## 8. Oztop vs CTS 横向对比

| 指标 | CTS Tours NZ | Oztop |
|------|-------------|-------|
| 行业 | 旅游/服务 | 建材/电商 |
| Goal 形态 | 增长型（awareness+acquisition） | 增长型 + **清仓型（decrease）** |
| 执行完成率 | SEO 1/17（6%） | SEO 17/27（**63%**）|
| Social 积压 | 29 actions | **53 actions** |
| 最大瓶颈 | Ads Token 未配 | Social 积压 |
| Reputation 分 | 54 | **72** |
| AI Visibility 分 | 36 | 11 |
