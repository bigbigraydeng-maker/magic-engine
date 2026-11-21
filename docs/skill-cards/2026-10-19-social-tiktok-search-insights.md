# 用站内搜索需求补充选题，不把热度分数当增长承诺
状态：candidate ｜ 行业：TikTok / 社媒选题 ｜ 支柱：social

## 来源
[TikTok Newsroom: Get inspired with Creator Search Insights](https://newsroom.tiktok.com/creator-search-insights?lang=en)｜TikTok 官方产品说明｜2024-03-13｜平台一手功能说明。通读页面主体；该工具仅在部分地区提供，未登录检查 Celine 账号可用性。

## 专家怎么做（自己的话）
Creator Search Insights 显示 TikTok 上常见搜索主题，并可按类别、For You 和内容缺口筛选。它能作为候选选题发现入口；需求信号不代表账号必然获得推荐或转粉。

## 数字与门槛
页面未给出对 Celine 的成效阈值。Popularity 分数和 Recommended Topic 是平台内提示，不是观看、关注或转化承诺。

## 适用条件 / 不适用
只在账号所在地区确实可用时使用；主题须与账号定位、真实素材和透明披露相符。不得从搜索提示推断某群体的敏感属性，也不得用不相关热门词蹭流量。

## 对账
既有社媒设计 §3.1–§3.4 已要求内容与受众相关、事实及素材来源可核；趋势候选卡已要求不伪装现场。新增点仅是“搜索需求/内容缺口”作为选题来源标签，不新建趋势服务。未发现可据此修改生产规则的证据；账号地区可用性与 ME 字段均未核验。

## 裁决
- 部分吸收（待验证）：把站内搜索主题作为选题候选来源；不把热度分数当成平台算法权重或增长承诺。
- 影响：既有选题队列；不新增连接器，不触发发布。

## 验证
未验证。只读方案：若 Celine 账号可见此工具，记录查询日期、地区可用性、主题和内容缺口；与现有已发布内容的主题标签及平台回看对照。不能读到就写 `cannot_check`；不为试验额外发帖。

## 落点
并入既有选题发现流程候选；97 号只读核实功能/数据可见性，PM 决定规则变更。

## 效果回写
2026-10-19 首轮只读验证：判 cannot_check。TikTok 连接 1 条：权限 user.info.basic + video.publish，访问令牌 2026-10-14 已过期，last_synced 为空；该功能是 TikTok 应用内工具，ME 没有接口，且按卡内说明只在部分地区可用。

## 机器索引
```json
{"pillar":"social","points":[{"key":"tiktok_search_demand","text":"TikTok Creator Search Insights 可提供站内搜索主题与内容缺口作为选题候选；对 ME 增长效果未验证。","state":"cannot_check","note":"TikTok 连接只有基本信息+发布权限，令牌已过期且从未同步；Creator Search Insights 是应用内工具，ME 读不到。"}]}
```
