# Magic Engine 2.0 · 页面优化共享能力契约 v1.0

> Issue [#873](https://github.com/bigbigraydeng-maker/magic-engine/issues/873)（WP00）· 父史诗 [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872)
> 直接消费者：[#878 WP06](https://github.com/bigbigraydeng-maker/magic-engine/issues/878) · [#880 WP07](https://github.com/bigbigraydeng-maker/magic-engine/issues/880) · [#879 WP05](https://github.com/bigbigraydeng-maker/magic-engine/issues/879) · [#884 WP09](https://github.com/bigbigraydeng-maker/magic-engine/issues/884)
> 状态：**只有文档。** 本文不写代码、不定接口签名、不建目录、不授权任何线上写入。
> 上游：[WP00 契约冻结 v1.0](./2026-08-10-me2-wp00-contract-freeze-v1.0.md) · [执行内核 v1](./2026-08-08-me2-execution-kernel-v1.md)

---

## 1. 它是什么

**一个共享能力，不是一个 Agent，也不是一个域模块。**

- Domain Module **推理**：这一页为什么该改、改成什么方向、改完怎么验。
- 本能力**精确干活**：把「改成什么方向」变成一份可评审的具体改动，在被授权之后真的写出去，并能撤回。
- Kernel **治权**：准不准写、写几次、花多少钱、写完谁负责验。

**共享的含义**：GEO Module 用它，将来 SEO Module 也用它，任何需要改客户页面的域都用它。**每个域各写一份页面写入逻辑 = 每个域各留一个绕过闸门的口子。**

### 1.1 调用边界（冻结，六条）

「整个共享能力只能由 Kernel 调用」这句话是**错的** —— 授权之前本来就要先把东西准备出来给人看，那一段不可能等 Kernel。正确的切分是**按「有没有对外副作用」切，不是按「是不是这个能力」切**：

| # | 冻结 |
|---|---|
| 1 | **Domain Module 可以产出 `PageOptimizationRequest`，但不许自己调 provider 适配器，也不许自己读写页面。** 它出请求，不碰通道 |
| 2 | **provider-neutral、non-write preparation workflow**（resolve · draft · diff · deterministic validate）**可以由应用编排层直接调用** —— 这一段不产生对外副作用，是给人看的准备工作 |
| 3 | **snapshot 与 provider 侧读取、以及内部草稿落库，必须留在共享能力边界之内**，并且在生产启用之前要先接上相应的成本 / 政策治理 |
| 4 | **任何会花钱的外部读取或模型调用都必须有声明好的预算上限**；上限**建立不起来就 fail closed**，不许「先读了再说」 |
| 5 | **apply 与 rollback 这两个 provider 写入入口，只能在拿到所需授权之后经 Kernel / Gateway 执行** |
| 6 | **`src/lib/capabilities/**` 之外不许存在任何 provider write import**（§7 —— 这一条由 ESLint + 架构测试机器强制，不靠自觉） |

#### 1.1.1 `non-write` 到底是什么意思（别读成「纯函数」）

早先这里写的是「纯的、provider 中立的准备流程」。**「纯」这个词是错的**，它会让人以为这一段没有计算、没有模型调用、没有落库 —— 而 `draft` 恰恰三样都有。正确的口径：

| 说法 | 含义 |
|---|---|
| **`non-write`** | **不产生 provider 写入 / 对外副作用。** 就这一件事 |
| **`non-write` 不等于** | 不等于零计算 · 不等于零模型调用 · 不等于零内部落库 |
| **`provider-neutral`** | 不出现任何 provider 专有字段、不绑死任何一个 CMS |

各段的真实性质，逐个说清：

| 段 | 是不是确定性 | 会不会花钱 | 说明 |
|---|---|---|---|
| **resolve** | ✅ 输入固定时是确定性的（路由判断按已连接 provider + 域名匹配） | 通常不花 | 见 §3.1 |
| **draft** | ❌ **可以是生成式的，不保证确定性** | ✅ **可能花钱**（模型调用） | 见 §3.3。它是 `non-write`，但**不是纯函数** |
| **diff** | ✅ 输入固定时是确定性的 | ❌ | 见 §3.4 |
| **deterministic validate** | ✅ 就叫确定性校验（同样输入必然同样结论） | ❌ | 见 §3.5。注意 provider 侧校验若需要回读，那部分归 §1.1 第 3、4 条 |
| **snapshot** | — | ✅ **可能花钱**（provider 读取 / 抓页面） | 是 provider 侧读取，**不在**第 2 条的可直接调用范围内，见第 3 条 |

**冻结**：**`draft` 或 `snapshot` 期间用到的任何模型 / provider 调用，在生产启用之前都必须接上显式的成本治理并声明上限；上限建立不起来就 fail closed。**「它只是准备阶段」不构成免于成本治理的理由。

> WP00 **不定**最终的函数签名，也**不定** ActionKey 名字。那是 WP06 / K-WP02 的事。这里只冻结「哪一段谁能调、哪一段必须过闸、哪一段要接成本治理」。

---

## 2. `PageOptimizationRequest`（provider 中立）

Domain Module 产出的是**这个请求**，不是一次 provider 调用。它必须在不知道客户用什么建站系统的前提下就能写出来。

一份完整请求要能回答：

| 问题 | 说明 |
|---|---|
| **改哪一页** | 客户 + 页面的**规范标识**（不是「某个 URL 字符串」—— 见 §3.1 resolve） |
| **改什么** | 语义意图（标题 / 描述 / 正文段落 / 结构化数据 / 内链 …），用**领域语言**表达，不是 provider 的字段名 |
| **为什么** | 指回 Finding 与 Evidence 的 lineage |
| **怎么算成功** | 配套的 VerificationDefinition（写在动作发生**之前**） |
| **基于哪个版本** | 提出请求时看到的页面版本标识（乐观并发的依据，见 §5） |
| **边界** | 明确不能碰什么（例如价格、法律声明、客户红线短语） |

三条冻结：

1. **请求里不许出现任何 provider 专有字段。** 出现了就说明抽象层漏了 —— 请求会被绑死在第一个接的 CMS 上。
2. **请求不携带授权。** 它是候选，授权由 Kernel 依客户政策签发。
3. **同一份请求必须能被路由到不同 provider**，各自产出各自的 diff，但语义意图不变。

---

## 3. 生命周期

```
【WP06 · non-write（无 provider 写入 / 无对外副作用）】
resolve → snapshot → draft → diff → validate
   det.     provider读   生成式    det.    det.规则
            (可能花钱)  (可能花钱)                │
                                                │
【WP07 · Kernel 授权后 · 有对外副作用】          │
              review → authorize → apply → verify → rollback
                                                       │
                                            lineage 全程记录
```

> `det.` = 输入固定时确定性。**`non-write` ≠ 纯函数 ≠ 免费** —— `snapshot` 与 `draft` 都可能花钱，都要按 §1.1 第 4 条声明上限（§1.1.1）。

### 3.1 resolve —— 把「哪一页」变成一个规范身份

resolve 要产出的是**两样不同的东西**，别混在一起：

| 产出 | 靠什么 | 没有它会怎样 |
|---|---|---|
| **路由决策**（这个 URL 该走哪个 provider） | 已连接的 provider + 域名匹配 | 不知道往哪写 |
| **规范页面身份**（这是客户的哪一个受管页面） | 可信的页面记录，或确定性的规范化规则 | 能写，但**页面级 lineage 与归因接不上** |

- **解析不了就停，不许猜。** 猜错的后果是改到别人的站。
- 仓库已有两件可直接复用的现成件：
  - `src/lib/cms/page-upgrade-plan.ts` 的 `resolvePageUpgradeExecution(pageUrl, providers)` —— **它做的是路由决策**：拿一个 URL，按已连接的 provider 与域名匹配决定走哪条路；匹配不上时明确返回「只存草稿」并说明原因。**它不需要页面台账也能给出路由结果**（前提是这个客户至少连了一个 provider）。
  - `src/lib/cms/connection-store.ts` 的跨客户闸门：域名不属于该客户时**抛错而不是返回 null**（2026-08-05 实测过一条 CMS 通道指向另一个客户的网站）。闸门放在**发放凭据这一层**，所以上面所有调用方自动安全。**新能力必须走这条凭据路径，不许自己另取凭据。**
- ⚠️ **ME2 要的规范页面身份比路由决策更强。** 它还要能消解重定向 / 别名 / 追踪参数，并且能在多次干预之间稳定地指向同一个页面 —— 那需要一条可信的页面记录或一套确定性规范化规则。
- ⚠️ Roman 当前既**没有页面台账**、也**没有任何已连接 provider**，所以他今天两样都缺（见 [Roman 范围文档](../clients/roman-hu/2026-08-10-geo-reference-loop-scope-v1.0.md) §3、§5）。**这是 Roman 的状态，不是既有解析器的缺陷** —— 不要把它写成「`resolvePageUpgradeExecution` 在页面台账为空时什么都解析不了」，那句话不成立。

### 3.2 snapshot —— 改之前先把原样存下来

- 抓取**改动前**的线上真实内容，**不可变**保存。
- 它有三个用途，缺一个都不行：diff 的基准 · 回滚的依据 · 「我们到底改了什么」的证据。
- 快照要带**抓取时刻**与**版本标识**（provider 提供什么就记什么，见 §5）。
- **快照失败 = 不许继续。** 没有 before 就没有可回滚的 after。
- **这一段是 provider 侧读取，必须留在共享能力边界内**（§1.1 第 3 条），**不属于**第 2 条那段可由编排层直接调用的 `non-write preparation workflow`。
- **会花钱的读取（抓页面 / 调 provider API）要有声明好的预算上限，上限建立不起来就 fail closed**（§1.1 第 4 条）。「只是读一下」不等于免费。内部草稿落库同理，留在边界内。

### 3.3 draft —— 生成候选内容

- 输入语义意图 + 快照，输出候选内容。
- 🔴 **这一段是 `non-write`，但它既不「纯」也不必然确定性。** 它**可以是生成式的**，**可能调用模型**，**可能花钱**，同样输入两次跑出来的结果**可以不一样**。`non-write` 只保证一件事：**不产生 provider 写入 / 对外副作用**（§1.1.1）。
- **它是这条生命周期里唯一允许生成式产出的一段。** 后面 diff 与 deterministic validate 在输入固定时是确定性的。
- **生产启用之前必须给它接上显式的成本治理并声明上限**，上限建立不起来就 fail closed（§1.1 第 4 条）。「它只是准备阶段」不构成免于成本治理的理由。
- 边界要显式：哪些区域允许改、哪些绝对不碰。
- **facade 先行**：复用现有 generator 时先包一层门面，**不重命名、不搬动、不重构现有文件**（#878 明确要求）。

### 3.4 diff —— 人能看懂的改动

- 输出必须是**人可评审**的：改了哪几处、每处从什么变成什么。
- **输入固定时是确定性的**（同一份 before 快照 + 同一份 draft → 同一份 diff）。
- 「有 47 处改动」不是 diff，是统计。
- diff 是审批界面要展示的东西 —— K-WP01 的界面要显示它。

### 3.5 validate —— 两层校验

| 层 | 查什么 | 是不是确定性 | 失败后果 |
|---|---|---|---|
| **语义校验**（deterministic validate） | 客户红线短语、事实性约束、不许改的区域有没有被碰、AU/NZ 拼写与地域口径 | ✅ 输入固定时确定性（判据是写死的规则，不是模型判断） | 直接拒，不进审批 |
| **provider 校验** | 目标系统接不接受这个结构（字段长度、允许的 HTML、必填项、主题限制） | ✅ 纯规则部分确定性；⚠️ **若需要回读 provider 才能判，那部分属于 provider 侧读取**，归 §1.1 第 3、4 条 | 直接拒，不进审批 |

**冻结：校验失败不许「先提交，让人在审批时发现」。** 审批人要判断的是「该不该做」，不是「这东西合不合法」。

**冻结：deterministic validate 里不许塞模型判断。** 一旦某条判据要靠模型来定，它就不再是确定性校验，得按 draft 那一档处理（成本治理 + 声明上限），并且不能再作为「拒绝进审批」的唯一依据。

### 3.6 review → authorize —— 人做决定

- 展示 diff + 为什么（lineage）+ 副作用等级 + 成本上限。
- 授权只能来自**认证过的会话**（见 WP00 契约 §9.4）。
- **pending 不等于可执行。** 在有人真的点头之前，任何界面不许把它呈现成「已安排」。

### 3.7 apply —— 真的写出去

- **provider 写入入口只能在拿到所需授权之后经 Kernel / Gateway 执行**（§1.1 第 5 条）。
- 必须携带 §6 的 provider 幂等键。
- 必须先检查快照是否已过期（§5）。
- 产出**执行回执**：什么时候、写到哪、provider 返回了什么、能不能撤回、怎么撤回。

### 3.8 verify —— 回读并断言

- **不许拿「写入成功」冒充「事情做成了」。** 回读线上内容，逐项断言改动真的在。
- **验证结论落库，不管成功失败** —— 失败的验证结论也是 lineage 的一部分。

**验证失败要分成两类，处置完全不同**（这一条替代早先那句笼统的「验证不重试」）：

| 失败类型 | 含义 | 处置 |
|---|---|---|
| **确定性断言失败** | 回读成功了，但内容对不上：改动不在、改错了、被别的东西覆盖了 | **绝不因此再 apply 一次。** 这是一个真结论，直接进人工处置 |
| **瞬时读取失败** | 回读本身没成：超时、网络错、限流、5xx。**我们根本不知道内容对不对** | **允许有界的、只读的重试**，按显式重试策略（次数 / 退避 / 总时限）。重试的是**读**，不是写 |

四条硬约束：

1. **重试验证永远不许重放写入。** 读侧重试与写侧重试是两件事，混在一起就会「为了看一眼有没有写成功，又写了一次」。
2. **区分不了「写失败了」和「写可能成功了」时，能不能重试 apply 由 provider 幂等能力决定**（§8 第 4 条）：provider 认幂等键 → 可以按同一把键重试；不认 → **一律 fail closed，升级给人判断**。
3. **验证重试耗尽 = 一个明确的「未解决 / 待人工复核」状态**，不是成功，也不是「大概成了」。它必须能被上游读到并如实展示。
4. 上面三条对 rollback 的验证同样适用。

### 3.8b 为什么不能一句「验证不重试」了事

那句话把两种完全不同的失败压成了一种：内容对不上（确定的坏消息）和根本没读到（不知道）。把「没读到」当成「验证失败」会制造假的失败告警；反过来，为了消除那个告警而允许再 apply 一次，就会在客户站点上写第二遍。**必须先说清是哪一种，才能决定下一步。**

### 3.9 rollback —— 撤回

- 每次 apply 都要有**明确的回滚路径**，在 apply 之前就确定。
- 回滚本身也是一次受治理的动作，也要留记录。
- **说不清怎么撤回的改动不许 apply。**

---

## 4. 每一段的失败语义

| 段 | 失败时 | 允许自动重试 |
|---|---|---|
| resolve | 停，说清哪一步解析不了 | ✅（纯读） |
| snapshot | 停，**不许在没有 before 的情况下继续** | ✅（纯读） |
| draft | 停 | ✅ |
| diff | 停 | ✅ |
| validate | **拒绝，不进审批**，说清违反了哪一条 | ❌（同样输入会同样失败） |
| authorize | 落一条带机器可读 deny 码的决策记录 | ❌ |
| apply | 见 §8 —— 结果未知时能不能重试**取决于 provider 幂等能力**；不认幂等键就 fail closed 升级给人 | ⚠️ 视 provider 而定 |
| **verify · 确定性断言失败** | 内容对不上 = 真结论。**绝不因此再 apply 一次**，直接人工处置 | ❌ |
| **verify · 瞬时读取失败** | 超时 / 网络错 / 限流 / 5xx —— 我们还不知道内容对不对 | ✅ **只读重试，有界**（显式次数 / 退避 / 总时限）。**重试读，绝不重放写** |
| **verify · 重试耗尽** | 落一个明确的**「未解决 / 待人工复核」**状态 | ❌ —— 它**不是成功**，也不是「大概成了」 |
| rollback | 停并升级 —— 撤不回来是必须有人立刻知道的事。其验证同样适用上面三行的分类 | ❌（写侧）· ✅（读侧，同上） |

---

## 5. 乐观并发与 stale snapshot

**要防的场景**：我们在 T1 抓了快照、T2 生成 diff、T3 人点头、T4 写回去。如果客户在 T2–T4 之间自己改了这一页，T4 的写入会**悄悄覆盖客户的改动**。

冻结规则：

1. 快照必须带一个**版本标识**（provider 给什么用什么：commit sha / 修改时间 / ETag / 内容哈希）。
2. **apply 之前必须重新核对版本标识。** 对不上 = stale。
3. **stale 时的默认行为是停手 + 通知，不是覆盖，也不是自动重跑。** 世界变了，原来那份 diff 可能已经不对了。
4. provider 不提供任何版本标识时，退化为**内容哈希比对**；连内容都读不回来的 provider，**这个动作在该 provider 上不许开启**。
5. stale 的处置是重新走一遍 resolve → snapshot → draft → diff → validate → review，**不是把旧授权拿去用**。

仓库现有先例：Kernel 用**代际 fencing**（`claim_generation` 单调递增）解决同一问题的执行侧版本，`geo_deployments` 表的设计注释里也记录了「用块哈希检测外部漂移，然后取消再重开，而不是强推」的同类思路。

---

## 6. provider 矩阵与中立性

### 6.1 现状（`origin/main` 实读）

`src/lib/cms/page-upgrade-plan.ts` 的 `resolvePageUpgradeExecution` 现在只有四个出口：

| provider | 模式 | 条件 | 性质 |
|---|---|---|---|
| WordPress | 重新读线上页面 → 逐项核对 → 写回 | 已连接 **且** 页面域名与连接站点同域 | 直接改线上 |
| GitHub | 开 PR | 已连接 | **PR 优先**：合并前不部署 |
| Shopify | 只存草稿 | 已连接 | 现有页面更新仍需人工，不自动写回 |
| none | 只存草稿 | 都没连 / 域名不匹配 | 安全兜底 |

生命周期跟踪也已有现成件：`src/lib/cms/page-upgrade-pr-state.ts` 的 `resolvePageUpgradePrTransition`（merged → `live`；closed 未合并 → `rejected`）+ `src/lib/cms/page-upgrade-pr-sync.ts`。

### 6.2 冻结的中立性规则

1. **能力本身对 provider 无知。** provider 差异全部收在适配器里。
2. **GitHub 一律 PR 优先。** 不直接 push 到默认分支，合并之后才算 live。
3. **WordPress 一律草稿 / 审核优先。** 不直接发布。
4. **不支持安全预览与回滚的 provider，一律降级为「只存草稿」**，并如实告诉人为什么降级 —— 不许假装做了。
5. **新增一个 provider = 新增一个适配器，不是改能力内核。** 如果加 provider 要改内核，说明抽象漏了。
6. **不许为了让某个 provider 跑通而把它的字段抬进 `PageOptimizationRequest`。**

### 6.3 Roman 的 provider 未知

Roman 在 ME 里**没有任何 CMS 连接记录**。按 §6.1 的现有逻辑，今天为他做路由决策会落到 `none / 只存草稿` —— **这是因为一个 provider 都没连，不是因为解析器坏了，也不是因为页面台账为空**（这两件事要分开说，见 §3.1）。

**冻结：不假设 Roman 的发布通道。** 它是一个必须由 PM 提供事实、由 Build Control Room 决定适配顺序的未决项（WP00 契约 §15 U1），不是可以在实施时顺手推断的东西。

---

## 7. `src/lib/capabilities/**` 物理边界

**这不是风格建议，是仓库里已经在强制执行的硬约束。**

`src/lib/kernel/boundaries.ts` 是唯一真相源，列出 10 个「对外写能力模块」：

```
@/lib/publer/client                        @/lib/cms/meta-patcher
@/lib/cms/wordpress-client                 @/lib/gbp/publisher
@/lib/cms/shopify-client                   @/lib/gsc/indexing-client
@/lib/cms/github-client                    @/lib/gsc/sitemap-ping
@/lib/cms/blog-publisher
@/lib/cms/github-page-upgrade-publisher
```

允许 import 它们的目录**只有 `src/lib/capabilities/`**。两道闸同时盯着：

- `.eslintrc.json` 的 `no-restricted-imports`（能被 `// eslint-disable` 关掉）
- `src/lib/kernel/__tests__/architecture.test.ts` 的文件系统扫描（**关不掉**，跑在 `npm test` 里）
- 还有一条测试专门盯着 `.eslintrc.json` 跟 `boundaries.ts` 对不对得上（两处各写一份必然分家）

历史 importer 用**精确路径**豁免（26 条，`PROVIDER_WRITE_GRANDFATHERED`），不是通配目录 —— 新文件默认撞规则，清单只会变短。

**由此直接推出的四条冻结**：

1. **任何 provider write import 都不许出现在 `src/lib/capabilities/**` 之外**（§1.1 第 6 条）。凡是要 import 上面那 10 个模块的代码，物理上就得落在 `src/lib/capabilities/` 下 —— 放 `src/lib/cms/` 或新建 `src/lib/page/` 都会当场撞架构测试。
2. **这条约束管的是 import，不是「谁能调哪个函数」。** provider-neutral、non-write preparation workflow（resolve 的路由判断、draft、diff、deterministic validate）不 import 任何 provider write module，因此**可以由应用编排层直接调用**（§1.1 第 2 条）。两件事别混：`capabilities/` 边界拦的是**对外写的物理入口**，Kernel 拦的是**执行授权**。
   > ⚠️ 「不 import provider write module」跟「不花钱、不调模型」是两回事。`draft` 落在这一段里，但它**可能调模型、可能花钱**，所以仍要按 §1.1 第 4 条接成本治理（§1.1.1）。
3. **往 `PROVIDER_WRITE_GRANDFATHERED` 加路径 = 又开一个绕过执行内核的口子。** 本史诗**不加**任何一条。
4. `src/lib/capabilities/` 内部**不许直连 `supabaseAdmin`**（`KERNEL_NO_SUPABASE_ADMIN_DIRS`），客户端由调用方注入。

---

## 8. Kernel 授权与副作用政策（WP07）

1. 每一个页面动作在注册表里都是一个**显式的 ActionKey**，带完整契约：输入 schema · 风险等级 · 副作用等级 · 可逆性 · 幂等规则 · 成本模型 · **provider 幂等能力** · 重试策略 · 验证方法 · 所需授权层级 · 步骤列表 · 允许的 purpose。
2. 页面写入的副作用等级是 **`outward`**。Kernel v1 在授权层与 Gateway **各拒一次**。让它能真正执行必须由 K-WP02 引入**逐个动作**的对外授权。
3. **永远没有全局对外旁路** —— 没有环境变量开关、没有「测试模式跳过」、没有 `if (allowOutward)`。
4. `providerIdempotency` 必须**逐个 provider 确认后如实填**（`not_applicable` / `supported` / `unsupported`）：
   - 收费步骤 + 结果未知 + provider 不保证幂等重放 → **不自动重试，直接转人工**
   - 不支持幂等键又要接的，必须在契约里显式标注「只能保证 at-least-once」，让授权层按此判风险
   - **不许用「有租约了所以没事」糊过去** —— 租约拦得住记账，拦不住已经发出去的那个调用
5. 每一次 apply 出示的幂等键**跨重试、跨死信重跑、跨接管都不变**（Kernel 已实现该语义）。
6. lineage 必须完整：为什么做 → 谁授权的 → 做到哪 → 有没有真做成 → 产生了什么业务结果。**缺任何一段都不算完成。**
7. **会花钱的外部读取（snapshot / verify 的回读）同样要有声明好的预算上限**，上限建立不起来就 fail closed（§1.1 第 4 条）。「只是读一下」不等于免费 —— 抓页面、调 provider API 都可能计费或计配额。
8. WP00 **不定** ActionKey 的具体名字，也不定函数签名。那是 K-WP02 与 WP06 的产出。

---

## 9. 明确禁止的三条路

### 9.1 普通页面不用 Google Indexing API

`src/lib/gsc/indexing-client.ts` 顶部已记录 2026-05-29 的实测结论：Google 官方把该接口限定在 JobPosting / BroadcastEvent 页面；其它页面**接受请求并返回 HTTP 200，但后台静默丢弃**，元数据接口对这些 URL 返回 404 证实了丢弃。

**所以它是一个会「成功」但什么都没发生的接口** —— 正是本仓库反复吃亏的静默失效形状。普通页面更新的正确做法是 `src/lib/gsc/sitemap-ping.ts`（迫使 Google 重读 sitemap）+ 人工在 GSC 里 Inspect 作为兜底。

### 9.2 `publish_geo_snippet` 不做 Roman 的主干预

`src/app/api/clients/[id]/cms/publish-geo-snippet/route.ts` 做的是：在客户 CMS 上新建一个**标题写死为 `GEO Directive (Magic Engine)` 的独立隐藏页**，把 GEO 指令 HTML 塞进去。

它不是「优化客户已有的商业页面」，是「另建一个页面装我们的东西」。两件事的效果、风险与可解释性完全不同。它同时也在 `PROVIDER_WRITE_GRANDFATHERED` 豁免名单里（即绕过执行内核的历史路径）。

**冻结：它不是 Roman v1 的主干预路径。** 本史诗不删它、不改它，也不拿它充数。

### 9.3 不重命名、不搬动现有 generator

#878 明确要求 facade 先行。理由：现有 CMS / 页面升级链路上有正在跑的生产行为（PR 同步、归因起算点），一次重命名就可能让某条链静默断掉，而断掉的表现是「什么都没发生」。

---

## 10. WP06 / WP07 的边界

| | WP06 #878 | WP07 #880 |
|---|---|---|
| **做** | resolve（路由决策 + 规范页面身份两件事分开）· snapshot · draft · diff · validate · 乐观并发元数据 · 现有 CMS 客户端走适配器 · 外部读取的预算上限 | ActionKey 映射 · per-action 副作用政策 · provider 感知的幂等与 stale-snapshot 检查 · 执行回执 · **两类验证失败的分流处置** · 回滚记录 · 完整 lineage |
| **不做** | **零线上写** · 不重命名 / 不搬动现有 generator · 普通页面不用 Indexing API · 不拿 `publish_geo_snippet` 当主路径 | 无全局对外旁路 · 无假审批链接 · 无假成功 · lineage 不许缺段 · **绝不为了「验证一下」而再写一次** |
| **依赖** | WP00（WP01 之后可与 GEO 运行时并行） | WP06 + K-WP01 + K-WP02 |
| **验收要点** | 同一份 `PageOptimizationRequest` 能路由到不同 provider 且语义不变；路由解析不了 / 快照失败 / 校验失败都停得干净；non-write preparation workflow 不 import 任何 provider write module；**draft 与 snapshot 的模型 / provider 调用都声明了成本上限，建立不起来就 fail closed** | 未授权无法执行；stale 快照停手；确定性断言失败不触发第二次 apply；瞬时读取失败按显式策略有界只读重试；重试耗尽落「未解决 / 待人工复核」；每次 apply 的幂等键跨重试不变 |

---

## 11. 本契约的未决项

| # | 未决 | 谁来决 | 卡住谁 |
|---|---|---|---|
| P1 | Roman 的发布通道是什么（决定第一个要做的适配器） | PM 提供事实 + Build Control Room 定顺序 | WP09 |
| P2 | **规范页面身份**从哪来（可信页面记录 vs 确定性规范化规则），以及谁负责维护 | Build Control Room | WP09（apply 与页面级 lineage）· 部分 WP08 |
| P3 | GitHub / WordPress / Roman 站点通道各自的幂等键支持情况 | WP07 实施时逐个验证 | WP07 |
| P4 | provider 不提供版本标识时，内容哈希的取值范围（整页还是受管区域） | Build Control Room（WP06 提方案） | WP06 |
| P5 | 「客户红线短语」的取用路径与逐字匹配语义 | Build Control Room（WP06 提方案） | WP06 |
| P6 | 回滚窗口有多长、过期之后怎么办 | PM（业务判断）+ Build Control Room | WP07 |
| P7 | 验证只读重试的具体策略（最多几次 / 怎么退避 / 总时限多久） | Build Control Room（WP07 提方案） | WP07 |
| P8 | snapshot 与 verify 回读的预算上限怎么定、算在谁头上 | PM（花钱）+ Build Control Room | WP06 · WP07 |
| P9 | 「未解决 / 待人工复核」这个状态落在哪、谁看得到、怎么消解 | Build Control Room（与 K-WP01 的审批界面对齐） | WP07 |
