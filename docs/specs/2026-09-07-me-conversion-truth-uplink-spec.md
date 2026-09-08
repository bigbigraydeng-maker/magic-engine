# 设计 v2 · 转化真相回流能力(第一期 · CRM 成交事件 → Meta CAPI)

风险级 **A**(PII + 直连 Meta 生产 API + 影响广告 AI 训练)。设计阶段产出。

**v2 修订记录**: 吸收 2026-09-07 子牙(5 阻断+3 决策+2 待命建议+4 非阻断)+ 魏征(12 阻断+6 非阻断)双审。

**平台候选登记**: `docs/registry/platform-candidates.md`(commit 030de2f6),复查 2026-10-07。

---

## 1. 目标 / 非目标

**目标**: CRM 成交事件 → ME 云端消费者 → hash PII → POST Meta CAPI,让 Meta AI 拿真成交训练广告。

**非目标(明确排除)**:
- ❌ 不做 Google/TikTok 适配器(只留 TODO 注释,子牙 Q3)
- ❌ 不做 CRM 侧(只消费其 emit 的事件)
- ❌ 不做客户名单批量上传(隔壁窗口手工在做,合流待未来)
- ❌ 不做通用「所有转化」,只做真成交(旅游 = Purchase)。未来其他事件类型(Lead/SubmitApplication)**新起事件名**,不复用 `deal.closed`。

---

## 2. 上游契约(**我们先定 · 发给 CRM 团队 · 子牙 Q1**)

**事件名**: `me/crm.deal.closed`(旅游成交 → Meta `Purchase`)。未来新场景另起事件名,一对一映射。

**幂等 id**: `me-crm-deal-<deal_id>-uplink`。

### 2A. PII 处理:CRM 侧先 hash(**魏征 BLOCK-1 · 首选方案 (a)**)

CRM 侧 emit 前完成 PII hashing(邮件电话姓名国家),payload **只带 hash**,明文**永不进 Inngest 事件仓**。

理由: 只有明文永远不出 CRM 边界,才是真正堵住 PII 泄露。加密信封方案(b)/内部拉表方案(c)都留了 debug 明文入口,治理复杂度高。

hash 规范化规则(**权威由本设计定,写进给 CRM 的合约文档**):
- email → `sha256(lowercase(trim(email)))`
- phone → `sha256(digits_only(e164(phone, country)))` —— **`country` 硬性 required 才 hash phone**;缺 country → skip 字段,`dropped_fields` 记 warning(魏征 BLOCK-4)
- fn/ln → `sha256(lowercase(trim(name)))`
- country → `sha256(lowercase(country))`

**2026-09-09 修订(加一条分支,不推翻本节)**: CTS 首个真实 CRM 定为 GoHighLevel(见 `docs/DECISIONS.md` 2026-09-09 决策),GoHighLevel **不支持自己预哈希**。本节「CRM 侧先 hash」对**能自己哈希的 CRM**继续原样成立;对做不到的 CRM,哈希这一步下沉到 **ME 自己新建的接收 handler**——在收到明文 webhook 的同一次调用栈内立刻按上面的规则完成哈希、不落库、不写日志,再转成本节字段形状 emit 进 Inngest。**「明文永不进 Inngest 事件仓」这条红线不变**,变的只是明文短暂存在的那一刻由谁负责哈希:从「CRM 团队自己的系统」变成「ME 这个新 handler 的一次函数调用」。这个 handler 是公网 webhook 入口,**必须做 fail-closed 来源认证(签名/共享密钥)+ 重放校验 + 服务端 `location_id → client_id` 映射(不信任 payload 自报的 `client_id`)**,否则等于把 §4 步骤 3 依赖的 `client_id` 信任边界向公网敞开。完整认证要求见 `docs/specs/2026-09-07-crm-deal-closed-event-contract.md` 文首「2026-09-09 更新」。

**2026-09-09 修订二(魏征/Codex 复审后收紧「CRM 直接 emit」分支 · 推翻上面"继续原样成立"这半句)**: 上面这条分支原文默认"能自己哈希的 CRM"可以绕开 ME 的入口、直接拿 Inngest 项目的事件 key emit,信任边界只是"进得了 Inngest 项目"(旧版 §4 步骤 3 原话)。这一条不成立——`event.data` 是调用方自己拼的,**Inngest 项目级密钥只证明"这是某个持有该密钥的后端",不证明"这条事件里的 `client_id` 是真的"**,和仓库里 `src/lib/inngest/functions/factory-reel-measurement-adapter.ts:70-73` 已经写明的前提一致(`event.data` 来自 Inngest、可被伪造,必须靠独立回读可信记录做第二道身份闸)。一个配置错误或被入侵的 CRM 后端,可以把 `deal_id` 配上任意别的 `client_id` 发一条合法 schema 的事件,把伪造 Purchase 写进别人的广告账号——这跟 GoHighLevel 明文 webhook 那条路径的风险是同一件事,不能因为"这个 CRM 自己会哈希"就默认可以少一道认证。

