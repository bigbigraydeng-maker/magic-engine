# CTS 新线索欢迎信 · 第一版正文（纯文字）

> 状态：**草稿，等 PM 确认**（PM 确认后在这里写日期）｜ 作者：126 号窗口 ｜ 起草日：2026-11-02
> 用途：ME 触发型发送闸里「CTS 新线索欢迎信」的第一版模板。依据：docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.2 和决定 D4（PM 11-02 回「可以」：第一版短纯文字、只带名字、不写团名价格日期）。
> 本文件不是发送授权：授权只存在于授权表里，并且绑定模板指纹——改一个字授权就作废，要重新点。

## 1. 主题与正文（英文、纯文字；`{{first_name}}` 是唯一的变量）

主题：`Welcome from Baker at CTS Tours`

```
Kia ora {{first_name}},

Thank you for your interest in China with CTS Tours. I'm Baker, the founder. We're an Auckland-based team, backed by China Travel Service, and we offer small-group China tours from Auckland.

You're welcome to browse all our China tours here:
https://www.ctstours.co.nz/china-tours?utm_source=me&utm_medium=email&utm_campaign=welcome_me_v1

If you have any questions at all, just reply to this email or call us on 0800 287 888. We'd be glad to help.

Warm regards,
Baker Gu
Founder, CTS Tours
```

系统会在正文末尾自动加一行可见的退订说明，并带一键退订的信头（设计稿 §6.1）——正文里不自己写退订。

## 2. 逐句出处（取数 2026-11-02 新西兰时间：官网原始页面 + 客户简报 master_briefs v3）

| 句子 | 出处 | 标记 |
|---|---|---|
| Kia ora {{first_name}}, | 问候语，没有事实可查 | 客套话 |
| Thank you for your interest in China with CTS Tours. | 公司名 CTS Tours 见官网首页；「感谢关注」是客套 | 官网可溯（名称）+ 客套话 |
| I'm Baker, the founder. | 官网首页：Baker Gu，头衔「Founder & Lead China Specialist」 | 官网可溯 |
| We're an Auckland-based team, backed by China Travel Service, | 官网首页页面说明「Auckland-based and backed by China Travel Service」；简报 core_proposition「Backed by China Travel Service (CTS)」 | 官网可溯 + brief 可溯 |
| and we offer small-group China tours from Auckland. | 官网首页「Expert-led small groups」；/china-tours「Signature … small groups up to 16」「Auckland departures」；简报「small-group China tours」 | 官网可溯 + brief 可溯 |
| You're welcome to browse all our China tours here: [链接] | 链接返回 200，页面标题含「All China Tours」；统计参数沿用 v2 的写法（utm_source / utm_campaign），来源名改成 me | 官网可溯 |
| If you have any questions at all, just reply to this email | 设计稿 §6.1 写 Reply-To 指向 CTS 现有邮箱，线上还没核 | **未证实**（上线前要核 Reply-To 真的配到 info@） |
| or call us on 0800 287 888. | 官网首页电话链接（页面上显示成「0800 CTS 888」，同一个号码） | 官网可溯 |
| We'd be glad to help. | 客套话 | 客套话 |
| Warm regards, Baker Gu, Founder, CTS Tours | 同第 3 句 | 官网可溯 |

## 3. 对照客户简报的红线

- 没有任何「since 1928 / 98 years / 近一个世纪」的说法（简报要求这类说法必须和「新西兰 25 年」成对出现；本信干脆不提）。
- 没有 cheap / bargain / tourist trap / exotic；没有表情符号；语气取简报的「专业而温暖、新西兰口吻」。
- 受众是新西兰本地 35–75 岁的客人：句子短、电话写成数字。

## 4. 对照设计稿 §6.2（第一版限制）

- 变量只有 first_name；没有团名、价格、日期（只写了「China tours」和「Auckland」，不是具体的团）；没有图片；纯文字；正文不含自己的退订句。
- 已知取舍（D4，PM 已同意）：渲染器没有「缺名兜底」——联系人没有名字时这封信渲染不出来、不会发；彩排对照会数出有多少人。

## 5. 还没定、不归 PM 的事（交发信设计窗口 / 127 窗口）

1. 谁把这段正文录进 ME 的模板管理（设计稿 §6.2 写「你们或我起草、你们确认」）。
2. Reply-To 是否真指向 info@；不是的话，「just reply to this email」要改成写明邮箱地址（会让模板指纹变化，授权要重新点）。
3. From 署名建议显示为「Baker from CTS Tours」（沿用 v2 主题行的写法），和正文署名一致。

## 6. Reuse Statement

- 复用：ME 发信关口的模板表与渲染器（127）、客户简报 master_briefs v3、官网原始页面核对法（curl 取页面再逐句 grep）。
- 新增 platform-shared：无。industry-specific：无。client-specific：整份（CTS 文案，进库时是模板数据，不进共享代码）。
- 没有把客户名、客户 ID 写进共享运行时；学习只留在这份客户文案里，没有升级到行业或全局记忆。
