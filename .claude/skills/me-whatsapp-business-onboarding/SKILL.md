---
name: me-whatsapp-business-onboarding
description: 客户从零注册 WhatsApp 企业号、绑定资产、最终接入 Magic Engine 的完整端到端指南。涵盖三个阶段——阶段一：注册 WhatsApp Business 账户（Meta 商务后台建 WABA、号码准备、企业资料）；阶段二：绑定资产到 ME 公司（系统用户、权限分配、令牌）；阶段三：接入 ME 平台（标准接入 vs 并存接入两条路径、平台级关卡、webhook 配置、验证）。触发场景：「WhatsApp 接入 ME」「客户要在 ME 里收 WhatsApp」「怎么给客户接 WhatsApp」「WhatsApp 并存怎么做」「客户怎么注册 WhatsApp 企业号」「WhatsApp 资产怎么绑」，或直接输入 `/me-whatsapp-business-onboarding`。
---

# WhatsApp Business 接入 ME · 从零到通 完整指南

---

## 全流程总览

```
阶段一：注册                阶段二：绑定资产               阶段三：接入 ME
┌─────────────┐      ┌────────────────────┐      ┌─────────────────────┐
│ 1. 准备号码    │      │ 5. 建系统用户         │      │ 8. 问客户：手机 app   │
│ 2. 建 Meta 商务 │  →   │ 6. 分配 WABA + 号码   │  →   │    要不要保留？       │
│ 3. 建 WABA     │      │    权限给系统用户       │      │ 9. 走路径 A 或 B     │
│ 4. 填企业资料   │      │ 7. 生成令牌           │      │ 10. 写 ME 数据库     │
└─────────────┘      └────────────────────┘      │ 11. 测试收发消息     │
                                                  └─────────────────────┘
```

**每一步都在下面展开讲。** 如果客户已经有 WABA 和号码，直接跳到阶段二；如果资产也绑好了，跳到阶段三。

---

## 阶段一：注册 WhatsApp Business 账户

> **目标**：让客户在 Meta 后台有一个审批通过的 WhatsApp Business Account (WABA)，准备好一个能接验证码的手机号。

### 前置条件

| 条件 | 说明 | 没有怎么办 |
|---|---|---|
| **一个手机号码** | 专用于 WhatsApp Business，格式 +64…（NZ）或 +61…（AU）。建议不要用老板个人号。号码要能收短信或接电话（验证码用）。 | 买一张预付费 SIM 或用虚拟号（Twilio 等），但虚拟号某些地区 Meta 不接受 |
| **一个 Facebook 公共主页** | WhatsApp Business 账户必须关联一个 Facebook 公共主页 | 先建主页，再回来。主页接入 ME 的步骤见 Meta 渠道接入 SOP |
| **一个 Meta 商务账户** | 管理 WABA 的容器。ME 公司已有一个（ID: 1265811139097132），客户资产共享到这里 | 新客户通常已有；没有就在 business.facebook.com 新建 |

### 步骤 1：确认号码状态

| 场景 | 含义 | 怎么处理 |
|---|---|---|
| 号码从未装过 WhatsApp | 全新号码 | 最简单，直接用 |
| 号码在个人 WhatsApp 上 | 要先从个人 WhatsApp 迁移到 WhatsApp Business | 客户在手机上下载 WhatsApp Business app → 选「从 WhatsApp 迁移」→ 按提示操作。**迁移后个人 WhatsApp 聊天记录会转到 Business app**，个人号不再可用 |
| 号码已在 WhatsApp Business 手机 app 上 | 已经是企业号，只需接入 ME | 跳到阶段二 |
| 号码在另一个 Cloud API 账号下 | 被别的系统占着 | 先在原账号取消注册（原系统管理员操作），等 5 分钟再继续 |

### 步骤 2：在 Meta 商务后台创建 WhatsApp Business Account (WABA)

> **谁来做**：我方（有 ME 商务后台管理员权限的人）。

