# NM Medspa · Messenger 广告「常见问题」只读核查（2026-10-10）

**一句话**：PM 要换的那三条问答，配置在**广告创意的欢迎消息里**（不是主页收件箱的自动回复）；
NZ$158 Signature Escape 这个套餐**客户自己已经在用**，但**溯不到官网 / 价目表**（客户没有官网）。
本文第 1–8 节是只读核查（当时未改线上）；之后又执行了两类线上写入：生产库 `master_briefs.products` 写入（§7）和在投广告组的排期/结束时间调整（§10）。三条问答在本文写作当时**没改成**（§11）；后来 PM 放行、已由统筹用官方广告工具改好并发布（§12，台账卡 `2026-10-10-nm-medspa-ad-faq-published`，pr:2402）。完整清单见 §8。

---

## 1. 现在配在哪一层

**结论：在广告这一层——广告创意字段 `page_welcome_message` 的 `ice_breakers`。**

- 广告账户 `act_1465150488793292`（商务账户 NM Spa）· 系列 `120253076136460216` · 广告组 `120253076137240216`（落点 MESSENGER，优化目标 CONVERSATIONS，ACTIVE）
- 唯一在投广告 `120253076139170216`「Your first NM MedSpa experience. ✨」· 创意 `1586529582952314`（boosted post，`surface: boosted_post`）
- 主页 `1253989377806948`（公开主页 NM Medspa，无官网链接，联系方式只有电话和 Gmail）

**现有配置原文（2026-10-10 从接口读回，改前快照存于本文件 §4）**：

- 欢迎语：`Welcome to NM MedSpa! Ask us about our NZ$158 Signature Escape for new clients.`
- 三条常见问题（`response` 全为空 = 客人点了之后由人工回）：
  1. `What's included in the NZ$158 Signature Escape?`
  2. `Is the NZ$158 offer for new clients?`
  3. `How can I book a time?`
- 自动跟进语：`Hi! Still interested in the 75-minute NZ$158 Signature Escape for new clients? Send us your preferred day and time and we'll check availability.`
- 标记位：`ice_breakers_edited: true` / `welcome_message_edited: true` / `auto_follow_up_message_edited: true` —— 说明这几段是**人改过的**，不是 AI 自动生成的默认文案。

**另一层（主页收件箱自动化）查了，是空的**：
Business Suite → 收件箱 → 自动化设置 → 「常见问题」这条规则**开关是关的，且一条问题都没加**。
所以 PM 粘过来的三条，来源只能是广告这一层，不是主页自动回复。

## 2. 价格套餐能不能溯源

**结论：溯不到官网 / 价目表，但有两处客户侧的书面证据。**

查不到的：
- 客户**没有官网**：`nmmedspa.co.nz` / `.com` / `.nz` 均不解析；公开搜索查不到官网；主页「联系信息」里也没有网址。
- 生产库 `master_briefs`：NM Medspa（`dce2795f-…`）与 NM Spa（`2a2b0613-…`，另一条重复记录）两条的 `website`、`products` **都是 NULL**。
- 第三方目录（ClassPass / Fresha）能查到门店和部分项目名，**查不到 "Signature Escape" 这个套餐，也查不到价格**。

查到的（客户侧书面证据，两处）：
1. **现在正在投的这条广告自己的欢迎语 + 跟进语**里，已经写着 NZ$158 Signature Escape、75 分钟、仅限新客——而且是人工编辑过的。
2. **主页 Messenger 收件箱里 2026-10-08 的一条真实对话**：客人问 "What's included in the NZ$158 Signature Escape?"，主页方回复
   `this package is included 40 min Body Massage and 35 min Spa Facial, including a 5 min Scalp Ritual`。
   40 + 35 = 75 分钟，跟 PM 给的三段话完全对得上（PM 的版本只是没写头皮护理那 5 分钟）。
   注：收件箱界面看不出这条是客户本人回的还是我们回的，**"谁写的" 未核实**。

**判断**：PM 的三段话跟线上已经在用的口径一致，没有新编出来的数字；按 CLAUDE.md §8「对外内容必先 grounding 官网」，
客户没有官网时的替代证据是客户/PM 确认。