**修正**: 取消"能自己哈希的 CRM 可以直接 emit 进共享 Inngest 项目"这条旁路。**所有外部 CRM,不论是否具备自哈希能力,都必须经过 ME 同一个按来源认证的接收入口**(见 §3 新增的 `crm-deal-closed` webhook handler,与 GoHighLevel 分支复用同一个 handler、同一张来源绑定映射表,只是内部分支不同):
- **能自哈希的 CRM**: 把已经哈希好的 payload(`*_sha256` 字段)POST 到这个 handler,handler 做来源认证 + 重放校验 + 用**服务端 `source_binding → client_id` 映射表**推导 `client_id`(不采纳 payload 自报值),校验通过后原样转发 emit 进 Inngest。
- **不能自哈希的 CRM(GoHighLevel)**: 走 §2A 原文描述的明文 webhook 分支,handler 多做一步就地哈希。

两条分支收敛到同一条硬规则: **`client_id` 永远由 ME 接收入口从服务端映射表推导,不接受任何路径的 payload 自报值;"能进入 Inngest 项目"本身不构成 `client_id` 授权**。因此本设计里不再存在"CRM 后端直接拿项目 key emit 到 Inngest"的路径——所有外部输入都先落这一个认证入口。§4 步骤 3、§7、§8 已同步更新。

### 2B. Payload schema(v1)

```
schema_version: 1
client_id: uuid
deal_id: string
event_name: literal "deal.closed"

# PII 全是 hash,64 字符 hex(不带 0x)
em_sha256: string             # 必需
ph_sha256?: string            # 可选(缺 country 时 CRM 侧 skip)
fn_sha256?: string
ln_sha256?: string
country_sha256?: string       # ISO2 lowercase 后 hash

# 业务
deal_value: number > 0        # zod 强校验(N-2)
deal_currency: string         # ISO 4217 3 位大写(zod 校验)
closed_at: string             # ISO datetime · Meta 硬要求 ≤ 过去 7 天(魏征 BLOCK-7)

# 归因(可选)
attribution_source?: string
hash_scheme_version: number   # 让消费者能识别 hash 规范升级
```

### 2C. 上游对齐(**魏征 BLOCK-11 · 硬前置**)

设计不算「完成」直到上游三件事都发生:
1. **本设计 §2 payload schema 落地到独立文档** `docs/specs/2026-09-07-crm-deal-closed-event-contract.md`,给 CRM 团队作需求书。
2. **PM 层面跟 CRM 团队开一次对齐会**,让 CRM 团队接受这份 schema + hash 规则,并写进他们的开发任务。**(这一步 agent 做不了 · 待 PM)**
3. **CRM 团队反向确认**: 事件名 / 字段名 / hash 规则 / 时间点 全部签字。反向签字前,本消费者不允许上线。

---

## 3. 最小实现(2026-09-09 修订二后:2 新文件 + 4 改,不再是"1 新文件")

**新增**:
- `src/lib/inngest/functions/crm-deal-capi-uplink.ts`(cloud 消费者)
- `src/app/api/webhooks/crm-deal-closed/route.ts`(**新增 · 修订二硬前置**:所有外部 CRM 的统一公网接收入口,不只是 GoHighLevel 专用):
  1. **来源认证**: 校验请求签名/共享密钥(按 CRM 来源各配一个,服务端保存,不进客户可见配置);验证失败 → 直接 401,不 emit、不落 `pushCapiItems`(伪造请求不算"失败任务")
  2. **重放校验**: 时间戳窗口 + 签名验证通过后才进入下游幂等判断
  3. **`source_binding → client_id` 服务端映射**: 查新表 `crm_source_bindings`,推导出 `client_id`;payload/请求方自报的 `client_id` 一律丢弃不采纳
  4. 按 CRM 能力分支:能自哈希的 CRM → payload 已是 `*_sha256` 形状,原样透传;GoHighLevel 等不能自哈希的 → 用 `src/lib/pii/hasher.ts` 就地哈希(不落库、不写日志)
  5. 组装成 §2B schema 形状(`client_id` 用步骤 3 的映射结果覆盖,不用请求方的值),emit `me/crm.deal.closed` 到 Inngest