1. 登录 [Meta 商务后台](https://business.facebook.com/) → 选 ME 的商务账户
2. 左栏 → **账户** → **WhatsApp 账户** → 点 **添加**
3. 填写：
   - **WhatsApp Business 账户名称**：用客户公司的品牌名，如 `NZ EV&Tech Expo`
   - **时区**：选客户当地时区（NZ 选 `Pacific/Auckland`，AU 选对应城市）
   - **货币**：NZD 或 AUD
4. 选择关联的 Facebook 公共主页（步骤 1 确认的那个）
5. 提交后 Meta 会审核，通常几分钟到几小时。状态变 `Approved` 才能继续

> **验证**：WhatsApp 账户列表里能看到新建的 WABA，状态为 Approved。

### 步骤 3：注册手机号码到 WABA（可选——看要不要同时在手机 app 用）

> **重要决策点**：这一步决定了号码是「只在 Meta 后台管」还是「手机 app 也能用」。
>
> - **如果客户不在乎手机 app**（将来只在 ME 后台收发 WhatsApp）→ 这一步先跳过，到阶段三用 Cloud API 注册
> - **如果客户要先用手机 app 发消息、同时也要接 ME**→ 让客户先在手机上用 WhatsApp Business app 正常注册这个号码，后面到阶段三走「并存接入」
>
> **不确定时默认让客户先在手机 app 上注册。** 到阶段三再决定走哪条路。手机 app 先用着不影响后续接入。

### 步骤 4：填写企业资料

无论号码在不在 WABA 里，企业资料都可以先填：

1. Meta 商务后台 → WhatsApp 账户 → 选刚建的 WABA → **WhatsApp Manager**
2. **账户工具** → **手机号码**（如果号码已注册）→ **企业资料** 或 **账户设置**
3. 填写：
   - **企业名称**（会显示在 WhatsApp 对话顶部）
   - **简介**（一句话描述业务）
   - **行业类别**
   - **地址**、**网站**、**邮箱**
   - **企业头像**（建议用 logo，正方形 PNG，≥192×192px）

> **注意**：这些信息客户的潜在客人会看到。必须和客户确认内容，不能我们随便填。

---

## 阶段二：绑定资产到 ME 公司

> **目标**：让 ME 的系统用户能代表客户调 WhatsApp API，且权限最小化。
> **前提**：阶段一完成，客户有一个 Approved 的 WABA。

### 步骤 5：创建客户专用系统用户

> 详细步骤见 [Meta 渠道接入 SOP](../docs/sops/2026-11-06-new-me-meta-channel-onboarding-fde-v0.1.md) 第 3-5 步。这里只补 WhatsApp 特有的部分。

1. ME 商务后台 → **用户** → **系统用户** → **添加**
2. 名称：用客户名（如 `EVExpo`），**角色选 Employee**（不选 Admin）
3. **给系统用户指定应用**：商务后台 → 应用 → 选门户使用的 Meta 应用 → 「指定人员」→ 加这个系统用户 → 给「开发应用」权限

> 如果客户已经有系统用户（之前接 Facebook 主页 / 广告户时建的），直接用那个，不要重建。

### 步骤 6：分配 WABA 和号码权限给系统用户

1. 系统用户页 → **分配资产** → 选 **WhatsApp 账户** → 找到客户的 WABA
2. 权限勾选：**管理 WhatsApp 账户**（含发消息、管模板、查分析）
3. 如果号码已注册到 WABA 下，号码权限跟着 WABA 走，不用单独分配

> **同时把 Facebook 主页和广告户也分配好**（如果之前没做）：
> - 主页权限：内容、社群动态、消息和通话、广告、成效分析、潜在客户
> - 广告户权限：管理营销活动、查看表现、管理创意馆样图
>
> 验证：系统用户页 → 资产列表里能看到 WABA、主页、广告户。

### 步骤 7：生成系统用户令牌

> **这一步必须真人操作**，要输 Facebook 密码，助手不能代做。

1. 系统用户页 → **生成口令** → 选门户使用的 Meta 应用
2. **有效期：永不过期**
3. **权限全勾**（至少包含以下 WhatsApp 相关的）：
   - `whatsapp_business_messaging` — 发消息
   - `whatsapp_business_management` — 管理 WABA、号码、模板
   - `business_management` — 管理商务资产
4. 同时勾上主页和广告相关权限（`pages_read_engagement`、`pages_manage_posts`、`ads_read`、`ads_management` 等，完整清单见 [权限清单文档](../docs/sops/client-onboarding-access-requirements.md)）
5. 复制令牌，**只粘进 ME 门户的「系统用户令牌」框**

> **红线**：令牌不进聊天、不进代码文件、不发给 AI、不截图。泄露了就「撤销口令」重生成。

同时要拿到**应用密钥**：

1. 开发者后台 → 该应用 → 应用设置 → 基本 → 应用密钥点「显示」（要输 Facebook 密码）
2. 复制，**只粘进门户框**

---

## 阶段三：接入 ME 平台

> **目标**：让 ME 后台能收发这个客户的 WhatsApp 消息。
> **前提**：阶段二完成，系统用户有 WABA 权限和有效令牌。

### 步骤 8：最重要的一件事——先问客户手机 app 要不要保留

客户的 WhatsApp Business 号码接入 ME Cloud API 有两条路，**区别在于手机上的 WhatsApp Business 绿色 app 还能不能用**。
选错了路不可逆——标准接入会**永久断开**手机 app，而并存接入能让手机 app 和 ME 后台同时收发消息。

### 步骤 9：两条路径判定

| 路径 | 手机 app | ME 后台 | 前提条件 | 复杂度 |
|---|---|---|---|---|
| **A · 标准接入（Cloud API Only）** | ❌ 断开 | ✅ 收发 | 号码能收验证码 | 低 |
| **B · 并存接入（Coexistence via Embedded Signup v4）** | ✅ 保留 | ✅ 收发 | ME 成为 Meta 技术提供方 + Embedded Signup v4 全链路 | 高 |

**判断方法**：问客户「手机上的 WhatsApp Business app 还要不要继续用？」
- **不要 / 没在用** → 路径 A（标准接入，当天可完成）
- **要保留** → 路径 B（并存接入，需平台级工程，见下方）

> **红线**：不确定时**默认路径 B**。断开手机 app 不可逆，必须客户明确同意才走路径 A。

---

### 路径 A · 标准接入（Cloud API Only）

> **警告：这条路会断开手机上的 WhatsApp Business app。走之前必须客户明确同意。**

#### 前提

- [ ] ME 有一个 Meta 应用已加 WhatsApp 产品（见附录一·应用清单）
- [ ] 该应用已设好 webhook 回调地址，指向 ME 的 `/api/webhooks/whatsapp`
- [ ] 应用已订阅 `messages` webhook 字段

#### 步骤

| # | 谁 | 做什么 | 验证 |
|---|---|---|---|
| A1 | 我方 | 确认客户的 WABA 存在且状态为 Approved（阶段一已完成）。 | WABA 列表里能看到 |
| A2 | 我方 | 在 WABA 下用 `register_phone_number` API 或 Meta 开发者后台注册号码。需要验证码（短信或语音）。**此步之后手机 app 立刻断开。** | 号码出现在 WABA 的电话号码列表 |
| A3 | 我方 | 确认系统用户已有 WABA 权限（阶段二步骤 6）。 | 系统用户资产列表里有 |
| A4 | 我方 | 确认系统用户令牌包含 `whatsapp_business_messaging`、`whatsapp_business_management` 权限（阶段二步骤 7）。 | 令牌能调 WhatsApp API |
| A5 | 我方 | 在 ME 数据库写入：`clients.whatsapp_phone_number_id` = 注册后 Meta 返回的 phone_number_id。 | 查数据库确认 |
| A6 | 我方 | 如果这个应用不是 ME 的主应用（用了客户专用应用），在 `whatsapp_app_credentials` 表写入这个号码对应的 app_secret，用于 webhook 签名验证。 | 查数据库确认 |
| A7 | 我方 | 发一条测试消息到这个号码，确认 ME webhook 收到并正确路由到客户。 | ME 后台能看到这条消息 |

#### 注意事项

- 号码注册到 Cloud API 后，**手机 app 上这个号码会立刻断开**，已有聊天记录不会迁移到 Cloud API。
- 如果号码之前在另一个 Cloud API 账号下注册过，需要先在原账号取消注册，才能在新账号注册。
- 生产环境发消息要配支付方式（WhatsApp 按对话计费）。

---

### 路径 B · 并存接入（Coexistence — 手机 app + Cloud API 同时用）

> **当前状态（2026-11-08）：此路径的平台级基础设施尚未完成。** 需要 7 道关卡全部通过 + 5 段 A 级代码实现。
> 设计文档：`docs/specs/2026-10-14-whatsapp-embedded-signup-coexistence-v1.md`

#### 原理

Meta 的 Embedded Signup v4 流程可以在**不断开手机 app** 的情况下，把同一个号码也接入 Cloud API。之后：
- 手机 app 发的消息，Cloud API 会收到一份回声（`smb_message_echoes`）
- Cloud API 发的消息，手机 app 也能看到
- 两边同时在线，客户可以在手机和 ME 后台都回复

#### 7 道平台级关卡（全部客户共享，过一次后面所有客户都能用）

| 门 | 内容 | 谁做 | 状态（2026-11-08） | 不可逆？ |
|---|---|---|---|---|
| G0 | ME 的 Meta 企业认证通过 | 等 Meta 审批 | 10-14 时「审核中」，需重查 | 否 |
| G1 | 申请高级权限（`whatsapp_business_management` + `whatsapp_business_messaging`） | 我方 在开发者后台提交 | 未提交 | 否 |
| G2 | 成为 Meta 技术提供方（Tech Provider） | PM 本人点，**不可逆** | 未做 | **是** |
| G3 | 配置 Embedded Signup（v4，v2/v3 已于 2026-10-15 过期） | 我方 | 未做 | 否 |
| G4 | webhook 订阅 `smb_message_echoes` 和 `smb_app_state_sync` 字段 | 我方 | 只订阅了 `messages` | 否 |
| G5 | 客户手机上 WhatsApp Business App ≥ 2.24.17 | 客户 | 未核 | 否 |
| G6 | 客户书面同意（存档） | 客户 | 无书面 | 否 |

#### 5 段代码实现（全部 A 级，碰凭据 + 新表 + 对外授权入口）

| 段 | 内容 | 状态（2026-11-08） |
|---|---|---|
| A | 门户里的 WhatsApp 连接页面（Embedded Signup UI）| 未写 |
| B | OAuth 回调 + 令牌交换 | 未写 |
| C | 接入后 24 小时同步工作流（联系人 + 历史消息） | 未写 |
| D | 联系人持续同步 | 未写 |
| E | 生命周期管理（断开、重连、迁移） | 未写 |

#### ME 代码中已实现的并存消息处理

虽然并存接入流程（A-E）没写，但 **webhook 消息处理已经支持**：
- `src/app/api/webhooks/whatsapp/route.ts` — 分类器能识别 `smb_message_echoes`，调 `storeEcho()` 存入数据库
- `src/lib/whatsapp/inbound-classify.ts` — 能分类并存模式特有的消息类型
- `whatsapp_app_credentials` 表 — 支持按号码查应用密钥（多应用签名验证）
- 按 `clients.whatsapp_phone_number_id` 路由消息到正确客户

#### NAL 的现有实现（「过渡桥」方案，非正式并存接入）

NAL 当前用的是一个单独的 Meta 应用（977213705442240），归 NAL 的商务账户（1177729918738407）所有。这是设计文档称为「过渡桥」的方案——每个客户建一个单独的 Meta 应用，绕过 ME 作为技术提供方的要求。代价是每个客户都要重复配置一遍。

---

## 步骤 10-11：收尾（两条路径共用）

### 步骤 10：在 ME 门户完成连接

1. ME 门户 → 选该客户 → **设置** → **渠道** → **WhatsApp**
2. 填入应用编号、应用密钥、系统用户令牌（阶段二步骤 7 拿到的）
3. 点「核验并关联」
4. 确认渠道页显示「已接入」

### 步骤 11：验证消息收发

1. 用另一个手机（不是客户的号码）给这个号码发一条 WhatsApp 消息
2. 确认 ME 后台 → 该客户 → WhatsApp 收件箱里能看到这条消息
3. 在 ME 后台回复一条，确认对方手机能收到
4. 如果走了路径 B（并存），还要确认：客户在手机 app 上发的消息也出现在 ME 后台

---

## 附录一：已知应用清单（2026-11-08）

| 应用 | ID | 用途 | WhatsApp 产品 |
|---|---|---|---|
| Magic Engine Connect | 1867184534115905 | 门户新用 | ✅ 已加，条款已接受 |
| Magic Engine Portal | 3955651258064982 | 门户 OAuth | ❌ 没有 WhatsApp |
| ME 门户实际使用 | 1814506663549438 | 俊东的门户代码实际调的 | 未知 |
| NAL 专用 | 977213705442240 | NAL 过渡桥 | ✅ |
| 旧系统（禁碰） | 1752513682785923 | 老 ME | — |
| Magic Engine Messaging | 1799741334398250 | 可能用于 WhatsApp | 未核实 |

---

## 附录二：红线

1. **不确定客户要不要保留手机 app 时，不准走标准接入。** 标准注册会永久断开手机 app。
2. **并存接入的 G2（成为技术提供方）不可逆，必须 PM 本人操作。**
3. **令牌、密钥只粘进 ME 数据库或门户，不进聊天、不进文件、不发给 AI。**
4. **一个客户一个系统用户。** 不用多客户共用的总系统用户（见 Meta 渠道接入 SOP §三.5）。
5. **旧系统应用 1752513682785923 绝对不碰。**
6. **企业资料（名称、简介、头像等）必须和客户确认，不能我们自己编。**
7. **号码从个人 WhatsApp 迁移到 Business 不可逆。** 必须客户本人操作并同意。

---

## 附录三：和其它手册的关系

- **Meta 渠道接入 SOP**（`docs/sops/2026-11-06-new-me-meta-channel-onboarding-fde-v0.1.md`）：覆盖 Facebook 主页 + 广告户的 8 步接入，其第 8 步说「客户有 WhatsApp 时也分配给系统用户」——本 skill 是那个第 8 步的完整展开，并向前延伸到注册和建 WABA。
- **Embedded Signup 设计稿**（`docs/specs/2026-10-14-whatsapp-embedded-signup-coexistence-v1.md`）：并存接入的完整技术设计，含 10 条风险评估。
- **广告账户开户 skill**（`.claude/skills/me-meta-ad-account-setup/SKILL.md`）：只管广告账户，不管 WhatsApp。
- **通用权限清单**（`docs/sops/client-onboarding-access-requirements.md`）：列出每类资产需要哪些权限。

---

## 附录四：复用与边界

- **平台共享**：整套三阶段流程、两条路径判定、关卡检查清单、webhook 消息处理代码、应用清单、红线。
- **客户私有**：WABA ID、phone_number_id、系统用户令牌、应用密钥、企业资料内容 → 只进客户台账卡和 ME 数据库。
- **行业差异**：目前没有，所有行业同一套。

---

## 附录五：常见问题

**Q：客户已经有个人 WhatsApp，能用同一个号码做企业号吗？**
A：可以，但个人 WhatsApp 会被永久替换为 WhatsApp Business。这一步由客户自己在手机上操作（下载 WhatsApp Business app → 选迁移），不可逆。

**Q：注册到 Cloud API 后还能回到手机 app 吗？**
A：不能。标准接入（路径 A）是不可逆的。如果未来要回到手机 app，需要从 Cloud API 取消注册，再在手机上重新注册，期间会丢失 Cloud API 上的聊天记录。所以不确定时走并存（路径 B）。

**Q：一个 WABA 可以挂多个号码吗？**
A：可以。每个号码独立注册、独立计费。ME 按 `clients.whatsapp_phone_number_id` 路由消息，一个客户当前只支持绑一个号码。

**Q：WhatsApp 消息怎么收费？**
A：按对话计费（不是按条），24 小时窗口为一个对话。营销对话和服务对话价格不同。需要在 WABA 里配支付方式（信用卡）。NZ/AU 价格见 Meta 官方定价页。

**Q：ME 企业认证什么时候过？**
A：最后一次查是 2026-10-14，状态是「审核中」。认证过了才能走并存接入的 G0 关卡。标准接入不需要企业认证。