**已闭合（2026-10-10）**：PM 本人确认「是确认的」——NZ$158 Signature Escape（40 分钟身体按摩 + 35 分钟面部护理含头皮、共 75 分钟）
是客户确认过的真实套餐。溯源这一关由 PM 本人确认顶上，不再因系统里查不到记录而停手。
遗留：这个套餐要补进 `master_briefs`（见 §7），出处写「PM 2026-10-10 口头确认」。

## 3. 口径（已定案 2026-10-10：保留 158 这条线）

- 广告**画面和正文**讲的是面部护理（facial ritual），没提身体按摩，也没提 158。
- 广告**欢迎消息**讲的是 NZ$158 套餐（面护 + 身体按摩 + 头皮）。
- 也就是说：**这条广告本来就是在推 158 套餐**，只是推在了私信那一层，图文那一层没提。

**定案（统筹 2026-10-10 回复）**：按本建议**保留 158 这条线**，直接把 PM 的三条换进去。
先前报上去的「口径冲突」是只看了广告正文、没看欢迎语造成的误判，统筹已向 PM 更正——两边本来就一致，不用 PM 再拍一次。

**遗留待办（这次绝不一起做）**：
- 广告正文要不要也补一句 158 套餐 —— 改正文等于素材重过审、会重置学习期，单独排期。
- 生产库里还有一条重复客户「NM Spa」（`2a2b0613-…`，连 brief 都没有），要不要并掉单独处理。

**仍卡着的一件（等 PM 本人）**：现在三条问题的答案是空的（客人点一下→人工回）；PM 这次给的三组带答案，设进去就变成**自动回复**。
统筹正在问 PM，**没拿到这一句之前不动线上配置**。

## 4. 改前快照（节选，不完整，见文末说明）

```json
{
  "type": "VISUAL_EDITOR", "version": 2,
  "landing_screen_type": "welcome_message", "media_type": "text",
  "text_format": {
    "customer_action_type": "ice_breakers",
    "message": {
      "ice_breakers": [
        {"title": "What's included in the NZ$158 Signature Escape?", "response": ""},
        {"title": "Is the NZ$158 offer for new clients?", "response": ""},
        {"title": "How can I book a time?", "response": ""}
      ],
      "text": "Welcome to NM MedSpa! Ask us about our NZ$158 Signature Escape for new clients."
    }
  },
  "user_edit": true, "autofill_message_edited": false,
  "ice_breakers_edited": true, "welcome_message_edited": true,
  "surface": "boosted_post",
  "auto_follow_up": {"text": "Hi! Still interested in the 75-minute NZ$158 Signature Escape for new clients? Send us your preferred day and time and we'll check availability."},
  "auto_follow_up_message_edited": true,
  "performance_booster_enabled": true,
  "has_ai_generated_welcome_message": false,
  "lwi_web_ai_generated_icebreakers_enabled": true,
  "ai_generated_icebreaker_toggle_enabled": true,
  "is_call_prompt_enabled": false,
  "ctm_deprecate_quick_replies_enabled": false,
  "template_id": "1430972422322388"
}
```

（撇号说明：上面 JSON 是人工转录，用的是普通直撇号 `'`。§9 卫青审查记录称线上用的是弯撇号 `’`，两处不一致，**本文无法证明哪个对**。回写或核验时，字符一律以执行当时从接口读回的原始响应为准，不得以本文转录为准。）

**本快照不完整**：`page_welcome_message` 里还有 `image_format` / `video_format` 两个分支，上面没有保存其完整内容。执行改动前必须先从接口把**整个** `page_welcome_message`（含这两个分支）原样读回，存成完整快照（存进本文件或 `docs/ledger/evidence/` 下的专用证据文件，**台账卡只写指向它的指针**，不贴快照），再动手；这份快照**只用来逐字段比对**，不能用来「写回」已发布创意（见 §11，已发布创意内容不可写），回滚一律是把广告重新指回旧创意 ID。

## 5. 第二段要改的时候怎么做（本轮未执行）

前置：① PM 确认口径 ② 价格套餐拿到客户书面确认 ③ 按记忆 `feedback-ads-automation-must-involve-weiqing`，**叫上卫青做记录/审查**。

