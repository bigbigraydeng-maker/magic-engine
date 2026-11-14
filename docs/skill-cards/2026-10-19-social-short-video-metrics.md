# Shorts 播放量须与选择继续观看的指标分开读取
状态：candidate ｜ 行业：YouTube Shorts / 跨平台分析 ｜ 支柱：social

## 来源
[YouTube Help: Understand your YouTube content performance](https://support.google.com/youtube/answer/12220281?hl=en)；[Content tab analytics tips—Shorts](https://support.google.com/youtube/answer/12942217?co=YOUTUBE._YTVideoType%3Dshorts&hl=en)｜Google/YouTube 官方帮助｜页面显示 2026 年更新｜平台一手指标定义；完整读取 Shorts 相关指标段。未看关联视频。

## 专家怎么做（自己的话）
YouTube 文档区分 Shorts 的 Views 与 Engaged views，并列出 “Stayed to watch / How many chose to view”、平均观看时长和平均观看比例。分析应说明自己在看播放开始还是选择继续观看，不把播放开始次数解释成完整观看。

## 数字与门槛
官方定义说明自 2025-03-31 起 Shorts views 统计播放或重播开始，不设最低观看时长；收益/资格仍使用 engaged/qualified views。此处仅是平台口径，不是内容成效线；更新日期以当前官方文档为准。

## 适用条件 / 不适用
适用于能访问对应 YouTube Studio Analytics 的账号；不能把 YouTube 指标等同 TikTok/Instagram 的 view 或 retention。字段不可见时记 null，不猜值。口径变化前后比较须注明日期/版本。

## 对账
已有：社媒日常设计 §6 要求数字含窗口/样本量、缺失不写 0，并明确某些平台洞察可能读不到。新候选：把平台自身指标定义纳入学习卡，避免裸 views 跨平台混比。未发现与现行 ME 规则冲突。已通读学习流程、社媒设计 §6 与 README 契约；阅读两份官方帮助页主体。

## 裁决
- 部分吸收（待验证）：报告中分列 YouTube Shorts views 和 engaged views，不跨平台直比。
- 影响：分析口径候选；97 号核实当前字段可见性，PM 批准共享规则变更。

## 验证
未验证 ME 当前接口是否回传这些字段。只读查看已有 Shorts 的 Studio Analytics；不改 OAuth 权限。无访问权/数据则记 `cannot_check`，不把空值当零。

## 落点
候选分析口径；不新增连接器。

## 效果回写
2026-10-19 首轮只读验证：判 cannot_check。YouTube 连接 1 条（权限：youtube.readonly / force-ssl / upload，无 yt-analytics 类权限；按 YouTube 公开文档 Engaged views 在 Analytics 接口，待核）；代码库 src 里没有 engagedViews 读取；youtube_publish_receipts 0 行。不把空值当零。

## 机器索引
```json
{"pillar":"social","points":[{"key":"shorts_views_vs_engaged","text":"YouTube Shorts Views 与 Engaged views 定义不同，应分开呈现且不跨平台直接比较。","state":"cannot_check","note":"YouTube 连接只有读取/上传权限，没有分析接口权限，代码里也没读 Engaged views；Shorts 回执 0 行。"}]}
```
