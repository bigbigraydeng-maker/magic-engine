# Onboarding + 第三方对接统一 — 技术方案 v2

> 2026-08-11 · 起草：子牙 · v1 经三路独立审查（子牙架构 + 魏征挑刺 + 板桥客户视角）后重写
> v1 的核心思路（合并 Google 授权、统一入口、激活向导）被三路审查一致认可，**但 v1 对现有代码链路的盘点不完整，三路审查各自独立挖出了会导致"合并后功能静默不工作"的具体漏洞**，且部分发现互相印证。v2 是修完这些漏洞后的版本。修订记录见文末 §7。

## 0. PM 已拍板的决定（不再讨论）

| # | 决定 | 备注 |
|---|---|---|
| 1 | 范围覆盖新客户注册路 + FDE/老客户设置页，一起理顺 | 不是只做向导 |
| 2 | 五步引导向导这次正式打开给新客户用 | 不再是预览态 |
| 3 | 老 Google OAuth 明文表这次一起迁移到新加密表，接受小风险 | expand-contract 两步走，不是一刀切 |
| 4 | "Google 广告已连接"假状态面板直接拆掉，换一行说明文字 | 不补写入逻辑 |
| 5 | GTM（Google Tag Manager）这次从零建真授权 | 工作量最大的新增项，**时间线有个不由我们控制的变量，见 §2.7** |
| 6 | Meta 广告授权这次不动，维持"填数字+上门帮弄" | 之前四审定过的板桥红线，原因是 Meta App Review 审核周期不可控 |
| 7 | GA4 / GSC / WordPress 也要走"先授权"路线 | GSC 已有真 OAuth 基础，GA4 需要补新代码（不是从零，见 §2.2），WordPress 维持现有 Application Password 机制（技术原因见 §2.5） |

---

## 1. 现状问题（v1 审计 + v2 三路复审共同确认）

1. **Google OAuth 现在其实是 3 条并行代码路径，不是 2 条**（v1 只发现 2 条，架构审查揪出第 3 条）：
   - `platform_oauth_connections`（新表，加密）+ GBP 专用的 nonce-cookie OAuth（`gbp/start`+`gbp/callback`）——单一 scope，已跑通。
   - `google_oauth_tokens`（老表，明文）+ HMAC-state OAuth（`google/connect`+`google/callback`）——**这条已经在合并请求 GSC+GA4+Indexing 三个 scope，一次同意**，同时 dual-write 到 `platform_oauth_connections`（仅 `google_gsc`）。
   - `/connect/[clientId]` ——一个**完全不需要登录**的客户自助授权页，靠 HMAC state 自证身份，走的是上面第二条老路径。FDE 发链接给不会用后台的客户老板，让他们自己点授权用的。
2. **"Google 广告已连接"是死状态**：没有任何代码写 `provider='google_ads'` 的行。
3. **同一批连接器有 3 处入口**：`/connectors` 独立页、`/settings` §1、client 主页 `SettingsDrawer`，且 `/connectors` 页面被至少 9 处仓库内部链接硬编码指向（导航侧栏、客户主页工具卡、GA4/GSC 趋势区块等），不只是外部书签问题。
4. **GA4 流程要求客户先在另一页面做 OAuth，再回来手输 Property ID**，是"好几个页面能对接"的直接证据。
5. **五步引导向导做好了但从未接入注册流程**，`buildBriefPath()` 仍导向旧的单页 `/brief`。
6. **向导的"已连接"状态和每日同步 cron 的判定条件，读的都是 `client_connectors` 表，不是 `platform_oauth_connections`**——这条是本次复审新增的关键发现，直接决定了 §2 的技术设计不能只顾着写新表。
7. **`platform_oauth_connections` 的 provider 白名单当前是 6 个值**（`google_gbp` / `google_gsc` / `meta` / `tiktok` / `google_ads` / `microsoft_mail`），2026-08-02 才加过 `microsoft_mail`（服务 CTS 邮件进线管道）。v1 文档抄的是这次改动之前的 5 值旧版——**这个事实错误如果被直接拿去当迁移基准，会静默把 `microsoft_mail` 挤掉，断掉一条正在跑的客户获客管道**，v2 已修正（见 §2.2）。