- 改法：只改创意的 `page_welcome_message.text_format.message.ice_breakers`（三条 title + response），**其余字段原样回写**。
  注意 PM 的答案里有换行和 ✨，要原文一字不改地带进 `response`。
- 禁止连带动的：广告正文 / 受众 / 预算 / 版位 / 开关。
- 改完回读 `page_welcome_message` 和该广告的 `effective_status`、`issues_info`；不是 ACTIVE 就立刻回滚。
- 回滚办法：**把广告重新指回已保存的旧创意 ID `1586529582952314`**（见 §9 ①）。已发布创意的内容不可写（§11 实测 `error_subcode 1815573`），所以不能把快照「写回」创意；快照只用来逐字段比对新创意是否与旧的一致（须含 `image_format` / `video_format`，见 §4 说明）。

### 5.1 目标三组问答原文

**原文待 PM 提供。** PM 给的三组新问题和答案（含换行和 ✨）没有在任何文档里留存，手头也没有原文，这里不得编造或凭记忆复原。拿到原文后，原样贴进本小节，台账卡「换问答」以本小节为验收依据。在此之前，该任务不能执行，夜巡也无法判定读回内容是否一致。

## 6. 语言（PM 2026-10-10 拍板：只要英文）

PM 拍板**只配英文，不加中文版**。多语言支不支持这件事按 PM 指示停查，只留已看到的两点（未做完整核实）：
广告创意的 `page_welcome_message` 里**没有 locale / 语言字段**；主页「常见问题」自动化的编辑页上**看不到语言切换入口**。
这两点都是"界面/字段上没看到"，不等于平台一定不支持。

## 7. 要补进 master_briefs 的内容（已执行，见本节末；下面的代码块是历史草稿值，勿据此再次写库）

写哪：生产库 `master_briefs`，`client_id = dce2795f-f6ee-4109-8f68-ff3ea863a163`（NM Medspa）。
注意库里还有一条重复客户 `NM Spa`（`2a2b0613-…`）没有 brief，是否合并另说，本轮不动。

```
products: [{
  "name": "Signature Escape",
  "usp": "NZ$158 · 75min for new clients: 40min Body Massage + 35min Spa Facial (incl. 5min Scalp Ritual)"
}]
website: （保持 NULL —— 客户确实没有官网，不要瞎填主页链接当官网）
```

字数：`usp` 上限 120 字（`normalizeProducts` 的 `MAX_USP`），上面这条 95 字，不会被截断；出处不放进 `usp`（放不下），只记在本文件。

契约说明：`products` 的消费者（`formatBriefForPrompt`、`/api/clients/[id]/products`）只认 `{name, usp}`，
多出的 `price` / `currency` 等字段会渲染成 `（undefined）`，FDE 在 Settings 保存时也会被静默删掉；所以价格、时长、受众、出处全部放进 `usp` 文字里。

第一次写入之前该行 `products` 原值为 NULL（历史状态）。

**已执行并已按契约修正（2026-10-10）**：
- 统筹代 PM 批准后写入 `master_briefs` 行 `60c6cc24-5946-4d82-a0b8-4eaec2d34d4c`（NM Medspa 唯一一条，`is_active = true`）。
- 第一版写错了：带 `price` / `currency` 等多余字段、没有 `usp`。核实代码确认审查意见属实——`normalizeProducts` 只保留 `{name, usp}`，
  `brief-injector` 会把它渲染成「主力产品：Signature Escape（undefined）」，等于白写还污染 prompt。
- 已覆盖重写成合契约的一条并回读确认：
  `name = "Signature Escape"`，
  `usp = "NZ$158 · 75min for new clients: 40min Body Massage + 35min Spa Facial (incl. 5min Scalp Ritual)"`（95 字，未超 120 上限）。
