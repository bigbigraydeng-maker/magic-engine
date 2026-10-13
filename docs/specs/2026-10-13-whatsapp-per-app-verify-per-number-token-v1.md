---
title: WhatsApp 按应用验签 + 按号码取令牌（93 号窗口，A 级）设计 v1
status: draft-for-review
owner: session:12233466（93 号窗口）
decided_on: 2026-10-13
source: 56 号窗口转述 PM 已批准；上位设计稿 56 号工作区 docs/specs/2026-10-10-whatsapp-business-connect-plan-v1.md §3/§4.2/§9
---

**层级判定（tier-gate）**：L3 Connector，挂在既有 Leads/CRM 下；不新增能力线，不登记候选。
**范围**：只做 A（收信按应用验签）与 B（发信按号码取令牌）。不做回声/历史/模板/连接页面/群组/#1331。

## 0. 现状事实（读代码核实）

- 收信 `src/app/api/webhooks/whatsapp/route.ts` POST：只用环境变量 `META_APP_SECRET` 验 `x-hub-signature-256`，验过才解析；再按 `clients.whatsapp_phone_number_id` 找客户。
- 发信 `src/lib/whatsapp/send.ts` `sendWhatsApp`：读全局 `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`，并要求后者等于 `clients.whatsapp_phone_number_id`，否则 424 fail-closed。
- 令牌存储 `platform_oauth_connections`（唯一键 client_id+provider+account_id，AES-256-GCM，`encryptToken/decryptToken`）。provider 有库约束（最新为 20260811150000）。`HEARTBEAT_POLICY` / `SCOPE_REPLAYED_ON_REFRESH` 是 `Record<PlatformProvider,…>`，新增 provider 必须表态。只有 `purpose='meta_ads_read'` 的行受 Meta 广告触发器管。

## 1. 现有零件能装什么、装不下什么

| 要存的东西 | 现有零件 | 结论 |
|---|---|---|
| 号码对应的访问令牌 | `platform_oauth_connections`（provider 新增 `whatsapp`，account_id = phone_number_id） | 能装，只需加 provider 值 |
| 号码所属应用的验签密钥（app secret） | 无字段；`refresh_token_enc` 语义是刷新令牌，拿来塞密钥会误导后人 | 装不下 → 新增一张窄表 |

新表 `whatsapp_app_credentials`：`phone_number_id` 主键、`app_secret_enc`（AES-256-GCM）、`status`（active/disabled）、`created_at/updated_at`。RLS：`FOR ALL TO service_role USING (true) WITH CHECK (true)` + REVOKE anon/authenticated。令牌**不**放这里（避免两处存凭据）。

## 2. A：收信按应用验签

1. 读原始请求体，**不验签先解析**，只抽出所有 `entry[].changes[].value.metadata.phone_number_id`（去重）。解析失败 → 视为无号码。（此步结果只用来"选哪把密钥"，选出来后仍必须验签通过才处理。）
2. 查 `whatsapp_app_credentials`（status=active 且 phone_number_id 在集合内）：
   - 查询出错 → 503（要 Meta 重投，不放行）。
   - 号码集合为空，或没有任何一个号码有自己的密钥 → 用环境变量 `META_APP_SECRET`（**CTS 现有行为不变**；环境变量没配仍是原来的 500）。
   - 全部号码都有自己的密钥且密钥相同 → 用这把（解密失败 → 500，不降级到环境变量）。
   - 一部分有、一部分没有，或有多把不同密钥 → 401 拒收（Meta 一次推送只来自一个应用，混合 = 异常或伪造）。
3. 用选出的密钥走**现有** `isValidSignature`（常量时间比较，原样不改）。不通过 → 401。
4. 日志：不打印任何密钥/令牌/签名；只打印"选中来源=route/env"与号码个数。
5. 之后的解析、按 `clients.whatsapp_phone_number_id` 找客户、入库流程**一行不改**。