**改**:
- `src/lib/inngest/functions/index.ts` — 加进 `cloudFunctions`(id `cloud-crm-deal-capi-uplink`,子牙 B5)
- `src/lib/inngest/functions/__tests__/registration.test.ts` — 契约测试:断言 `me/crm.deal.closed ∉ WORKER_OWNED_EVENTS`(子牙 B5)
- `src/lib/flywheel/vocabulary.ts` — 加 `ads.uplink_conversion`(子牙 N4 · 语义比 `capi_uplink` 更贴,未来 Google/TikTok 归同类)
- `src/lib/pm-todo/manual-items.ts` — 加 kind: `capi_no_config` / `capi_meta_rejected` / `capi_invalid_payload` + `pushCapiItems`(子牙 B1)

**同 PR 迁移(A 级 · service_role RLS)**:
- 建 `me_capi_uploads` 已发账本表(魏征 BLOCK-6):`(client_id, deal_id, event_name, uploaded_at, payload_hash, hash_scheme_version)`,`UNIQUE(client_id, deal_id, event_name)`
- `clients.meta_pixel_id text` 列(子牙 B2 · 二选一里选 A:走列而非 env,列不存在的运行时分支删除)
- **新增(修订二硬前置)** `crm_source_bindings` 映射表:`(source_binding_id text primary key, client_id uuid, crm_provider text, secret_ref text, created_at timestamptz)`,service_role RLS(`FOR ALL TO service_role USING (true)`);`source_binding_id` 对 GoHighLevel 是 `location_id`,对其他能自哈希直连的 CRM 是各自签发的来源标识,两者共用同一张表、同一条"服务端映射优先于 payload 自报"规则

**同 PR 验收测试(2026-09-09 修订二硬前置,不放到"待命期"再补)**:
- `src/app/api/webhooks/crm-deal-closed/__tests__/route.test.ts`: 签名缺失/错误 → 401 且不 emit、不落 `pushCapiItems`;时间戳超窗口 → 拒绝;`source_binding_id` 查不到映射 → 拒绝;映射存在但请求 body 里带了不同的 `client_id` → 以映射结果为准、不采纳请求值(断言 emit 出去的事件 `client_id` 是映射结果);GoHighLevel 明文分支的哈希正确性锁 `crm-deal-closed-event-contract.md` 的 NZ 示例(见该文档 §③ 修订)

---

## 4. 消费者逻辑

1. id `cloud-crm-deal-capi-uplink`,订阅 `me/crm.deal.closed`
2. `safeParse(event.data)`:
   - 失败 → `return {ok:false, reason:'invalid_payload', issue_paths: issues.map(i=>i.path.join('.'))}` —— **只报字段路径,禁止报字段值**(子牙 B3)
   - 同时**落 `pushCapiItems`**(魏征 BLOCK-9 · 别静默),带 client_id + issue_paths,不带原 payload
3. 读客户配置:
   - `pixel_id` = `clients.meta_pixel_id`(子牙 B2 · 唯一路径)
   - `access_token` = `getMetaTokenForClient(clientId)`(带 ads_management,吸取 me_ad_launch)
   - 任一 null → `{ok:false, reason:'no_config'}` + `pushCapiItems` (kind `capi_no_config`)
   - **`client_id` 信任边界(2026-09-09 修订二后)**:本消费者对 `event.data.client_id` 不做二次校验,直接信任它——但信任的前提变了:不再是"进得了 Inngest 项目就算数",而是**所有外部 CRM(能自哈希的 + GoHighLevel 这类不能自哈希的)都先经过 §3 新增的 `src/app/api/webhooks/crm-deal-closed/route.ts` 统一入口**,由该 handler 的来源认证 + `crm_source_bindings` 服务端映射推导出 `client_id` 后才 emit 进 Inngest;消费者信任的是"这条事件已经过 handler 校验",不是"这条事件能出现在 Inngest 里"。这个 handler 一旦漏做认证或映射,都会在这一步直接读到错误客户的 pixel/token——这是硬前置,不是可以先跳过、上线后再补的待办。