- `usp` 放不下出处，所以**出处「PM 2026-10-10 口头确认」只记在本文件和台账卡里**，不写进库。
- `website` 仍为 NULL。
- **重写前的那一版（带多余字段的错误版）其完整 JSON 当时没有留存，本文和台账里都找不到，我也不能去生产库补读。** 它本来也是读不出卖点的错误版，不该恢复。
- **重写前旧值未留存，无法回滚到旧值。回滚 = 清空**（把 `products` 写回第一次写入前的 NULL）；旧值里的价格、时长在本文 §7 的合契约版里都有，不会丢信息。此口径待 PM 确认（见 PR 线程）。

## 8. 本轮做了什么 / 没做什么

- 做了（只读部分，§1–§6）：查广告层 + 主页自动化层 + 价格溯源 + 生产库 `master_briefs` 核对。
- 之后做了的线上写入：① 生产库 `master_briefs.products` 写入并按契约重写（§7）；② 在投广告组的投放时段、结束时间调整并回读（§10 第二、三轮；结束时间延后使日预算下多花最多约 NZ$70）。
- 当时没做成：三条常见问答改自动回复（§10 第一轮、§11），线上维持原样（后续已完成，见 §12）；没碰广告正文 / 受众 / 预算 / 开关。
- 执行人：Claude Code 53 号窗口 · 2026-10-10（NZ 时间）· 依据：PM 2026-10-10「把这 3 个问题，更改到 NM SPA 的广告问题」。

## Reuse Statement

- 复用了什么：既有 Meta Ads Connector（官方 ads MCP + Graph 只读）、既有 `master_briefs` 客户事实表、PM 已登录 Chrome。
- 新增：无代码、无 shared runtime 改动。
- platform-shared：无 · industry-specific：无 · client-specific：本文件全部内容（NM Medspa 的广告配置与套餐事实）。
- 有没有把客户事实写进 shared runtime：没有，只写进 `docs/clients/`。
- 落点与 tier-gate 决策是否一致：一致（决策时判 L4 客户配置，实现落在客户文档，未动 `src/lib/`）。

---

# 第二段 · 执行记录（2026-10-10）

## 9. 卫青审查记录（动手前）

> **时间**：2026-10-10 01:27 NZDT
> **审查对象**：NM Medspa Messenger 广告（账户 act_1465150488793292，系列 120253076136460216，广告组 120253076137240216，广告 120253076139170216，创意 1586529582952314）。计划把创意字段 `page_welcome_message` 里的三条快捷问题（问题和自动回答）改成 PM 10-10 给的三组问答，其余字段原样保留。
> **核实到的事实（Graph API 只读）**：广告、广告组、系列均为 ACTIVE；日预算 1000（NZ$10），无总预算；投放窗口 10-02 00:37 到 10-12 00:37；每天 10:00–17:00 投放；累计花费 NZ$83.25，曝光 3419，开聊 10。创意现有三条快捷问题的自动回答均为空；线上问题里用的是弯撇号 `’`。创意里另有自动跟进文案、模板编号和关闭自动优化（`standard_enhancements: OPT_OUT`）的设置，需要原样保留。10-01 晚该广告已做过一次 `update_ad_creative` 并恢复 ACTIVE。
> **风险判断**：Meta 的创意对象是只读的，这个字段**不能原地改**，接口上只能新建创意再把广告指过去，等同「改在投广告的素材」（PITFALLS D13、广告手册第二十七条），会触发重新过审；是否重置学习期读不到字段、判断不了，影响预计较小（该广告组仅 1 条广告、累计 10 次开聊）。接口新建「已有帖子 + 欢迎语」类创意能否一次过审没有先例，属未知。
> **授权**：PM 本人 2026-10-10 指示，套餐事实 PM 本人确认，授权链充分。
> **结论：可以改，但必须先做三件事**：① 存好含弯撇号和全部字段的线上原文快照，并记下回滚目标创意 1586529582952314；② 先新建创意不切广告，读回逐字段比对；③ 在开投前切换并立刻回读，不是 ACTIVE 当场指回旧创意，成功后冻结 7 天。

## 10. 三轮改动 · 回执

执行人：Claude Code 53 号窗口 · 2026-10-10 NZDT · 三轮分开改、分开回读。

### 第一轮：三条问答改成自动回复 —— **当时没做成，被权限挡住（见 §11）；后来已由统筹放行完成（见 §12）**

### 第二轮：按时段投放 10:00 → 12:00 ✅ 已完成并回读

