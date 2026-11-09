# ME 产品版本 Registry

> **单一名单来源**：所有 ME 产品版本（platform 通用 + 行业垂直版本）都在本文件登记。skill、CLAUDE.md、代码中禁止硬编码版本名单 —— 一律引用本文件。
>
> **谁改**：新增 / 弃用版本属 **PM 拍板项**（不由 agent 自决）。

---

## 现役版本

### ME 通用 · platform / kernel
- **英文键**：`me-platform`
- **中文名**：ME 通用 / ME 平台通用
- **是什么**：跨行业跨客户的智能层底盘，所有垂直版本共享
- **归属**：L1 Capability 的运行环境
- **触发词**（供 skill 动态读取）：`ME 通用` · `平台通用` · `跨行业` · `kernel` · `platform-shared`

### ME 地产版
- **英文键**：`me-real-estate`
- **中文名**：ME 地产版
- **是什么**：面向房地产中介 · 楼盘发展商 · 地产开发商的垂直版本
- **归属**：L2 Playbook / Version
- **当前状态**：规划中（当前 Roman 客户在 platform 上试跑，未真正抽出 me-real-estate 版）
- **触发词**：`ME 地产版` · `地产版` · `real estate playbook` · `房产版`

### ME 旅游版
- **英文键**：`me-travel`
- **中文名**：ME 旅游版
- **是什么**：面向旅游运营商 · 目的地营销的垂直版本
- **归属**：L2 Playbook / Version
- **当前状态**：**已正式立版（PM 2026-09-14 拍板）**。Customer Zero = CTS Tours NZ。
  - 首个 L2 能力候选（尚未晋升为共享能力）：**行程转路线地图生成器**（PC + 手机两版，按团自动出图；CTS 8 个团已用首例验证，见 `docs/registry/platform-candidates.md`——该条目当前状态仍为 `candidate`，证据 1/2 客户，需第 2 个旅游客户出现事实复制后才能晋升为 ME 旅游版共享能力）。
  - 首个模块规划：**ME Tour 管理模块**（一个团在推广前统一备好内容/定价/行程/地图），规划见 [`docs/specs/2026-09-14-me-tour-management-module-plan.md`](../specs/2026-09-14-me-tour-management-module-plan.md)，**未授权实施**，待 P1 团数据结构立项。
  - 红线：客户具体团数据（城市/价格/活动）= L4 配置按 client 隔离，不入 shared runtime。
- **触发词**：`ME 旅游版` · `旅游版` · `travel playbook` · `tourism`

### ME 电商版
- **英文键**：`me-commerce`
- **中文名**：ME 电商版
- **是什么**：面向 DTC 品牌 · Shopify 独立站 · 跨境电商的垂直版本
- **归属**：L2 Playbook / Version
- **当前状态**：早期原型（Jingshop 试点、Homara 自营店试点；PR #1000 已合并选品能力 POC）
- **触发词**：`ME 电商版` · `电商版` · `commerce playbook` · `DTC 版`

---

## 版本弃用规则

- 弃用需 PM 显式拍板
- 弃用后版本名保留在本文件"已弃用"段（不删除），skill 触发词继续保留 6 个月避免旧代码引用突然失效
- 6 个月后版本名可从触发词列表移除

## 已弃用

*（当前无）*

---

## Registry 与 skill 的耦合

[me-platform-tier-gate skill](../../.claude/skills/me-platform-tier-gate/SKILL.md) v2 的语言级触发词从本文件的 `触发词` 字段动态读取。当 PM 在本文件里加新版本（例如 `ME 健康版`），skill 自动跟进新触发词，不需要改 skill 本身。

**约束**：
- 触发词必须是"人自然会说的词"（中文优先，避免只写英文键）
- 新增版本时同步更新 [`docs/registry/platform-candidates.md`](./platform-candidates.md)（若该版本是从平台 candidates 晋升而来）

---

## 历史

- 2026-08-27 · 建仓，v1 · 收录 4 个版本（platform / real-estate / travel / commerce）。skill v2 上线的配套 registry。
- 2026-09-14 · **ME 旅游版正式立版**（PM 拍板）。从「规划中」转「已立版」；Customer Zero = CTS；首个共享能力 = 行程转路线地图生成器；首个模块规划 = ME Tour 管理模块（`docs/specs/2026-09-14-me-tour-management-module-plan.md`）。
