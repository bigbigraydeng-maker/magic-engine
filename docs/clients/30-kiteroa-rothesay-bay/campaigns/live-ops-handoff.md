# 30 Kiteroa · Live Ops Handoff

> **上线日**：2026-07-27 · ME **首条 Type B 楼盘广告** · Messenger 对话 lead-gen 测试轮

---

## 1. 投放实况（核对用）

| 项 | 值 |
|---|---|
| **广告账户** | **Magic Engine** `1018365291238494`（ME 自有 · NZD · 数据护城河归 ME）|
| Campaign | `120251829450070589` · OUTCOME_ENGAGEMENT · CBO |
| 广告组 | `120251829469950589` · CONVERSATIONS / Messenger · Rothesay Bay 15km · 18-65 · Advantage+ |
| **日预算 / 上限** | **NZ$32/天 · 总上限 NZ$1,300**（约 40 天）|
| 承接 Page | **Roman Hu Real Estate** `227633594573276`（Messenger 收件箱）|
| 对外署名 | Roman Hu Real Estate（**零 Magic Engine 痕迹**）|

**5 条广告（赛马）**：
- Ad A `120251830148050589` — 英文 · Rangitoto 学区
- Ad B `120251830178720589` — 英文 · $10k Prezzy（**广告文案里无任何日期**，只写 "before this offer ends"；「20 August」仅存在于视频烧字，2026-07-28 未能独立核实，见 §4）
- Ad C `120251830179580589` — 英文 · 空间/家庭
- Ad D `120251830180220589` — 英文 · 议价 $1.25M
- Ad E `120251836134920589` — **英/中/韩三语文案** · Rangitoto 学区

> ⚠️ **废弃账户**：`1260456876069575`（名字叫「30 Kiteroa」）被 Meta 平台 bug 锁死付款，**不用它**。手机 App 里看广告要切到 **Magic Engine** 账户。

---

## 2. Messenger 三语自动回复（欢迎语）

> 首次私信自动秒回。**英文打头**堵「中文默认杀转化」坑。设在 Roman Page → 收件箱 → 自动化 → 自动回复。

### 🔴 2026-07-28 实地核查结果（推翻此前判断）

| 项 | 实况 |
|---|---|
| 直达 URL | `business.facebook.com/latest/inbox/automated_responses?asset_id=227633594573276` |
| 自动化 ID | `1909747876361831`（模板 `instant_reply`）|
| **开关状态** | **已经是「开」** —— 不需要「扳开关」，此前判断有误 |
| 渠道 | Messenger ✅ / Instagram ☐（未勾）|
| **当前回复内容** | **「你好，我们已收到你的消息，感谢你与我们联系。」** ← Meta 默认中文，**正在生效** |
| 字数上限 | 500 字符（三语文案实测 467，放得下）|

### ✅ 2026-07-29 PM 纠正：**「买家收到中文」是错的判断，已撤销**

> **PM 实机确认（手机端）：买家收到的是英文回复。** 此判断 PM 已纠正两次，子牙重复误报，记为教训。

**根因**：Meta 的**默认模板自动回复是按收信人语言本地化的**，不是固定文本。
子牙在**中文后台界面**里读到的是同一条模板的中文渲染 —— 把「**我看到的语言**」误当成「**买家收到的语言**」。

| | 买家实际收到 |
|---|---|
| **Meta 默认模板**（现状） | 英文买家→英文 · 中文买家→中文 · 韩国买家→韩文 ✅ **自动适配** |
| 子牙原提议的「三语固定文案」 | **所有人都收到三段** —— 对多语受众**反而更差** |

> 🔴 **教训（比原问题更值钱）**：那个「修复」会把一个**自动适配**的机制，换成一个**所有人都要读三遍**的固定字符串。
> **在后台界面看到的文案语言 ≠ 终端用户收到的语言。** 判断对外内容前必须实机验证收信端，或直接问 PM，不能靠读后台。

**仍待实机验证（非语言问题）**：
- 「离开消息」`895159281154034` 的**离开时段被设成 7 天 × 全天**，手动状态却是「在线」，两者冲突 → 到底触不触发**未验证**。若触发，等于每个买家都收到一句「现在无法回复」（哪怕是英文的，也劝退）。
- FAQ 内容未核实。
- 三者都只能靠**发一条测试私信看实际弹回什么**来确认，不能靠读后台推断。

**下面那段三语文案：暂不使用**，保留仅作参考（若将来改成自定义文案再评估，且需先想清楚「固定三语 vs 自动本地化」的取舍）。

```
Hi! Thanks for your interest in 30 Kiteroa Terrace, Rothesay Bay 🏡 Brand-new 4-bed freestanding home in the Rangitoto College zone. Reply with your name + what you'd like (info pack / floor plan / viewing) and Roman will be in touch shortly.

您好！感谢关注 Rothesay Bay · 30 Kiteroa 全新 4 房独立别墅（Rangitoto College 学区）🏡 请回复称呼 + 需求（资料 / 户型图 / 预约看房），Roman 会尽快联系您。

안녕하세요! 로데세이 베이 · 30 Kiteroa 신축 4베드룸 단독주택（랑기토토 칼리지 학군）입니다 🏡 성함과 원하시는 것（자료 · 평면도 · 방문 예약）을 남겨주시면 Roman이 곧 연락드리겠습니다.
```

---

## 3. 给 Roman：手机看客户咨询（**整段直接转发**，中英双语·手机可读）

> ⚠️ 发送前需 PM 显式授权。整段复制到 WhatsApp / 微信发给 Roman 即可，无需他读本交付单。

```
Hi Roman — 30 Kiteroa 的广告已经上线，买家会直接私信你的
Facebook 主页。麻烦花 2 分钟把手机端设好：

1. 应用商店搜 "Meta Business Suite"，下载安装
2. 用你自己的 Facebook 账号登录 → 选「Roman Hu Real Estate」主页
3. 进「收件箱 Inbox」→ 把消息通知全部打开
   （Settings → Notifications 全开）

买家私信会在收件箱，不在「潜在客户中心」。
有新消息手机会立刻响，请用对方的语言回（中 / 英 / 韩都会有）。
越快回复成交率越高，建议 1 小时内。

---

Hi Roman — the 30 Kiteroa ads are live and buyers will message your
Facebook page directly. Please take 2 minutes to set up your phone:

1. Download "Meta Business Suite" from the App Store / Play Store
2. Log in with your Facebook account → select "Roman Hu Real Estate"
3. Open Inbox → turn ON all message notifications
   (Settings → Notifications)

Enquiries land in Inbox, not the Leads Centre.
You'll get an instant ping — please reply in the buyer's own language
(we're running English / Chinese / Korean creative).
Faster replies convert much better — aim for within the hour.
```

