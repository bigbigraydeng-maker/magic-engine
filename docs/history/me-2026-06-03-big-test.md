# ME 大测试 — 2026-06-03

> 一次性把今天的新功能跑完。**生产环境**：https://app.magicengine.com.au
> 测试客户：**CTS Tours NZ** (`c0000000-0000-0000-0000-000000000000`)
> Active Goal：**CTS ME营销Wave 1** (`81052933-b475-4810-99a7-ffaff972ea4a`)

---

## 数据基线（Supabase 实测 2026-06-03 15:30 NZST）

测试时所有数字必须跟下面对得上 — 对不上立刻反馈：

| 指标 | 期望值 | 用于验证哪项 |
|------|--------|--------------|
| 整体执行进度分母 | **73** = 54 execution_items + 19 flywheel 自主行动 | Kanban 顶部 N/73 |
| pending | **38** （来自 execution_items） | 状态 chip |
| in_progress | **11** （来自 execution_items） | 状态 chip |
| completed | **20** = 1 execution_items.completed + 19 flywheel 自主行动（全已执行） | 状态 chip |
| skipped | **4** | 不显示在 chips 里（chips 只显示 pending/in_progress/completed） |
| Filter 应用后 actions | **2** | P33.9 关键数字 |
| 未归类 Actions（unassigned placeholder 绑定）| **52** | P33.10 关键数字 |
| Goal 下 active Initiative 数 | **2** | M4 卡片顶部「Initiatives」 |
| - Initiative A：Facebook + Google Ads — October 2026 Tours | total 2, pending 2 | 关联 1 个 Campaign |
| - Initiative B：SEO + Content — China Visa-Free Travel NZ | total 0 | 关联 0 个 Campaign |

---

## Part 1 — Phase 33 P33.9 / P33.10：Kanban Goal Filter
> PR #301 + #302 | merged 2026-06-03

**入口**：CTS Tours NZ 客户页 → 顶部「执行追踪」步骤 → 进入执行看板

### ✅ 检查清单

- [ ] **1.1** 不点任何 filter 时，看顶部状态 chips：`待处理 38` / `进行中 11` / `已完成 20`（已完成含 19 个飞轮自主行动）
  - 失败模式：数字对不上 → 数据飞了，截图给我反查
  - 失败模式：chips 不存在 → 部署没上线

- [ ] **1.2** 顶部「按 Goal」filter 出现（仅当有 active Goal 时显示）
  - 应有下拉框，选项含「CTS ME营销Wave 1」
  - 失败模式：filter 不出现 → goalsForFilter 数据没传到 UI

- [ ] **1.3** 点选「CTS ME营销Wave 1」filter ⭐ **P33.9 核心**
  - chips 数字立刻变为：`待处理 2` / `进行中 0` / `已完成 0`
  - **如果还显示 38/11/1 → P33.9 修复没生效，立刻反馈**

- [ ] **1.4** filter 状态下，看分组区是否有「📥 未归类 Actions」分组 ⭐ **P33.10 核心**
  - 该分组**包含约 52 条 actions**
  - **如果分组不出现 → P33.10 修复没生效，立刻反馈**

- [ ] **1.5** 取消 Goal filter
  - chips 回到 `38/11/1`
  - 未归类分组消失（或不再独立显示）

- [ ] **1.6（可选回归）** 在未归类分组里点其中一条 action，触发 bulk-migrate 到「Facebook + Google Ads — October 2026 Tours」Initiative
  - 该 action 从未归类分组消失
  - Kanban 重新载入后该 action 出现在对应 Initiative 区

---

## Part 2 — Phase 33 M4：Goal 详情页执行摘要
> PR #304 | merged 2026-06-03

**入口**：从客户页或 Kanban 跳到 `/dashboard/clients/c0000000-0000-0000-0000-000000000000/goal/81052933-b475-4810-99a7-ffaff972ea4a`

### ✅ 检查清单

- [ ] **2.1** Verdict Panel 下方出现「Execution Progress」卡片
  - 卡片有 `Phase 33 M4` 标签徽章
  - 失败模式：卡片不出现 → M4 没部署或 import 报错

- [ ] **2.2** 卡片顶部 4-stat 数字对得上：
  - Initiatives：**2**
  - Campaigns：**1**
  - Actions Done：**0**
  - In Progress：**0**

- [ ] **2.3** 卡片底部「Action completion」进度条
  - 显示文字：`0 / 2`（denom = total 2 − skipped 0）
  - 进度条 0%
  - 子文字含 `completed / (total − skipped)` 标注

- [ ] **2.4** 滚到 Initiatives 区，展开「Facebook + Google Ads — October 2026 Tours」⭐ **M4 / P33.11 核心**
  - 展开后右上角出现 chip：`0 / 2 actions done` + `0%` 黄色徽章
  - **「关联执行」区**显示 1 个 Campaign 标题
  - Campaign 标题前有小圆点（颜色 = 状态：active 绿色 / paused 黄色 / draft 灰色）
  - Campaign 状态名（如 `Active`）显示在标题右边

- [ ] **2.5** 展开「SEO + Content — China Visa-Free Travel NZ」
  - **不显示完成率 chip**（因为 totalActions = 0，按设计隐藏）
  - 「关联执行」区显示「暂无关联 Campaign」