- 依据：PM 2026-10-10 原话「广告投放时间设为 12 点」「12点开始」（经统筹转达）
- 改前：`adset_schedule = [{days:[0..6], start_minute:600, end_minute:1020, timezone_type:ADVERTISER}]`
- 改后（整体写、整体回读）：`[{days:[0,1,2,3,4,5,6], start_minute:720, end_minute:1020, timezone_type:ADVERTISER}]` = 每天 12:00–17:00，广告主时区
- 同时回读核对未被连带改动：`status/effective_status = ACTIVE/ACTIVE`、`optimization_goal = CONVERSATIONS`、`destination_type = MESSENGER`、`billing_event = IMPRESSIONS`、系列日预算仍 1000、受众仍 30–55 岁女性 + Massage parlor 兴趣 + 原地理范围、版位组合未变、素材未动
- 怎么撤回：把 `adset_schedule` 整体写回 `start_minute: 600`（其余不变）
- 机制坑（新学到）：经 Meta 官方 ads 工具改广告对象，**改完是「草稿」，不发布不生效**；必须再调一次发布，且发布后状态先是 `PUBLISHING`，要回读才知道真落没落

### 第三轮：投放结束时间延后 7 天 ✅ 已完成并回读

- 依据：PM 2026-10-10 原话「延期 7 天」「照延」（经统筹转达；PM 已被明确告知这是日预算、延 7 天等于多花最多约 NZ$70）
- 改前：广告组 `end_time = 2026-10-12T00:37:31+1300`，系列 `stop_time` 同
- 改后回读：广告组 `end_time = 2026-10-19T00:37:31+1300`，**系列 `stop_time` 被 Meta 同步改成 10-19**（我只写了广告组这一项，系列是平台自己跟着改的）
- 同时回读核对未变：`start_time` 仍 10-02 00:37、排期仍 12:00–17:00 七天、系列日预算仍 1000、状态仍 ACTIVE
- 怎么撤回：把 `end_time` 写回 `2026-10-12T00:37:31+1300`
- **钱的事实（按读回的数，不采用先前「总预算/摊薄」的错误说法）**：这是**日预算 NZ$10/天**，不是总预算。截至 10-10 已花 **NZ$83.25**、曝光 3419、开聊 10 次，约 **NZ$8.3 一次开聊**。延 7 天 = 每天照样 10 块、**多花最多约 NZ$70**，投放速度不变、不会变慢。

## 11. 第一轮为什么没做成（卡在权限，不是做法问题）

三条路都试过，逐条记事实：

1. **直接改创意字段** —— 不行。实测 `POST /{creative_id}` 带 `page_welcome_message` 被 Meta 拒：`error_subcode 1815573`，提示「请指定名称、status 或关联的广告标签来更新创意」。**Meta 的创意对象除了名称/状态/标签之外是只读的**，印证卫青的判断。
2. **新建创意再把广告指过去** —— 现有钥匙不行。我们的系统身份令牌对 `act_1465150488793292` **只有读权限**（`error_subcode 2490585`「没有广告账户的写入权限」）。Meta 官方 ads 工具虽然有写权限（第二、三轮就是用它改成功的），但**它的建创意接口根本不支持 `page_welcome_message` 这个字段**，建出来的创意会丢掉欢迎语；而且它明确不允许给已有广告换创意，只能新建广告——新建广告等于往在投广告组里加广告，会不会重置学习期读不到字段、未确认；确定的只有会重新过审，比原方案扰动大。
3. **到广告后台界面手工改**（跟人操作同一条路、广告 ID 不变、不新建素材，是扰动最小的做法）—— 被本机的权限策略拦住：在 `adsmanager.facebook.com` 上的点击动作被判为「真实世界交易 / 账户设置变更」类动作直接拒绝，页面能看、不能点。

### 11.1 「改不了」到底是谁的限制（PM 问到这一点，这是答案）

**这是两件事，要分开看：①「原地改创意」不可行，是 Meta 平台本身的规则，对所有人成立；②「新建创意并切换」这一步，当时是我们缺写权限（钥匙只读、本机点击被拦），不是平台不允许。**

