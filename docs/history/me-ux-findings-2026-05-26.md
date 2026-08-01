# ME UX & 功能优化发现 — 2026-05-26 全流程复盘

> **来源**：2026-05-26 PM 全天 session（Oztop 手动发布 Pet Flooring 博客 + 配置 Elegant Walnut 清仓 Campaign + 生成 Wave 1 Marketing Plan）
> **目的**：从真实使用流程倒推 ME 功能缺口和 UX 摩擦点
> **方法**：按用户旅程顺序，记录每一个"卡了一下"或"做了重复劳动"的瞬间

---

## 总览：今天发现 26 个改进点

按严重程度分级：
- 🔴 **P0 阻塞型**（5 个）：FDE 完全无法用 ME 完成动作，必须 ME 工程修复
- 🟡 **P1 摩擦型**（12 个）：可以绕过但效率打折，每次都消耗 FDE 时间
- 🟢 **P2 体验型**（9 个）：影响产品感受，但不影响交付

---

## A. Master Brief（MB）录入优化点

### A1 🟡 缺产品矩阵字段 ★★★

**现状**：MB 只有品牌描述、品牌声音、目标受众、痛点。**没有产品矩阵字段**。

**问题表现**：Oztop 的 MB 没有写明 "SPC 占 80% 营收 / Engineered Timber 是高利润小众 / Laminate 在淘汰中"。结果今天生成博客和 social tasks 时，AI 不知道哪些产品是核心、哪些是补充。

**建议新增字段**：
```
产品矩阵（Product Portfolio）
  ├─ 产品名（如 "SPC Hybrid Flooring"）
  ├─ 营收占比（80%）
  ├─ 战略角色（hero / high-margin niche / phased-out / new launch）
  ├─ 主要使用场景（pet / kitchen / DIY ...）
  ├─ 价格区间
  └─ 内部代号（自有品牌名，如 "Bigpanda Flooring"）
```

**预期收益**：博客自动按"hero 产品优先"策略选题，social tasks 自动按产品营收占比分配频次。

---

### A2 🟡 缺 USP / Business Advantages 字段 ★★

**现状**：MB 没有"为什么客户选你"的结构化字段。

**问题表现**：Oztop docx 里明确写了 5 个 USP（持牌公司、90% 当天响应、两周内安装、100% 售后处理、自有品牌库存），但 MB 没填写。AI 生成的内容文字泛泛，没体现这些信任锚点。

**建议新增字段**：
```
Unique Selling Points（结构化，5-10 条）
  ├─ 类别（licensing / response_time / inventory / quality / aftercare）
  ├─ 数字化承诺（"90% same-day response"，"100% after-sales resolution"）
  └─ 在生成内容时的使用方式（信任段落 / CTA 旁注 / 产品页内链）
```

**预期收益**：每篇博客和社媒帖子可以自动嵌入对应 USP 作为信任元素，转化率预计 +15-25%。

---

### A3 🟡 缺地理服务范围字段 ★★

**现状**：MB 只有 "Brisbane, Australia"（city 级），没有服务半径。

**问题表现**：Oztop 服务范围是"半径 100km 内含 Brisbane + Gold Coast"，但 MB 只显示 Brisbane。生成的 social tasks 默认只针对 Brisbane，**Gold Coast 受众覆盖被遗漏**。

**建议新增字段**：
```
Service Geography
  ├─ Primary location（Brisbane）
  ├─ Service radius（km）或 secondary locations 数组（["Gold Coast", "Ipswich"]）
  └─ AU/NZ 市场标记
```

**预期收益**：自动生成的地域定向内容（如"Gold Coast 户主"专属帖）就不会缺失。

---

### A4 🟡 缺现有内容库存盘点 ★★

**现状**：MB 不知道客户网站已有多少篇博客、什么主题。

**问题表现**：Oztop 已有 23 篇博客，但 ME 不知道。新生成博客时**可能选已经写过的主题**，造成重复。今天 Pet Flooring 文章发布前没人提醒"网站已经有这类主题"。

**建议新增字段**：
```
Existing Content Inventory（与 Phase 14.F Site Knowledge Graph 同步）
  ├─ 已发布博客 URL 列表
  ├─ 每篇博客的主关键词（如已知）
  └─ 内部链接图谱（哪些产品页缺内链）
```

**预期收益**：避免重复选题 + 自动建议内链锚点。

---

### A5 🟡 缺自有品牌（Owned Brand）字段 ★★

