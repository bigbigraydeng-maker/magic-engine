# 广告户绑定：从授权商务管理平台选账户（设计稿 v4，已审设计、未排期，仅设计）

- 日期：2026-10-20　窗口：119　风险级别：**A**（账户归属 = 谁能被停广告/改预算；碰钱的上限；要加数据库迁移）
- 状态：v4 = **最后一轮改稿**，送一次终审（只核对 18 号第三轮清单）。通过后作为「已审设计、未排期」存档；**本期不写代码**——CTS 的两个户已绑好，绑第二个户是低频操作，眼下不卡任何事。
- 版本：v1、v2、v3 三轮两审均为「改设计再审」。v4 把范围再收口：第一刀只做 §0 的三项；旧 PATCH、解绑、换主、迁移入口、去 BM 号等**全部移出**，写进「后续」并写明风险。

## 0. 目标与范围

PM 诉求：能给一个客户绑多个广告户，不必手输账户号。

### 第一刀（唯一范围）
1. 列候选账户（只读）。**为此需要抽出一个只管分页读 `adaccounts` 的读取函数**（§3），属于本项必要组成，不另算范围。
2. 给**已有主账户且已在登记表里有行**的客户加一个**副账户**（带币种、日上限、立即抓快照）。
3. 单独改副账户标签。
4. 附带一个文案修正（§7）：待办里「去客户设置里解绑」的提示，本期没有解绑功能，改写。

### 后续（不在本期，各自另出设计稿）
解绑；换主账户（设主）；收紧旧 PATCH（`meta-ad-account/route.ts:133`）；把「只有旧列」的客户迁入登记表的入口；审计与预览里去掉 BM 号 / 他客户名（既有代码 `binding-service:133`、`:152`）；「移除在投旧主即拒」类规则（它会卡住纠正误绑，见 `registry-write.ts:5-11`，需单独权衡）；员工配置专属令牌的界面。

### 本期不动
作战地图、自治信封、`daily-cap` PATCH、旧 PATCH、PR 2935。

## 1. 已有 / 真缺口（已核对代码）

已有：改主账户三道闸与审计（`ad-account-binding.ts`、`ad-account-binding-service.ts`）；日上限唯一入口（`ad-accounts/[accountId]/daily-cap`）；账户状态常量 `src/lib/ads-strategy/account-status.ts`（已在 main；关闭集合 `{2,100,101}`，code 3=欠款）。
缺口：无候选清单；无直接加副账户入口；标签不能单独改。

## 2. 为什么危险（设计前提）

1. 读取方只要登记表有行就不再回落旧列（`client-ad-accounts.ts:49`、`campaign-ownership.ts:58`、`common.ts:54`）：对零行 / 只有旧列的客户直接加副账户，主账户会静默消失。
2. 绑第 2 个账户的瞬间，原账户也变成「日上限未配置」（`envelope-facts.ts:696`），整客户加预算被拒。
3. 内核没有账户状态判断。
4. 跨客户唯一性目前只在应用层，并发可双绑。
5. 共享令牌能看到多家客户账户：「读得到 ≠ 属于」（`ad-account-binding.ts:15`）。
6. **加错无法在本期撤销**：本期没有解绑。加错的副账户只能由开发直接处理库。→ POST 必须确认弹窗写明「本期无法自行撤销」，且校验宁严勿松（§5）。

## 3. 令牌来源与读取函数

- 令牌 = 管道实际在用的那把：`resolveMetaTokenDetailed`（与 `snapshot-sync.ts:242` 同源）。
- 要求：客户存在，且令牌来源是**客户专属**。`shared_fallback` / `ownership_unknown` / 无令牌 → 候选清单返回空 + 提示；**POST 一律拒绝**（绕开清单也绑不了共享令牌能看到的账户）。
- **谁怎么配专属令牌**：目前专属令牌是服务器环境变量，**没有员工界面**。本期不做界面；由开发在服务器配置并手动重新部署（改环境变量不会自动生效，见部署手册）；候选清单返回空时，提示文案写「该客户没有专属授权，请联系开发配置」。配置界面列入「后续」。
- 读取函数：`ai/manage.ts` 的 `discover` 只吃客户 OAuth 连接、要求授权人本人且试点已开通、占 Ads-AI 限流，不直接用。从其中**抽出只管分页读 `adaccounts` 的函数**（入参=令牌），`discover` 改调它（行为不变，原测试保持绿）；候选清单与 §5.2 的 Graph 核实共用它。
- 候选清单字段：脱敏账户号、名称、状态码、币种、`bound_elsewhere`（布尔）。**不含** BM 号、不含他客户名。这是新接口自身的约束；**既有预览**（`binding-service`）里带 BM 号 / 他客户名的人工核对仍保留，本期不削弱它（后续再设计替代办法）。
- 清单只是便利，不是归属证据，不设「必须在清单里」校验。

