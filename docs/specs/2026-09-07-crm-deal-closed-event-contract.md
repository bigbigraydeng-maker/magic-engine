# CRM 团队对齐清单 · `me/crm.deal.closed` 事件

给 PM 用:开跟 CRM 团队的对齐会时,照这份清单钉。CRM 团队回来签字确认后,才能进 CAPI 实现阶段。

---

## 一句话背景

ME 广告端要建一个「CAPI 回传」通道,让 Facebook 拿到「谁真成交了」,广告才能变聪明。这个通道**消费 CRM 系统 emit 的成交事件**——所以 CRM 侧要按下面这份格式发事件,ME 侧才接得上。

---

## CRM 团队要交付的三件事

### ① 事件名 + emit 时机

- **事件名(不能改)**: `me/crm.deal.closed`
- **emit 时机**: 每笔成交在 CRM 里被标记为「已成交/已确认/已收款」的**瞬间**,emit 一条事件
- **发到哪**: Inngest(ME 和 CRM 共用同一个 Inngest 项目)

### ② Payload 格式(严格按下面,一字不差)

```
{
  "schema_version": 1,
  "client_id": "<UUID>",              // ME 客户 id · CTS = c0000000-0000-0000-0000-000000000000
  "deal_id": "<CRM 内唯一 id>",       // 用来幂等,同一 deal 重发时用同一 id
  "event_name": "deal.closed",

  // ↓↓↓ PII:CRM 侧先 hash,永远不发明文 ↓↓↓
  "em_sha256": "<64字符hex>",         // 必需
  "ph_sha256": "<64字符hex>",         // 可选
  "fn_sha256": "<64字符hex>",         // 可选
  "ln_sha256": "<64字符hex>",         // 可选
  "country_sha256": "<64字符hex>",    // 可选

  // ↓↓↓ 业务字段 ↓↓↓
  "deal_value": 3200,                 // 数字,大于 0
  "deal_currency": "NZD",             // ISO 4217 三位大写
  "closed_at": "2026-09-07T14:30:00Z",// ISO 8601 · 必须过去 7 天内(Meta 硬要求)

  "attribution_source": "facebook",   // 可选,来源标记
  "hash_scheme_version": 1            // 让 ME 识别 hash 规则升级
}
```

### ③ PII hashing 规则(严格照 Meta CAPI 规范,不然匹配失败)

**为什么 CRM 侧 hash**: Inngest 事件仓保留 30-90 天,明文进事件 = PII 泄露给第三方 SaaS,红线。所以明文只允许在 CRM 内部处理完就地 hash,payload 只带 hash。

**规则**:
- **email**: 小写 + 去首尾空格 → SHA-256 → hex 小写
  - 例:`Test@Example.com ` → `test@example.com` → `973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b`

- **phone**: 需要**国家码**(不然 E.164 化不了)
  - 有国家码 → E.164 规范化 → 只留数字 → SHA-256
  - 例:`(021) 555-1234` + country `NZ` → `+64215551234` → `64215551234` → SHA-256
  - **没国家码时:CRM 侧直接 skip phone 字段**(不 hash 错的比不 hash 更糟)

- **first_name / last_name**: 小写 + 去首尾空格 → SHA-256

- **country**: ISO 两位 + 小写(`nz`)→ SHA-256

- **不允许**:发明文、发 MD5 而不是 SHA-256、发大写 hex、`+alias` 邮箱不清理

---

## CRM 团队要回签字确认的清单

请 CRM 团队负责人对每一条回 ✅ 或 ❌+原因:

1. □ 事件名 `me/crm.deal.closed` 能实现,不改名
2. □ Payload schema 照 §② 一字不差
3. □ PII hashing 照 §③ 规范(尤其**明文不出 CRM 边界**这一条)
4. □ 每笔成交 emit 一次;deal 修改后重 emit 用同一 `deal_id`(触发 ME 侧的「payload 变了」检查)
5. □ `closed_at` 保证是**过去 7 天内**(超期的 Meta 会拒;历史存量老单**另议**,不走这个事件)
6. □ CRM 上线日期:______(填)
7. □ 上线前先用假邮箱假电话(如 `test@example.com` / hash 后)发一条测试事件到 Inngest,ME 侧用 Meta 测试模式验证收到

---

## 存量老成交怎么办(**PM 要拍板 · 不是 CRM 团队定**)

Meta CAPI **只认过去 7 天**内的成交。CRM 上线时,过去几个月的存量成交怎么处理?

- **选项 A**:不管,只从 CRM 上线日开始的新成交走 CAPI。老成交 Meta 不知道也罢。
- **选项 B**:走另一条通道——Meta 的「离线转化上传」(offline conversion upload),支持 62 天内。CRM 团队额外导出一份 CSV,PM 上传。工程量:小。
- **选项 C**:再往前的成交,只能算了(Meta 硬性上限)。

**推荐 A(最紧贴实际)**,除非 PM 判断存量数据价值大得值得做 B。

---

## 时间表建议(填给 CRM 团队)

- **本周**:开对齐会,CRM 团队签字确认 §①②③
- **CRM 开发期(1-2 周)**:ME 侧同步写 CAPI 消费者代码 + 契约测试 + 测试模式桩(不等 CRM,并行走)
- **CRM 上线日**:双方对接,ME 侧撤测试模式,开始真发 CAPI

---

## 对齐会议程建议(30 分钟)

1. (5 min)背景:为什么要有这个事件 = 广告变聪明
2. (10 min)过一遍事件名 + payload + hash 规则(§①②③)
3. (5 min)确认老成交策略(§ 存量老成交)
4. (5 min)确认时间表 + 测试模式演练怎么做
5. (5 min)签字 / 遗留问题

**对齐完了 CRM 团队回签**——反向签字前,ME 侧 CAPI 消费者代码可写,但**不能真上线**(否则 CRM 发的事件形状不对,消费者全崩)。
