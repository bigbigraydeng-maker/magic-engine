# SOP — 新客户 Meta 广告户开通与授权（通用路径）

> **目的**：任何新客户要把 Meta（Facebook/Instagram）广告户交给 Magic Engine 代管/代投时，都走这一条路径，不因客户不同而另起一套流程。
> **执行人**：分两段——第一段（资产共享）由**客户方**操作，必须是该广告户/主页所在 Business Manager 的 Admin 本人完成（Meta 官方要求，ME 不能代做）；第二段（分配资产、签发令牌）由 **Magic Engine 操作人**在 ME 自己的 Business Manager 里完成。
> **耗时**：15-20 分钟
> **前置**：客户方操作人已经是自己 Business Manager 的 Admin；ME 操作人已经是 Magic Engine 商业组合（Business ID `1265811139097132`）的 Admin

本文档取代 `meta-system-user-token-setup.md` 里 CTS / Oztop 专属的部分，作为**所有新客户默认路径**。CTS / Oztop 已经配好的不用重做，新客户（例如 Magic Picks）从这里开始。

---

## 零、最容易踩的坑：App 和系统用户永远留在 Magic Engine 自己的商业组合里，不要往客户那边搬

**2026-09-13 Magic Picks 接入时的真实教训**：agent 一开始建议给新客户单独建一个 Meta Developer App，被 PM 当场纠正——Magic Engine 应该像所有正规代投代理商一样，**所有客户共用同一个应用**，只是这个应用被逐个客户的 Business Manager 单独授权。新建应用是错的，会导致每个客户一套配置、日后维护成本线性增长，也不符合"一个 agency 一个 App，多客户挂载"的 Meta 官方推荐架构。

**另一个同源的坑（本轮复审新增）**：客户没有办法在自己的 Business Manager 里靠"按名称搜索"把一个归属 Magic Engine 商业组合的 App **加进**自己账户——那个 App 从来不出现在客户的候选列表里，这一步在客户那边大概率直接失败。Meta 代理商的标准架构是反过来的：**客户把自己的资产（广告账户、主页）Partner-share 给 Magic Engine 的商业组合，App 和系统用户永远留在 Magic Engine 这边不动**（详见 [`docs/strategy/meta-flywheel-risk-and-sequencing.md`](../strategy/meta-flywheel-risk-and-sequencing.md) §4，以及客户自助页面 [`src/app/authorisation/page.tsx`](../../src/app/authorisation/page.tsx) 里已经在用的 Partner 共享流程）。所以下面从「一」开始，操作方向是"客户共享资产进 ME"，不是"客户把 App 加进自己账户"。

**Magic Engine 现有的正式应用**（用浏览器登录 developers.facebook.com/apps 核实过，2026-09-13）：

| 应用名称 | 应用编号（App ID） | 状态 | 归属业务实体 |
|---|---|---|---|
| **Magic Engine** | `1752513682785923` | 已上线 | Magic Engine（商业组合 ID `1265811139097132`） |

> 同名还有一个「开发中」的 `3955651258064982`，不归属任何业务实体，那是测试用的，**不要用**。生产客户一律用已上线的 `1752513682785923`。这个 App 只存在于 Magic Engine 自己的商业组合里，客户那一侧永远看不到、也不用管它。

---

## 一、客户把资产共享给 Magic Engine（客户操作）

1. 客户登录 https://business.facebook.com，切到**客户自己**的 Business Manager
2. 左下角 **⚙️ 业务设置** → 左侧「用户」→「合作伙伴」→「添加」→ 选「给一个合作伙伴访问你的资产的权限」
3. 输入 Magic Engine 的**商业组合 ID**：`1265811139097132`（客户界面上会显示出商业名称，应该是 "Magic Engine"——如果显示别的名字，停下来找 PM 核实，别继续）
4. 勾选要共享的资产：
   - **广告账户**：客户的广告户，授予「管理广告」权限（新客户如果还没开广告户，先在客户自己的「账户」→「广告账户」里新建一个，归属必须是客户自己的业务账户，不能挂在 Magic Engine 名下）
   - **公共主页**：客户的 Facebook 主页，授予 ads/insights 相关权限
   - **Pixel**（如果客户网站装了追踪代码）：客户的 Pixel