## 4. 接口

| 方法 路径 | 作用 |
|---|---|
| `GET /api/clients/[id]/ad-accounts` | 扩展现有：名称/脱敏号/标签/主副/实时状态/币种/日上限；状态读不到显示「未知」 |
| `GET /api/clients/[id]/ad-accounts/candidates` | 候选清单，规则见 §3 |
| `POST /api/clients/[id]/ad-accounts` | 加一个副账户。不调 `bindAdAccount`；无覆盖开关；请求体只接受 `ad_account_id`、`label`、`daily_budget_cap_cents` |
| `PATCH /api/clients/[id]/ad-accounts/[accountId]` | 只改 `label`；多余字段 → 400；路径 `accountId` 不属于该客户 → 404 |

仅内部员工（`requireGlobalAdmin`）。

## 5. POST：严格顺序、各步失败状态与补偿

### 5.1 前置校验（全部 fail closed，任何一条不过都不写库）
1. 内部员工；令牌来源 §3。
2. 规范化 `parseAdAccountInput`。**Graph 核实该账户可读**：复用现成的 `verifyAdAccountAccessible`（`ad-account-binding.ts:126`，用专属令牌直读 `act_<id>`），并在 `:132` 处补返回币种；**不用候选列表函数来核实**（那等于变相「必须在清单里」，且列表分页截断会误拒，也与 §3 矛盾）。读不到即拒。
3. 该客户必须已有主账户且**登记表里有行**。零行 / 只有旧列 → **拒绝（报错，不是放行）**：「该客户尚未迁入账户登记表，请联系开发」，并写 outcome=`blocked_legacy_only`。
4. **冲突查重**：用现成的 `meta_ads_account_conflict(tenant, account)`（`20260920064556:99`，**同时查登记表、`clients` 旧列、读授权表**），命中 → 拒，只回「该账户已被占用」，不泄露客户名。另与本客户已有行比对（含 `123` vs `act_123`）。
5. 币种：读不到 → 拒；与现有账户币种不一致 → 拒（理由同 daily-cap 币种闸）。
6. 日上限先行条件：现有每个账户已配日上限（否则拒并提示先补）；本次必须同时给上限；各账户上限之和 ≤ 客户总上限（沿用 daily-cap 规则）。
7. 欠款/停用账户允许作为副账户绑定，界面标「不可用」。

### 5.2 写入顺序（钉死；上限放在快照之后）
`daily-cap` 要求账户已绑，并读账户级快照里的币种（`daily-cap:94-199`、`:165`）。快照在写库之后才存在，所以**先上限必 409**。因此：

| 步 | 动作 | 失败时状态与处理 |
|---|---|---|
| ① | 单事务 RPC：插入登记行（副账户，`daily_budget_cap_cents` 先为空）+ 写审计（outcome=`authorized`→成功后 `applied` 在⑤）。RPC 返回**新行 id** | 失败：事务整体回滚，什么都没留下；23505（唯一索引）→ 回「已被占用」 |
| ② | 一次抓**全部**账户的快照（含现有账户，否则 `envelope-facts.ts:165` 判「非同一轮」，加预算被拒） | 失败：进入补偿（§5.3）。**补偿判据不看「全部抓取是否 success」**：任一旧账户抓失败不得误删新户（`snapshot-sync.ts:254`）；只看**新账户自己的快照是否存在** |
| ③ | 确认新账户的账户级快照**是本次抓取产生的**（`captured_at` 晚于步骤①的时间，且该轮抓取 complete，含币种） | 不满足：进入补偿。补偿不清快照，所以必须限定「本次」，否则重试时会拿旧快照「空过」 |
| ④ | 写日上限（走 `daily-cap` PATCH 逻辑，以其返回为准） | 失败（409/校验不过）：进入补偿 |
| ⑤ | 审计 outcome 更新为 `applied` | 失败：不影响数据；记日志 + 生成人工待办（审计缺口） |

### 5.3 补偿（不是回滚，是补偿删除）
- **只在本次 ① 成功之后触发**，且**只按 ① 返回的行 id 删除**，并带条件 `is_primary = false`，命中必须恰好 1 行；0 行或多行 → 视为补偿失败。
- 补偿成功：审计 outcome=`compensated`，向员工报错并说明原因。
- 补偿失败：审计 outcome=`compensation_failed`，**同时生成人工待办**（见 §5.4），并向员工报「留下了半成品，已通知处理」，不假装成功。

