# CRM 团队对齐清单 · `me/crm.deal.closed` 事件

给 PM 用:开跟 CRM 团队的对齐会时,照这份清单钉。CRM 团队回来签字确认后,才能进 CAPI 实现阶段。

---

## 2026-09-09 更新:GoHighLevel 场景下"谁来哈希"

CTS 的 CRM 已定为 GoHighLevel（见 `docs/DECISIONS.md` 2026-09-09 决策），而 GoHighLevel **不支持自己预哈希再发 webhook**——它发给 ME 的是明文 PII。下面 §③ "CRM 侧先 hash"这条硬红线本身不变(明文永远不能进 Inngest event 仓)，但**"CRM 侧"这个词的边界要按 CRM 系统能力区分**:

- 如果 CRM 系统自己能预哈希(按 §③ 规则)再 emit,`em_sha256` 等字段由 CRM 团队负责生成。
- 如果 CRM 系统做不到(GoHighLevel 属于这一类):哈希这一步下沉到 ME 侧,在同一次调用栈里立刻用 `src/lib/pii/hasher.ts` 完成哈希,明文用完即弃(不落库、不写日志、不进 Inngest)。

**2026-09-09 修订二(收编进统一入口,不再有"CRM 直接 emit 到 Inngest"这条路)**: 不论 CRM 是否能自哈希，都不再允许直接拿 Inngest 项目事件 key 往 Inngest 里 emit——两类 CRM 统一 POST 到 ME 新建的 **`src/app/api/webhooks/crm-deal-closed/route.ts`** 这一个公网接收 handler，由它统一做来源认证 + 重放校验 + 服务端 `source_binding → client_id` 映射（见下方"接收 handler 的来源认证与租户绑定"一节），推导出可信的 `client_id` 后才代为 emit 进 Inngest。GoHighLevel 走的分支多做一步就地哈希；能自哈希的 CRM 分支直接透传已哈希字段。**"明文不出 CRM 边界"这条红线在 GoHighLevel 场景下,实际执行者是 ME 的接收 handler,而不是 GoHighLevel 自己;"`client_id` 由谁说了算"这条红线,在两条分支下都是 ME 的服务端映射表，不是 CRM 自己的系统或它持有的事件 key。**

**下游消费注意**:`me/crm.deal.closed` 事件里的 `*_sha256` 字段到了 CAPI 消费者这一步,要原样塞进 Meta `user_data`,**不能**再调 `src/lib/meta/capi/writer.ts` 现有的 `MetaCapiWriter.build()`——那个方法是给 Issue #1397 的 ME 内部明文 Outcome 管道用的,收到什么都会自己再哈希一次,对已经是哈希值的字段会造成二次哈希(`sha256(sha256(...))`),Meta 侧完全匹配不上且不会报错。GoHighLevel 消费者需要单独一段"哈希值直通"的构造逻辑。

**接收 handler 的来源认证与租户绑定(强制,不是可选项,不是后续待办)**:`crm-deal-closed` 是一个**公网可达的 webhook 入口**,且(修订二后)**是所有外部 CRM 的唯一入口,不分能不能自哈希**。如果不做来源认证,payload 里的 `client_id` 就完全由调用方自己填——任何人都能提交一条 schema 合法的 `deal.closed` 事件,让下游消费者拿这个 `client_id` 去读对应客户的 Meta pixel/token,把伪造的 Purchase 写进任意客户的广告账号。`me_capi_uploads` 持久化幂等账本只挡**重放**(同一 `deal_id` 重发),挡不住这种**伪造**(新 `deal_id`)。handler 必须 fail-closed 满足以下三条,三条缺一不可:

