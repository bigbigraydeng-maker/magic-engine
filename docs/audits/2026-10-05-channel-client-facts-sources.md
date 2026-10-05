# 各内容渠道「客户资料从哪取」盘点（2026-10-05，只读，基线 b40da0c3，未 fetch）

只看了代码，没查生产库，没跑测试。判断「是不是都走 Master Brief」「有没有统一底座」用。

| 渠道 | 客户资料来源 | 产品/价格事实 | 官网校验 |
|---|---|---|---|
| ①A 广告成片 | master_briefs 整行；clients 红线/factory_config；本机 brandkit 文件夹 | 手填 `verified_offer`/`verified_cta`；价格数字白名单硬拦 | 不抓官网 |
| ①B 讲课口播 | master_briefs（含 vi_colors）、爆款库 | 无，要求数字用占位 | 事后李白逐句标注，只标不拦 |
| ①C Creatomate | `factory_config.render.creatomate`（手填 offers 字典） | 手填 offers，确定性映射 | 不抓取，缺值拒绝出片 |
| ②Reels Studio | master_briefs（只认 is_active）、自带序列化器 | products 只取名称 | 无 |
| ②社媒计划/content/ai-factory | master_briefs、campaign_briefs | brief.products（名称+卖点） | 无 |
| ③每日计划 | 请求体手填；brief 只存 id | 手填 | 代码里 evidence_grounding 恒为 UNKNOWN（没做） |
| ④SEO 标题周循环 | `seo_config`、原页面、DataForSEO/GSC；不读 master_briefs | 不产出事实，硬核对原文价格日期不丢不增 | 对原页面核对 |
| ④SEO 写作/关键词 | master_briefs、campaign、站点页面 | brief.products，无价格 | 页面升级线实时抓原页 |
| ⑤网站内容写入 | cms_connections（GitHub PR/WordPress/Shopify） | 不生成 | 草稿→预览→发布 |
| ⑥广告文案/素材 | 请求体；红线=brand_redline_phrases+avoid_words | 房产用 listings；通用 /draft 无事实源校验 | 房产逐句溯源；通用 /draft 无 |
| ⑦邮件 | ME 不生成 newsletter，只排选题（FDE 手写） | 无 | 无 |
| ⑧GEO/AI 问句 | master_briefs 窄字段（只认 status=active）、brand_aliases | 无产品 | 无 |
| ⑨GBP/口碑 | 司马迁只用 clients.name；鲁班走 injector | 无事实源 | 只靠 prompt，一律不自动发 |
| ⑩客户知识库 | client_knowledge_facts（逐条审批、双签、有效期、按客户开通） | 价格/时效/政策的客户确认事实 | 双签+有效期；只有私信链路读它 |

## Master Brief 的「产品」到底是什么
只有一个 `products jsonb`：类型写着 {name, description, price_range, season, usp}，但真正的写入口只留 {name, usp}，injector 也只渲染这两项；AI 生成 brief 的 prompt 不产出 products。没有价格数值、币种、团期、有效期、来源 URL、库存。

## 产品事实现在有 7 份并存
master_briefs.products｜factory_config.verified_offer/verified_cta/render.creatomate.offers｜client_knowledge_facts｜listings（房产）｜group_tours（仓库无迁移文件，谁建的没查清）｜web-intelligence 的官网 feed（FirstPartyTour）｜config/clients/cts/offerings.yaml（无生产调用）。ROADMAP「旅游版 Tour 管理模块 P1」已记录这种漂移，**尚未授权实施**。

## 分叉点（摘要）
- 序列化各写一套：injector、`reels/generator.ts:280`、`route-b-rewriter.ts:53`、geo/ai-tracker 窄 select、messenger tools。Reels 读 `vi_color_palette`/`vi_typography`，这两列在迁移和类型里都不存在，所以 Reels 拿不到品牌色。
- 禁忌词两套：`brand_voice.avoid_keywords`（只有鲁班读）与 `master_briefs.avoid_words`（旧列，无编辑入口）；`clients.brand_redline_phrases`（有 UI、硬扫描）只被视频 A、广告、私信、语音用，社媒/Reels/博客/SEO/每日计划都不读。
- 「哪份 brief 是生效的」取法四种：`status=active OR is_active`、只认 `is_active`、只认 `status='active'`、不过滤。
- 官网网址三处：`brief.website`（AI 不写）、`source_website_urls`、`clients.domain`；工厂片尾 URL 取 `brief.website`。
- VI 三种来源：本机 brandkit、`vi_colors`、不存在的列。

## 底座缺口
1. 没有统一的只读「事实包」（品牌、禁忌合集、产品价格、官网域名、VI、CTA 事实）。
2. 没有带来源与有效期的产品/价格/团期单一事实源。
3. 没有渠道通用的「事实核对闸」：价格白名单只在视频 A，原文保持只在 SEO 周循环，逐句溯源只在房产广告与李白（只标不拦）；Reels、社媒、每日计划、通用广告草案、GBP、邮件都没有。
4. 知识库对内容渠道零接入，且按客户开通。
5. brief 字段漂移（旧列/新列/死列）。

## 不确定、没验证
生产库里 CTS 的 products/avoid_words/website 是否有值；`excluded_topics` 迁移是否已 apply；`group_tours` 来历；知识库对 CTS 是否 live；TikTok、Google Ads、小红书、portal 自助向导没覆盖。

## 更正（四位审查员核对后，2026-10-05 晚）
- 「价格白名单只在视频 A」不准：`content/price-claim-gate.ts`（`judgeOutgoingPost`）已装在 Publer 三个发布口（create-post、schedule、quick-post）与 `pm-todo/manual-content-items.ts`；`seo-meta/cycle/hard-fact-check.ts` 也有原文核对。视频 A 的白名单在 `factory/copy-generator.ts:103/154`。
- 「SEO/博客不读禁忌」不完整：`blog/weekly-blog.ts:137` 与 `seo-intelligence/keyword-relevance.ts:72` 已读 `excluded_topics`，迁移 `20260611000001` 存在；是否已在生产 apply 仍未验证。
- 「知识库对内容渠道零接入」属实，但 CTS 的 4 条价格类事实已在迁移 `20260915120000` 写入 `client_knowledge_facts` 并授予读取准入。
- 新增发现：`/api/content/route-a|b|c` 无任何鉴权（中间件不覆盖 /api）；现有价格识别正则不认 NZD/¥/元/USD（已实测）；`first-party-tours.ts` 抓取失败返回 `[]`；官网为终裁与 CTS 已下架团仍挂官网的事故冲突（`offerings.yaml` 记录）。

## 生产库只读核对（2026-10-05 晚，只读，样本=全部 19 个有 Master Brief 的客户）
- `master_briefs.excluded_topics` 列**生产里存在**（魏征担心的「发布代码已在 select 一个可能不存在的列」不成立）。
- 「生效 brief」两种取法：`status='active'` 的客户 14 个，`is_active=true` 的客户 19 个；**5 个客户只有 `is_active`、`status` 不是 active**（0 个客户反过来）。所以任何渠道若只认 `status='active'`，会让这 5 个客户读不到 brief（目前 GEO 与 AI 可见度问句正是只认 status）；统一取法前必须先看这 5 个是谁。
- CTS：Master Brief 的 `products` 为空；`avoid_words` 16 个；`clients.brand_redline_phrases` 3 条；`website` 有值。Oztop：`products` 为空；`avoid_words` 0 个；红线 5 条；`website` 有值。即「产品不在 Master Brief 里」在这两个客户上成立。