5. 保存

> 这一步做完之前，后面 ME 侧「四、分配资产」根本看不到这个客户的资产——**不要跳过，也不要指望反过来在客户那边"添加 App"**。

> ⚠️ **这一步卡在客户手里，不能只靠私聊提醒**：所有新客户都会在这一步停下来等客户方 Admin 操作第三方后台，消息一旦被漏掉，整个 onboarding 会无声卡住，PM/FDE 都看不见。**开 GitHub issue 不算下发**——今日待办 / 执行看板不会去读 GitHub issue，FDE 那条统一管道里根本看不到它，issue 关不关也只能靠人工记忆，跟没下发一样。唯一算下发的做法：ME 操作人发出这一步指引的**当天**，在 [`src/lib/pm-todo/client-doc-manual-tasks.ts`](../../src/lib/pm-todo/client-doc-manual-tasks.ts) 的 `CLIENT_DOC_MANUAL_TASKS` 数组里给这个客户加一条（跟里面 CTS 那条格式一样），三件套缺一不可：
> - **what**：`<客户名> 的 Meta 广告资产还没共享给 Magic Engine，onboarding 卡在客户手上`
> - **how**：`提醒 <客户联系人> 按上面「一」的 3 步操作，商业组合 ID 是 1265811139097132`
> - **href**：直接发 https://business.facebook.com/settings/partners 给客户，不要只发一段文字描述
> - **expiresAt**：填 2 个工作日后，让它自动从待办消失——过期不代表客户已完成，只代表要升级找 PM
>
> 这条会经 `pushClientDocManualTaskItems` 自动进 `loadManualItems`（今日待办首页 / 执行看板），FDE 打开首页就看得到，不用谁记着去 GitHub 翻。客户完成「一」（ME 侧「二」能看到资产）之后，从数组里删掉这一条；超过 `expiresAt` 还没删，升级找 PM。

## 二、Magic Engine 侧确认资产已到账（ME 操作）

1. 登录 https://business.facebook.com，切到 **Magic Engine 自己的**商业组合（`1265811139097132`）
2. 左侧「账户」→「广告账户」/「公共主页」，确认客户在「一」里共享的资产已经出现在列表里
3. 如果没出现，回头找客户确认「一」的步骤 3 输入的商业组合 ID 有没有打对、有没有点保存

## 三、为这个客户新建独立系统用户（ME 操作，系统用户住在 ME 自己的商业组合里）

⚠️ **每个客户一个独立系统用户，不允许复用别的客户已经在用的系统用户**——系统用户签发的每一个令牌，能访问的是**这个系统用户名下已分配的全部资产**，不是"这条令牌对应的那一个客户"。如果两个客户的资产分配在同一个系统用户下，任何一个客户的令牌泄露，另一个客户的广告账户会跟着一起暴露；Render 里按客户域名分开存令牌（见「六」）只是方便查找，并不会缩小 Meta 侧的实际访问范围。**App 继续所有客户共用**（`1752513682785923`，见「零」），但系统用户必须按客户隔离。

⚠️ **角色必须选"员工"，不能选"管理员"**（2026-09-13 本轮复审纠正）：管理员系统用户拥有管理**整个商业组合**的权限——可以给任何资产分配/收回任何人的权限，包括别的客户的资产。哪怕每个客户各建了一个独立系统用户，只要它是"管理员"角色，这个客户的令牌一旦泄露，拿到令牌的人一样能把别的客户的广告账户重新分配给自己，隔离形同虚设。"员工"角色的系统用户只能操作被**明确分配**给它的资产，业务组合里其它客户的资产它看不到也动不了——这才是真正的按客户隔离。员工系统用户照样能拿到 `ads_management` 等写权限，只要在「四」把该客户的资产分配给它并勾"完全控制"即可，不存在"员工调不了 `ads_management`"这回事（那是旧版 SOP 的错误认知，见下方 Q1 已更新）。

