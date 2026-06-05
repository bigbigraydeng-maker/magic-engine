# Phase 31/33 策略执行层 — 上线经验总结

**覆盖客户**：CTS Tours NZ + Oztop Building Supplies  
**覆盖 Phase**：Phase 31（Strategy Layer）+ Phase 32（Goal Sub-types）+ Phase 33（Strategy-Execution Bridge）+ P31.X.2（Auto-fetch）  
**写作日期**：2026-06-05  
**用途**：新客户 onboarding SOP + 未来功能迭代参考

---

## 1. 什么跑通了

### 1.1 Goal→Initiative→Action 三层模型可用
两个客户都完整建立了三层结构：
- CTS：4 Goals × 3 Initiatives（部分 Goal 尚无 Initiative）
- Oztop：4 Goals × 2 Initiatives

FDE 反馈：在执行看板按 Goal 筛选后，能清楚知道自己在做的事服务于哪个 90 天目标。

### 1.2 清仓型 Goal（Phase 32）首次验证
Oztop「Walnut 库存 500→0」走完了完整生命周期：
- 设 Goal（target_direction=decrease）→ 配 Initiative → 执行 → Submit Verdict → verdict=partial
- 公式运作正确，partial 结果符合预期（60 天清 500 件是激进目标）

### 1.3 Auto-fetch current_value（P31.X.2）节省 FDE 操作
两个 `measurement=auto` 指标（organic_traffic + brand_search_volume）通过 P31.X.2 直接从 ME 缓存读取，FDE 提交 Verdict 时不需要离开平台查数据。

### 1.4 执行看板 Phase 33 连线生效
- Initiative 卡片展开后显示关联 Campaign + action 完成率
- Unassigned Actions 分组让 FDE 看到「还没归类」的 action 池
- Goal filter 让 chips 数字跟随变化（P33.9 修复后）

---

## 2. 什么还没跑通（已知缺口）

| 缺口 | 影响 | 下一步 |
|------|------|--------|
| Social action 大量积压（CTS 29 个，Oztop 53 个），完成率 0% | FDE 看到长列表不知从何下手 | 加「本周焦点」标记 / 按 campaign 分批 |
| Meta System User Token 未配，Ads 维度完全 frozen | CTS 3 个 Ads actions 无法推进 | **PM 操作**：Render 设 `META_SYSTEM_USER_TOKEN` |
| 多个 Goal 没有 Initiative | 指标有，行动没有，Goal 失去战略价值 | 加「子牙建议 Initiative」草稿功能 |
| current_value 无自动定期刷新 | Verdict 前才更新，中间进度不可见 | Phase 22.A.2 GA4 每日采集 + cron 自动更新 |
| ai_visibility_score 没有 auto-fetch 路径 | FDE 需手动填 AI 可见度分 | ai_visibility_snapshots 建立 0-100 分计算列 |

---

## 3. 对新客户 Onboarding 的 SOP 建议

基于两个试点客户的经验，建议新客户首次接入 ME 的标准流程：

### 阶段 0：先决条件确认（Day 1）
```
□ GA4 connector 已连接（property_id 在 connectors 表）
□ Google OAuth token 有 analytics.readonly scope
□ Meta System User Token 已在 Render 配置（如有 Ads）
□ GBP 已认领（如需 Reputation 追踪）
□ primary_keywords 已填写（用于 brand_search_volume auto-fetch）
```

### 阶段 1：跑诊断（Day 1-2）
```
□ 跑 full 诊断（6 个维度）
□ 记录各维度基线分数
□ 识别 2-3 个最弱维度
```

### 阶段 2：设 Goals（Day 2-3）
```
□ 每个弱维度设 1 个 Goal（不超过 4 个并行 Goal）
□ 每个 Goal 确认 measurement 类型（auto/self_report）
□ 设合理 baseline（从诊断/GA4/keyword_snapshots 取真实数字）
□ 不要设激进 target（第一个 90 天重在「跑通流程」而非「达成目标」）
```

### 阶段 3：配 Initiatives（Day 3-5）
```
□ 每个 active Goal 配 1-2 个 Initiative
□ terminal tier 优先（直接推动目标达成）
□ 调用子牙润色 hypothesis（提高战略可读性）
□ 关联已有 Campaign（如有）
```

### 阶段 4：迁移 Actions（Day 5）
```
□ 使用 Backlog Migrator 将历史 execution_items 归类到 Initiative
□ 确认没有大量 unassigned actions 堆积
□ 在执行看板按 Goal 筛选验证 action 正确归类
```

### 阶段 5：执行周期（Week 1-12）
```
□ 每周 FDE review：按 Goal 筛选，处理 in_progress actions
□ 每 2 周检查 current_value（尤其是有截止日期的清仓型 Goal）
□ 90 天 Verdict：用「⚡ 自动获取」预填 + Submit Verdict
```

---

## 4. Goal 设计反模式（避免）

### ❌ 反模式 1：没有 Initiative 的 Goal
- **问题**：Goal 有指标，没有行动，等于只设了 KPI 没有计划
- **识别**：Goal 详情页 Initiative 列表为空
- **修正**：Goal 创建后 24 小时内必须配至少 1 个 Initiative

### ❌ 反模式 2：激进的清仓型 Target
- **问题**：Oztop「库存 500→0」，60 天 100% 清仓，实际结果 partial
- **修正**：清仓类 Goal 设 60-70% 为 Target（500→150），留 headroom

### ❌ 反模式 3：同一客户多个指标重复的 Goal
- **问题**：两个「Walnut 清仓」Goal（一个用 inventory，一个用 monthly_revenue）让 FDE 混淆
- **修正**：同类 Goal 只留一个，archive 或合并其余

### ❌ 反模式 4：在先决条件未就绪时设 Goal
- **问题**：CTS Ads Goal 设了，但 Meta Token 没配，Initiative 无法推进
- **修正**：Ads 类 Goal 创建前先确认 Token 已在 Render 配置

---

## 5. 平台数字概览（2026-06-05 快照）

| 客户 | active Goals | 总 Initiatives | 总 Actions | SEO 完成率 |
|------|-------------|--------------|-----------|----------|
| CTS Tours NZ | 4 | 3 | 61 | 6% (1/17) |
| Oztop | 4 | 2 | 92 | 63% (17/27) |

**两客户合计**：8 active Goals，5 Initiatives，153 execution actions

---

## 6. 下一步优先迭代方向

按影响力排序：

1. **Social action 批处理 UI**（高影响，两客户共 82 个 social pending actions）
2. **Goal current_value 自动刷新 cron**（中影响，依赖 Phase 22.A.2 GA4 每日采集）
3. **「子牙建议 Initiative」功能**（中影响，降低 FDE 设计 Initiative 门槛）
4. **ai_visibility_score auto-fetch**（中影响，依赖 ai_visibility_snapshots 增加分数列）
5. **清仓 Goal 标准模板**（低影响，主要是文档/UX 优化）