---

## 2. 目标架构

### 2.1 核心思路：扩展现有的合并授权路径，不新建第三条

**v1 的错误**：设计了一条全新的 `/api/auth/google/connect-suite/start`+`callback`，参照的先例是 GBP（单 scope）。但仓库里已经有一条专门做"多 scope 一次同意"的路径——`/api/auth/google/connect`+`callback`（`COMBINED_GOOGLE_SCOPES`），而且它已经在生产跑、已经被 `/connect/[clientId]`（无登录客户自助页）和 legacy connectors 页在用。新建一条平行路径不是"统一"，是把 3 条变成 4 条。

**v2 的做法：直接扩展这条已存在的合并路径**，而不是新建：

1. `COMBINED_GOOGLE_SCOPES`（`src/lib/google-oauth/client.ts`）追加 GTM 只读 scope（`tagmanager.readonly`）。
2. `google/callback/route.ts` 的回调逻辑扩展：拿到 token 后，除了现有的 GSC 处理，**新增**调用 GA4 Admin API 列出可用 Property、GTM API 列出可用 Container，各自写入 `platform_oauth_connections`（provider=`google_ga4`/`google_gtm`）。
3. **`/connect/[clientId]` 无登录客户自助页不需要额外改动**——它复用的就是这条路径，扩展后自动获得 GA4/GTM 能力，不用单独设计。
4. `buildState()`/`destination()` 现有的 `flow` 字段（目前是 `'admin' | 'connect'`）**新增第三个值 `'wizard'`**，回调成功后：
   - `admin` → 跳转到统一后的 settings 页对应位置（现状是 `/connectors/gsc`，本次一并改成 settings 页，见 §2.4）
   - `connect` → 保持跳 `/connect/[clientId]`（无登录页自己的确认界面）
   - **`wizard`（新增）→ 跳回 `/dashboard/clients/[id]/onboarding`**，不是 settings 页

这一条直接解决板桥复审发现的问题：**GBP 现有的 OAuth 回调不管从哪发起、成功失败都写死跳到 FDE 专用的中文"客户配置中心"页面**。向导页面的新按钮如果照抄这个写死目标，客户授权成功后会被送进一个自己完全看不懂的内部后台，卡在那里。v2 用现成的 `flow` 参数机制解决——这个机制本来就是为了"记住从哪来、连完送回哪"设计的，只是之前没有覆盖到向导场景，这次把 GBP 的 `gbp/start`+`gbp/callback` 也同步补上 `wizard` 分支，两条路径（GBP 专用 + 合并授权）都要修，不能只改一条。

**GBP 为什么继续独立、不并进合并授权**：`business.manage` 是 Google 另划的一类更敏感的受限 scope，已经单独走完验证在生产跑，跟 GSC/GA4/GTM/Indexing 那一组的审核轨迹不是一回事。硬并在一起会让整个同意页背上最高等级的敏感 scope 审核要求，而且会让已经连过 GBP 的老客户下次授权时同意页新增好几行陌生权限、可能触发 Google 侧的额外安全提示——这是特意分开，不是漏想。

