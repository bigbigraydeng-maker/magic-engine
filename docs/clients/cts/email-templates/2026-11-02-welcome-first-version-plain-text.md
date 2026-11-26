# CTS 新线索欢迎信 · 第一版正文（纯文字）

> 状态：**PM 已确认定稿（2026-11-05 新西兰时间，PM 在 126 窗口回「欢迎信行」）；定稿后一个字都不能再动——授权绑内容指纹，改一字授权作废、要重新点**｜ 作者：126 号窗口 ｜ 起草日：2026-11-02
> 用途：ME 触发型发送闸里「CTS 新线索欢迎信」的第一版模板。依据：docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.2 和决定 D4（PM 11-02 回「可以」：第一版短纯文字、只带名字、不写团名价格日期）。
> 本文件不是发送授权：授权只存在于授权表里，并且绑定模板指纹——改一个字授权就作废，要重新点。
> **2026-11-05 更新**：官网「关于我们」页写 Lisa Li, MNZM＝创始人、Baker Gu＝China Travel Specialist（独立复核抽查 9 个带头衔的官网页，8 页相同，只有首页写 Founder）；月信署名已由 PM 11-05 定为「Baker Gu / China Travel Specialist, CTS Tours」。本稿的自我介绍与署名已同步改成同样写法，**PM 11-05 回「欢迎信行」，确认了这一版（主题 + 正文 + 署名）**（见 §5 第 4 条）。

## 1. 主题与正文（英文、纯文字；`{{first_name}}` 是唯一的变量）

主题：`Welcome from Baker at CTS Tours`

```
Kia ora {{first_name}},

Thank you for your interest in China with CTS Tours. I'm Baker Gu, a China Travel Specialist. We're an Auckland-based team, backed by China Travel Service, and we offer small-group China tours from Auckland.

You're welcome to browse all our China tours here:
https://www.ctstours.co.nz/china-tours?utm_source=me&utm_medium=email&utm_campaign=welcome_me_v1

If you have any questions at all, just reply to this email or call us on 0800 287 888. We'd be glad to help.

Warm regards,
Baker Gu
China Travel Specialist, CTS Tours
```

系统会在正文末尾自动加一行可见的退订说明，并带一键退订的信头（设计稿 §6.1）——正文里不自己写退订。

## 2. 逐句出处（取数 2026-11-02 新西兰时间：官网原始页面 + 客户简报 master_briefs v3）

| 句子 | 出处 | 标记 |
|---|---|---|
| Kia ora {{first_name}}, | 问候语，没有事实可查 | 客套话 |
| Thank you for your interest in China with CTS Tours. | 公司名 CTS Tours 见官网首页；「感谢关注」是客套 | 官网可溯（名称）+ 客套话 |
| I'm Baker Gu, a China Travel Specialist. | 官网「关于我们」页：Baker Gu＝「China Travel Specialist」；专家页 /experts/baker-gu 与 4 篇博客作者框相同（独立复核抽查 9 页，8 页相同；只有首页写「Founder & Lead China Specialist」）；名字加头衔的写法由 PM 11-05 定 | 官网可溯（多数页面）+ PM 定 |
| We're an Auckland-based team, backed by China Travel Service, | 官网首页页面说明「Auckland-based and backed by China Travel Service」；简报 core_proposition「Backed by China Travel Service (CTS)」 | 官网可溯 + brief 可溯 |
| and we offer small-group China tours from Auckland. | 官网首页「Expert-led small groups」；/china-tours「Signature … small groups up to 16」「Auckland departures」；简报「small-group China tours」 | 官网可溯 + brief 可溯 |
| You're welcome to browse all our China tours here: [链接] | 链接返回 200，页面标题含「All China Tours」；统计参数沿用 v2 的写法（utm_source / utm_campaign），来源名改成 me | 官网可溯 |
| If you have any questions at all, just reply to this email | 设计稿 §6.1 写 Reply-To 指向 CTS 现有邮箱，线上还没核 | **未证实**（上线前要核 Reply-To 真的配到 info@） |
| or call us on 0800 287 888. | 官网首页电话链接（页面上显示成「0800 CTS 888」，同一个号码） | 官网可溯 |
| We'd be glad to help. | 客套话 | 客套话 |
| Warm regards, Baker Gu, China Travel Specialist, CTS Tours | 同上 | 官网可溯 + PM 定 |

