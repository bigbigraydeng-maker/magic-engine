# CRM 客人「档案」：标准字段 + 永远不拿邮箱当名字 — 设计稿 v0（2026-10-22）

窗口 76 起草。状态：**设计稿，待子牙 + 魏征审。** 风险级：**B**（**不加表、不加列、不做迁移**；写 contacts 一列的修正是 PM 点头后的单独一步）。
PM 原话（2026-10-22）：「我们应该给客户做一个档案的概念，里面需要有客户的名字或者 nickname 以及邮件 电话。现在我们有时候进来的时候可能不知道客户叫什么，那也不能拿他的邮箱作为 name，我觉得系统里应该有标准的字段。」回复「做档案」（第一步：不改数据库结构；真名 / 昵称分列存储留作第二步）。
平台归位（跟班 · Tier）：L1 平台共用的 CRM 联系人底层，不新增支柱、不进候选表。

## 1. 事实（只读生产库，CTS，2026-10-22）

- 联系人 1203 个；**45 个的名字就是邮箱地址**（如 `hayleyhailstone@icloud.com`），20 个名字为空（其中一些连电话 / 邮箱都没有，只有 Facebook 私信编号）。
- `contacts` 只有一列 `display_name`；身份表 `contact_identities` 有 3 种：`email` 1002、`fb_psid` 918、`phone` 847。
- **邮箱变成名字的两个来源**：
  ① 邮件同步把 Graph 给的 `counterparty.name` 原样当名字（对方没有显示名时 Graph 给的就是邮箱本身）——`mail-ingest.ts` → `resolveContact({ displayName })`；
  ② **读侧凭空造名**：`contact-enrichment.ts` 的 `nameFromEmail()`——名字缺失时取邮箱 `@` 前面那段、首字母大写当名字（`brendam@…` 显示成「Brendam」）。页面上看到的「名字」其实是这么编出来的。
- 所有渠道建人都走同一个入口 `resolveContact`（`lib/crm/identity.ts`：WhatsApp、邮件、Meta 表单、网站表单、私信认人、电话、手工录入），名字清洗放这里一处就覆盖全部。
- 会话表 `conversations.participant_name` 本来就存着各渠道的**平台昵称**（WhatsApp 个人资料名 / Messenger 名 / 邮件显示名）。

## 2. 「档案」的标准字段（第一步，不改表结构）

| 字段 | 存在哪 | 规则 |
|---|---|---|
| **名字** | `contacts.display_name` | 客人的**真名**（或销售确认过的称呼）。**不是**邮箱、不是电话、不是占位词。可由销售在档案卡上直接改。 |
| **昵称** | 读自 `conversations.participant_name`（只读，不新增存储） | 各渠道上客人自己用的名字，按渠道列出（「WhatsApp：Kam」「Messenger：Susan L」）。 |
| **邮箱** | `contact_identities`（kind=email）+ `contacts.primary_email` | 可以有多个，主邮箱标出。 |
| **电话** | `contact_identities`（kind=phone）+ `contacts.primary_phone` | 可以有多个，主号码标出。 |

**显示规则（列表、抽屉、待办摘要共用一份）**：名字 → 昵称（非邮箱、非电话、非占位）→ 「问：他说的第一句」（沿用 2026-08-02 的既定做法，带「问：」标记，不假装是名字）→ **「未知客人」**。**永远不拿邮箱（或邮箱的一截）当名字。**

## 3. 改什么

1. **名字清洗 `cleanDisplayName(raw)`**（纯函数，放 `lib/crm/display-name.ts`）：去首尾空白；邮箱形状 / 纯电话形状 / 已知占位词（`WhatsApp Business`、`unknown`、`N/A`…）/ 没有任何可读字符 → 返回 `null`。
2. **入口一处挡住**：`resolveContact` 对传进来的 `displayName` 先清洗；清洗后为 `null` 就当没给名字（新建的人 `display_name = null`；命中已有联系人时**不覆盖**原名——现有「有名字才覆盖」的行为保持）。所有渠道自动受益，邮件同步不用单独改。
3. **去掉读侧造名**：`contact-enrichment.ts` 删掉 `nameFromEmail` 兜底（两处），缺名字就落到上面的显示规则。`isMissingName` 保留（它判「这个名字等于没有」，现在复用 `cleanDisplayName`）。
4. **档案卡**（抽屉里，在姓名下方）：显示名字（可点「改」）、昵称列表、邮箱列表、电话列表。新路由 `GET/PATCH /api/clients/[id]/crm/contacts/[cid]/profile`：`GET` 汇总；`PATCH { name }` 只改名字（清洗；邮箱 / 电话形状直接拒绝并说明；空串 = 清空回「未知客人」）；按 `client_id + contact_id` 收口，登录且有该客户权限才行。**第一步不提供改 / 加邮箱电话**（改身份会牵动合并 / 认人，另立设计）。
5. **历史数据整理（单独一步，需 PM 点头）**：把现有 `display_name` 是邮箱形状的 45 个联系人改成 `null`。先出只读清单；改前备份（id + 原名）；一键还原脚本随清单一起出。