```
客户点一次「连接 Google 网站数据」（GSC + GA4 + GTM + Indexing 合并）
        │
        ▼
Google 同意页
        │
        ▼
回调（扩展现有 google/callback）：exchange code
        │
        ├─ GSC：列出站点 → 客户选一个（沿用现状逻辑，不变）
        ├─ GA4：调 Admin API 列出 Property → 客户选一个／没有就跳过（新增）
        └─ GTM：调 API 列出 Container → 客户选一个／没有就跳过（新增）
        │
        ▼
写入 platform_oauth_connections（google_gsc/google_ga4/google_gtm）
        │
        ▼
【新增，直接对齐现状 cron/向导的真实判定条件】
同步写 client_connectors（anchor=gsc/ga4，status='connected'）——现状 GSC 已经这样做，
GA4 这次补上，否则每日同步 cron（判定条件是 client_connectors，不是新表）和向导的
"✓ Connected" 状态都不会生效，即使 platform_oauth_connections 里数据是对的。
        │
        ▼
按 flow 跳转：admin→settings 页 / connect→原页 / wizard→向导
```

GBP 独立保留 `gbp/start`+`gbp/callback`，同样补 `wizard` flow 分支。

### 2.2 数据模型改动（对照 `vocabulary.ts` 文件头写明的两步流程，一步都不能少）

`platform-oauth/vocabulary.ts` 文件头自己写着新增 provider 要做两步：① 加进 `PLATFORM_PROVIDERS` 常量 ② 加迁移扩容 DB CHECK 约束。v1 只做了第②步，v2 两步都要：

**① 代码层**（PR1）：
- `PLATFORM_PROVIDERS` 新增 `GOOGLE_GA4: 'google_ga4'`、`GOOGLE_GTM: 'google_gtm'`。
- `platform-oauth/token-manager.ts` 的 `isGoogleProvider()` **必须同一个 PR 内**把这两个新值加进去（现状只认 `google_gbp`/`google_gsc`/`google_ads`）。**这是 v1 完全没发现的一个真实功能缺口**：不加的话，客户连上 GA4/GTM 之后，access token 一小时左右过期，第一次自动刷新会直接命中"`Token refresh not yet implemented for provider=...`"的报错分支，连接静默被标记成 `error`，界面和客户都不会有任何提示——等于连上不到一小时就自动断线。

**② 数据库层**（PR1，同一个 PR）：
- **当前真实约束是 6 个值**（`google_gbp` / `google_gsc` / `meta` / `tiktok` / `google_ads` / `microsoft_mail`，2026-08-02 加过 `microsoft_mail`），新迁移必须在这 6 个基础上加 `google_ga4`、`google_gtm`，变成 8 个值。**动手写这条迁移前，先 `SELECT` 一次线上真实约束定义，不要照抄任何文档里的"现状"描述**——这条提醒是 v1 自己犯过这个错误后加的：v1 文档里"现状"那行抄的是 2026-06-03 的旧版本，如果照抄下去写 `DROP CONSTRAINT` + `ADD CONSTRAINT`，会静默把 `microsoft_mail` 挤掉，断掉正在跑的 CTS 邮件进线管道，而且是那种"约束生效当下不报错、只有下次写入 microsoft_mail 那一行时才会炸"的滞后性事故。

**③ 老表迁移**（PR3a/PR3b，expand-contract 两步走，按仓库迁移铁律执行）：

- **Expand**：一次性回填脚本，把 `google_oauth_tokens` 的现有 token 加密后写入 `platform_oauth_connections`（provider=`google_gsc`，如果能判断出该客户在用 GA4 也补一行 `google_ga4`）。回填期间新老表双写。
- **Contract 前必须先解决 `ga4/client.ts` 的真实迁移缺口**（v1 完全没提到，架构审查+挑刺审查都独立指出）：`src/lib/ga4/client.ts` 现在 100% 挂在老的 `getValidAccessToken(clientId)` 上（这个函数签名没有 provider 参数，因为老表设计是一个客户一行）。而 `gsc/client.ts` 已经有一个跑通的"新路径优先、失败回退老路径、再不行落到 service account"的 `resolveAccessToken()` 实现——**`ga4/client.ts` 的迁移要直接复用 `gsc/client.ts` 这套已验证的 fallback 模式**（参数化 provider=`google_ga4`），而不是简单地把 `getValidAccessToken` 的读取目标从老表换成新表就算完事。
- **验证窗口不能只看 cron 成功率**：`gsc/client.ts` 的 `resolveAccessToken()` 设计就是新路径失败会静默 fallback 到老路径——也就是说双写窗口期间哪怕新表那条路完全是坏的，只要老表还正常，cron 成功率照样 100%，这个信号测不出真问题。**验证窗口内必须挑 1-2 个 canary 客户强制走新路径、禁用 fallback**，单独盯着这几个客户的同步结果，而不是看整体成功率。
- **Contract**：确认新表在 canary 客户上稳定后，停止读写老表。老表本身不删，只停止读写。
- Contract 必须是独立 PR，不与 Expand 混在同一批合并——按仓库既有迁移铁律执行。