### 5.4 未走完 / 补偿失败的人工待办（拉模式，不是路由里「创建」）
待办在本系统是**拉模式**：由各 pusher 定期读数据生成（参照 `src/lib/pm-todo/manual-items.ts`），没有路由能直接创建待办；种类须登记进 `LANE_OF_KIND` 穷举表（`five-kinds.ts:56`）。因此：
- 新增一个 pusher `ads_account_bind_incomplete`：读审计表 `client_binding_audit`，命中以下两类行就生成待办：① outcome=`compensation_failed` 且对应登记行仍在、日上限仍为空；② outcome 长期停在 `authorized`（超过一个约定时限未走到 `applied` / `compensated`）。②同时覆盖「①后⑤前进程被打断，既不补偿也无告警」的缺口。
- 在 `LANE_OF_KIND` 登记该 kind，归 dev 车道。
- key：`ads_account_bind_incomplete:{clientId}:{规范化账户号}`（同账户不重复）。
- what：「给 {客户名} 加第二个广告账户 {脱敏号} 时中途失败，库里留了一条不完整的记录；它没有日上限，会让整个客户的加预算被拒。」
- how：「联系开发：按审计记录里的行 id 删掉这条不完整记录（或补齐上限），再重新添加。」
- href：该客户广告健康页（同 `ads-account-status-items.ts` 的 `adsHealthHref(clientId)`）。

### 5.5 审计
审计先于数据变更写入；审计写失败 → 不写数据。

## 6. 数据库（A 级迁移）

1. **唯一索引**：格式 CHECK（`^act_[1-9][0-9]{9,24}$`）+ `ad_account_id` 普通唯一索引。不重造归一化。迁移前置检查：存量里不符合格式或已重复的行，**只列出不自动改**。
2. **与旧 PATCH 的关系（更正 v3 的说法）**：全局唯一索引会让旧 PATCH 的「共用账户覆盖」在登记表层报 **23505**（`registry-write.ts:62`），不是不受影响。本期不改旧 PATCH，所以：旧 PATCH 的「覆盖共用」在全局唯一后会报 23505、失败。这是**有意**的收紧，但由此带来的已知问题与应对写在 §8。
3. **审计枚举扩值**：表 **`client_binding_audit`**（`20260913120000`）。
   - `action` CHECK（:29）新增：`add_secondary`、`relabel`。
   - `outcome` CHECK（:32）新增：`blocked_legacy_only`、`compensated`、`compensation_failed`。（`blocked_legacy_only` 是 outcome，不是 action。）
   - RLS 不变，仍 `FOR ALL TO service_role`。
4. **错误码映射**：23514 不一律转 409：来自触发器 `meta_ads_registry_guard` → 409；来自 CHECK（迁移未 apply）→ 500 并提示「迁移未应用」。23505 → 「该账户已被占用」。
5. **新 RPC** 权限：`REVOKE ALL FROM PUBLIC/anon/authenticated`，仅 `GRANT EXECUTE TO service_role`（仿 `20260920064556:193`）。事务内只含库内写，无外部读写。

## 7. 待办文案修正（第一刀附带）

`src/lib/pm-todo/ads-account-status-items.ts:178` 的 how 现在写「在客户设置里把它解绑」，但本期没有解绑功能。改为：「确认这个账户确实不用了，就联系开发把它从登记里移除；还要用就去 Meta 后台申诉恢复。这条每周一提醒一次。」并在 `ads-account-status-items.test.ts` 里**新增**对该文案的断言（目前没有）。

## 8. 本期不动旧 PATCH：风险与已知问题

旧 PATCH 仍接受共享令牌（`binding-service:78`），可以：把死户设为主、移除在投旧主；改主后草稿（`draft:46`）、同步（`sync:64`）、评论回复（`comment-autoreply-posts:63`）、日 cron（`pullback:422`）仍只认主账户；CTS 迁移计划 §1.6 写明「暂不翻主账户」。本设计**不放大也不修复**这些：第一刀的新接口不触碰「谁是主账户」。风险由现有的内部员工限定 + 审计兜底；收紧旧 PATCH 在「后续」。

**全局唯一索引带来的已知问题（本期接受，写明）：**
1. 旧 PATCH 的「覆盖共用」（共用账户的员工显式覆盖）在全局唯一后会在登记表层报 23505 而失败——有意收紧，应对：路由把 23505 映射成清晰错误「该账户已登记在别的客户名下，登记表不再允许共用」，并在员工界面说明。
2. 旧路由遇 23505 目前会显示成「可以重试」（`binding-service:118`）：这是不准确的提示，列为已知问题，随旧 PATCH 收紧一并改（后续）。
3. 旧 PATCH 失败时的回滚会按写前快照整体恢复，**可能删掉并发新增的副户行**（`registry-write:100`）：与本期 POST 同时操作同一客户时才会发生，概率低；应对：员工在同一客户上不并行操作；彻底解决需把旧 PATCH 也改成单事务（后续）。