4. **7 天窗口前置检查**(魏征 BLOCK-7):
   - `if (nowMs - Date.parse(closed_at) > 7d)` → 落 `flywheel_actions.metadata.dropped_reason='beyond_capi_window'` + 计数,**不 POST 不进 manual-items**
5. **已发账本第二层幂等**(魏征 BLOCK-6):
   - `payload_hash = sha256(canonicalJSON(event.data))`
   - 查 `me_capi_uploads` (client_id, deal_id, event_name):
     - 存在且 payload_hash 相同 → skip,计数
     - 存在但 hash 不同 → `pushCapiItems(kind='capi_payload_changed')`,**不覆盖上一次**(默认策略:拒后处理,魏征要求给答案)。理由: deal 修改覆盖 = 双计风险,人审后决定策略
     - 不存在 → 继续
6. `step.run(POST-capi)`:
   - URL: `https://graph.facebook.com/v19.0/{pixel_id}/events`
   - body.data[0]:
     - `event_name: 'Purchase'`(v1 硬编码,与事件名 `deal.closed` 1:1 · 子牙 Q2)
     - `event_time`: unix(closed_at)
     - `event_id`: `deal_id`
     - `action_source: 'system_generated'`(**魏征 BLOCK-5 · CRM 离线成交,不是 website**)
     - `user_data`: 从 payload 的 `*_sha256` 字段直接组装,消费者**不做 hashing**(hashing 在 CRM 侧完成)
     - `custom_data`: `{value, currency}`
   - 待命期加 `test_event_code`(env `META_CAPI_TEST_EVENT_CODE`,上线日 unset 才发真训练池 · 子牙"待命期不腐化 #1")
7. **PII 泄露堵漏**(魏征 BLOCK-2 · 硬要求):
   - 整个 handler wrap try/catch
   - catch 内: `delete errorContext.event_data.em_sha256`(即使 hash 也不必进错误)
   - 禁止在 `console.log` / Sentry breadcrumb 塞 `event.data` 或消费者内部变量
   - `onFailure` handler(魏征 BLOCK-10):落 `pushCapiItems(kind='capi_meta_rejected', reason='inngest_exhausted')`
8. 成功: 记 `me_capi_uploads` + `flywheel_actions` 直插

---

## 5. `flywheel_actions` metadata 白名单(**魏征 BLOCK-3 · 硬要求**)

`metadata` JSONB **只允许**以下字段(union 类型 zod 校验):
```
{
  event_id_hash: string,      // sha256(deal_id),不是 deal_id 明文
  meta_events_received: number,
  fbtrace_id: string,
  pixel_id: string,
  hash_scheme_version: number,
  hash_ok: boolean,
  outcome: 'success' | 'skipped' | 'failed',
  reason?: string,             // 只挑白名单枚举,禁自由文本
}
```
**禁止**任何 raw user_data / raw payload / deal_id 明文 / 客户业务 fact(子牙 B4)。unit test 断言 metadata 里不出现明文 email/phone/deal_id/客户名。

---

## 6. 幂等(两层)

- **第一层**: Inngest 事件 id 去重(有界窗口 ~24h),Inngest 内 retry 安全
- **第二层**: `me_capi_uploads` 持久化账本(魏征 BLOCK-6),跨天/跨月/deal 修改都锁住

---

## 7. 治理 / 边界(2026-09-09 修订二后:GoHighLevel 分支收编进统一入口,其余不变)

- 不需要人工审批(不占花钱/对外/难撤三占,与 me_ad_launch 审批闸判据一致)
- 但 PII 高敏 → hash 在 CRM 侧完成(CRM 做不到时下沉到 §3 新增的 `crm-deal-closed` 统一接收 handler,同调用栈内完成、见 §2A 2026-09-09 修订)+ metadata 白名单 + 明文禁进任何 ME 存储/日志
- 失败一律进 `manual-items.ts`「🙋 需要你动手」,带 what/why/href(接收 handler 的来源认证失败**不算**这类失败,直接拒绝,不落 manual-items,见 `crm-deal-closed-event-contract.md`)——**这条现在对所有外部 CRM 都成立**,不再只限 GoHighLevel:能自哈希的 CRM 如果签名/映射失败,同样直接拒绝,不进人工待办
- **同因合并 / 熔断**(魏征 BLOCK-12):`pushCapiItems` 同 client_id + kind 一天合成一条,同 client 连续 5 次同因触发消费者层熔断(30 分钟不再进 manual-items,只计数)

---

## 8. Reuse 声明(红线对账)

