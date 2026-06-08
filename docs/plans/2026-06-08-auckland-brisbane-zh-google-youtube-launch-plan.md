# Magic Engine 首轮投放前期方案

> 日期：2026-06-08  
> 目标市场：奥克兰 + 布里斯班华人服务型商家  
> 渠道范围：Google Search + YouTube

## 1. 这波要先验证什么

这不是“直接放量”的方案，而是首轮需求验证方案。我们先确认三件事：

1. 奥克兰和布里斯班的华人服务商，是否会主动搜索“广告投放 / 获客 / 诊断”这类问题。
2. 他们看到中文广告后，是否愿意先进入“免费诊断”而不是直接预约销售。
3. YouTube 对这类受众，是能拉出有效回访，还是只会带来便宜但不转化的观看。

## 2. 为什么先做这两个城市

- 奥克兰端有明确的人口基础。Stats NZ 的 2023 Census Auckland 区域资料列出，奥克兰有 `194,484` 人识别为 Chinese。
- 布里斯班端也有足够的华人聚集带。ABS 2021 Census 的 Brisbane-South QuickStats 显示，该区域有 `53,273` 人报告 Chinese ancestry，占区域人口 `14.4%`。
- 更广义看，ABS 2021 的 Greater Brisbane QuickStats 显示，Greater Brisbane 有 `41,978` 名出生于 China（excludes SARs and Taiwan）的人口，另有独立的 Hong Kong 出生人口样本。

这意味着两地都不是“只有少量中文受众”的试水市场，而是值得做本地化文案与地域拆分的城市级测试。

## 3. 渠道角色怎么分

### Google Search

Google Search 负责抓高意图需求，优先验证：

- “我已经想投广告了”
- “我在找广告顾问 / 广告诊断 / 华人投放”
- “我不是想看教程，我是要找人做这件事”

所以 Search 是这波的主渠道。

### YouTube

YouTube 不负责第一时间接高意图，而是负责两类事：

- 让已经有问题意识、但还没点搜索广告的人，先认识这个 offer
- 让已经访问过 `/cn/ads` 或 `/cn/discover` 的人被二次提醒，回来提交

所以 YouTube 应该做“小预算、强约束、明确信号”的辅助层，而不是和 Search 平分预算。

## 4. 首轮建议的启动顺序

1. 先把 Search 准备完整，作为 Day 1 主上线渠道。
2. YouTube 的素材、受众、UTM、落地页一起准备好，但不要求 Day 1 全量打开。
3. 更稳的做法是：Search 跑 `3-5` 天后，如果已经有合格搜索词和站内点击，再开 YouTube。
4. 如果业务坚持两条渠道一起上，YouTube 也应只占较小预算，并以回访/问题意识视频为主。

## 5. 账户与结构建议

### Search campaign 结构

- `AKL | Search | Chinese Leads | v1`
- `BNE | Search | Chinese Leads | v1`

每个 campaign 只保留 `2-3` 个意图组：

- 广告投放意图
- 获客/营销意图
- 诊断/顾问意图

每个城市分开跑，不要混在一个 campaign 里。原因很简单：

- 搜索量和 CPC 不会一样
- 页面承诺要能点名城市
- 后续否词、出价、时段调整都要按城市分开

### YouTube 结构

- `AKL | YouTube | Chinese Awareness | v1`
- `BNE | YouTube | Chinese Awareness | v1`

YouTube 这一层建议优先用 Demand Gen 的手动 channel control，只选 YouTube 相关版位，不要一上来把 Discover、Gmail、GDN 全开。

## 6. 地域与语言设置原则

Google 官方文档有三个和这次最相关的现实：

- Search/Google Ads 的 location 与 language 是两套设置，不能只设语言不设地理。
- 默认 location option 可能覆盖“对某地感兴趣的人”，不一定只是真正在该地的人。
- Demand Gen / YouTube 现在可以用 channel controls 手动选 YouTube，也支持 location/language 设置。

基于这个逻辑，这波建议：

### Search

- 城市只投 `Auckland` 或 `Brisbane`
- location option 用 `Presence: People in or regularly in your targeted locations`
- 语言不要只锁死一种中文

更实际的做法：

- 关键词以中文为主
- 广告文案以中文为主
- 语言设置至少覆盖 `Chinese (Simplified)`、`Chinese (Traditional)`，是否加 `English` 取决于你想不想覆盖英文界面下的双语华人

### YouTube

- 城市同样按 Auckland / Brisbane 分开
- 语言建议先从 `Chinese (Simplified)` + `Chinese (Traditional)` 起步
- 受众不用一上来放很宽，先以自定义 segment + 网站回访受众为主

## 7. 页面与承接链路

首轮主链路继续用：

`中文广告 -> /cn/ads -> /cn/discover`

当前 ME 站内已经有这些底座：

- `/cn/ads` 到 `/cn/discover` 的 attribution 透传
- `ads_landing_view`
- `ads_primary_cta_click`
- `discover_start`
- `discover_submit`
- `/api/discover/register` 可接 attribution