**现状**：MB 没有专门字段标注"客户拥有的自有品牌"。

**问题表现**：Oztop 拥有 Bigpanda Flooring 自有品牌，是核心商业优势。AI 生成的产品文案应该多用 Bigpanda 这个品牌名，但因为 MB 没单独标注，AI 生成内容里**几乎没出现 Bigpanda**。

**建议新增字段**：
```
Owned Brands
  ├─ Brand name（"Bigpanda Flooring"）
  ├─ 关联产品类别
  └─ 在文案中的使用频率（每篇内容至少提 N 次）
```

---

### A6 🟢 缺销售漏斗信息

**现状**：MB 没有"客户主要从哪个渠道询盘 / 哪种 CTA 转化率高"的字段。

**问题表现**：Oztop 的核心 CTA 是 "Book Free Measure"，但 MB 没强调，导致 AI 生成的 social tasks 里 CTA 形式杂乱（call / email / book / link in bio 全都有）。

**建议新增字段**：
```
Sales Motion
  ├─ Primary CTA（"Book Free Measure"）
  ├─ Secondary CTA（"Call 07 3416 6458"）
  ├─ Conversion funnel stages
  └─ Average response time SLA
```

---

## B. Campaign 配置优化点

### B1 🔴 Visual Direction 是死端输入（MP-GEN-4）

**现状**：UI 让 FDE 填 vi_mood / vi_color_accent 等字段，甚至有 AI Generate 按钮自动起草。**但这些字段从未进入 Marketing Plan 生成的 prompt**。

**今天的实际成本**：
- 用户填了 4 个 Visual Direction 字段 + 上传 1 个参考文件 = ~10 分钟
- 这些信息**完全没影响**生成的 30 个 social tasks 的视觉描述
- 用户信任度受损（"我填了为什么没用？"）

**修复优先级**：🔴 P0 — 必须立即修

**已登记**：ROADMAP `MP-GEN-4`

---

### B2 🔴 Source URLs（落地页）也未注入 prompt（MP-GEN-5）

**现状**：Campaign 让 FDE 填 4 个落地页 URL（产品分类 / 产品页等）。**这些 URL 也没进入 prompt**。

**今天的实际成本**：
- 生成的 social tasks 提到产品但不知道 URL
- FDE 需要手动加 link in bio 链接
- 与 Phase 14.F Site Knowledge Graph 协同时无数据基础

**已登记**：ROADMAP `MP-GEN-5`

---

### B3 🟡 关键词拉取失败后无手动覆盖入口

**现状**：Campaign 关键词靠"拉取"按钮自动从 Master Brief 种子词调用 Keyword Intelligence。今天 Oztop 拉到 0 个关键词（因为种子词与 Walnut 清仓不匹配）。**UI 里没有手动添加关键词的入口**。

**今天的实际成本**：
- FDE 看到 "0 个关键词" 不知道怎么办
- 只能跳过这一步，Marketing Plan 生成时没有 campaign 关键词上下文

**修复建议**：
- 在"拉取"按钮旁加"手动添加"输入框
- 拉取失败时给具体原因（种子词不匹配 / API 失败 / 配额耗尽）
- 允许 FDE 手动覆盖种子词后再次拉取

---

### B4 🟡 缺 Campaign 类型分类

**现状**：所有 Campaign 在 ME 里被同等对待。

**问题表现**：清仓 campaign（短期紧迫，5 周）和品牌建设 campaign（长期，3 个月+）应该用完全不同的 prompt 模板和强度基线，但 ME 现在不区分。

**修复建议**：新增 `campaign_type` 字段：`clearance` / `launch` / `sustain` / `seasonal` / `awareness`，generator.ts 根据类型动态调整 prompt baseline。

---

## C. Marketing Plan 生成与配置优化点

### C1 🔴 FDE 关注点（FDE Focus Note）— 用户的核心质疑 ★★★

**今天用户的问题**："marketing plan 这里的 FDE 关注点又应该怎么填写进去？"

**根本问题**：当前的 FDE Focus Note 没有任何引导：
- 文本框为空 + 占位符提示极简（"例：本月重点突破 NZ 退休群体..."）
- 没有 AI Generate 按钮（MP-UX-2）
- 没有模板选择（Launch / Mid-push / Final-close 不同模板）
- 没有"哪些 Campaign 字段已经包含、哪些需要 FDE 补充"的提示
- FDE 容易**重复抄写 Campaign 已有信息**，浪费 token