安全推理：伪造者想让服务用某把密钥验自己的包，必须在包里写某个号码；写 NAL 号 → 用 NAL 的密钥验，他没有；写 CTS 号（无自有密钥）→ 用环境变量验，他没有；混合 → 拒。一个应用的持有者无法冒充另一个应用的号码。

## 3. B：发信按号码取令牌

`sendWhatsApp` 在算出"该客户绑定的号码 ownedNumberId"（沿用 `clients.whatsapp_phone_number_id` 作为归属权威，沿用原有查询与错误文案）之后，凭据来源改为：

1. 先查 `platform_oauth_connections`：`client_id = 该客户 AND provider='whatsapp' AND account_id=ownedNumberId AND status='active'` → 解密 `access_token_enc` 作为令牌，发信号码 = ownedNumberId。解密失败 → 424 `no_token` 明确失败（不降级）。
2. 没有这样一行（或查询出错）→ 回退旧路径：仅当 `WHATSAPP_ACCESS_TOKEN` 与 `WHATSAPP_PHONE_NUMBER_ID` 都有且 `WHATSAPP_PHONE_NUMBER_ID === ownedNumberId` 才用（**CTS 现有行为与文案完全不变**）。
3. 两条都不满足 → 424 `no_token`，沿用 fail-closed。
4. 审计行、回写、CRM 触点逻辑不变；日志不含令牌。

按号码取的意义：连接行以 (client_id, whatsapp, 号码) 为键，所以 A 客户永远取不到 B 客户号码的令牌。

## 4. 配套（最小）

- 迁移 1：建 `whatsapp_app_credentials`；迁移 2：provider 约束追加 `whatsapp`（保留已有 8 个值 + 现网实测核对）。**只写文件，不执行**；执行库迁移要 PM 在对话里同意（A 级）。
- `vocabulary.ts` 加 `WHATSAPP: 'whatsapp'`；`connection-health.ts` 两张 Record 表态：`refreshable:false, staleHours:null`（系统用户令牌不过期；心跳口径是设计稿 §4.2.6，本轮不做）；`SCOPE_REPLAYED_ON_REFRESH` = null。
- 一个登记函数 `registerWhatsAppNumber({clientId, phoneNumberId, accessToken, appSecret?})`（`src/lib/whatsapp/register-number.ts`）：加密后写 `platform_oauth_connections`（token_expiry 取 2099，refresh 占位）与 `whatsapp_app_credentials`。附一个本地脚本从环境变量读值并支持 `--dry-run`（只打印"将写入哪两张表、哪些字段"，不连库、不回显秘密）。没有它，没人能把加密凭据写进去。

## 5. 刻意不做

回声/历史/状态回调、模板、连接页、群组、#1331 未认领号码待办、`isConnected` 改造、Graph 版本升级、把 `clients.whatsapp_phone_number_id` 迁走。

## 6. 风险与回滚

- 回滚：整体可回退到上一版代码；两张表是新增，空表时行为 = 现状（表空 → 环境变量；无连接行 → 环境变量路径）。
- 主要风险：选密钥逻辑写错导致 CTS 收信被拒（401）或被误放行。用单测锁死：空表/无号码/混合/多密钥/解密失败/查询失败各一条；变异验证（把"混合拒收"删掉测试必红）。

## 7. Reuse Statement（草稿）

复用：`platform_oauth_connections` + `encryptToken/decryptToken`（令牌）、现有验签函数、现有 webhook 入库与发信审计流程。新增且平台共享：按号码的验签密钥表、`whatsapp` provider、登记函数。行业专属：无。客户专属：只有表里的行（号码、密钥、令牌），不进共享代码。换客户测试：NAL 换成 CTS 或地产客户，共享代码不用改，只多一行数据。落点与 tier-gate 决策一致（L3）。

## 8. 设计审查修订（魏征，2026-10-13，已并入）

