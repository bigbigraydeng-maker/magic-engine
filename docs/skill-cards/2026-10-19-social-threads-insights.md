# Threads 周报用来复盘账号变化，不证明内容造成增长
状态：candidate ｜ 行业：Threads ｜ 支柱：social

## 来源
[Meta Newsroom: New Threads Features for a More Personalized Experience That You Control](https://about.fb.com/news/2025/03/new-threads-features-more-personalized-experience-you-control/)｜Meta 官方产品说明｜2025-03-20，后续更新至 2025-10-30｜通读 Insights、周报与发现来源段落。

## 专家怎么做（自己的话）
Meta 说明 Threads Insights 的周度概览包含帖子数、总 views、新增关注者和回复的周同比；详细面板可拆 likes、replies、quotes、reposts、关注者地域/年龄段/性别，并可查看 7–90 天走势及内容发现位置。适合将内容活动与同窗口变化并列观察。

## 数字与门槛
7–90 天是产品图表的时间范围；不是实验样本量或因果判据。Meta 关于带主题标签帖子通常有更多 views 的说法属于平台内部观察，不能直接用作 ME 承诺或算法规则。

## 适用条件 / 不适用
仅查看账号本人获准访问的汇总 Insights；不导出或推断个人身份/敏感属性。不可见字段写 null。不同时间窗、指标定义和内容类型不可混比。

## 对账
既有 SO-09 要求来源、时间窗、样本量、缺失值和不可比性；SO-10 要求可证伪且可逆的建议。本卡仅是复盘口径候选，不授权发帖/标签实验，不因一周周报将相关性说成因果。Celine Insights 可见字段未核验。

## 裁决
- 部分吸收（待验证）：用周度汇总串联发帖量、views、关注变化与回复，再以详细互动/发现来源辅助解释；不把单项相关性说成效果。
- 影响：现有 Threads 数据回看流程，不新增分析表。

## 验证
未验证。97 号只读检查授权范围内 Insights 是否提供上述字段、可用窗口及是否可导出；记录平台时间窗和缺失项。无数据写 `cannot_check`，不猜测受众属性，不扩大权限。

## 落点
候选并入现有社媒复盘；不增新机制。

## 效果回写
2026-10-19 首轮只读验证：判 cannot_check。连接表无 Threads；Meta 连接权限列表无 threads_basic / threads_manage_insights；src 里没有 Threads 接口代码。

## 机器索引
```json
{"pillar":"social","points":[{"key":"threads_weekly_insights","text":"Threads 周报可并列查看发帖、views、关注与回复变化；需同窗复核且不推断因果。","state":"cannot_check","note":"ME 没有 Threads 连接，Meta 权限里也没有 threads 类权限，代码里没有 Threads 接口。"}]}
```