- [ ] **2.6（边界回归）** 在某 Initiative 卡里点「+ 关联 Campaign」
  - 下拉框只列 **active 状态**的 Campaign（paused 不在候选里）
  - 已关联的不在下拉里

- [ ] **2.7（数据刷新）** 关联一个新 Campaign 或解除一个 → 顶部 Execution Progress 卡片**自动刷新**
  - Campaigns 数字应即时变化（refreshKey wiring 起作用）

---

## Part 3 — 诸葛亮全局工作台 FAB

**入口**：任意 Client 子页面（概览 / 执行 / Goal 详情 / 诊断都行）

### ✅ 检查清单

- [ ] **3.1** 右下角浮动按钮「诸 工作台」可见

- [ ] **3.2** 鼠标悬停按钮（不点击），quick-link chips 从下往上 fan-out 出现
  - 应有 6 个 chips：概览 / 执行看板 / Launch Hub / 诊断 / 内容策略 / AI 可见度
  - chips 错峰动画（35ms 间隔）

- [ ] **3.3** ⭐ 鼠标从按钮**连续移动**到任一 chip，再点击 → chip 不消失，可成功跳转
  - **这是上次发现 bug 的关键场景，必须真人测**
  - 失败模式：鼠标从按钮往上移时 fan 消失 → hover gap 又回来了

- [ ] **3.4** 点开按钮（不是 hover），打开完整工作台 panel
  - **第一个区块是「快捷切换」**（已提到最顶部）
  - 下面依次是：当前工作线程 / 待处理摘要 / 下一步建议 / 最近线程

- [ ] **3.5** 在 Goal 详情页点 Initiative 卡片打开 Edit drawer
  - drawer 弹出后，FAB **被遮罩自动盖住**（z-index 测试）
  - drawer 的 Save/Cancel 按钮可正常点击，不被 FAB 挡

---

## Part 4 — A1 reputation 公式（顺便验证已上线效果）
> PR #298 + #300 | merged 2026-06-03 上午

**入口**：CTS Tours NZ → 华佗诊断 → 看 reputation 维度评分

### ✅ 检查清单

- [ ] **4.1** reputation 评分应该在 **70 左右**（旧版只有 44）
  - 失败模式：如果还是 44 → 诊断没重跑或缓存
  - 解决：手动跑一次 reputation collector / clear cache

- [ ] **4.2** GBP 查询返回正确商家
  - 看 reputation 数据源里展示的商家名 + 地址，应是真正的 "CTS Tours" 在 Auckland，不是某个同名错配的商家

---

## 测试报告格式（跑完贴这）

```
Part 1 — Kanban filter:
  1.1 ✅/❌  实际数字: ___/___/___
  1.2 ✅/❌  filter 是否出现: ___
  1.3 ✅/❌  filter 后数字: ___/___/___
  1.4 ✅/❌  未归类分组实际条数: ___
  1.5 ✅/❌
  1.6 ⏭️/✅/❌

Part 2 — Goal 详情页:
  2.1 ✅/❌
  2.2 ✅/❌  实际 4-stat: ___/___/___/___
  2.3 ✅/❌
  2.4 ✅/❌  Campaign 状态点颜色: ___
  2.5 ✅/❌
  2.6 ⏭️/✅/❌
  2.7 ⏭️/✅/❌

Part 3 — 诸葛亮 FAB:
  3.1 ✅/❌
  3.2 ✅/❌  chips 数: ___
  3.3 ✅/❌  ← 关键
  3.4 ✅/❌
  3.5 ✅/❌

Part 4 — A1 reputation:
  4.1 ✅/❌  实际分数: ___
  4.2 ✅/❌
```

---

## 失败时怎么办

1. **数字对不上**：截图 + 截 SQL 实测结果给我对比
2. **UI 元素不出现**：F12 → Console 看 error；F12 → Network 看 API 调用
3. **Hover 失败**：录屏（最好 GIF），让我看 hover 流转的具体卡点
4. **整页 500**：截 URL + Render Events 截图，可能是部署回滚或环境变量错

跑完汇总告诉我，我把对应的「🧪 测试待跑」从焦点表移到「✅ 已完成全景」。

---

## 🔧 测试中发现的 4 项修复（已写代码，待部署）

| # | 问题 | 修复 |
|---|------|------|
| **1.1 clip 数字口径** | 测试清单期望 1，实际 20（19 个飞轮自主行动算 completed） | 已修正期望值 → **20**（不是 bug） |
| **1.6 BacklogMigrator 看不到** | 默认 `count === null`，section 看起来空白 | useEffect mount 时自动 loadOnce()，进入页面就显示 backlog 数字 |
| **2.1 "Phase 33 M4" 标签像内部代号** | ExecutionSummaryBar 顶部徽章是开发标识 | 删掉标签，标题改成「执行进度 · Execution Progress」 |
| **2.7 unlink × 按钮难看到** | text-[10px] 灰色无 border 容易忽略 | 改成 6×6 白底圆角按钮 + 红色 hover + tooltip |
| **4 A1 reputation 还是 44** | 上次诊断是 2026-05-29 (A1 修复前)，PM 没点「运行新诊断」 | 诊断页面顶部 ≥3 天未跑显示「⚠️ N 天未重跑」黄色提示 |

跑这些修复需要 commit + push + 等 Render 部署（约 5 分钟）。