1. **号码格式异常一律拒收**：只要任何一个 `metadata.phone_number_id` 存在但不是「非空、纯数字字符串」→ 401（不当作"无号码"回退环境变量）。完全没有 metadata 的变更项才算"无号码"。
2. **号码数量上限 20**：去重后超过 20 个 → 401，且不查库。
3. **同一把密钥下多个号码允许**（同一应用下多个号码，密钥相同即可）；密钥不同或混合 → 401。写成测试。
4. **发信**：只要存在该客户 + 该号码的 whatsapp 连接行（不论状态）→ 只用该行；状态非 active → 424 明确失败，**不回退环境变量**。只有「没有这行」或「查询出错」才回退环境变量，且仍要求环境号码 == 绑定号码。
5. **日志**：解密失败、查询失败只记错误类别/`error.message` 的固定前缀，不记错误对象本体、不记密文、不记签名、不记令牌。
6. **断言核实**：「Meta 一次推送只来自一个应用」依据是 Meta 的推送订阅按应用配置；本轮按此保守实现（混合就拒），真实环境由 56 号实测确认；PR 里标「未在真实 Meta 上验证」。provider 约束值以仓库迁移文件为准（最新为 20260811150000，已 grep 核对无后续改动）。
7. **测试**：现有 `route.test.ts` 的 `from` 桩要补 `whatsapp_app_credentials` 空表默认；`send.test.ts` 凭据未配用例按新顺序更新。新增变异可抓用例：混合号码→401、不同密钥→401、停用密钥行→按无自有密钥处理、号码类型异常→401、超量→401、NAL 号用环境密钥签→401、CTS 号用 NAL 密钥签→401、密钥表查询失败→503 且不碰客户表、发信连接行停用→424 不回退、连接行 account_id 不一致→回退但号码校验仍拦。

## 9. 设计审查修订（子牙，2026-10-13，已并入；与 §8 冲突处以本节为准）

1. **查密钥表出错 ≠ 503**：先用环境变量 `META_APP_SECRET` 验签，通过就按"CTS 旧路径"继续处理；不通过（或环境变量没配）才 503。原因：表还没建/瞬时故障时 CTS 收信不能断；攻击者没有环境变量里的密钥，所以这个回退是安全的。**上线顺序：先在库里建表，再上代码**（写进 PR 与台账）。
2. **号码口径对齐下游**：只接受非空纯数字字符串（≤32 位），其余一律 401；去重后 >20 个 401；请求体 >1MB 直接 413（不解析、不查库）。
3. **发信**：原先「没有环境变量就先返回 no_token」的前置检查，挪到「连接行查不到」之后；连接行优先。
4. **登记函数**校验 `clients.whatsapp_phone_number_id` 等于传入号码（防登记错客户）；不一致直接报错不写。
5. **漏项**：`src/lib/pm-todo/platform-connection-items.ts` 的 `PROVIDER_COPY` 补 `whatsapp`（`ENROLMENT_ANCHOR` 只管 gsc/ga4，不用动）。迁移保留 8 个旧值再加 `whatsapp`（沿用 20260811150000 写法）。`token-manager` 不对 whatsapp 调 `getValidToken`（发信直接读连接行）。
6. **测试补**：「密钥表查询报错时 CTS 仍能收信」「连接行状态非 active → 424 不回退」「令牌解密失败 → 424 不回退」。

## 10. 实施后审查补记（子牙，2026-10-13）

- 密钥解密失败（`decrypt_failed`）返回 500（让 Meta 重投，不放行）。
- 登记函数先写令牌、后写密钥；密钥写失败时返回明确错误「令牌已存、密钥未存，重跑即可」（两步写入都是幂等 upsert）。
- 一个号码「登记了令牌、没登记密钥」，其收信会用 `META_APP_SECRET` 验签；若该号码属于另一个应用会被 401——所以接入 NAL 时令牌和密钥必须一起登记（PR 与台账写明）。