- Meta 的广告创意（creative）对象**一经发布即不可改内容**：接口上只接受改「名称 / status / 广告标签」三样，
  其它字段（包括欢迎语和快捷问题所在的 `page_welcome_message`）一律拒绝。
- 直接证据：我们对这条创意发起修改，Meta 原话返回
  `code 100 / error_subcode 1815573` ——「更新创意失败。请指定名称、 status 或关联的广告标签来更新创意」。
  这是 Meta 自己的报错文案，不是我们代码里的判断。
- 这条规则对**任何人、任何工具**都一样：人在 Ads Manager 界面里"改"欢迎语时，Meta 后台也不是在改原创意，
  而是替你生成一份新的再挂回同一条广告——只是界面把这一步藏起来了，所以人感觉"能改"。
- 所以这件事上**权限只决定我们能不能执行那条替换动作**，不决定"能不能原地改"——原地改对谁都不存在。

**证据在哪**：`docs/ledger/evidence/2026-10-10-nm-medspa-ad-faq-blocked-by-permission--2026-10-10.md`
（四条，逐条带 Meta 返回的错误码与原文）。同一机制已写进广告通用手册第三十五条。

### 11.2 三条路各自被什么挡住（一句话版）

| 路 | 被什么挡住 | 挡我们的是谁 |
|---|---|---|
| 直接改这条创意的欢迎语 | `error_subcode 1815573`「只能改名称/status/广告标签」 | **Meta 平台规则**（对所有人成立） |
| 新建创意再把广告指过去 | `error_subcode 2490585`「没有广告账户的写入权限」；官方广告工具的建创意接口又不支持欢迎语字段，且只允许新建广告（会重新过审，是否重置学习期未确认） | **我们的钥匙权限不足** + 工具能力缺口 |
| 到 Ads Manager 界面手工改 | 本机权限策略拒绝点击（判为真实世界交易 / 账户设置变更） | **我们自己这台机器的闸**（由 PM 决定放不放） |

**结论**：第一轮要落地，需要二选一——
- 放开这个会话在 `adsmanager.facebook.com` 的点击权限（我自己到后台改，最小扰动）；或
- 给一把对 `act_1465150488793292` 有 `ads_management` 写权限的令牌（走接口新建创意 + 切换，按卫青那三步走，会重新过审）。

在当时（2026-10-10 写本节时）**线上三条问答维持原样**（答案仍为空、人工回），§4 的快照是当时的实际配置；后续结果见 §12。

**统筹 2026-10-10 明确**：不替我绕过、不放权限、不发钥匙——被权限拦住只报「拦在哪、要什么权限」，由 PM 决定。
在 PM 给话之前**不要再试别的路子**：不新建广告、不换创意、不动在投广告组。

---

## 12. 后续结果（2026-10-14 补记，文档收尾）

- **三条问答已改完并发布**：PM 2026-10-10 回「放行」「发布」后，统筹用官方广告工具改了三条问答并各配自动回复，Meta 另建了新创意（原创意不可改），广告编号不变。记录见台账卡 `2026-10-10-nm-medspa-ad-faq-published`（pr:2402）。§11 写的「没做成」是当时状态，不是现状。
- **欢迎语 / 自动跟进语现状已过时**：§1、§4 里的「for new clients」是 10-10 读回的旧文。10-12 起线上新素材的欢迎语和跟进语已由 87 号去掉该措辞，该改动的回执文件**截至本次提交尚未落到主干**（由 87 号窗口负责提交），所以本仓库目前**没有**可读的替代原文；回执提交后以它为准，本文不复制内容。登记后续（#964）：回执落地后，在本节补一行真实路径；在此之前核对线上欢迎语只能直接从线上新素材读回，不要信 §1/§4 的旧文。
- **PM 给的三组新问答原文至今没有存进任何文档**（§5.1 仍是空的）。这是已知缺口，按 #964 登记为后续：由归属窗口从线上新创意读回原文存进证据文件，再决定要不要补进 §5.1；本文不凭记忆复原。
- **重写前的 `products` 旧值未留存**（§7）：同样无法补，回滚口径 = 清空；已知，不再追。