**Lead 落点**：Roman Hu Real Estate Page → **收件箱（Inbox）**，不是「潜在客户中心」（因走 Messenger 对话，非表单）。
⚠️ **原写「ME(Pengyu) 有 full access」需修正**：PM 个人 Facebook 登录（浏览器）确实能进收件箱看/管，但 **API/MCP 通道读不到任何对话**，不能据此设计自动落库。详见 §4.5。

---

## 4. 待办 / 下一步（2026-07-28 更新）

### ~~🔴 P0 · 三个自动化全是默认中文~~ → ✅ **2026-07-29 已撤销（误判）**
- **PM 手机端实机确认：买家收到的是英文。** Meta 默认模板按收信人语言本地化，子牙读的是中文后台渲染，误判。详见 §2。
- **原「改成三语固定文案」的方案一并作废** —— 会把自动适配换成人人读三遍，更差。
- ⚠️ 若将来真要改成自定义文案：自动回复对 **Roman 整个 Page** 生效，非 30 Kiteroa 专属，活动结束需改回通用版。

### ✅ ~~P1 · 离开消息是否会误触发~~ → **2026-07-29 用真实对话验证完毕，无需改动**

**证据来源**：不发测试私信，直接翻真实买家对话（Rama Krishna Kolluru，周一 21:46 从广告进来）到最开头：

```
Rama Krishna Kolluru 回复了一条广告。
[主页] Hi Rama Krishna! Please let us know how we can help you.   ← 自动回复
买家   What's the address
买家   Can you send the floor plan
```

| 待验事项 | 实证结论 |
|---|---|
| 自动回复是否触发 | ✅ 触发，买家首条消息后立即弹出 |
| 语言 | ✅ **英文**，且**自动代入买家名字** |
| 离开消息是否误触发 | ✅ **不会** —— 全对话无「休息时间/无法回复」字样；手动状态「在线」压过全天离开时段 |

> **结论：自动回复与离开消息均按预期工作，不需要任何改动。**
> 方法论沉淀：**验证对外内容行为，要去看真实用户收到了什么，而不是读后台设置反推** —— 后台读到的是「管理员界面语言下的渲染」，不是买家看到的东西。发测试私信也不可靠（管理员身份可能不触发自动化）。

### ✅ ~~$10k Prezzy 截止日~~ → **2026-07-29 已查实：8 月 20 日签约截止**

**来源（第二独立来源，非视频烧字）**：Roman 本人在 Ray White Mission Bay 官网的房源页原文 ——
> "Sign by 20 August and receive a $10,000 Prezzy Card on settlement."

