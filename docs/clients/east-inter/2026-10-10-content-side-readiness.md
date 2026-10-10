# East Inter 内容侧盘点（2026-10-10）

查的是生产库 CrazyContent 与 Dropbox 本机同步目录，只读，未改动任何数据。
结论一句话：**账户那边就算今天绑上卡，内容侧也投不出去——品牌色、logo、在期的推广活动三样都不齐。**

## 1. 品牌色：VI 字段全空，但有一条色值躺在过期活动里

`master_briefs` 里 `vi_colors` / `color_palette` / `visual_style` / `vi_style_keywords` 全是空，
`brand_voice`、`brand_story_md` 也没有。

但 2026-10-01 那份推广活动的 `vi_color_accent` 写着 **深海钢蓝 `#1A3F6F`**。
这是目前库里唯一一条关于这个客户的颜色记录——它是单次活动的点缀色，**不等于品牌主色**，
在拿到客户确认之前不要当品牌色用，也不要直接回填进 `master_briefs`。

## 2. Logo / 素材：没有

- 合同区 `Magic Engine/by-client/11_East_Inter/` 里只有：已签合同、运价单、报价计算器网页。
- 素材库（`reference-client-creative-assets-dropbox` 记的那个目录）里**没有**这个客户的文件夹，
  整个 Dropbox 搜 `east` 也只搜到上面那几份文档。
- 也就是说：**没有 logo 源文件，起任何画面交付物之前得先向客户要。**

## 3. 推广活动：两份都过期了，但状态字段还写着 active

| 标题 | 有效期 | 库里 status | 实际 |
|---|---|---|---|
| East Inter — China to Australia Freight 7-Day Facebook | 2026-09-22 → 09-28 | `active` | 已过期 |
| East Inter \| 5-Day Facebook Reels | 2026-10-01 → 10-05 | `active` | 已过期 |

**只看 status 字段会误判成「有在跑的活动」**，必须拿 `valid_until` 跟当天比。

## 4. 其他现状

- 客户档案：`East International` / `eastinter.com.au` / 行业 logistics / 国家登记 AU / 状态 active
- Facebook 主页已绑在客户档案上；Instagram 账号为空
- `primary_keywords` 是空的，`contact_email` 是空的，客户问卷（brief）也没填完

## 要客户给的东西（内容侧开工前的最小清单）

1. logo 源文件（矢量优先）
2. 品牌主色确认（含上面那个 `#1A3F6F` 到底算不算）
3. 真实产品/场景照片——运价、时效这类数字只能用客户自己给的，不许估

来源：session:8c3f674c