这意味着 Search 和 YouTube 两边都可以走同一个主承接页，不需要现在再做两套表单。

但首轮要补的承接要求是：

- `/cn/ads` 文案要从“新西兰中文市场”改成“奥克兰 + 布里斯班华人市场”
- 首屏要明确写出 Google / YouTube 广告前先做诊断
- 页面里要让用户感觉这是“本地中文获客入口”，不是泛泛 AI 公司首页

## 8. 首轮 UTM 规范

统一规则先定死，避免上线后乱掉。

### Search

- `utm_source=google`
- `utm_medium=cpc`
- `utm_campaign=akl_zh_search_v1` 或 `bne_zh_search_v1`
- `utm_content=hero_search`
- `entry_offer=free_diagnosis`
- `entry_page=cn_ads`

### YouTube

- `utm_source=google`
- `utm_medium=paid_video`
- `utm_campaign=akl_zh_youtube_v1` 或 `bne_zh_youtube_v1`
- `utm_content=in_stream` / `shorts` / `in_feed`
- `entry_offer=free_diagnosis`
- `entry_page=cn_ads`

说明：

- `utm_term` 主要给 Search 用
- YouTube 关键是把 `utm_medium` 和 `utm_content` 分清

## 9. 创意准备清单

### Search 必备

- 每城 1 组中文 RSA
- 每城 1 组更直接点名城市的版本
- 否定词清单首发就带上：`招聘`、`工作`、`兼职`、`课程`、`教程`、`怎么学`、`免费软件`、`下载`

### YouTube 必备

- `15s` 竖版短视频 1 条
- `30s` 横版或通用版视频 1 条
- 1 套静态图，给 Demand Gen 混合素材用

YouTube 首轮视频不该讲一堆功能，而只讲一个问题：

`还没把受众、offer、落地页、追踪理顺，就开始烧广告费。`

## 10. 每城建议的信息角度

### 奥克兰

- 中文沟通 + 新西兰本地市场语境
- 本地服务商想拿咨询和线索
- 先诊断，再决定要不要开 Google / YouTube

### 布里斯班

- 华人商家已有网站但获客链路松
- Google 搜索能不能接线索，要先把页面和追踪理顺
- 不要先花钱买曝光，再回头找问题

## 11. 上线前 checklist

- GA4 已接入并能在 Realtime 看到上述站内事件
- `/cn/ads` 主 CTA 到 `/cn/discover` 不丢 UTM
- `discover_submit` 能区分 Search 和 YouTube
- Search campaign 已切成奥克兰、布里斯班两套
- YouTube campaign 已切成奥克兰、布里斯班两套
- Search 否词首发已加
- YouTube 创意至少有 1 条竖版可投素材
- 日报维度已明确：城市、渠道、搜索词/版位、CTA 点击、discover_submit

## 12. 第一周怎么看成败

Day 1-3 先看这几件事：

- Search 搜索词是不是商业意图
- 奥克兰和布里斯班哪边展示更快起来
- `/cn/ads -> /cn/discover` 点击率是否成立
- YouTube 是否只带来观看，不带来任何站内动作

Day 4-7 再做第一轮动作：

- Search 加否词、砍低质词
- 保留高意图城市词和问题词
- 如果 Search 词质量好但站内点不动，先改页面，不先怪关键词
- 如果 YouTube 只有观看没有点击，先缩受众或降预算，不要继续堆量

## 13. 当前我对 ME 的结论

现阶段 ME 已经具备首轮投放前期工作的核心骨架：

- 承接页已存在
- 归因透传已存在
- discover/contact API 已能接 attribution
- 事件命名已统一

还没完全闭环的，是“真实站点测量 + 真实广告账户 + 首轮素材体系”这三块运营前置物。

所以当前最合理的推进方式不是“立刻大投”，而是：

1. 先把页面与 tracking 口径固定。
2. 把 Search 与 YouTube 的城市结构先搭好。
3. 用首周验证结果决定哪座城市、哪个渠道继续加码。

## 14. 外部依据

- [Stats NZ: Our region - Auckland 2023 Census](https://www.stats.govt.nz/assets/2023-Census/Detailed-infographic-of-2023-Census-data-for-Auckland-region.pdf)
- [ABS: 2021 Brisbane - South QuickStats](https://www.abs.gov.au/census/find-census-data/quickstats/2021/303)
- [ABS: 2021 People in Greater Brisbane who were born in China](https://www.abs.gov.au/census/find-census-data/quickstats/2021/6101_3GBRI)
- [Google Ads Help: Choose your location and language settings](https://support.google.com/google-ads/answer/1722072?hl=en)
- [Google Ads Help: Prevent clicks outside of your geo-targeted locations](https://support.google.com/google-ads/answer/9376662?hl=en)
- [Google Ads Help: About targeting geographic locations](https://support.google.com/google-ads/answer/2453995?hl=en)
- [Google Ads Help: Create a Demand Gen campaign](https://support.google.com/google-ads/answer/13695389?hl=en)
- [Google Ads Help: Channel controls in Demand Gen campaigns](https://support.google.com/google-ads/answer/15973205?hl=en)