## 3. 对照客户简报的红线

- 没有任何「since 1928 / 98 years / 近一个世纪」的说法（简报要求这类说法必须和「新西兰 25 年」成对出现；本信干脆不提）。
- 没有 cheap / bargain / tourist trap / exotic；没有表情符号；语气取简报的「专业而温暖、新西兰口吻」。
- 受众是新西兰本地 35–75 岁的客人：句子短、电话写成数字。

## 4. 对照设计稿 §6.2（第一版限制）

- 变量只有 first_name；没有团名、价格、日期（只写了「China tours」和「Auckland」，不是具体的团）；没有图片；纯文字；正文不含自己的退订句。
- 已知取舍（D4，PM 已同意）：渲染器没有「缺名兜底」——联系人没有名字时这封信渲染不出来、不会发。（11-03 更正：彩排不看名字，不会数出这个人数——我原先写错了。发信设计窗口用库里数据按渲染器规则粗算，非原代码：彩排首次运行的 29 人里 1 人没有可用名字；近 30 天 Facebook 来的 162 人里 1 人，约 0.6%。）（11/04 发信设计窗口答复，126 没核代码：没有可用名字＝空 / 含 @ / 1 个字符 / 含数字 / guest·customer·test 类词，一律不发；账本记「可重试拦截」，3 天后记 skipped:stale，另出待办「N 位新线索没有可用名字，请销售手发」；近 30 天 Meta 163 人约 1 位，中文名 0 位。）

## 5. 交发信设计窗口的事（下面的答复是发信设计窗口 11-04 给的，126 没核代码）

1. 谁把这段正文录进 ME 的模板管理（设计稿 §6.2 写「你们或我起草、你们确认」）。答复：不用 126 / 127；PM 回「欢迎信行」之后，由发信设计窗口在 PM 已登录的浏览器里走 ME 模板管理页存成「停用」（写生产库，要 PM 再回「录」；PM 自己粘约 2 分钟），试发那天才切「启用」；模板 key 约定 `auto-` 前缀（拟 `auto-welcome`），销售「通话后选模板」列表排除它。
2. Reply-To 是否真指向 info@；不是的话，「just reply to this email」要改成写明邮箱地址（会让模板指纹变化，授权要重新点）。答复：现在没有任何东西设置 Reply-To（适配器还没写），所以「just reply to this email」标未证实是对的；它会做成硬条件（必须是 ME 读得到的 info@，每封都带，有测试钉住），试发那天（约 11-12）真回一封，看落进 info@ 并同步进 ME 才算核实；info@ 是活邮箱（域名收信在 Microsoft 365，ME 的 info@ 连接 active，最近同步 11-04 14:11）。结论：正文先不用改，试发失败再改成写明邮箱（授权前改指纹没代价）。
3. From 署名建议显示为「Baker from CTS Tours」（沿用 v2 主题行的写法），和正文署名一致。答复：可以。
4. **（2026-11-05 已按 PM 的决定同步）自我介绍与署名**：原稿「I'm Baker, the founder.」和署名「Founder, CTS Tours」与官网「关于我们」页冲突（该页：Lisa Li, MNZM＝Managing Director、Founder of CTS Tours New Zealand，Baker Gu＝China Travel Specialist）。PM 11-05 对月信回「可以」，署名定为 Baker Gu / China Travel Specialist, CTS Tours，本稿已同步成「I'm Baker Gu, a China Travel Specialist.」和同样的署名。**PM 11-05 回「欢迎信行」确认了本稿；从此一个字都不能再动（改一个字，授权指纹就变）。**

## 6. Reuse Statement

- 复用：ME 发信关口的模板表与渲染器（127）、客户简报 master_briefs v3、官网原始页面核对法（curl 取页面再逐句 grep）。
- 新增 platform-shared：无。industry-specific：无。client-specific：整份（CTS 文案，进库时是模板数据，不进共享代码）。
- 没有把客户名、客户 ID 写进共享运行时；学习只留在这份客户文案里，没有升级到行业或全局记忆。
