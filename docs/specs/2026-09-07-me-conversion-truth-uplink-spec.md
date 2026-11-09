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

## 3. 最小实现(1 新文件 + 4 改)

**新增** `src/lib/inngest/functions/crm-deal-capi-uplink.ts`(cloud 消费者)

**改**:
- `src/lib/inngest/functions/index.ts` — 加进 `cloudFunctions`(id `cloud-crm-deal-capi-uplink`,子牙 B5)
- `src/lib/inngest/functions/__tests__/registration.test.ts` — 契约测试:断言 `me/crm.deal.closed ∉ WORKER_OWNED_EVENTS`(子牙 B5)
- `src/lib/flywheel/vocabulary.ts` — 加 `ads.uplink_conversion`(子牙 N4 · 语义比 `capi_uplink` 更贴,未来 Google/TikTok 归同类)
- `src/lib/pm-todo/manual-items.ts` — 加 kind: `capi_no_config` / `capi_meta_rejected` / `capi_invalid_payload` + `pushCapiItems`(子牙 B1)

**同 PR 迁移(A 级 · service_role RLS)**:
- 建 `me_capi_uploads` 已发账本表(魏征 BLOCK-6):`(client_id, deal_id, event_name, uploaded_at, payload_hash, hash_scheme_version)`,`UNIQUE(client_id, deal_id, event_name)`
- `clients.meta_pixel_id text` 列(子牙 B2 · 二选一里选 A:走列而非 env,列不存在的运行时分支删除)

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

## 7. 治理 / 边界(不变)

- 不需要人工审批(不占花钱/对外/难撤三占,与 me_ad_launch 审批闸判据一致)
- 但 PII 高敏 → hash 在 CRM 侧完成 + metadata 白名单 + 明文禁进任何 ME 存储/日志
- 失败一律进 `manual-items.ts`「🙋 需要你动手」,带 what/why/href
- **同因合并 / 熔断**(魏征 BLOCK-12):`pushCapiItems` 同 client_id + kind 一天合成一条,同 client 连续 5 次同因触发消费者层熔断(30 分钟不再进 manual-items,只计数)

---

## 8. Reuse 声明(红线对账)

**复用**: `getMetaTokenForClient`(token-manager.ts:69) · flywheel_actions 直插(daily-plan-publish 模式) · manual-items 失败落点 · cloud Inngest 骨架 · CTS pixel/token 今日修地基填的 env。**不另起**任何 Graph 客户端 / 审批体系。

**分层**:
- **L1 shared**: 消费者、幂等账本、metadata 白名单、CAPI POST、事件名↔Meta event_name 映射表(硬编码 1:1)
- **L4 config**: 客户 pixel_id / token / (未来)自定义业务事件↔Meta event_name 的扩展
- 红线 2: 客户 PII 明文永不进 shared runtime;deal 语义 fact 不进 shared

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