**④ `client_connectors` 表不动、不废弃**：管的是另一类东西——公开数据标记（Facebook 主页 URL、GBP place_id 备用、reviews/publer 打勾），这次继续用它做 GSC/GA4 的"是否已连接"信号源（因为 cron 和向导现在就是读这张表），不是把它废弃掉换成只读新表——**这是 v1 最大的技术误判**：v1 以为"新表已经加密、更安全，应该完全取代旧的状态判定"，但实际上 `client_connectors` 不是"老旧要淘汰的东西"，是**现状唯一真正生效的开关**，新表目前谁都不读。v2 的设计是两张表都写，各司其职：`platform_oauth_connections` 存真授权凭证，`client_connectors` 继续做 cron/向导的状态判定源，直到未来有单独任务把 cron 和向导也切换到读新表为止（不在本期范围）。

### 2.3 Google Ads 假状态处理

`GoogleAdsPanel` 整个删除，改成一行说明：

> 广告投放走平台共享授权，无需单独连接。当前客户 ID：`{customer_id}`（在 [执行页] 修改）。

顺手清掉 Panel 自身代码注释里一句误导性说明（原注释暗示"legacy connectors 页的 OAuth 回调已经在写 platform_oauth_connections"，实测是假的——那个 anchor 走的是 Google Ads Transparency Center 公开数据扫描，完全不需要凭证，跟"真连接"是两回事）。不新建 per-client OAuth 机制，继续用现状的共享 MCC 凭证模式。

### 2.4 三处重复入口收敛为一处

- `GbpPanel` 抽成通用组件 `PlatformConnectionPanel`，GBP/GSC/GA4/GTM 四份共用。**GTM 的资源选择器不继承 GBP 的跨客户互斥检查**（`taken_by_other_client`）——GBP 那个检查是因为"两个客户同时发内容到同一个门店"是真实的数据冲突场景，而 GA4 Property / GTM Container 被多个 ME 客户同时接入更可能是正常的业务结构（比如同一家代理机构名下账号），不是错误状态，这次不继承这条规则，按需要保留独立判断空间。
- 账号级选择（如果客户 Google 登录下有多个可选账号）v1 没有现成先例可抄——GBP 现在是硬编码取第一个账号（`accounts[0]`，代码注释自己写着"MVP，位置选择器另外做"），真正有"下拉选，没有就跳过"实现的是账号**内部**的资源选择（GbpLocationPanel）。v2 沿用同样的简化：GSC/GA4/GTM 合并授权也先取第一个可用 Google 账号，账号级选择器不在本期范围（如果 FDE 实际遇到客户一个 Google 登录挂多个账号的情况，走跳过+上门处理）。
- `client_connectors` 驱动的"标记类"连接器（Facebook 主页、GBP place_id 备用、reviews、publer、Google Ads Transparency 扫描、social）合并进 settings 页"其他数据来源"小节——**这次把 anchor 清单核对完整**（v1 遗漏了 google-ads 扫描和 social 两类没写清楚去向）。
- Meta 三种绑定方式挪到同一屏，不合并成一个按钮（下游功能不同）。
- `/dashboard/clients/[id]/connectors` 整页退役，改 302 跳转；`/connectors/[anchor]` 子路由的具体去留（是否也退役、还是作为过渡期内部实现保留）在 PR5 动手前单独确认，不能只处理主入口页。
- **PR5 必须同步修改至少 9 处硬编码指向 `/connectors` 的内部链接**（导航侧栏、客户主页工具卡、GA4/GSC 趋势区块 CTA、DataPullbackSection、ClientDataTab、诸葛亮相关页面），不是只加一个重定向桩子就算完成——重定向能保证不 404，但不能保证体验不绕圈子。
- client 主页 `SettingsDrawer` 的 "platform" tab 改成直接链接到 settings 页对应位置。
- 新路由统一使用 `requireOnboardingClientAccess`（现有 GBP 回调用的是 `requireDashboardClientAccess`，两者行为等价，但前者是仓库特意为"可审计哪些路由对 self_serve 在 onboarding 阶段开放"设的别名，新代码按约定走，旧代码不用现在改）。

