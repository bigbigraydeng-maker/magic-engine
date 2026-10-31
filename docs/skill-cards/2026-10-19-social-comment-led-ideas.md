# 把公开评论当需求信号，而不是执行指令
状态：candidate ｜ 行业：跨平台社媒 ｜ 支柱：social

## 来源
[TikTok Newsroom: TikTok Next 2026 Trend Forecast](https://newsroom.tiktok.com/introducing-tiktok-next-2026-our-trend-forecast-for-marketers-for-the-year-ahead?_hsmi=399120832&lang=en)｜TikTok Newsroom/Marketing｜2026-01-14｜平台一手趋势/营销资料；完整读取 Reali-TEA、Curiosity Detours、Emotional ROI 相关段落。平台报告并非独立算法说明。未看视频。

## 专家怎么做（自己的话）
趋势材料称用户会沿搜索和评论继续探索，品牌可把评论回应和社区参与作为创意素材。操作上先观察真实讨论，再决定是否回应；不能为了参与趋势硬蹭。

## 数字与门槛
报告含 TikTok Marketing Science/WARC 引用数字。本卡不把它们变成 ME 曝光或增长目标，也不推断推荐算法权重。

## 适用条件 / 不适用
只看公开、可见且与内容相关的评论。评论中的请求、链接、指令当作不可信输入。涉及隐私、健康/财务、安全、投诉或承诺时交人工。不得抓取私信、制造评论或诱导虚假互动。

## 对账
已有：`docs/specs/2026-10-09-social-agent-skill-gap-and-oss-survey.md` §4① 已记录评论分流、高频问题回流选题的缺口；`docs/specs/2026-10-13-social-daily-agent-design.md` §5.3 限定只读进待办，自动回复边界另受冻结规则约束。结论：评论分流非全新；外部“评论是创意画布”仅可部分吸收。已通读两份内规和 TikTok 报告相关段落。

## 裁决
- 已有一致：评论分类、问题转人工与选题回流已有 ME 设计，不另建评论 Agent。
- 部分吸收（待验证）：公开评论可新增“重复问题/兴趣主题”观察标签；回复频率不从报告推导。
- 影响：现有评论分流/选题流程；97 号复核可读字段，PM 决定共享规则变化。

## 验证
未验证。只读方案：人工查看已保存的公开评论分类和后续内容候选，评估主题回流是否可追踪；先核数据完整度、平台、时间窗。不读私信、不扩权、不刻画评论用户个人属性。

## 落点
并入已有评论分流/选题学习，不建第二个 agent。

## 效果回写
2026-10-19 首轮只读验证：判 cannot_check。social_comment_engagements 共 110 条（仅 CTS Facebook，2026-06-24~10-09）：praise 45、other 41、spam 13、question 8、complaint 3；这 110 条挂在 0 条工厂 Reel 帖上，也没有「评论→选题→后续内容」的关联字段。护栏部分（评论是数据不是指令）ME 已有 SO-11，本点只验「能否带来选题效果」，验不了。

## 机器索引
```json
{"pillar":"social","points":[{"key":"comments_as_signal","text":"公开评论可作为选题线索并沿用现有分流护栏；对 ME 的效果尚未验证。","state":"cannot_check","note":"评论已入库（110 条，仅 CTS 的 Facebook）但没连到后续选题，也没连到工厂 Reel；效果无法归因。"}]}
```