**复用**: `getMetaTokenForClient`(token-manager.ts:69) · flywheel_actions 直插(daily-plan-publish 模式) · manual-items 失败落点 · cloud Inngest 骨架 · CTS pixel/token 今日修地基填的 env。**不另起**任何 Graph 客户端 / 审批体系。

**分层**:
- **L1 shared**: 消费者、`crm-deal-closed` 统一接收 handler、`crm_source_bindings` 映射表结构、幂等账本、metadata 白名单、CAPI POST、事件名↔Meta event_name 映射表(硬编码 1:1)
- **L4 config**: 客户 pixel_id / token / `crm_source_bindings` 里每条来源到 client_id 的具体映射行 / (未来)自定义业务事件↔Meta event_name 的扩展
- 红线 2: 客户 PII 明文永不进 shared runtime;deal 语义 fact 不进 shared——**2026-09-09 唯一受限例外**:GoHighLevel 明文 webhook 落地的接收 handler,明文只存活在单次函数调用栈内(不落库、不写日志、哈希后立刻丢弃),且该 handler 必须先过 fail-closed 来源认证 + 服务端映射才处理请求(见 `crm-deal-closed-event-contract.md` 2026-09-09 更新)。这不是放宽本条红线,是把「谁在明文短暂存在的瞬间负责哈希」从 CRM 系统换成 ME 自己的一段代码——除此之外任何组件仍不得持有或转发明文 PII。
- 红线 3(2026-09-09 修订二新增): `client_id` 的授权来源只能是 `crm_source_bindings` 服务端映射,不能是"能否 emit 进 Inngest 项目"或 payload 自报值——这条对所有外部 CRM 一视同仁,不因为某个 CRM"自己能哈希"就单独放行少一道校验。

**注意**: hash_scheme_version 是 shared 层字段(所有客户一样),用于消费者识别 CRM 侧 hash 规则升级,便于兼容迭代。

---

## 9. 决策记录(子牙拍板 · v2 承认)

1. **事件合约**: 我们先定发给 CRM 团队(§2C 硬前置)
2. **event_name = Purchase**: 硬编码 1:1 与事件名 `deal.closed` 绑定;未来新场景新事件名(§1 非目标 3)
3. **Google/TikTok 不预留 interface**,只 TODO 注释

---

## 10. 待命期不腐化(子牙硬要求)

不写代码 + 等 CRM = 待命腐化。v2 计划:

1. **写代码 + 契约测试 + dry-run 桩**(不等 CRM):
   - 消费者代码写完
   - 契约测试: `getMetaTokenForClient` 签名 / manual-items 3 kind / event schema
   - `scripts/emit-fake-crm-deal.ts` 发假 hash 事件 → 消费者跑通 → CAPI POST 带 `test_event_code` → Meta Events Manager Test Events 看到收到 · 证明整条路能跑
2. **CRM 上线日只做**: 事件名对齐 + 撤 `test_event_code`(几小时可完)
3. 待命期依赖变化(token-manager / manual-items / vocabulary 有人改)→ 契约测试 CI 立刻炸,不至于上线日才发现

---

## 11. 待 PM 的三件事(agent 跨不出去)

1. **上游对齐会**(§2C):PM 安排跟 CRM 团队对齐 §2 payload schema,让他们签字
2. **老单要不要回传**: Meta 硬性只认过去 7 天。CRM 上线时几个月存量老成交要不要一次特殊上传(需另做 offline conversions 批量上传通道,不走 CAPI)? PM 拍板做还是不做
3. **`META_CAPI_TEST_EVENT_CODE` env**: 待命期在 Render 生产设 test code(在 Meta Events Manager 里生成,免费),上线日撤。PM 授权时机

---

## 12. 分步交付

- **v2 通过审后**: 实现代码 + 迁移 + 桩(前提是 §11.1 上游对齐会已开)
- **CRM 上线**: 撤 test_event_code + 真发
- **未来**: Google/TikTok 适配器 = 新 PR

---

## 13. 已知边界(诚实)

- N1(子牙):浏览器 pixel 去重在 CTS 离线成交场景**不生效**——注释写清,未来在线支付场景才生效
- N2:EMQ 完整监控不做。**但加一条 daily cron 打日志汇总 events_received**(魏征 N-6 一句 SQL,救命)——第一版最低监控
- N3:客户名单历史批量补——不做,隔壁窗口手工中,待未来合流
- N4:自定义字段扩展——YAGNI