## 4. 不做（本步）
- 真名 / 昵称分列存储（要加列 = A 级迁移，等看第一步效果再定）。
- 改 / 新增邮箱与电话、合并重复联系人（已有 `2026-10-17-crm-duplicate-contact-merge-design.md`）。
- 自动从邮件签名 / 正文抽取真名（可以做，但是另一件事：LLM 抽取要单独评审）。

## 5. 风险与护栏
| 风险 | 护栏 |
|---|---|
| 清洗太狠，把真名清掉（如名字里有 `@` 的昵称 `kay@home`） | 只在「整串是邮箱形状 / 整串是电话形状 / 在占位词表里」时才清；其余原样保留；测试各列反例 |
| 名字清空后，列表上一排「未知客人」 | 显示规则逐级回退（昵称 → 他说的第一句 → 未知客人）；不会比现在的「造名」更难认，且不再说假话 |
| 档案卡改名被滥用 | 与现有 CRM 写操作同一道鉴权；写 `updated_at`；名字长度上限 80；纯文本，不渲染 HTML |
| 改了名字，别的地方还在用旧名（待办邮件、摘要） | 摘要 / 待办都走 `contactCardTitle`，同一份显示规则；测试穷举调用方 |
| 历史 45 个修正出错 | 备份 + 还原脚本 + 先只读演示；PM 点头才写 |

## 6. 测试
- `cleanDisplayName` 各列表驱动：邮箱 / 电话 / 占位 / 空 / 表情 / 含 `@` 的昵称 / 正常中英文名 / 带空白换行。
- `resolveContact`：传邮箱形状名字 → 新建 `display_name=null`；命中已有联系人且传邮箱名字 → **不覆盖**原名；传真名 → 覆盖（原行为）。
- `enrichContacts`：缺名字时**不再**出现 `nameFromEmail` 的结果；有会话昵称时用昵称。
- 档案卡路由：跨客户取不到、PATCH 邮箱形状被拒、清空允许、长度上限、未登录 / 无权限。
- 每个 guard 做突变测试；全仓 `tsc --noEmit`。

## 7. 交付
1. 本稿 → 子牙 + 魏征审。
2. PR-1（B）：`cleanDisplayName` + `resolveContact` 入口清洗 + 去读侧造名 + 档案卡路由与组件 + 测试。
3. 只读清单（45 个）→ PM 点头 → 修正 + 读回。
4. （可选，第二步）真名 / 昵称分列存储：要加列，A 级迁移，PM「go apply」。

写代码交 DeepSeek（aider）：纯函数 / 路由 / 组件；`resolveContact` 入口接线（核心共用函数）由我自写并在 PR 写原因。

---

## 8. v0.1 修订（吸收子牙 + 魏征审查，均为「需改后进实现」）

**拆成两个 PR**（子牙 N5）：**PR-1 = 名字卫生**（只止住「邮箱当名字」，不加路由不加组件）；**PR-2 = 档案卡**（GET/PATCH + 抽屉组件）。