### 2.5 WordPress 维持现状（技术原因，非偷懒）

不变，同 v1：自建 WordPress 站点走 REST API + Application Password，WordPress.com 官方 OAuth 对自建站点无效，这不是没实现，是这条路本来就走不通。这次只把面板从 CMS 分组挪到统一的"平台连接"分组。

### 2.6 五步向导 Step 3 改造

- GA4/GSC/GTM 显示真实的"连接 Google 网站数据"按钮（走 §2.1 合并流程，用新的 `wizard` flow 值），同屏保留"👉 我搞不定 → 上门帮我连"跳过链接，不需要先失败一次才能看到跳过选项。
- **回调必须落回向导页面，不能落到 settings 页**——这是本次修订最关键的一条（§2.1 已经在设计里解决，此处重申）。
- 资源列表接口调用如果因为权限不足/API 未开通而报错，**必须明确报错，不能悄悄归到"没有可用资源，点这里跳过"这一支**——两种情况都会表现为客户端拿到空列表，但一个是真的没有、一个是我们接口坏了，必须用不同的状态码/错误信息区分，不能让 FDE 和客户都以为是"客户没账号"而错过真正的接口故障。
- Meta 维持原样，不改。

### 2.7 GTM 新建范围（零基础，且有一个不由我们控制的时间变量）

- scope：`tagmanager.readonly`（v1 只读，够确认客户是否已装 GTM 容器）。
- **这是一个全新申请的 Google scope，跟 Meta 广告的 App Review 是同一类风险**：Google 对新增到 OAuth 同意页的 sensitive/restricted scope 有独立验证流程，从几天到几周不等，不在我们的工程进度控制范围内。v1 对 Meta 做了这个判断（§0 第 6 条），但没有把同样的标准套用到 GTM 上——这次补上：**PR2 动手前，先去 Google Cloud Console 提交 `tagmanager.readonly` 的验证申请，参照 GBP posting API allowlist 的先例（提交 case → 等批复 → 批复前功能降级）**。批复时间不确定这件事需要提前让 PM 知道，不是"代码写完了才发现卡在审核"。
- **产品价值确认（子牙拍板，理由写在这里，PM 如果不认可可以推翻）**：只读 scope 能做的事只是"检测客户装没装 GTM"，对大概率没有 GTM 账号的客户，连上之后能看到的就是"0 个容器，跳过"。这次仍然选择把 GTM 一起放进合并同意页，理由是 PM 原话是"google ga4，gsc，tag mgt，wordpree授权，meta这些都需要先授权过来"，把 GTM 跟 GSC/GA4 归在一类明确要求过；"0 个容器"这个空状态复用跟 GA4 一样的"没有就跳过，是正常情况不是错误"文案模式，不会让客户觉得卡住。

---

## 3. 分 PR 实施顺序