**待 PM 确认的问题（不替他定）：** 是否**永久禁止**两个客户共用同一个广告账户？全局唯一索引会把这条变成硬规则；如果业务上存在合法共用（例如代运营共用一个账户），需要另设计「共用账户」的表达方式，而不是靠覆盖。本期按现有数据（无合法共用的已知案例）先上全局唯一，但这一条要 PM 点头后才进迁移。

## 9. 敏感信息（范围说明）

新增接口的响应与审计不含 BM 号 / 他客户名（审计只记 `token_source` 枚举）。既有代码 `binding-service:133`、`:152` 的 BM 号写入保持不变，列入「后续」；不削弱既有预览的人工核对。

## 10. 验证计划

### 10.1 测试（每条校验一个「应该拒」用例并做变异：去掉校验，对应用例必须变红）
- 真 resolver（不 mock `resolveMetaTokenDetailed`）：专属 / 共享回落 / 无令牌 / 客户不存在；**POST 共享令牌可见的账户被拒**。
- PATCH：多余字段 400；路径 `accountId` 非本客户 404。
- 真库：触发器 `meta_ads_registry_guard`、审计 action/outcome CHECK、格式 CHECK、唯一索引（并发双绑、`123` vs `act_123`）；仿 `scripts/meta-ads-ai-db-check.mjs`。
- 查重用 `meta_ads_account_conflict`：别家「只有旧列」的主账户被拒。
- 顺序与补偿：①成功后②失败 → 补偿删除按行 id；**某个旧账户抓取失败但新账户快照存在 → 不误删**；补偿 0 行 → `compensation_failed` + 生成待办；④失败 → 补偿；审计写失败 → 数据不改。
- 币种读不到 → 拒；上限和 > 总上限 → 拒；现有账户未配上限 → 拒；Graph 读不到 → 拒。
- 读取函数：分页（多于一页）；`discover` 行为不变（原测试保持绿）。
- 待办文案测试。

### 10.2 生产只读查询（动手前先做，PM 已一次性授权只读调查）
```sql
-- 存量跨客户重复（规范化后相同的账户号出现在 >1 个客户）
SELECT regexp_replace(lower(ad_account_id),'^act_0*','') AS acct, count(DISTINCT client_id) AS n, array_agg(client_id)
FROM client_meta_ad_accounts GROUP BY 1 HAVING count(DISTINCT client_id) > 1;
-- 存量格式不合 CHECK 的行
SELECT id, client_id, ad_account_id FROM client_meta_ad_accounts WHERE ad_account_id !~ '^act_[1-9][0-9]{9,24}$';
-- 零行客户 / 只有旧列的客户
SELECT c.id FROM clients c LEFT JOIN client_meta_ad_accounts a ON a.client_id=c.id
WHERE c.meta_ad_account_id IS NOT NULL AND a.id IS NULL;
-- 旧列与登记表不一致（旧列有值，但登记表里没有这个账户；或主账户标记对不上）
SELECT c.id, c.meta_ad_account_id FROM clients c
WHERE c.meta_ad_account_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM client_meta_ad_accounts a WHERE a.client_id=c.id)
  AND NOT EXISTS (SELECT 1 FROM client_meta_ad_accounts a WHERE a.client_id=c.id
                  AND regexp_replace(lower(a.ad_account_id),'^act_0*','') = regexp_replace(lower(c.meta_ad_account_id),'^act_0*','') AND a.is_primary);
```
有结果则迁移前先由开发人工处理，不自动改。

### 10.3 演练与审
- 夹具账户走「候选→加副账户→抓快照→补上限→改标签」，不碰真广告；夹具必须带账户级快照。候选清单对 CTS 做一次只读真实读取。
- 审：本稿终审（只核对 18 号第三轮清单）；排期后实施前再审、实施后再审；碰账户归属加狄仁杰攻击验证（绕前端直接 POST 他客户账户号、共享令牌账户、并发双绑）。A 级 PR 保持草稿，合并只在 PM 回「合 N」且 head 与签字 SHA 一致后。

## 11. 平台化自检

L3 Connector 管理面，挂在广告支柱账户登记下，不新增能力线、不新增表；换客户 / 换行业代码均不用改。不需要 Inngest：纯同步管理写入，已有审计回执；补偿失败走人工待办（§5.4）。
