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