| PR | 内容 | 依赖 | 风险等级 |
|---|---|---|---|
| **PR1** | 扩容 `PLATFORM_PROVIDERS` + `isGoogleProvider()`（代码层）+ DB CHECK 约束扩容为 8 值（**动手前先 SELECT 线上真实约束，不抄文档**）；`GbpPanel` 抽成通用 `PlatformConnectionPanel`，原地替换 GBP 验证行为不变 | 无 | 低 |
| **PR2** | 扩展现有 `google/connect`+`callback`（不新建路径）：加 GTM scope、GA4/GTM 资源列表+选择器、写 `platform_oauth_connections` 三行、**同步写 `client_connectors`**（gsc/ga4）、`flow` 新增 `wizard` 值、GBP 的 `gbp/start`+`callback` 同步补 `wizard` 分支、区分"真的没有"vs"接口报错"两种空态；settings 页整合展示 | PR1 | 中高（本次修订的核心） |
| **PR3a** | 老 `google_oauth_tokens` 回填脚本 + 双写（expand）+ `ga4/client.ts` 迁移到 `resolveAccessToken()` 模式（复用 `gsc/client.ts` 先例） | PR1（不依赖 PR2，可并行安排） | 中 |
| **PR3b**（独立 PR，canary 验证通过后才合并） | 停止读写老表（contract） | PR3a + canary 验证 | 中，PM 已接受小风险 |
| **PR4** | 拆假状态 `GoogleAdsPanel`，换一行说明，清掉误导性代码注释 | 无 | 低 |
| **PR5** | 三处重复入口合并：connectors 页退役为跳转 + **同步修改 9 处内部硬链接**、`[anchor]` 子路由去留确认、SettingsDrawer 简化、WordPress 面板挪分组、`client_connectors` 遗漏 anchor（google-ads 扫描/social）补齐去向 | PR2 | 中 |
| **PR6** | 向导 Step 3 改真连接按钮 + 保留跳过；`buildBriefPath` 改指向 `/onboarding`（正式激活开关）；`onboarding/complete` 顺手补写 `brief_completed_at`（防止跳过 Step1 的客户下次登录被多余弹回向导） | PR2 | **高，客户注册首屏，必须先在预览环境走一遍完整流程再合并** |

PR2 已包含 GTM，理由见 §2.7。

**PR2 动手前的前置事实核查（不是代码工作，是去查清楚再动手）**：
1. 当前 Google OAuth 客户端在 GCP 的"未验证应用"审核状态——如果还没通过，同意页前面会插一个"Google hasn't verified this app...unsafe"警告页，比同意页本身更吓退非技术客户，必须先确认清楚再决定要不要先处理这个。
2. 提交 `tagmanager.readonly` 的 scope 验证申请（见 §2.7）。
3. 用沙盒 Google 账号实测一遍：已经连过 GBP 的客户，再走一次新合并授权，同意页会不会因为新增好几个 scope 而触发 Google 侧额外安全提示邮件——不能凭空假设"应该没事"。

---

## 4. 验收清单（实施完成后逐条对照）

1. **狄仁杰重点**：GSC/GA4/GTM 新增/复用路由的 provider 过滤必须到位（2026-08-03 那次"断错连接"的 bug 不能在新 provider 上重演）——变异测试：故意去掉 provider 过滤，测试必须失败。
2. **板桥重点（本次修订新增）**：向导里点新按钮连接 GA4/GSC/GTM，成功或失败之后**必须落回向导页面**，不能落到 settings 页；走查一遍没有账号的客户点连接的完整体验（同意页正常显示 → 资源选择器显示"没找到，点这里跳过"而不是报错卡住）。
3. self_serve 用户只能碰自己 client 的连接数据。
4. **canary 客户强制走新路径的同步结果核对**（不是看整体 cron 成功率——原因见 §2.2）。
5. connectors 页退役后，9 处内部硬链接全部改完，不是只加跳转桩子；历史外部书签跳转不 404。
6. 老 `google_oauth_tokens` 表停止写入后，保留读权限至少一个季度做审计追溯。
7. 沙盒账号验证：GA4/GTM token 过期后的自动刷新流程真的能跑通，不会命中"`Token refresh not yet implemented`"报错分支。
8. `microsoft_mail` provider 的现有连接（CTS 邮件进线管道）在 PR1 约束扩容后依然能正常写入——扩容前后各跑一次针对这个 provider 的写入测试。