**用户今天的实际经验**：
- 我帮用户写了 ~200 字 FDE Focus Note
- 内容大量重复 Campaign 已有的：产品名、价格、时间、卖点
- 真正"新增信息"只有：A/B 测试角度 + 平台分配建议 + Wave 1 节奏

**正确的 FDE Focus Note 应该填什么**（建议 UX 引导）：

```
FDE Focus Note 应该只包含 Campaign 之外的「波次/时段独有」信息：

✅ 应该填：
- 波次目标（Launch / Mid-push / Close）
- 波次特殊约束（"只在 Brisbane CBD 投放"、"避开 5/30 公共假期"）
- A/B 测试假设（"测试价格冲击 vs 风格灵感"）
- 平台权重调整（"Instagram 加倍，TikTok 减半"）
- 强制覆盖角度（"必须有 builder 角度内容"）
- 强制避免点（"不要用 holiday 主题"）

❌ 不应该填（这些 Campaign 已有）：
- 产品名 / 价格 / 时间
- 通用卖点 / 受众 / CTA
- 视觉方向（应该填到 Visual Direction）
```

**修复建议**（按优先级）：
1. 🔴 加 AI Generate 按钮（MP-UX-2）— 自动基于 MB + Campaign 起草
2. 🟡 加 placeholder 引导文本，明确"该填什么 / 不该填什么"
3. 🟡 加波次模板下拉（Launch / Mid-push / Final-close）一键填入对应模板
4. 🟢 加"Campaign 已有内容预览"侧栏，让 FDE 一眼看到哪些信息已经被注入

---

### C2 🟡 Marketing Plan 日期不从 Campaign 继承（MP-UX-1）

**今天的实际成本**：
- Marketing Plan 日期默认显示 `2026/05/25 → 2026/06/24`（错的）
- Campaign 实际是 `2026/05/26 → 2026/06/30`
- FDE 需要手动改两次

**已登记**：ROADMAP `MP-UX-1`

---

### C3 🟡 Campaign vs Marketing Plan 入口混淆

**今天的实际成本**：
- 用户在"建 Wave 1"时点错按钮，建了一个 Campaign 而不是 Marketing Plan
- 创建了空 Campaign："Oztop Walnut Clearance · Wave 1 — Launch"
- 需要先识别错误 → 手动删除 → 重新走 Marketing Plan 入口

**问题根源**：两个入口在 UI 上区分度不够。Campaign 是"战略容器"，Marketing Plan 是"战术执行"，但 FDE 看到 "新建 Campaign" 和 "AI 生成新 Plan" 两个按钮时不一定能马上 mapping。

**修复建议**：
- "新建 Campaign" 按钮加副标题："5 周战略容器，包含视觉方向 / 关键词 / 落地页"
- "AI 生成新 Plan" 按钮加副标题："1-2 周执行任务，自动派发到鲁班"
- 客户主页加面包屑导航："Campaign（战略） → Marketing Plan（战术） → Tasks（执行）"

---

### C4 🔴 33 任务预生成模型（MP-ARCH-1）

**已登记**：ROADMAP `MP-ARCH-1`，需要升级为波次模型。

---

### C5 🟡 缺生成成本预估

**现状**：FDE 点"生成 Plan 草稿"时不知道这次生成会消耗多少 token / 多少美金。

**修复建议**：在生成按钮旁显示估算成本（基于 brief + campaign + intensity 计算 input tokens）。FDE 知道"这次 30 任务生成大约 $0.40，30 天累积 $12"。

---

### C6 🟢 缺任务清单 quality check 摘要

**现状**：30 任务生成后，FDE 需要手动滚动浏览验证质量。

**修复建议**：在 Plan 详情顶部加 quality summary：
```
✓ 三平台都有内容（FB 12 / IG 12 / TikTok 5）
✓ 博客 2 篇（W1 各 1 篇）
✓ A/B 测试角度覆盖（价格 6 / 风格 5 / 紧迫 8）
⚠ 缺少建筑商 B2B 内容（仅 1 条）
✓ 所有任务日期在 5/26-6/1 范围
```

---

## D. 内容生成（Blog Studio）优化点

### D1 🔴 GEO 城市硬编码（geo-city-hardcode）

**已知** — 今天 Pet Flooring 文章里改了 6 处 "Sydney" → "Brisbane"。已登记到 SEO TO-DO 文档。

---

### D2 🔴 H1 标签重复（h1-duplicate）