1. 在 Magic Engine 自己的商业组合里，左侧「用户」→「系统用户」
2. 右上角「+ 添加」新建：名称填 `Magic Engine Ads – <客户名>`（例如 `Magic Engine Ads – Magic Picks`），角色选**员工**
3. 如果这个客户之前已经建过专属系统用户（比如重新生成令牌），直接复用**那一个**——但绝不能把这个客户的资产分配进另一个客户名下已有的系统用户

## 四、分配资产（不分配，令牌就是空壳）

在系统用户详情页 →「已分配的资产」→「添加资产」，这时候资产列表里应该已经能看到客户在「一」共享进来的资产（如果看不到，先解决「二」的问题，不要跳过继续）。以下都勾**完全控制**：

| 资产类型 | 选哪个 |
|---|---|
| **广告账户** | 客户共享进来的广告户 |
| **公共主页** | 客户共享进来的 Facebook 主页 |
| **Pixel**（如果有） | 客户共享进来的 Pixel |

## 五、生成令牌（在 Magic Engine 自己的商业组合里操作）

1. 系统用户详情页 → 右上角「生成新令牌」
2. **应用**：选 `Magic Engine`（`1752513682785923`）
3. **到期时间**：选 **永不过期**
4. **权限**（八项全勾——⚠️ 不是六项，少两项线索广告会一直花钱但线索收不回来，见下）：
   - `ads_management`
   - `ads_read`
   - `business_management`
   - `pages_read_engagement`
   - `pages_show_list`
   - `read_insights`
   - `leads_retrieval`（线索表单要靠它才能列出来。少这一条，`meta-leads-sync` 每小时照常跑，但 `leadgen_forms` 一个都拉不到，客户以为线索在流入，实际上系统一条都没收到，广告费照花不误——2026-08-21 已经在别的客户身上出过一次同款事故，9 天漏了 45 条线索）
   - `pages_manage_ads`（列出主页的即时表单必须有这一条，`pages_show_list` 顶不了它——2026-08-30 生产实测过，加了 `leads_retrieval` 但没加这条，Graph 照样报 `(#200) Requires pages_manage_ads permission to manage the object`）
5. 生成 →立即复制（页面一关就再也看不到，只能重新生成）

## 六、令牌怎么给到 Magic Engine —— 绝不能贴在对话框/邮件/Slack 里

那串以 `EAA` 开头的字符能直接操控客户的广告户，泄露了任何人都能拿去投放花钱。正确路径：

1. 登进 Render Dashboard → Magic Engine 主服务 → **Environment**
2. 新增一条环境变量，命名规则是**客户 `clients.domain` 字段派生的 key，不是随便起的客户简称**：
   - 变量名 = `META_SYSTEM_USER_TOKEN_<DOMAIN_KEY>`
   - `<DOMAIN_KEY>` = 把 `clients.domain` 转大写、非字母数字字符全部换成下划线（就是 [`src/lib/meta/token-manager.ts`](../../src/lib/meta/token-manager.ts) 里的 `domainToEnvKey()`，读取时也是走这个规则，两边必须对上）
   - 举例：`clients.domain = magicpicks.com.au` → `DOMAIN_KEY = MAGICPICKS_COM_AU` → 完整变量名 `META_SYSTEM_USER_TOKEN_MAGICPICKS_COM_AU`
   - **动手前先去数据库确认这个客户 `clients.domain` 的真实值**，不要凭客户名称猜——猜错了运行时读不到，广告读写会一直报未配置令牌
3. 值填那串令牌
4. 保存，等 Render 自动重启（约 60 秒）

配完只需要回来说一句「token 已配」，不需要（也不应该）把令牌本身发过来。

## 七、把广告户登记进数据库 —— 走 Settings UI / API，不要手写 SQL

拿到广告户 ID（`act_` 开头一串数字，广告户设置首页能看到）后，**不要**直接写 `INSERT INTO client_meta_ad_accounts`——那张表只是给多账户场景用的镜像表，真正的真相源是 `clients.meta_ad_account_id`：每日回流任务（`google-data-pullback-daily`）、手动同步、诊断适配器都靠这一列判断"这个客户有没有配广告户"，只写 `client_meta_ad_accounts` 不动 `clients.meta_ad_account_id`，这个客户会被当成"未配置"直接跳过。