---

## 5. 明确不做（本期）

- Meta 广告真 OAuth（PM 拍板暂不做，等 Meta App Review 走通后再单独立项）。
- WordPress.com 官方 OAuth（技术上对自建站点无效）。
- Google Ads per-client OAuth（继续用共享 MCC 凭证模式）。
- `google_oauth_tokens` 表物理删除（只停止读写，留作审计）。
- 账号级选择器（客户 Google 登录下有多个可选账号的场景，沿用 GBP 现状的"取第一个"简化）。
- cron / 向导状态判定从 `client_connectors` 切换到只读 `platform_oauth_connections`（本期两张表并存，各司其职，见 §2.2）。

---

## 6. 明确留给下一轮的开放问题（不阻塞本期，但需要有人记住）

- `/connectors/[anchor]` 子路由本身要不要跟主页面一起退役，还是作为过渡期内部实现保留——PR5 动手前确认。
- GTM 只读 scope 目前唯一价值是"检测装没装"，如果 Google 审核时间线拖得比预期长很多，是否要把 GTM 从这批合并授权里先抽出来单独放行，避免拖慢 GSC/GA4 的上线——留给 PR2 动手前那次前置核查后再判断。

---

## 7. v1 → v2 修订记录（供审查对照）

| v1 的问题 | 发现者 | v2 的修法 |
|---|---|---|
| 新建 `connect-suite` 路径，未发现已有合并授权路径存在 | 子牙+魏征（独立各自发现） | §2.1 改为扩展现有 `google/connect`+`callback` |
| 未发现 `/connect/[clientId]` 无登录客户自助页 | 子牙 | §2.1 说明其自动继承扩展后的能力，不需要单独处理 |
| OAuth 回调写死跳到 FDE settings 页，向导场景会把客户送错地方 | 板桥 | §2.1/§2.6 新增 `wizard` flow 值 |
| 向导"已连接"状态和 cron 判定读的是 `client_connectors`，方案只写了新表 | 子牙+魏征（独立各自发现） | §2.1/§2.2 改为两表并写 |
| `isGoogleProvider()` 未涵盖 GA4/GTM，token 刷新会静默报错断线 | 魏征 | §2.2 明确同一 PR 内修 |
| `PLATFORM_PROVIDERS` 常量遗漏，只改了 DB 约束 | 魏征 | §2.2 补齐两步流程 |
| CHECK 约束"现状"描述过期（漏了 microsoft_mail），照抄会断邮件管道 | 魏征 | §2.2 更正为真实 6 值现状 + 强调迁移前必须 SELECT 真实值 |
| `ga4/client.ts` 完全未迁移，`getValidAccessToken` 无 provider 参数 | 魏征 | §2.2 改为复用 `gsc/client.ts` 的 `resolveAccessToken` 模式 |
| "双写验证 3 天看 cron 成功率"信号被 fallback 掩盖，测不出新路径是否真的能用 | 魏征 | §2.2/§3 改为 canary 客户强制新路径验证 |
| GTM 新 scope 需要 Google 审核，未套用 Meta 同款风险判断 | 子牙 | §0/§2.7 补齐，PR2 前置核查加提交审核 |
| 未确认 OAuth 客户端"未验证应用"状态，可能有比同意页更吓人的警告页 | 板桥 | §3 PR2 前置事实核查新增 |
| connectors 页退役低估实际依赖范围（9 处内部硬链接） | 魏征 | §2.4/§3 PR5 明确列出 |
| Meta/GTM 部分成功状态（如 GSC 成功但 GA4 403）未设计 | 子牙 | §2.6 明确"真的没有"vs"接口报错"必须区分 |
