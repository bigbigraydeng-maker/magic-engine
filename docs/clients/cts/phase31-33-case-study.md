# CTS Tours NZ — Phase 31/33 策略执行层案例沉淀

**客户**：CTS Tours NZ（China Travel Service，奥克兰）  
**行业**：入境旅游 / 华人旅行社  
**市场**：NZ（semrush_db: au）  
**记录日期**：2026-06-05  
**数据快照**：基于 Supabase production 截至 2026-06-05 晨

---

## 1. 背景

CTS Tours NZ 是 ME 的 Phase 31/33 首个真实试点客户。在此之前，ME 只有诊断维度（6 大分数）和执行看板（action items），但没有「为什么要做这些 action」的战略层连接。Phase 31 引入 Goal→Initiative→Action 三层模型，CTS 是第一个从头到尾走通这条链路的客户。

---

## 2. 诊断基线（2026-05-20 → 2026-06-05）

| 维度 | 2026-05-20 | 2026-06-05 | 变化 |
|------|-----------|-----------|------|
| **整体分** | 39 | 38 | -1 |
| **Reputation** | 44 | 54 | **+10** ✅ |
| **AI Visibility** | 36 | 36 | 持平 |
| **Ads** | 0 | 0 | 无 Meta System User Token |
| **Competitor** | — | 100 | 新上线 |
| SEO | null | null | 未接通 |
| Social | null | null | 未接通 |

**关键发现**：
- Reputation 从 44→54 的提升来自 **A1 公式修复**（RATING 权重 0.60→0.70，MAX_REVIEWS 100→30，GBP 查询从 domain→"name+city+country"）。这是公式校准，不是客户真实行动带来的提升，需在下一次诊断中观察真实改善。
- Ads 维度长期为 0 的根因是 META_SYSTEM_USER_TOKEN 未在 Render 配置，**不是客户广告质量差**。待 PM 操作后会立即有数据。

---

## 3. Goal 战略层（Phase 31/32）

CTS 当前有 **4 个 active Goals**（另有 2 个已归档的草稿）：

### Goal 1：CTS 品牌搜索量提升
- **Metric**：brand_search_volume / Baseline 166 → Target 300（+81%）
- **Period**：2026-06-05 → 2026-09-05（90 天）
- **Measurement**：auto（P31.X.2 已接通 keyword_snapshots）
- **Initiative**：「2027 Silk Road 提前蓄水」— demand_generation / terminal / slow posture
- **假设核心**：Silk Road 2027 是高客单价决策型团，需提前 12 个月建立品类认知，品牌词搜索量是蓄水深度的代理指标

### Goal 2：CTS 自然流量增长
- **Metric**：organic_traffic / Baseline 525 sessions/mo → Target 1,000（+90%）
- **Period**：2026-06-04 → 2026-09-02
- **Measurement**：auto（P31.X.2 已接通 ga4_traffic_snapshots）
- **Initiative**：「SEO + Content — China Visa-Free Travel NZ」— demand_generation / terminal / slow / 预算 20%
- **假设核心**：China visa-free 政策创造新的搜索需求，SEO 内容是基础设施投资，90 天内看排名出现而非直接转化

### Goal 3：CTS AI 可见度提升
- **Metric**：ai_visibility_score / Baseline 0 → Target 30
- **Period**：2026-06-04 → 2026-09-02
- **备注**：无 Initiative，current_value=8（AI Tracker 已有真实数据）

### Goal 4：CTS 2026 Best of China 团报名
- **Metric**：leads_count（客资数）/ Baseline 0 → Target 30
- **Period**：2026-06-04 → 2026-09-02
- **Initiative**：「Facebook + Google Ads — October 2026 Tours」— conversion_optimization / terminal / fast / 预算 70%
- **假设核心**：NZ 50-70 岁退休人群有出行意愿，Visa-free 降低决策门槛，缺的是信任触点与主动引导

---

## 4. 执行层数据（Phase 33 连线后）

**执行看板 action 统计**（截至 2026-06-05）：

