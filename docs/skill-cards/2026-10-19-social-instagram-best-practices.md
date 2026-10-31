# Instagram 站内创作者建议应结合账号实况读取
状态：candidate ｜ 行业：Instagram 创作者运营 ｜ 支柱：social

## 来源
[Meta Newsroom: Introducing Best Practices, an Education Hub for Creators on Instagram](https://about.fb.com/news/2024/10/best-practices-education-hub-creators-instagram/)｜Meta 官方产品说明｜2024-10-01｜通读站内教育中心介绍及栏目说明。

## 专家怎么做（自己的话）
Instagram 专业版面板的 Best Practices 将创作、互动、触达、变现和指南分开，并提供通用建议及个性化提示；其中创作类涵盖频率、吸引注意、Reels 长度等，触达类讲算法与 Reels/关注增长的关系。该页面强调功能内容会持续更新。

## 数字与门槛
没有适用于 Celine 的固定发布时间、长度或增粉线。面板提示随账号表现和产品版本变化，不能把某次提示抄成普遍规则。

## 适用条件 / 不适用
仅适用于可见专业版面板的账号；先记录提示日期和适用分类，再与该账号实际指标比较。提示不可见就记 `cannot_check`。不允许据通用建议自动更改发布频率、账号资料或广告预算。

## 对账
ME 已有社媒设计 §6–§7 的指标/调整门槛及 SO-09/SO-10；个性化建议只可作为复盘输入，不绕过 PM 审批。功能可用性、Celine 所属账号类型和当前提示未核验。

## 裁决
- 部分吸收（待验证）：定期把站内个性化建议作为有日期的观察项，与同账号数据对照；不当成强制规则。
- 影响：现有复盘清单，不增新 Agent/数据表。

## 验证
未验证。只读检查 Instagram 专业版面板是否有 Best Practices，保存建议类别、查看日期与对应指标窗口；与同账号历史相同内容类型比较。缺权限/提示时写 `cannot_check`；不据此改发布量。

## 落点
接入现有 Instagram 复盘候选；不改变生产规则。

## 效果回写
2026-10-19 首轮只读验证：判 cannot_check。platform_oauth_connections 里没有 Instagram/Threads 条目，Meta 连接权限里也没有 instagram_basic / instagram_manage_insights；该面板是 Instagram 应用内页面，需要人工在已授权账号上查看，本轮无账号可查。

## 机器索引
```json
{"pillar":"social","points":[{"key":"instagram_best_practices_panel","text":"Instagram 专业面板的个性化最佳实践可作复盘线索，应按账号和日期核对，不是固定生产规则。","state":"cannot_check","note":"没有 Instagram 账号连接，也没有任何 Instagram 面板/指标读取；要等原生接入（PR 2897）并拿到只读指标权限。"}]}
```