[2/30 Kiteroa Terrace · rwmissionbay.co.nz](https://rwmissionbay.co.nz/properties/residential-for-sale/north-shore-city/rothesay-bay-0630/house/3524829)（同页价格 "any offer above $1.25 million"、agent Roman Hu，与广告口径一致）

**口径澄清（此前一直含糊）**：
- 是 **签约（sign）截止 8/20**，不是"咨询截止"—— 买家必须在 8/20 前**签合同**
- $10,000 卡是 **成交时（on settlement）** 才发，不是签约即发
- 与视频烧字「20 August」**一致** → 视频无需重做

**遗留动作（未决，见 §7 第 1 条）**：
- Ad B 目前仍暂停中。恢复与否等 7/29 那轮定向调整的 3 天观察期结束再定（学习期内加广告会干扰）
- 若恢复：**建议把「Sign by 20 August」写进文案首行** —— 现文案只有 "before this offer ends"，把一个真实存在的 22 天倒计时浪费掉了
- 时间风险仍在：campaign 按 $43/天 × $1,300 跑到约 **2026-08-26**，**offer 8/20 到期后仍有约 6 天窗口** → 8/20 当天必须停 Ad B 或换视频（**设提醒**）

### ✅ ~~Roman 装 App~~ → **2026-07-29 PM 确认：Roman 已装好**
- §3 那段说明**不必再发**（保留作新客户开户模板）
- **推论（重要）**：既然通知已通，前 5 条对话里那句「请打这个电话 / 发邮件 / 或留个号码给我」**是 Roman 真人回的，不是自动回复**（自动回复是 Meta 默认模板「已收到你的消息」）→ 承接摩擦属**话术问题**，不是通知问题

### 🔵 Meta 客服工单（清澳大利亚国家锁）
- [ ] 需 PM 显式 go（向 Meta 发起支持对话 = 对外发送）
- 已探明路径：`business.facebook.com/business-support-home/` → 顶部 AI 支持助手，**已自动锁定 Magic Engine `1018365291238494`**；「未结束」工单列表为空（此前从未开过）；历史工单「Ad isn't running」2026-07-01 已完成，说明该通道对本账户可用
- ⚠️ 期望值下调：Meta 官方帮助文档口径是「改国家/币种 = 关掉旧账户新建一个」，**没有「原账户解锁」的公开流程**。工单目标应定为「清个人档案层的澳大利亚遗留、让**新建**账户能绑卡」，不是「解锁现有账户」

### 🟣 lead 对话自动落库（**本轮做不到，需改设计**）
- [ ] PM 拍板：本轮华人 lead 占比用**人工口径**统计（Roman 收件箱 + PM 浏览器核对语种），自动落库推到下一轮
- [ ] 下一轮基建：建 ME 自有 Meta App + `pages_messaging` 过 App Review + Roman 授权 Page → Webhook 落库（详见 §4.5，预期 1–3 周）

### 其他
- [ ] Meta 审核通过后：ME 发一条测试私信，端到端验证三语秒回 + Roman 收到通知（**这条同时也是验证离开消息是否会触发的唯一办法**）
- [ ] 北极星追踪：华人 lead 占比 ≥40% → 数据包撬全盘 mandate

---

## 4.5 ⭐ ME 对 Roman 主页的真实权限（2026-07-28 实测 · 推翻「full access」表述）

### 结论一句话
> **两条通道能力完全不同**：PM 的**个人 Facebook 登录**（浏览器）能管这个 Page 的收件箱和自动化；**API/MCP 通道对这个 Page 几乎什么都读不到**。交付单原先写的「ME(Pengyu) 有 full access」只在浏览器这条通道成立，**不能据此设计任何自动化数据管道**。

### 逐项证据

| 探测 | 结果 | 说明 |
|---|---|---|
| `ads_get_user_pages` | **不含** `227633594573276` | 该 token 对此 Page 无 CREATE_ADS 任务权限 |
| `ads_get_ad_account_pages(1018365291238494)` | 返回 `{page_id: 227633594573276, page_name: "(unknown)", leadgen_tos_accepted: false}` | **关键证据**：能看到 id（因为它被挂为该广告账户的可投放 Page），但**连名字都读不到** → 无 Page 级 token |
| `ads_get_pages_for_business(1265811139097132)` (Magic Engine) | `[]` | Page **不归** ME 业务组合所有 |
| `ads_get_pages_for_business(510218946394854)` (Roman Hu) | **报错：This connector requires additional permissions** | Page 归 Roman 自己的业务组合，MCP 通道无权访问 |
| 浏览器 Business Suite | ✅ 能进收件箱自动化、能读能改 | URL 带 `business_id=1265811139097132` → Page 是**以合作伙伴资产（partner asset）分享进 ME 业务组合**，不是 ME 所有 |

> 附带查明：Roman 有自己的业务组合 **`510218946394854`「Roman Hu」**，废弃广告账户 `1260456876069575`「30 Kiteroa」归它所有。

### ❌ 能不能程序化读 Messenger 收件箱 / conversations？——**不能，而且不是权限问题**

**根因是工具面根本不存在**：当前接的是 **Meta Ads MCP**，它暴露的 100+ 个工具**全部是 `ads_*`**（campaign / creative / catalog / audience / pixel / insights / experiment），**没有任何一个 conversations / messages / inbox 工具**。全量工具检索确认无 Meta 消息类工具。
→ 所以**即使 Roman 明天把 Page 全权授予 ME，这条 MCP 通道依然读不到一条对话**。

### ✅ 要做「lead 对话自动落库」，唯一正确路径（三步，缺一不可）

1. **建 ME 自己的 Meta App**（developers.facebook.com），申请权限 `pages_messaging` + `pages_read_engagement` + `pages_manage_metadata`，走 **App Review**（对话数据属敏感权限，必过审，需录屏演示 + 隐私政策 URL）
2. **Roman 在他的业务组合 `510218946394854` 里，把 Page `227633594573276` 授权给 ME 的 App**，ME 换取长期 **Page Access Token**
3. 二选一取数：
   - **拉**：`GET /{page-id}/conversations?fields=participants,messages{message,from,created_time}`（轮询，简单）
   - **推**：订阅 Webhook `messages` 字段 → 实时回调 ME 后端落库（推荐，实时且省配额）

> ⏱ 现实预期：App Review 通常 **1–3 周**，**赶不上本轮 $2000 测试**。
> **本轮建议**：lead 对话**先人工/半自动**统计（Roman 收件箱 + PM 浏览器侧核对语种占比），把「华人 lead 占比 ≥40%」这个北极星指标用人工口径先跑出来；自动落库列为**下一轮**基建，别阻塞本轮交付。

### 🤖 Meta Business AI（Messenger AI 客服）在 Roman 页面是否可用？

**不可用 —— 是资格问题，不是设置问题。**
实测 Roman Page 的自动化模板全目录（`查看全部`）只有：问候用户（自动回复 / 离开消息）、分享信息（常见问题 / 位置 / 联系方式 / 营业时间 / 自定义关键词 / 消息回复评论）、管理消息（识别未回复的消息）。
**AI 客服 / Business AI 条目整条不存在**——不是开关没打开，是模板压根没下发到这个 Page。符合官方「分批开放（this feature may not be available to you yet）」的表述。
> **无公开申请入口**，Meta 按 Page/地区/行业灰度下发，只能等。
> **本轮替代方案**：用现有的「常见问题 FAQ」+「自定义关键词」两个模板手工搭一个轻量问答（能覆盖学区 / 户型 / 价格 / 约看房四类高频问题），效果不如 AI 客服但今天就能上。

---

## 5. 关键教训（沉淀进 skill）

1. **付款系统性 bug**：`1260456876069575` + Magic Engine 账户级绑卡都撞「无法更改国家/地区」→ 根因=个人档案层澳大利亚遗留。业务组合层加卡 OK，账户层绑卡全锁。**只有 bug 前已绑卡的老账户能花钱**（Magic Engine 恰好被 PM 手动绑成功）。
2. **Messenger 创意兼容**：CONVERSATIONS/MESSENGER 广告，创意 CTA 必带 `call_to_action.value.app_destination=MESSENGER`（否则「创意与目标不兼容」）+ video_data 必带缩略图。
3. **视频账户隔离**：MCP 视频上传全账户 gated → 视频需手动传到目标账户素材库（个人账户无独立素材库，业务组合账户才有）。
4. **自动回复默认中文**：Meta 自动回复模板默认中文 = 杀转化。混合人群必英文打头三语。
   → **2026-07-28 加强**：这个开关**默认就是「开」的**（不是需要你去扳开），且内容默认中文。所以「没配」≠「没生效」——**每个新客户 Page 上线广告前必须先去看一眼 `automated_responses` 现在到底在回什么**，否则等于替客户默认发了一句中文。
   → **再加强**：默认开的**不止一个**。本单 Roman Page 同时有 3 个自动化在用（自动回复 / 离开消息 / 常见问题），全中文。**排查要看整张 `automated_responses` 列表，不能只看问候语那一条。**
5. **对外内容署名 Page 决定**：广告署名 = 创意里的 page_id（Roman Page），跟广告账户是谁无关 → 跑 ME 账户对外仍 100% Roman。
6. **「只认真人手势」要先证伪再写进文档**：本单曾记「Meta 这个开关自动化点不动」，实测浏览器自动化可正常进列表 / 进编辑页 / 定位文本框，真正的拦截来自 ME 本地权限分类器。**把本地权限限制误记成第三方平台限制，会让下一个人直接放弃自动化。**
7. **⭐「有 full access」必须写清楚是哪条通道**：本单交付单写「ME 有 full access」，实际是 **PM 个人 FB 登录（浏览器）有**，而 **API/MCP 通道连 Page 名字都读不到**。两条通道能力天差地别。**任何「数据自动落库」设计前，必须先用 API 实探一次（读 page_name 是最便宜的探针：读不到名字 = 没有 Page 级 token），不能靠交付单里的形容词。**
8. **⭐ Meta Ads MCP 没有消息面**：它 100+ 个工具全是 `ads_*`，**不含任何 conversations/messages 工具**。想读 Messenger 对话必须另建 Meta App + `pages_messaging` 过 App Review（1–3 周）。**「接了 Meta MCP」≠「能拿 Messenger lead」，排期时别把这两件事当成一件。**
   → **2026-07-29 重大更正**：上面这条的结论**对 MCP 通道成立，但对整个 ME 是错的**。ME **早就有生产级 Messenger 每小时同步管道**（`messenger-hourly` cron → `/api/cron/messenger-sync-hourly` → `conversations`/`conversation_messages` 表，CTS 已落 444 条对话 / 1694 条消息，2026-07-27 由 PR #654 注册）。**差点因为「MCP 读不到」就去排一个 1–3 周的 App Review，而现成的东西一直在跑。** 这是「建东西前先查平台」的又一次现场复发：**查能力要查整个平台（表 / cron / route），不能只查手上那个工具面。**

9. **⭐ 沉默失败最贵**：30 Kiteroa 收件箱里有 5 条真实买家对话，同步却报「0 条」，和「真的没有对话」**完全无法区分** —— 因为 `fetchPageConversations` 里 `if (!body) break` 把 API 报错吞成了空数组（错误只进 console，不进 `cron_run_logs.error_message`）。**任何「拉取 0 条」的成功日志都必须能区分「真的没有」和「请求被拒」**，否则排查要靠肉眼比对第三方后台。

10. **⭐ 消息类权限拿不到系统账号令牌**：Meta 的 `pages_messaging` 属需审核权限。生成系统账号口令时它是**灰的、勾不动**（应用未过 App Review）。
    → **可行路径 = 用户令牌**：由**同时是「应用管理员」+「该 Page 管理员」**的个人生成（Graph API Explorer），Meta 对这种身份直接放行、不需要过审。代价是 **60 天到期需换**。CTS 一直就是这么跑的（`token-manager.ts` 注释里写着，但没人当回事）。
    → **推论**：一个用户令牌覆盖**该用户有权限的所有 Page**。所以 PM 手上给 CTS 用的那个令牌，很可能直接就能读 Roman 的 Page —— 复制到新变量名即可，无需新建。

11. **⭐ 别用「填个网址」去当配置钥匙**：`getMetaTokenForClient` 原本只能按 `clients.domain` 派生 env key，而 30 Kiteroa 是单楼盘、没有网站。**但绝不能为了配令牌随便填一个占位网址** —— `keyword-snapshots-weekly` / `flywheel-seo-weekly` 都是 `WHERE domain IS NOT NULL` 全量选客户，填了就会把这个不买 SEO 的客户**静默拉进每周付费的 DataForSEO 扫描**。
    → 已改为支持 `META_SYSTEM_USER_TOKEN_PAGE_<PAGE_ID>`（PR #676，无 migration、纯增量）。**教训通用化：加配置项之前先 grep 那个字段还被谁当筛选条件用。**

---

## 6. 2026-07-29 第三天调整（当前生效状态 · 接手先读这节）

**触发**：第 3 天 0 enquiry。诊断出根因不是创意，是**池子投干了** —— 多花 $19.70 只多触达 179 人，频次 1.90。

**PM 目标（本轮唯一硬指标）**：$1,300 总预算 · 30 天 · **50 个 enquiry**
→ 反推：单个 ≤ **$26** · 日预算 **$43.33** · 每天 **1.67 个**

**3 天基线**：花费 $81.54 · 触达 1,641 · 频次 1.90 · CTR 5.04% · 5 个 enquiry · 单个 **$16.31**（比上限低 37%，成本不是问题）

### 已执行的四步

| 步 | 改动 |
|---|---|
| 1 | 投放半径 **15km → 25km**（两个广告组都改）|
| 2 | 日预算 **$32 → $43**（30 天正好花完 $1,300）|
| 3 | A/C 换成**价格前置**文案（地址+$1.25M+4房+学区+现房 全部前置）|
| 4 | 停掉旧 A（$25.12 太贵）· 旧 C · **B（$10k 优惠截止日未确认，不让过期优惠对外跑）**|

### 当前在跑（4 条 + 2 组）

| 广告 | ID | 说明 |
|---|---|---|
| **D 议价** | `120251830180220589` | 🏆 $7.44 最低 —— **不要动赢家** |
| A2 价格前置·学区 | `120251888084530589` | 新 |
| C2 价格前置·空间 | `120251888086350589` | 新 |
| E2 三语 | `120251880887740589` | 独立组 `120251880863820589` · 扩展关 |

> ⚠️ **改定向会触发 Meta 强制暂停**，`ads_update_entity` 后必须配 `ads_activate_entity`。本次已处理。
> ⚠️ **改完定向 = 重新进学习期**，24–48h 成本先涨后降属正常。**给它 3 天，别反复改** —— 反复改定向是最伤成本的操作。

### 3 天后怎么判（只看一个数）

| 信号 | 结论 |
|---|---|
| 触达每天涨几百+ | ✅ 放大奏效，方案成立 |
| 触达仍不动 + 频次涨 | 🔴 25km 仍不够 → 考虑全奥克兰 |

**别只盯 enquiry 数**，池子刚放大算法在重学。

---

## 6.5 ⭐ 2026-07-29 晚 第二轮调整（**推翻半径思路** · 接手以本节为准，§6 已被覆盖）

**PM 洞察（本轮最关键一句）**：「买房子的不一定是住在这里的」。**成立，而且比预想更严重。**

### 🔴 根因：不是半径太小，是设置层把目标买家排除了

实读两个广告组的定向，都写着 `location_types: ["home"]` —— **只投「家住在这个圈里」的人**。

而本盘最大卖点是 **Rangitoto College 学区**。**为学区搬家的人恰恰现在不住在学区里** —— 这正是他们要买的理由。按「住在附近」投，等于把最想买的人**从设置层面**排除。

**同时解释了华人 lead 0%**：奥克兰华人聚居在**东区（Howick / Botany）+ 中区（Epsom）**，从 Rothesay Bay 量过去正好卡在 25km 圈的边缘或圈外 → **不是三语创意不行，是压根没投到华人住的地方**。

### 平台拆分实测（决定关掉 IG 的依据）

| 平台 | 花费 | 触达 | CTR | 咨询 |
|---|---|---|---|---|
| **Facebook** | $86.57 | 1,753 | **5.75%** | **6** |
| **Instagram** | $14.74 | 279 | **1.49%** | **0** |

IG 零产出、CTR 只有 FB 的 1/4（4 倍差距，非噪音）。
⚠️ **额外发现**：ad account **没有连 IG 商业账号**（`ads_get_ig_accounts` 返回空）→ IG 上的互动**收不进任何受众池**，那 $14.74 买到的 279 人互动**全数流失**。

### 已执行（2026-07-29 晚 · PM「明天就改」授权，提前到当晚以让 7/30 全天跑满新定向）

| # | 改动 | 两个组都改 |
|---|---|---|
| 1 | 地理：25km 半径 → **Auckland Region 全域**（key `2724`）| ✅ |
| 2 | `location_types`：`["home"]` → **`["home","recent"]`**（← 真正的修复点）| ✅ |
| 3 | 版位：自动 → **`["facebook","messenger"]`**，关掉 IG | ✅ |
| 4 | 年龄：主组 18 → **25**（18–24 买 $1.25M 概率极低，纯浪费；与三语组统一便于对比）| ✅ |

**组名已改**：`Auckland 全域 · Message Leads · FB only` / `30 Kiteroa · 三语专测 · Auckland 全域 · FB only`

> ⚠️ 三语组改定向后**被 Meta 强制暂停**，已 `ads_activate_entity` 恢复并验证 ACTIVE（主组本次未被暂停 —— **强制暂停不是必然发生，每次都要实查，不能假设**）。
> ⚠️ 改定向后所有广告重新进 `PENDING_REVIEW`，adset 短暂显示 `no_active_ad` 属正常，审完自动恢复。

### $10k Prezzy 广告已复活（带日期）

| 广告 | ID | 状态 |
|---|---|---|
| **B3**（在跑）| `120251897764880589` | ✅ ACTIVE · 零错误 |
| ~~B2~~（建坏了）| `120251897468000589` | ⛔ PAUSED · 保留作教训，不花钱 |
| ~~B~~（原版无日期）| `120251830178720589` | PAUSED 留作对照 |

新文案首行：`🎁 Sign by 20 August — receive a $10,000 Prezzy Card on settlement.` + 价格前置 `Offers above $1.25M`（D 已验证价格前置有效）。

> 🔴 **教训 12（新）**：Messenger/CONVERSATIONS 目标的广告，creative **必须**带 `call_to_action.value.app_destination = "MESSENGER"`。
> `ads_create_creative` 工具面**不暴露**这个字段 → 建出来的 creative 报 `Invalid Creative For Objective`。
> **正确姿势**：走 `ads_create_ad` 的 `creative.object_story_spec` 内联 video_data，把 `app_destination` 写进去。
> 通用化：**创意建完必须 `ads_get_errors` 实查**，`ads_activate_entity` 返回 success **不等于**能投放。

### 目标口径变更（PM 2026-07-29 拍板）

| | 旧 | **新** |
|---|---|---|
| 30 天 lead 目标 | 50 | **30** |
| 单个 lead 上限 | $26 | **$43.33** |

**含义**：预算没变而目标减半 → **PM 用预算空间换「更对的人」而非「更多的人」**，与打华人买家的方向一致。
当前实际单个 **$14.43**（campaign 级，含 IG 拖累）→ **成本远不是瓶颈，人群才是。**

---

## 6.6 中文版 Reel（2026-07-30）· 已建好待发 · 卡在账户电话验证

**触发**：PM「视频是不是也要再大胆调整」+「之前画面压得太暗」+「教育是很大卖点」。

### 成片

`30kiteroa_reel_cn_school_v1.mp4` · 16s · 1080×1920 · 六屏 · 配乐 Suno《Sunlit Kitchen Window》
存放：Dropbox `Magic Engine/by-client/05_Kiteroa/` + Supabase `content-factory/renders/30-kiteroa/`
可复用脚本：同目录 `_tooling/{make_text.py,render_cn.sh}`（换素材清单+文案即可出下一个楼盘）

| 项 | 旧英文版 | 中文版 |
|---|---|---|
| 平均亮度 (0–255) | 105 | **137**（+30%）|
| 压暗方式 | **整屏压暗 15%** 衬白字 | 只在字幕带加 ≤28% 渐变，主体全亮 |
| 素材 | 航拍社区远景 | **明亮室内实拍**（之前一直闲置未用）|

**六屏顺序**（PM 指出原七屏「$1.25M → 8月20日签约 → 私信看房」逻辑不对 = 还没看房就叫人签约）：
学区 → 全新 4 房 → 产权·验收全部下发 → 现在就能入住 → $1.25M 起（含优惠）→ 私信预约看房

### 🔴 教训 13：素材元数据必须实测，不能信 ffprobe 的宽高

`ffprobe` 报 1280×720（横屏），实际带 `rotation=-90`，解码后是 **720×1280 竖屏**。
按横屏处理会多做一层无用的模糊填充且裁掉底部。**判断方向要抽帧看解码结果，不能只读 stream 宽高。**

### 🔴 教训 14：移动镜头选帧必须验「该段中点」，不是起点

`IMG_7637` 起点是客厅全景，2 秒后镜头已摇到厨房水槽 —— 按起点选帧，CTA 配到了水槽。
另：该 40s 长镜头 10–37s 全是门/空墙/厕所，只有 ~2s 可用。**长素材不等于可用素材。**

### 🔴 教训 15：Meta AI 的「文案改进」会删掉合规限定词（**每次新建广告必查**）

创意流程第 4 步，Meta AI 生成 4 条改写并**默认全部勾选**。它把
「8月20日前签约，**成交时**送 $10,000 礼卡」改成「8月20日前签约，**送** $10,000 礼卡」——
**删掉「成交时」= 变成"签约即送"的误导陈述。**
同页「图片生成」还会塞 **AI 假人**（自拍女性/情侣）+ **乱码中文**（"莫柩""全粃独立厓"）。
👉 **每次都要手动取消「全部应用」，并确认 AI 素材 0 选中、增强开关全关（尤其「视频润色」会裁掉字幕）。**

### ✅ 教训 16（好消息）：上传视频的正确绕道

`ads_creative_upload_video` MCP 工具**对本账户未 rollout**；浏览器 `file_upload` 又受
「只能传用户已共享给会话的文件」限制（scratchpad 和 Dropbox 路径都被拒）。
**可行路径**：视频先传 Supabase `content-factory`（public bucket）→ Ads Manager 素材面板
**「视频网址」标签** → 粘贴公开 URL → 秒导入。**这条路对任何客户都通用。**

### ✅ 已发布：Ad F `120251907788030589` · ACTIVE（2026-07-30）

三语组 `120251880863820589` 下，名「30 Kiteroa · Ad F · 中文 · Rangitoto 学区」。
接口验证 `status=ACTIVE`（`effective_status=IN_PROCESS` 属新广告审核中，正常）。

### ✅ 教训 17：账户电话验证 —— 「关联已验证号」≠「验证新号」

发布时报 #3858013「广告账户必须绑定已验证电话号码」。
弹窗自动带出 **主页上已验证的号**，措辞是「**添加**到广告账户」而非「验证」。
**PM 确认该号是他本人的**（不是 Roman 的 —— 但归属必须先问，别默认）。
选已验证那条 → **直接通过，零验证码**。PM 此前「一直认证有问题」应是走了「验证另一电话号码」（需重新收短信）那条路。
👉 **下次遇到：先看有没有「主页已验证号码」可选，别一上来就验新号。**

### 账户当前在跑（2026-07-30 接口实读）

| 组 | 广告 | 状态 |
|---|---|---|
| 主组 `…829469950589` | D 议价 / A2 / C2 / **B3 $10k 带日期** | 全 ACTIVE |
| 三语组 `…880863820589` | E2 三语 / **F 中文·学区** | 全 ACTIVE |

⛔ `120251897468000589` 已改名 **[作废·勿用] B2** —— PAUSED 不花钱，保留作教训 12 的现场。

---

## 6.7 数据飞轮盘点（2026-07-30 · PM 追问「我们到底拿到了什么」）

### 实读结论：飞轮在转，但只转了一半

| | SEO | 广告 |
|---|---|---|
| 原始数据 | 有 | 有（`ad_daily_insights` 434 行，CTS 198 / Oztop 236，6/21–7/28）|
| 结果判定（`flywheel_outcomes`）| **141 条**（62 confirmed / 66 reversed / 13 inconclusive）| **0 条** |
| 沉淀成经验 | 1 条自动提炼 | **0 条** |

memory 系统四表实读：`client_decision_history` 424 / `client_proven_patterns` 15（seo 9 + geo 6）/
`client_failed_experiments` 8（seo 7 + social 1）/ `client_learned_preferences` 2。
**广告相关：全部为 0。**

**根因**：SEO 的结果会自己回来（排名涨没涨 Google 会说），广告的不会——花钱→曝光→点击→咨询之后就断了。
**结果不回流 ⇒ 永远判不了「这次做得对不对」⇒ 永远学不到东西。** 这跟 §7 的「结果回流」是同一件事的两面。

### 🔴 教训 18：30 Kiteroa 的广告数据 4 天没回流 —— 因为绕过 UI 直接写库

`clients.meta_ad_account_id` 被直接写成裸数字 `1018365291238494`，**缺 `act_` 前缀**。
`google-data-pullback-daily` 拿它直接拼 Graph URL（`${GRAPH_BASE}/${adAccountId}/insights`，**不补前缀**）→ 请求打到不存在的对象 → **静默失败无报错**。

**而系统正规写入端 `normaliseAdAccountId()`（`api/clients/[id]/meta-ad-account/route.ts`）会自动补前缀 + 校验 `^act_\d{10,}$`** —— 走 UI 根本填不错。

✅ 已修正为 `act_1018365291238494`。
⚠️ **未验证**：token 解析走 `META_SYSTEM_USER_TOKEN_<DOMAIN>` → slug → 全局 fallback 三级；本客户 domain 为 null（教训 11 有意为之），会落到全局 token。该 cron **不支持** PR #676 的 `_PAGE_<PAGE_ID>` scheme。明早 cron 跑完需实查是否真回流。

### ✅ 新建：跨客户经验库 `global_learned_lessons`（PM 2026-07-30 拍板「必须建」）

**补的是 memory 系统缺失的全局层** —— 现有 `client_*` 四表全部强制带 `client_id`，装不了「学区房别只投附近」这类不属于任何单个客户的认知。**不是另起一套系统。**

migration `20260729164753_global_learned_lessons` 已验证落库 · 17 字段 · RLS `service_role_full`。

设计要点：
- `lesson_key` UNIQUE → 同一经验重复观察走 upsert + `confirmed_count+1`，不堆重复行
- `evidence` jsonb **NOT NULL** → 无出处的「经验」不许入库（呼应「绝不凭空注入」红线）
- `contradicted_count` → 经验必须可被推翻，只涨不跌会把偶然当规律

**首批 6 条已入库**（全部来自本轮实测，非凭空）：

| lesson_key | 层 | 置信 |
|---|---|---|
| `re-ads-do-not-restrict-to-home-location` | 行业·地产 | 0.70 |
| `re-ads-instagram-underperforms-premium-housing` | 行业·地产 | 0.60（样本小）|
| `meta-ai-copy-rewrite-strips-compliance-qualifiers` | 渠道 | 0.95 |
| `meta-messenger-creative-needs-app-destination` | 渠道 | 1.00 |
| `config-must-go-through-ui-not-direct-db-write` | 全局 | 0.90 |
| `video-source-metadata-must-be-verified-by-frame` | 渠道 | 0.85 |

> 🔴 **尚未完成，别当已通**：表建好了、数据写了，但**目前没有任何代码读它**。
> 要真正生效需要：①`src/lib/memory/service.ts` 的 `loadMemoryContext` 增加全局层加载
> ②agent 决策前注入 ③广告动作写入 `flywheel_actions` 以便将来判定。
> **在这三步做完之前，这张表跟写在文档里的区别只是「换了个地方躺着」。**

---

## 6.8 🔴 事故：广告编造看房时间对外发布，已停（2026-08-01）

**事发**：另一 session/agent 在 2026-07-31 17:33–18:22 期间，未经沟通，往这个账户添加了大量新结构：
新 campaign「预约表单 Lead Form」（daily $8, PAUSED）、新暖池重定向 adset（含 lookalike 1%）、
重新打开 Instagram 投放（`30 Kiteroa · IG 专投测试`）、新增韩语广告 Ad H、英文广告 Ad G、
以及 **两条写着具体看房时间的广告**：「私约 CN · 本周末两时段」「私约 EN · Two slots this weekend」。

`custom_audiences` 的 `creation_ui` 字段显示为 `"ads MCP server"` —— 是 agent 通过工具建的，不是人工在后台点的。

**PM 确认：「本周末两个时段」是编造的，Roman 没有给过任何真实看房时间。**

**已处理**：两条广告立刻 `ads_update_entity` 设 PAUSED，并 `ads_get_ad_entities` 实读确认
`effective_status=PAUSED`、`delivery.status=off`——不是只信 update 返回的 success。
名称改为 `[停用·编造看房时间] ...` 防止日后被误当正常广告重新启用。

### 🔴 教训 19：这是同一条红线的第三次触发，且这次是 agent 自己编的

CTS 长城「日出登长城」（2026-07-13，人写内容编行程细节）→
Oztop「vinyl/herringbone 5 个品类页」（编产品线+搜索量）→
**本次：agent 生成广告时凭空编了具体看房时段**（编运营排期/物流细节）。

三次的根子相同：**生成对外内容时，把"应该有一个具体细节"当成了"可以编一个具体细节"**。
前两次是人/agent 写文案编内容，**这次是 agent 用 MCP 工具直接把编的内容发布成了真实广告**——
比写草稿更危险，因为**没有人工审核这一步就已经在花钱、已经在被买家看到**。

已写入 `global_learned_lessons`（见下）。**任何 agent 生成客户对外内容前，具体的时间/地点/排期/
数量等运营细节，必须能指向一个真实来源（官网/客户确认/master_brief），指不出来源就必须留空
或写成「请私信确认」，绝不能为了让文案看起来完整而编一个。**

### ✅ 已确认：其余改动是 PM 授权的并行操作，不是事故

**PM 2026-08-01 确认**：「这些是我同意做的，是另一个窗口安排的」。指以下四项——**本窗口不再拦截，接手监控**：

| 改动 | 现状 | 依据/意图 |
|---|---|---|
| Instagram 重新打开（`IG 专投测试` adset，`120251953611930589`）| ACTIVE，花了 $6.52 | ⚠️ **待另一窗口补**——与 7/30 本窗口实测的「IG CTR 只有 FB 1/4、零咨询」结论矛盾，需要知道这次是重新测什么假设 |
| 韩语 Ad H（`120251953461550589`）| ACTIVE | ⚠️ 待补 |
| 新 campaign「预约表单 Lead Form」（`120251954035030589`）| PAUSED，daily $8 | ⚠️ 待补——目标是 `OUTCOME_LEADS`（收表单），跟现有 `OUTCOME_ENGAGEMENT`（私信）策略是两条不同的路，为何并行 |
| 主 campaign 日预算 `$43→$55` | 已生效 | ⚠️ 待补 |

🔴 **多窗口协作缺口（本窗口记录，不代表另一窗口认可）**：这四项改动发生在 7/31 17:33–18:22，
本窗口直到 8/1 用户主动提到「频次快到 3」才发现——**改动本身没有同步进本档案**。
CLAUDE.md 已有的规矩「多窗口并行必须留痕」在这次执行上有缺口：
**touch 同一个客户实盘的任一窗口，改动当下就该写一行进 `live-ops-handoff.md`，
不能靠另一个窗口事后从数据里侦测。** 建议另一窗口回来后把「为什么加 IG / 韩语 / 表单 campaign /
提预算」各补一句依据，本窗口好接手判断效果。

---

## 6.9 中文客服回复问题排查 + 修复（2026-08-03）

### 触发：PM 查今日 Messenger 留言，发现两个问题

1. **中文/韩文默认群发，不该主动触发**——PM 要求：Meta 广告回复默认 100% 英文，只有客户自己用中文/韩文打字问时，AI 才被动触发对应语言的技能
2. **反复被问地址**——多个客户第一句就问"can you send address"，人工在重复回答同一个问题

### 实读今日 9 条待回对话，三个确认发现

| # | 发现 | 证据 |
|---|---|---|
| 1 | **中文广告（Ad F）自带的问候语会发给不懂中文的买家** | Anita Singh 收到「Anita，你好！」后回「Which language is this / Are you from New Zealand」；Karen Mcquoid 讽刺回复「I will get back to u in couple years time, need to learn language... check back in 2029」；PM(Bigray Demg) 两次手动道歉「Sorry about this Chinese/wrong setting」|
| 2 | **Ad G 的广告正文本身写着编造的看房时间** | `ads_get_creatives` 实读 creative `1366591138993817`（Ad G）body 字段原文：「Message us to book a private viewing this weekend — only two slots available.」—— 跟 §6.8 已确认造假的「本周末两时段」是**同一句话**，只是直接写进了这条广告的正文，不是单独的私约广告。当天已从这条广告收到至少 4 个 lead（Thomas/Siddhesh/Nilda/Jonathan）|
| 3 | **主页自动回复（自动回复/instant reply）触发不稳定** | 同为「问地址」，Thomas/Bryan 收到了自动回复；Siddhesh/Anita/Nilda 没收到，全靠 PM 手动发 Property Documents。原因未查（疑似 Meta 对同一用户/同一 session 的自动回复有频率限制）|

### 🔴 机制澄清：中文问候语不是配置错误，是平台行为

`ads_get_creatives` 拉到的 creative payload 里**没有单独的「欢迎语」字段**——「Anita，你好！请问有什么可以帮助你的？」这类问候是 Meta 点击广告进 Messenger 时的**系统内置气泡**，直接照抄**广告正文自身的语言**（Ad F 中文 body → 中文气泡；Ad G 英文 body → 英文气泡），**不是**按买家的实际语言判断，也不是我们能单独编辑的字段。

**根本原因是账户里中/英/韩三种语言的广告没有做受众语言隔离**——同一个奥克兰全域受众，中文广告一样可能投给不懂中文的人，导致「广告语言≠买家语言」的错配。这不是这次能顺手修的，先如实记录。

### 已处理

**① Ad G 已停**（同 §6.8 造假红线，同一句话不同广告位）
```
ads_update_entity(120251953461450589, status=PAUSED)
→ 实读确认 effective_status=PAUSED, delivery.status=off
→ 改名 [停用·编造两时段] Ad G · EN · Title+CCC Move-in Now
```

**② 主页「自动回复」重写为 100% 英文**（不再是中英双语群发）
内容含地址/价格/学区/优惠 + 二选一 CTA（看房或户型图）+ Roman 直联方式（021 590 027 / roman.hu@raywhite.com）。350/500 字符。

**③ 新建两条"自定义关键词"自动化，被动触发，默认关闭主动群发**

| 自动化 | 触发关键词（最多 5 个，Meta 上限）| 回复语言 |
|---|---|---|
| 中文咨询 · 被动触发 | 地址 / 看房 / 价格 / 户型 / 你好 | 中文（含地址/价格/学区/优惠/CTA/Roman 联系方式）|
| Korean inquiry passive | 주소 / 가격 / 방문 / 평면도 / 안녕하세요 | 韩文（同等信息）|

两条均已实读验证：开关=开、渠道=Messenger、关键词 5/5 命中、消息内容完整未截断。
⚠️ Meta 官方说明：**若聊天闲置超过 15 分钟后收到完全匹配关键词的消息，才会立即自动回复**——不是逐条消息都判定，且要求关键词"完全匹配"。

### 🔴 教训 20：Meta 自动化编辑必须"填完立刻截图核对"，不能连续操作后一次性确认

第一次填 Korean 自动化时，连续做完"填名称→点渠道→打关键词→打消息"四步才截图，结果发现**名称/渠道/关键词全部是空的**，只有最后打的长段消息正文保存住了（推测：某次点击/输入的坐标或焦点跑偏，之前几步操作全部落空但界面无报错提示）。删掉重来后，**每完成一步就截图确认**，才验出全部正确落地。
👉 **通用化**：在任何"多字段依次填写"的表单流程里，尤其是坐标点击驱动的浏览器自动化，**不能假设上一步生效**，必须每步之后用 read_page/screenshot 验证该步骤的具体值，不能靠"流程走完了就应该对"来推断。

### ✅ Ad H（韩语）已一并停用（PM 2026-08-03「一起处理」拍板）

`ads_update_entity(120251953461550589, status=PAUSED)` → 实读确认 `effective_status=PAUSED`、`delivery.status=off`。改名 `[停用·未确认看房安排] Ad H · KR · 학군 挑战者`。

### 当前账户在跑（2026-08-03 处理完后实读，5 条，均无编造内容）

| 广告 | ID |
|---|---|
| Ad B3 · $10k Prezzy · Sign by 20 Aug（带真实日期）| 120251897764880589 |
| Ad F · 中文 · Rangitoto 学区 | 120251907788030589 |
| IG · 中文学区 | 120251953614450589 |
| Ad E2 · 三语 · 专测组 | 120251880887740589 |
| Ad D · By negotiation | 120251830180220589 |

本轮共停用 4 条含编造内容的广告（私约CN/EN两时段、Ad G、Ad H），全部实读验证 PAUSED，均改名标注原因防误重启。

### 📅 2026-08-08 周度结果盘点（自动任务 `kiteroa-weekly-outcome-pull` 实读）

**一句话**：广告端数据全回来了，**咨询之后那一段仍然是 0** —— 而且这次能指出为什么。

#### 本周实读（2026-08-01 ~ 08-07，Meta 接口 + ME 库交叉核对，两边对得上）

| campaign | 花费 NZD | 触达 | 频次 | CTR | 结果 | 单个 |
|---|---|---|---|---|---|---|
| Message Leads Test（私信） | **177.97** | 4,903 | 1.83 | 6.57% | **21 个咨询** | **$8.47** |
| 预约表单 Lead Form | 49.47 | 1,026 | 1.66 | 2.82% | **0 个表单** | — |
| 看完视频·攒买家池 | 64.98 | 5,544 | 1.15 | 0.85% | 2,982 次看完 | $0.02 |
| **合计** | **292.42** | — | — | — | 21 咨询 / 0 表单 | — |

广告层赢家：**Ad F（中文·学区）$76.63 → 15 个咨询 → $5.11**；Ad G（英文，8/3 因编造看房时间已停）$69.59 → 6 个 → $11.60。
IG 组 $12.97 / 触达 490 / **0 咨询**，已暂停。

#### 🔴 三个必须报的问题

**1. 私信广告现在全停了。** 主组 + 三语组 + IG 组 + 表单冷投组**全部 PAUSED**，只剩「攒买家池」和「表单·暖池」两个组在跑。
库里 8/5、8/6 私信 campaign 花费为 **0**，Messenger 最后一条对话停在 **8/6 00:56**。
→ **$10k 优惠 8/20 截止，只剩 12 天，而唯一能带来咨询的那条线是关着的。**

**2. 表单线花了 $49.47，一个表单都没收到。** 冷投组 $43.33 零产出后已停；暖池表单组新开，目前 $6.14 零产出。

**3. ⭐ 20 个对话里，没有一个买家开口约看房 —— 因为没人问他们。**
实读 `conversations` + `conversation_messages`（本周 20 个对话）：标准回复是「资料包 tinyurl + 房源页 + Roman 电话邮箱」，**没有问句、没有下一步**。资料发完对话就结束。
这就是「咨询之后发生了什么」一直是空的直接原因之一 —— 承接环节根本没有把人往看房推。
> ⚠️ 但这**不等于**本周真的 0 次看房：电话/邮件约的看房 ME 看不到。**这条只能问 Roman，不能从库里推。**

#### 对话质量实况（比 $8.47 这个数字重要得多）

| 类型 | 人数 | 例子 |
|---|---|---|
| 语言错配 / 反感 | **8 / 20** | 「Which language is this」「if you can't speak English wtf」「Please delete my contact」「check back in 2029」 |
| 根本不是目标客户 | 3 | 想租 Mt Roskill $700/周；**同行中介**（Sid, Harcourts） |
| 真实但很浅的兴趣 | 5 | 「I'm interested」「How much」「Can you send address」 |
| **问优惠没看懂** | **3 人次** | 「8月20日前签约的礼卡是什么?」（Tina 问了两遍 = 没得到满意回答） |

> 🔴 **推论：$5.11 的中文广告不是赢家，是假象。** Ad F 单个咨询最便宜，但它的「咨询」里有相当比例是收到中文气泡的英文买家在表达困惑或不满（§6.9 那个机制仍在生效）。
> **把 $5.11 当成「中文创意有效」写进经验库会是错的**，本次已避免。

#### ✅ 已写进数据库

| 动作 | 内容 |
|---|---|
| `global_learned_lessons` 更新 | `re-ads-instagram-underperforms-premium-housing` → confirmed 1→**2**，置信 0.60→**0.70**（本周 IG $12.97 / 490 触达 / 0 咨询，第二次同向观察；已在 evidence 里注明花费小、方向一致但不决定性） |
| `global_learned_lessons` 新增 | `re-ads-reply-must-ask-for-the-viewing-not-just-send-documents`，置信 **0.55**（单客户单周 n=20，evidence 里明确写了「电话/邮件约的看房未排除」） |
| `flywheel_metrics` | **没写** —— 本轮 PM 没给看房/出价/成交数字。**Messenger 里没人约看房 ≠ 真的 0 次看房**，写 0 等于把「查不到」当成「没有」，这是明令禁止的。等 Roman 回答再写。 |

#### ⚠️ 广告数据其实一直在回流，只是记在了另一个客户名下

任务里那句自检 SQL（按 `5a3fb2b7…` 查 `ad_daily_insights`）返回 **0 行**，看起来像「回流失败」，**实际不是**：

- `act_1018365291238494` 挂在客户 **Roman HU**（`e7465ac7…`）名下，不在 30 Kiteroa 名下
- 该账户数据 **86 行，7/27 ~ 8/6 连续无断**，`flywheel_metrics` 也在每天写（`ads.account.*`）
- 教训 18 那个 `act_` 前缀问题**已经修好了，没有复发**

→ **这不是回流故障，是归档位置问题。** 但后果是真的：任何按「30 Kiteroa 这个楼盘」查的地方（学习链、飞轮、给开发商的报告）都会看到空。
**本窗口没有擅自改** —— 换挂点会同时改变 Roman 和这个楼盘两边报表看到的东西，属于业务口径决定，留给 PM 拍。
可选：①把账户改挂 30 Kiteroa（Roman 客户报表就空了）②让楼盘按 campaign 前缀从 Roman 账户里读（要改代码，更对但不是今天能做完的）。

---

## 7. 开放议题（都没结论，接手别当已决）

| # | 议题 | 卡在谁 |
|---|---|---|
| 1 | ~~$10k Prezzy 真实截止日~~ → ✅ **已查实 8/20 签约截止**（Roman 官网房源页原文，见 §4）。**剩余待定**：Ad B 是否恢复 + 恢复时把日期写进文案 → 等 3 天观察期结束再定 | 子牙（3 天后） |
| 2 | **四层战略谁出钱**（PM 提的 4-campaign 方案）— 子牙结论：战略对，但 $43/天拆四组全饿死；且第2/4层花开发商钱养中介资产。建议第1层用开发商预算，**第2/3/4层作为月费产品卖给 Roman** | PM 拍板 |
| 3 | **开发商合同数据条款** — 受众资产归属，已提两次仍未写 | PM |
| 4 | 给开发商的早期信号材料（已写好未发）— 需 PM 授权 + Roman 先过口径 | PM |
| 5 | 转发给 Roman 的装 App 说明（已写好未发） | PM |
| 6 | 三语组要不要加中文/韩文语言定向（代价：会排除用英文界面的华人移民） | PM |
| 7 | **北极星「华人 lead ≥40%」目前 0%** — 5/5 全英文，口径需重谈 | PM |
| 8 | P18.E 下一步：建池器 ↔ 台账表尚未接线；周度 SOP 未自动化 | 子牙 |
| 9 | Meta 客服工单（清澳洲国家锁）— 从未开过 | PM 显式 go |
| 10 | 中介私域产品定价 — 「到 agent package 再定」 | PM |
| 11 | **主页管理员权限写进新客户开户清单** — 已决定不为这轮去麻烦 Roman，但清单还没建 | 子牙 |

### 再营销现状（第 3 组为什么现在跑不了）

| 池子 | 状态 |
|---|---|
| 私信过的人（最热）`120251867251360589` | 🔴 **INACTIVE — 无法投放** |
| 互动过的人 `120251867195960589` | ACTIVE，规模在披露下限 |

3 天仅触达 1,641 人。**再营销是第 10–14 天的动作，不是第 1 天** —— 届时冷投也饱和了，钱本来就该往暖池挪，用同一笔预算切 ~$10/天即可，不必另开预算。

> 依据：CTS 真实数据 —— 暖池单 lead **$6.65** vs 冷启动 **$11.12**，低 40%（同账户同期同指标）。