### PR-1 范围（修正后）
1. **`cleanDisplayName` 放进已有的 `lib/crm/display-name.ts`，不新建文件**；把三份占位词表（`contact-enrichment.ts` 的 `MISSING_NAME_LITERALS`、`link-contacts.ts` 的 `META_PLACEHOLDER_NAMES`——含「Facebook 用户」、通用占位词）合成**一份**放这里，旧处改为引用。`isMissingName`、`link-contacts.realDisplayName`、`contactCardTitle` 全部调它——不再有第三份判断。
2. **清洗规则（列表驱动测试写死）**：整串是邮箱 → null；`Name <a@b.com>`、`'a@b.com'`、`a@b.com (Bob)` 这类 → 去掉地址部分，剩下的若空或仍是邮箱 → null，否则取剩下的名字；整串是电话形状（数字 ≥ 7 位，只含 `+ - ( ) 空格`）→ null（`8888`、`007` 这种短数字不算电话，原样保留）；占位词（trim + 小写 + 去标点后集合匹配：unknown、unknown caller、n/a、null、undefined、`.`、`-`、Facebook 用户、Facebook user…）→ null；**没有任何字母 / 数字 / 汉字的（纯符号、纯表情）→ null（写死）**；**判「有没有字」用 Unicode 字母**（运行时构造 `\p{L}`，覆盖西里尔、阿拉伯、泰文、天城文等，不再用只认拉丁 / CJK 的 `MEANINGFUL`）；`kay@home`、`Mr. A. Smith`、`+1 Bob` **原样保留**。
3. **系统账号名不清洗**（魏征 B2）：`WhatsApp Business` 等继续作为名字存在，让 `isSystemAccountName` 过滤照常生效——否则系统账号会变成「未留姓名」重新排进「今天要联系」。
4. **入口清洗，且补上旁路**（子牙 B3 / 魏征 B1）：`resolveContact` 入口清洗；`messenger/unclaimed/claim/route.ts`（直接 insert）和 `link-contacts.ts:584`（直接 update）接上同一个函数；`import-march-bookings.ts` 等脚本逐个核对走没走 `resolveContact`。**加一条全仓扫描测试**：除白名单文件外，没有任何代码直接写 `display_name`。
5. **读侧**：`contact-enrichment.ts` 删 `nameFromEmail`（两处），**且 `display_name: resolvedName ?? contact.display_name` 改成「清洗后的名字或 null」，不回落原值**（子牙 B1）；`digest-shared.ts` 的 `stripAddress` 不再保留「邮箱 @ 前一截」；各处写死的「未留姓名」（`contact-response-row.ts`、`contacts/route.ts`、`timeline/route.ts`、`manual-crm-items.ts`）统一调 `contactCardTitle`。**兜底词统一用现有的「未留姓名」**（不新造「未知客人」，页面和测试里已经在用）。
6. **邮件这一路不再覆盖已有名字**：`mail-ingest.ts` 调 `resolveContact` 时传 `overwriteDisplayName: false`（子牙 B2；WhatsApp / 私信 / 官网表单 / 手工录入已经是 false；Meta 表单保持覆盖——客人自己填的名字越新越准）。
7. **风险级**：`resolveContact` 是所有渠道建人的共用入口，影响面大，我按「高影响 B」对待：只做输入清洗、不改任何判重 / 合并逻辑，改后跑全量 CRM 测试 + 对 CTS 生产数据只读重放（前后列表名字对比）；不是 A（不碰鉴权 / 数据库结构 / 钱 / 对客外发）。

### PR-2 补充（档案卡）
- 手工改的名字会被下一次 Meta 表单覆盖（魏征 B3）：PR-2 设计里决定保护办法——倾向「手工改名时写一条备注类触点，`resolveContact` 见到就不再覆盖」（不加列）；在 PR-2 的设计里单独评审，PR-1 不涉及。
- PATCH 拒绝控制字符 / 换行 / 零宽字符 / 邮箱或电话形状，长度 ≤ 80，纯文本；名字会进「按全名认亲」（`link-contacts.attachByUniqueFullName`）和发给 Meta 的受众 / 回传，这两处在 PR-2 设计里写明。
- 昵称：读 `conversations.participant_name`，**同样过 `cleanDisplayName`**（邮件那一路昵称常常就是邮箱），去重、最多显示 3 条。
- 历史 45 个修正：**必须在 PR-1 上线之后**（否则邮件同步会把邮箱名字再写回去）；先核对这 45 个都有邮箱可联系；还原脚本只还原「现在仍是 null」的行并同时恢复 `updated_at`。
- 数字口径：45 = `display_name` **整串是邮箱形状**的联系人数（含 `@` 的不算）；20 = `display_name` 为空。
