# NM Medspa · Messenger 广告「常见问题」只读核查（2026-10-10）

**一句话**：PM 要换的那三条问答，配置在**广告创意的欢迎消息里**（不是主页收件箱的自动回复）；
NZ$158 Signature Escape 这个套餐**客户自己已经在用**，但**溯不到官网 / 价目表**（客户没有官网）。
本轮只读，未改任何线上配置。

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

## 4. 改前快照（完整原文）

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

（原文中的撇号为 U+2019 弯引号，回写时须逐字对齐；`image_format` / `video_format` 两处的 `message.text` 与欢迎语相同。）

## 5. 第二段要改的时候怎么做（本轮未执行）

前置：① PM 确认口径 ② 价格套餐拿到客户书面确认 ③ 按记忆 `feedback-ads-automation-must-involve-weiqing`，**叫上卫青做记录/审查**。

- 改法：只改创意的 `page_welcome_message.text_format.message.ice_breakers`（三条 title + response），**其余字段原样回写**。
  注意 PM 的答案里有换行和 ✨，要原文一字不改地带进 `response`。
- 禁止连带动的：广告正文 / 受众 / 预算 / 版位 / 开关。
- 改完回读 `page_welcome_message` 和该广告的 `effective_status`、`issues_info`；不是 ACTIVE 就立刻回滚。
- 回滚办法：用 §4 的快照原样写回。

## 6. 语言（PM 2026-10-10 拍板：只要英文）

PM 拍板**只配英文，不加中文版**。多语言支不支持这件事按 PM 指示停查，只留已看到的两点（未做完整核实）：
广告创意的 `page_welcome_message` 里**没有 locale / 语言字段**；主页「常见问题」自动化的编辑页上**看不到语言切换入口**。
这两点都是"界面/字段上没看到"，不等于平台一定不支持。

## 7. 要补进 master_briefs 的内容（草稿，等 PM 批了再写库）

写哪：生产库 `master_briefs`，`client_id = dce2795f-f6ee-4109-8f68-ff3ea863a163`（NM Medspa）。
注意库里还有一条重复客户 `NM Spa`（`2a2b0613-…`）没有 brief，是否合并另说，本轮不动。

```
products: [{
  "name": "Signature Escape",
  "usp": "NZ$158 · 75 min for new clients: 40 min Body Massage + 35 min Spa Facial (incl. 5 min Scalp Ritual). Source: PM 2026-10-10 口头确认"
}]
website: （保持 NULL —— 客户确实没有官网，不要瞎填主页链接当官网）
```

契约说明：`products` 的消费者（`formatBriefForPrompt`、`/api/clients/[id]/products`）只认 `{name, usp}`，
多出的 `price` / `currency` 等字段会渲染成 `（undefined）`，FDE 在 Settings 保存时也会被静默删掉；所以价格、时长、受众、出处全部放进 `usp` 文字里。

可回退：写之前该行 `products` 原值为 NULL，要撤就写回 NULL。

**已执行但格式不合契约，待重写（2026-10-10）**：
- 统筹代 PM 批准后，已向 `master_briefs` 行 `60c6cc24-5946-4d82-a0b8-4eaec2d34d4c`（NM Medspa 唯一一条，`is_active = true`）写入过一版 `products`，
  但那一版带了 `price` / `currency` 等多余字段、没有 `usp`，不符合上面的 `{name, usp}` 契约。
- 需要用上面的 `{name, usp}` 版本覆盖重写（写库属生产写入，须另获授权；本次修订只改文档，未碰生产）。
- 回滚：`update master_briefs set products = null where id = '60c6cc24-5946-4d82-a0b8-4eaec2d34d4c';`

## 8. 本轮做了什么 / 没做什么

- 做了：只读查广告层 + 主页自动化层 + 价格溯源 + 生产库 `master_briefs` 核对。
- 没做：**没有改任何线上配置**，没碰广告正文 / 受众 / 预算 / 开关。
- 执行人：Claude Code 53 号窗口 · 2026-10-10（NZ 时间）· 依据：PM 2026-10-10「把这 3 个问题，更改到 NM SPA 的广告问题」。

## Reuse Statement

- 复用了什么：既有 Meta Ads Connector（官方 ads MCP + Graph 只读）、既有 `master_briefs` 客户事实表、PM 已登录 Chrome。
- 新增：无代码、无 shared runtime 改动。
- platform-shared：无 · industry-specific：无 · client-specific：本文件全部内容（NM Medspa 的广告配置与套餐事实）。
- 有没有把客户事实写进 shared runtime：没有，只写进 `docs/clients/`。
- 落点与 tier-gate 决策是否一致：一致（决策时判 L4 客户配置，实现落在客户文档，未动 `src/lib/`）。
