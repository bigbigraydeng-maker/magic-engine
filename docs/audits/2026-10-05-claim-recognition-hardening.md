# 价格 / 日期识别补强（对外发布闸的识别函数）— 2026-10-05

风险级别 **A**（`containsPriceClaim` 是三条发布路由的挡板判据）。来源：客户内容底座规划 v0.3「第 0 步」最后一条 + 魏征 B1。
**范围**：只补识别规则 + 回归测试。不改渠道接线、发布路由，不建表；「白名单绑 tour_id」依赖第 3 步产品事实源，本 PR 不做。

## 改了什么
- `src/lib/content/price-claim.ts`：宽、严两个口径都补币种写法；旧规则原样排在最前，新的只往后追加，所以**旧规则命中的文本新规则必然仍命中**。
- `src/lib/content/date-claim.ts`（新）：精确日期识别 `findDateClaims` / `containsDateClaim`，**没有接进任何渠道**。
- `claim-recognition.test.ts`（新）+ `copy-generator.test.ts`（加 2 条）。`copy-generator.ts` 一字未动。

## 新认出的写法
| 写法 | 宽 | 严（挡发布） |
|---|---|---|
| `NZD 4,999` `NZD4999` `4,999 NZD` `AUD88` `USD 1,200` `RMB 12000` `4999 NZDpp` | ✅ | ✅ |
| `¥3999`（半角）`3999元` `纽币/纽元/新西兰元/新西兰币/澳元/澳币/澳刀/美元/美金/美刀/人民币` + 数字 | ✅ | ✅ |
| `1.2万元` `8千元` `NZD 1.3k` `$1.3k` | ✅ | ✅ |
| 裸 `1.3k` `20k` | ✅ | ❌（不能挡 "10k followers"）；`2K/4K/8K` 视频分辨率两边都排除 |
| `CNY 2027`（春节）`NZD 7 day tour` `澳币 3 天` `美金 10 人` `5元件` `元旦` 跨行的 `NZD↵7` | ❌ | ❌ |

日期：`15 March` `March 5` `15th of March` `3月15日` `2027年3月` `15/03/2027` `2027-03-15` 等；不当日期：`2027 tour` `3 days` `Level 3` `22 Market Street` `88 May Road` `March 7 day tour` `you may 5 times` `6月龄` `第3月` 等。

## 没做 / 已知缺口（代码注释里有完整清单）
- **没替换** `copy-generator.ts:91` 的旧 `DATE_RE`：换了会改变 AI 广告文案落模板的行为，应和第 4 步结构化日期比对一起做；所以该路径仍认不出 `15 March`。
- 价格没覆盖：中文数字、`4999$`、`NZD: 4999`、€£、全角数字、`CNY 3999`；已知误伤：`nzd5.com`、`#NZD2027`、旧 `AUD` 跨行。日期：小写月份缩写（除 may）、`31st May` 与 `May 31` 不归一、区间只抓一端。

## 行为影响（合并即生效）
1. **严口径被发布闸使用**（`publer/create-post`、`schedule`、`quick-post`，另有 `manual-content-items.ts`、`SocialPlanSection.tsx`）：有新认出价格、配图又没核实为实拍的帖子会被拦。
2. **宽口径被 `copy-generator.hasInventedNumber` 使用**：AI 广告文案里不在 `verified_offer` 白名单的新写法金额会整条落模板；比例未量化。
3. 超集只在「命中与否」层成立，命中片段可能变长（`NZD 4,999 for 2` 旧判编造、新放行，与旧 `$99 for 2` 一致）。

## 影子统计口径（只读，由协调窗口在 Supabase 里跑；Postgres 正则只是近似，要精确判定把命中行贴回来）
```sql
with t as (
  select 'content_posts.caption' as src, id::text as id, caption as txt from public.content_posts
   where status in ('approved','scheduled','published') and coalesce(published_at, scheduled_at, created_at) > now() - interval '90 days'
  union all
  select 'reels_drafts.fb_caption', id::text, fb_caption from public.reels_drafts
   where created_at > now() - interval '90 days'
)
select src, id, left(txt, 120) as 开头 from t
where txt ~* '(\ynzd|\yusd|\yrmb|\yaud)\s*\d|\d\s*(nzd|usd|rmb|aud)\y|[¥￥]\s*\d|\d\s*元|(纽币|纽元|新西兰元|新西兰币|澳元|澳币|美元|美金)\s*\d'  -- 新规则会认(近似)
  and txt !~* '(\$|a\$|nz\$|\yaud\y|￥)\s*\d|\d\s*(%|\yoff\y|\ydollars?\y|\ybucks\y|/\s*(m²|sqm))'                                        -- 旧规则本来就认(近似)
order by src, id;
```
读法：每一行都是「合并后会多拦（或多落模板）」的候选，人工判是不是真价格；不是价格 = 误伤，回报我收紧。`content_posts.caption` 最能代表发布闸；报样本总数。只覆盖这两张表，不含每日计划、工厂工单、AI 广告文案。

## 审查与验证
设计、实施各两位（子牙、魏征）审过一轮，意见已并入；未开第三轮；狄仁杰未参与（不新增入口、不改鉴权）。实跑的命令与结果见 PR 正文。