1. **来源认证**:每一路 CRM 的请求都必须带可验证的签名或共享密钥(GoHighLevel 按 location/sub-account 各配一个;能自哈希直连的 CRM 按各自后端服务账号配一个,服务端保存,不进任何客户可见配置)。验证失败 → 直接拒绝该请求(不 emit 事件、不进 Inngest、也不落 `pushCapiItems`——伪造请求不该被当成一个"失败任务"外泄进人工待办看板)。
2. **重放校验**:结合请求时间戳拒绝超出合理窗口的请求,并在签名验证通过后才进入 `deal_id` 幂等账本判断,避免重放请求被当作新事件反复触发下游写入。
3. **租户绑定不信任 payload**:`client_id` **不允许**由请求方在 payload 里自报来决定路由,**这一条对所有 CRM 来源一视同仁**,不因为某条 CRM 自己能预哈希就可以少这一步。handler 必须依据请求本身携带的来源标识(GoHighLevel 是 location/sub-account id;其他 CRM 是各自的来源凭证 id),查一张 **ME 服务端维护的 `crm_source_bindings`(`source_binding_id → client_id`)映射表**来服务端推导 `client_id`,再拼进 emit 给 Inngest 的事件——即便请求 body 里也带了 `client_id` 字段,也以服务端映射结果为准覆盖,绝不采纳请求方提供的值。

这三条约束**所有外部 CRM → ME 接收 handler**这一条统一路径;不存在"CRM 自己能预哈希就可以跳过认证、直接拿 Inngest 项目 key emit"的旁路(旧版本此处的例外已废止,见 `docs/specs/2026-09-07-me-conversion-truth-uplink-spec.md` §2A"2026-09-09 修订二")。

---

## 一句话背景

ME 广告端要建一个「CAPI 回传」通道,让 Facebook 拿到「谁真成交了」,广告才能变聪明。这个通道**消费 CRM 系统 emit 的成交事件**——所以 CRM 侧要按下面这份格式发事件,ME 侧才接得上。

---

## CRM 团队要交付的三件事

### ① 事件名 + emit 时机

- **事件名(不能改)**: `me/crm.deal.closed`
- **emit 时机**: 每笔成交在 CRM 里被标记为「已成交/已确认/已收款」的**瞬间**,emit 一条事件
- **发到哪**(2026-09-09 修订二后:所有 CRM 统一发到 ME 的接收 handler,不再有"直接 emit 到 Inngest"这条路):
  - 统一 POST 到 ME 的 **`src/app/api/webhooks/crm-deal-closed/route.ts`**,带来源签名/共享密钥。handler 完成来源认证 + 重放校验 + `crm_source_bindings` 租户绑定后,代为 emit 到 Inngest;CRM 团队不直接碰 Inngest,不需要自己持有 Inngest 项目凭证。
  - 按 CRM 系统能力二选一,只影响 payload 内容,不影响"发到哪":
    - CRM 系统自己能按 §③ 规则预哈希 → payload 直接带 `*_sha256` 字段,handler 原样透传。
    - CRM 系统做不到自己预哈希(如 GoHighLevel,见文首「2026-09-09 更新」)→ payload 带明文 PII,handler 在同一次调用栈内就地哈希,不落库不写日志。

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

**为什么 CRM 侧 hash**: Inngest 事件仓保留 30-90 天,明文进事件 = PII 泄露给第三方 SaaS,红线。所以明文只允许在 CRM 内部处理完就地 hash,payload 只带 hash。(这条规则默认给「CRM 自己能哈希」的路径用;GoHighLevel 这类做不到的 CRM 走文首「2026-09-09 更新」描述的 ME 接收 handler 路径,哈希规范本身不变,只是"就地 hash"的执行者从 CRM 团队变成 ME 的接收 handler。)

**规则**:
- **email**: 小写 + 去首尾空格 → SHA-256 → hex 小写
  - 例:`Test@Example.com ` → `test@example.com` → `973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b`