正确路径二选一（效果一样，都会同时更新 `clients.meta_ad_account_id` 并镜像一条 `is_primary=true` 记录进 `client_meta_ad_accounts`）：

1. **Settings UI（推荐，FDE 用）**：客户详情页 → 设置 → 「Meta 广告账户」面板，填入 `act_XXXXXXXXX`，点保存
2. **API（脚本化场景用）**：
   ```
   PATCH /api/clients/<clients.id>/meta-ad-account
   Content-Type: application/json

   { "ad_account_id": "act_XXXXXXXXX" }
   ```

## 八、验证（四项都过，才算真的能跑）

1. **健康 check**：调 `/me?fields=id,name`，看令牌有没有效
2. **广告户访问 check**：调 `/act_XXXXXXXXX/insights`，看能不能拿到数据
3. **写 check**：尝试建一个 `status=PAUSED` 的测试广告系列，看权限够不够写
4. **线索表单 check**（客户跑或计划跑 Lead Ads 才需要，但只要客户有 Facebook 主页就顺手测一下，不要等到上线才发现）：调 `/<PAGE_ID>/leadgen_forms`，能列出表单（哪怕是空列表，只要不报权限错误）才说明「五」里的 `leads_retrieval` + `pages_manage_ads` 真的生效了；报 `(#200)` 权限错误，回「五」重新生成一次令牌，两项权限都要勾上

四项都过 = 这个客户的 Meta 战线正式可跑。

---

## 常见问题

**Q1：系统用户角色选"员工"行不行？**
A：**必须选员工**，不能选管理员——见「三」。旧版曾说"员工调不了 `ads_management`"，这个说法是错的：员工系统用户只要在「四」里被分配了该客户的资产并勾"完全控制"，一样能签发带 `ads_management`/`business_management` 等写权限的令牌，只是访问范围收窄在被分配的资产内。管理员系统用户能管理整个商业组合（分配/收回任何客户的资产权限），一旦某个客户令牌泄露，风险会波及所有客户，不能用来维持"按客户隔离"。

**Q2：要不要每个客户都建一个新应用？**
A：**不要**。见本文档「零」——所有客户共用 `Magic Engine`（`1752513682785923`）这一个应用，且这个应用永远留在 Magic Engine 自己的商业组合里，不需要也不可能挂到客户账户下。**但系统用户不一样**——App 可以共用，系统用户不能，见「三」。

**Q3：能不能把新客户的资产也分配进已经在用的那个系统用户，省得再建一个？**
A：**不能**。见「三」——同一个系统用户签发的令牌能访问它名下**全部**已分配资产，跟客户是几个没关系。省下建系统用户的两分钟，换来的是"一个客户令牌泄露，殃及所有共用同一系统用户的客户"，不划算。

**Q4：令牌真的永不过期？**
A：是，前提是①选了"永不过期"②用的是系统用户不是普通用户。如果客户把「一」里共享给 Magic Engine 的 Partner 权限收回，令牌照样会失效——这不是技术问题，是客户那边的账户变动。

**Q5：客户还没有广告户 / 主页，怎么办？**
A：先在客户自己的 Business Manager 里新建（「账户」→「广告账户」/「公共主页」→「添加」），归属必须是客户自己的业务账户，不能挂在 Magic Engine 名下——见 `CLAUDE.md` 铁律 8「客户营销落地页必须建在客户自己的域名」同理，广告户/主页所有权也必须是客户的，Magic Engine 只是被授权的代管方。建完之后回到「一」，把新建的资产 Partner-share 给 Magic Engine。

---

## 关联

- 旧版（CTS / Oztop 专属，两家已配完不用重做）：[`meta-system-user-token-setup.md`](./meta-system-user-token-setup.md)
- Magic Picks 是第一个走本通用路径的客户，2026-09-13 接入中——完成后本文档补一行到下表：

| 客户 | 广告户 ID | 状态 |
|---|---|---|
| CTS | `act_2775766642787274` | ✅ 已配（走旧版 SOP） |
| Oztop | （见 `clients.meta_ad_account_id`） | ✅ 已配（走旧版 SOP） |
| Magic Picks | 待填 | 🔄 进行中 |
