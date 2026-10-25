# CRM 之后全流程 — CTS 先行（设计稿 v0）

- **日期**：2026-10-26
- **来源**：issue [#3158](https://github.com/bigbigraydeng-maker/magic-engine/issues/3158)
- **范围**：从「Meta 表单线索进 CRM 联系人+触点」到「成交回传 Meta」之间每一段
- **客户**：CTS 先行，验稳再推到 Oztop / NAL
- **风险级**：设计稿 C；后续子刀各自判级（表字段=A，UI=B，CAPI 真回传=A）

---

## 1. 现状时序（10-26 只读核对）

```
Meta 表单填写
    │  （2h cron，单数小时 25 分）
    ▼
meta-leads-sync ──► unified_contacts + contact_touchpoints
    │                   │
    │                   │（1h cron）
    │                   ▼
    │               lead-sheet-sync ──► 留资总表（Google Sheet）
    │
    │（每天 08:00 NZ，开关=OFF，收件人=hello@magicengine.cloud）
    ▼
crm-lead-followup-digest  ✗  未发给 CTS 销售
    │
    │（手动在总表标成成交）
    ▼
Meta CAPI 回传「Purchase」事件
```

缺口对应 issue 清单第 1–6 条。

---

## 2. 目标时序

```
Meta 表单填写
    ▼
meta-leads-sync ──► 联系人（含来源：广告编号/系列/表单名）
    │
    ├─► 自动分配跟进人（CTS：轮流 or 固定）───► CRM 看板「我的待跟进」
    │
    ├─► digest 收件人改成 CTS 销售（🔴 要 PM 本人同意）
    │
    ├─► lead-sheet-sync ──► 留资总表（三列补齐 + 去重 + 查清谁在写）
    │
    ├─► 分级 CAPI 回传：
    │      - 进库即回传「Lead」(质量=raw)
    │      - 销售标「有意向」回传「Lead」(质量=qualified)   🔴 新
    │      - 成交回传「Purchase」                           ✅ 已有
    │
    └─► Mailchimp：先只读核实现有自动邮件；要改要 PM 同意
```

---

## 3. 五刀拆法

| # | 范围 | 碰生产 | 风险 | 要 PM 合 |
|---|---|---|---|---|
| 1 | **本设计稿 + 根台账卡** | 否 | C | 否（纯文档） |
| 2 | **跟进人字段 + 分配 UI + 看板**：`unified_contacts` 加 `assigned_to`、分配 UI、「我的待跟进」看板；digest 开关不动 | 加表字段 | A | 是 |
| 3 | **总表三件事**：补广告编号/系列/表单三列；查 10-09 后谁在往表里写；去掉 10-07 重复行 | 改表结构 + 补写回表 | A | 是 |
| 4 | **测试线索端到端**：Meta 线索测试工具 → v6.1 → CRM → 总表 → CAPI 测试事件 → Mailchimp 只读核对 | 测试事件 + 测试数据 | B | 是（点"发测试线索") |
| 5 | **CAPI「有效线索」+ Newsletter 核实**：新增 qualified 级回传；核实 Mailchimp 自动邮件挂了哪些 | CAPI 真回传 | A | 是 |

每刀自带：子台账卡、当场试跑证据、reuse statement。digest 真开 / Mailchimp 真写 / CAPI 真回传各走独立 PR。

---

## 4. 页面原型（粗）

### 4.1 CRM 看板「我的待跟进」
一列卡片，顶上 3 个过滤：全部 / 我负责 / 未分配。每张卡：
- 来源徽章（广告编号 + 表单名）
- 最近一次触点时间 + 窗口（≤24h 绿，>24h 黄，>72h 红）
- 一个主按钮：**打电话** / **发邮件**（打开自带 drafts，不自动发）
- 一个次按钮：**改状态**（新线索 / 已联系 / 有意向 / 成交 / 不是询盘）

### 4.2 分配 UI
联系人详情页顶部一行：「跟进人：[下拉：CTS 销售 1 / 2 / 3 / 未分配]」。改完立即保存，不要确认按钮。

### 4.3 总表来源列
留资总表加三列：`campaign_id` / `campaign_name` / `form_name`。lead-sheet-sync 补写时填上。

---

## 5. 边界（issue §边界 原样搬过来 + 两条我补的）

- ❌ 不往外发邮件/短信/私信；digest 收件人改 CTS 销售要 PM 本人同意
- ❌ 不改 Meta 设置、不花广告费、不发布
- ❌ Mailchimp 只读
- ❌ 改库 PR 只能 PM 合
- ❌ 仓库公开：不贴姓名/邮箱/电话/密钥
- ❌ **补的**：所有 cron 真开关 / 真回传开关都走代码字面量常量，不读环境变量
- ❌ **补的**：第二刀上线前先把 digest 的收件人改字段改 ready，但开关仍默认 off

---

## 6. 待 PM 拍板的事（第二刀开工前要回答）

1. **CTS 销售是谁、几个人**：姓名 + 邮箱（后面要写进分配下拉）
2. **分配规则**：轮流（round-robin）还是全部进"未分配"桶等人认领？
3. **响应时间**：多少小时内没动当黄灯，多少小时当红灯？（我默认 24/72）
4. **digest 收件人**：第二刀上线后，什么时候改成 CTS 销售、改成谁？

---

## 7. Reuse 边界

- **复用**：`unified_contacts` / `contact_touchpoints` / `crm-lead-followup-digest` / `lead-sheet-sync` / `conversion_source_kind` 全部沿用
- **平台新加**：`assigned_to` 字段 + 分配 UI + 待跟进看板 — 其他客户也要用，不写死 CTS
- **CTS 配置层**：销售名单、响应阈值进 `client_configurations`，不写死
- **CAPI qualified 回传**：新增通用能力，不是 CTS 特供