- **phone**: 需要**拨号国家码**(如 `64`/`61`,不然 E.164 化不了)
  - **2026-09-09 补(锁 Codex 复审发现的一个真实坑)**: `src/lib/pii/hasher.ts:29-34` 的 `hashPhone(raw, defaultCountry)` 直接把 `defaultCountry` 传给 `normalizePhone`(`src/lib/pii/normalize.ts:41-67`),而 `normalizePhone` 要的是**拨号码**(`64`/`61`),**不是 ISO2 国家码**(`NZ`/`AU`)。GoHighLevel 示例里给的是本地号码 `021…` + ISO2 `NZ` —— 如果把 `NZ` 原样传给 `hashPhone` 的第二个参数,`normalizePhone` 里 `cc = 'NZ'.replace(/\D/g,'')` 会得到空串,函数直接返回 `null`,电话字段被静默丢掉,不会报错、也不会走"没国家码 skip"那条日志。
  - **正确做法**:哈希电话前必须先把 GoHighLevel 的 ISO2 值换成拨号码,换算来源**只能是 ME 服务端已知的可信值,不能信 payload 自报的 ISO2**——已自哈希的 CRM 路径下,由 CRM 团队自己完成"ISO2→拨号码→E.164→hash"全链路(§③ 规则本身不变);GoHighLevel 明文路径下,由 §2A 描述的 ME 接收 handler 用 `clients.default_phone_country`(该客户配置好的拨号码,例如 CTS = `64`)作为 `hashPhone` 的第二个参数,**不使用 GoHighLevel webhook body 里的 `country` 字段**做换算源。
  - 例(锁定为验收测试用例):本地号码 `021 555 1234`,客户 `default_phone_country = '64'` → `hashPhone('021 555 1234', '64')` → 内部 E.164 规范化成 `64215551234` → SHA-256。**反例**:`hashPhone('021 555 1234', 'NZ')` → 返回 `null`(不是预期行为,是需要在测试里断言"不能这样调用"的坑)。
  - **没有可信拨号码时**(客户未配置 `default_phone_country`):直接 skip phone 字段,`dropped_fields` 记 warning(不 hash 错的比不 hash 更糟)

- **first_name / last_name**: 小写 + 去首尾空格 → SHA-256

- **country**: ISO 两位 + 小写(`nz`)→ SHA-256

- **不允许**:发明文、发 MD5 而不是 SHA-256、发大写 hex、`+alias` 邮箱不清理

---

## CRM 团队要回签字确认的清单

请 CRM 团队负责人对每一条回 ✅ 或 ❌+原因:

1. □ 事件名 `me/crm.deal.closed` 能实现,不改名
2. □ Payload schema 照 §② 一字不差
3. □ PII hashing 照 §③ 规范(尤其**明文不出 CRM 边界**这一条)——**仅适用于「CRM 系统自己能预哈希」这条路径**。如果这套 CRM 走的是文首「2026-09-09 更新」描述的 ME 接收 handler 路径(明文 webhook → handler 内哈希),这一条改成"明文不出 handler 调用栈",由 ME 侧保证并对 handler 做来源认证 + 租户绑定,不需要 CRM 团队签这条
4. □ 每笔成交 emit 一次;deal 修改后重 emit 用同一 `deal_id`(触发 ME 侧的「payload 变了」检查)
5. □ `closed_at` 保证是**过去 7 天内**(超期的 Meta 会拒;历史存量老单**另议**,不走这个事件)
6. □ CRM 上线日期:______(填)
7. □ 上线前先用假邮箱假电话(如 `test@example.com` / hash 后)发一条测试事件到 Inngest,ME 侧用 Meta 测试模式验证收到
8. □(仅 GoHighLevel 等不能自哈希的 CRM 需要 ME 侧确认,不需要 CRM 团队签)接收 handler 的电话哈希测试用本地号码(如 `021 555 1234`)+ 客户 `clients.default_phone_country` 拨号码(CTS = `64`)锁定,断言产出 `ph_sha256` 非空;同时断言把 GoHighLevel payload 里的 ISO2 `country` 值直接传给 `hashPhone` 不会被误用(见 §③ 2026-09-09 补)

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