**已知** — WP 标题 + body H1 重复。

---

### D3 🔴 Schema JSON-LD 被 wpautop 污染（schema-corruption）

**已知** — 需要 strip。

---

### D4 🔴 无内链（no-internal-links）

**已知** — Phase 14.F Site Knowledge Graph 修复。

---

### D5 🟡 缺 WP Author 配置

**今天的实际成本**：Pet Flooring 文章默认作者是 `bigbigraydeng`（WP admin 账号），需要手动改成 `OZ Top Editor`。

**修复建议**：客户 ME profile 加 `wp_author_username` 字段，发布时自动设为该值。

---

### D6 🟡 缺 WP Category 智能推荐

**今天的实际成本**：Pet Flooring 文章发布后没自动归类，导致 `/blog/` 页面看不到。FDE 手动改成 "Flooring" 类别。

**修复建议**：ME 连接 WP 后读取所有 categories；blog 生成时基于关键词自动推荐 category。

---

## E. 鲁班看板优化点（明天验证）

### E1 🟢 缺波次分组视图

**预测问题**：明天 FDE 进鲁班看板会看到 30 个任务平铺，不知道哪些是 Wave 1。

**修复建议**：任务卡片按周分组，可以折叠 Wave 2 / Wave 3（即使现在还没有 Wave 2/3 任务）。

---

### E2 🟢 缺最佳发布时段建议

**修复建议**：基于平台 + 受众 + 时区，自动给每个任务推荐 "Optimal post time"。

---

## F. 跨模块系统性问题

### F1 🔴 SiteGround IP 封锁（wp-ip-blocked）

**已知** — Phase 14.G 静态 IP 或 ME WP Connector Plugin 修复。

---

### F2 🔴 Viral Reference 未注入任何 prompt（MP-GEN-3）

**已知** — Phase 21 AI Factory 修复。

---

### F3 🟡 缺数据回流到 ME

**今天的盲区**：Pet Flooring 文章发布后，ME 完全不知道这篇文章的实际 reach / clicks / 排名变化。**数据回流断了**。

**修复**：Phase 22 Data Intelligence Engine（已登记）。

---

## 总结 — 立即可做 vs 等开发

### 立即可做（不需要工程改动，FDE 操作绕过）
- 在 Master Brief 文本字段里**手动**填入产品矩阵 / USP / 服务半径等信息（拼到 description 里）
- FDE Focus Note **手动**写明"只填波次独有信息"
- 关键词拉取失败时**手动**在 Campaign description 里补充关键词
- 每篇博客**手动**走 30 分钟修复 SOP
- Plan 批准前**手动**滚动检查 quality

### 等工程开发（按优先级）
- 🔴 P0（FDE 大规模使用前必修）：MP-GEN-4/5（Visual Direction + URLs 死端）、wp-ip-blocked（静态 IP）、4 个 Blog 生成 bug
- 🟡 P1（影响效率，2-3 周内修）：MB 字段扩展（A1-A5）、FDE Focus Note AI Generate（MP-UX-2）、日期继承（MP-UX-1）、MP-ARCH-1 波次模型
- 🟢 P2（体验提升，Q3 之前修）：UX 引导文案、quality summary、波次分组、最佳时段、成本预估

---

## 附录：从今天会话提取的 ROADMAP 更新

已新增登记：
- `MP-UX-1` Marketing Plan 日期继承
- `MP-UX-2` FDE Focus Note AI Generate
- `MP-GEN-1` Intensity 数量基线（✅ 已修复）
- `MP-GEN-2` Premium=少量偏见（✅ 已修复）
- `MP-GEN-3` Viral Reference 未注入
- `MP-GEN-4` Visual Direction 死端
- `MP-GEN-5` Source URLs 死端
- `MP-ARCH-1` 波次执行模型
- Phase 14.F Site Knowledge Graph
- Phase 21 AI Content Factory（旗舰）
- Phase 22 Data Intelligence Engine（旗舰）
- Phase 23 Cross-Agent Memory Layer（旗舰，升级 8.M）

待本文档登记到 ROADMAP（下个 session）：
- 本文档 A1-A6（MB 6 个字段扩展）
- 本文档 B3（关键词手动覆盖）、B4（Campaign 类型分类）
- 本文档 C5（成本预估）、C6（quality summary）
- 本文档 D5（WP author）、D6（WP category 推荐）
- 本文档 E1（波次分组）、E2（最佳时段）