| 维度 | pending | in_progress | completed | skipped |
|------|---------|------------|-----------|---------|
| seo | 8 | 6 | 1 | 2 |
| social | 19 | 8 | 0 | 2 |
| ai_visibility | 5 | 1 | 0 | 0 |
| ads | 3 | 2 | 0 | 0 |
| reputation | 2 | 1 | 0 | 0 |
| competitor | 1 | 0 | 0 | 0 |
| **合计** | **38** | **18** | **1** | **4** |

**核心观察**：
1. Social 维度有 29 个 active actions（19 pending + 8 in_progress）但 0 completed——这是执行层最大的待消化池，说明内容制作周期长，FDE 需要专门的 sprint 来推进
2. SEO 有 6 个 in_progress，只有 1 个 completed——与「SEO + Content」Initiative 对齐，正在建设阶段
3. Ads 3 pending + 2 in_progress 全卡在 META_SYSTEM_USER_TOKEN 未配置（PM 待操作）

---

## 5. Phase 31/33 跑通的关键验证

### ✅ 验证成立的设计决策

**1. Goal→Initiative→Action 三层连线可行**
- CTS 的 4 个 Goals 都配了具体 Initiative，每个 Initiative 都有 hypothesis（AI 子牙润色版）
- FDE 在执行看板里能按 Goal 筛选，清楚知道每个 action 服务于哪个目标

**2. Auto-fetch current_value 节省 FDE 时间**
- brand_search_volume（166）和 organic_traffic（525）都通过 P31.X.2 自动从 ME 缓存读取
- FDE 提交 Verdict 时可一键获取，不需要手动查 GA4 后台

**3. 诊断分 → Goal 自动对应**
- CTS reputation 44→54 的修复让 FDE 看到了「平台数据变了，但我做了什么」的归因问题——这正是 Goal 层需要解决的问题：把诊断分变化和具体 Initiative 行动连起来

### ⚠️ 发现的设计缺口

**1. current_value 没有自动定期更新**
- Goal 的 current_value 在创建时设了 baseline，之后没有自动刷新机制
- FDE 手动更新，或者 Verdict 时一次性读
- **下一步**：Phase 22.A.2 GA4 每日采集后，可以写 cron 自动更新 organic_traffic 类 Goal 的 current_value

**2. ai_visibility_score Goal 没有 Initiative**
- CTS AI 可见度 Goal（0→30）目前没有配 Initiative，只有一个裸指标
- 说明 FDE 还在想「用什么行动来提升 AI 可见度」——这是战略参谋功能的机会点

**3. Ads Goal 被硬件堵塞**
- Meta Token 未配导致整个 Ads 维度 frozen，4 个 ads actions 全是 in_progress 状态但无法推进
- **教训**：技术先决条件（API token）应在 Goal 创建前就确认，否则 Initiative 假设无法验证

---

## 6. 可复用的 FDE 操作流程

以下是 CTS 案例中跑通的标准流程，可作为新客户 SOP：

```
1. 诊断 → 识别 2-3 个最弱维度（CTS: reputation + ai_visibility + ads）
2. 为每个机会设 Goal（SMART：有数字 baseline/target，有 90 天 period）
3. 每个 Goal 配 1-2 个 Initiative（terminal tier 优先，每个有 hypothesis）
4. 把现有 execution_items 通过 Backlog Migrator 迁移到对应 Initiative
5. 在执行看板按 Goal 筛选，专注单一目标的 action 清单
6. 90 天后用「Submit Verdict」+「⚡ 自动获取」提交结果
```

---

## 7. 数字备忘（供下次 Verdict 用）

| Goal | Baseline | Target | 自动获取来源 |
|------|---------|--------|------------|
| 品牌搜索量 | 166 searches/mo | 300 | keyword_snapshots (P31.X.2 ✅) |
| 自然流量 | 525 sessions/mo | 1,000 | ga4_traffic_snapshots (P31.X.2 ✅) |
| AI 可见度 | 0 | 30 | 待接通 |
| 团报名客资 | 0 | 30 | 手动（leads 系统未接入） |

**Verdict 日期**：2026-09-02 至 2026-09-05（3 个 Goals 同期到期）
