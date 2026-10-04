# 客户内容底座：规划草案 v0.1（待 PM 定总纲，再审）

日期 2026-10-05 · 状态：规划，未写代码 · 依据：`docs/audits/2026-10-05-channel-client-facts-sources.md`、`2026-10-05-video-functions-inventory.md`、ROADMAP「旅游版 Tour 管理模块 P1」、`ME_PRODUCT_DEFINITION.md` §3.2（价格/库存/出发日期留外部源 Connector 读）。

## 0. 一句话
**一套客户事实底座 → 各渠道各自派生内容 → 统一的闸门在对外那一步把关。** 视频工厂统一、Remotion 接入、统一发布，都挂在它下面，不各自再造一套。

## 1. 三层结构
| 层 | 管什么 | 现有的零件 | 缺什么 |
|---|---|---|---|
| ① 事实层（唯一来源） | 品牌与调性、VI（含 logo）、禁忌合集、官网域名、**产品/价格/团期（带来源、核实时间、有效期）**、客户确认的政策 | master_briefs、injector、brand_redline_phrases、client_knowledge_facts、factory_config、官网 feed | 一个统一只读入口；产品/价格/团期的权威源；logo 与 VI 进底座；字段漂移清理 |
| ② 派生层（每渠道一个适配器） | 视频（Remotion/工厂）、Reels、社媒、每日计划、SEO、网站、广告、邮件、GEO、GBP | 各渠道现有生成代码 | 各渠道都改成「只从事实层取事实，只自己决定形态」 |
| ③ 闸门层（对外那一步） | 价格白名单、原文事实保持、逐句来源、红线、发布许可 | 视频 A 的价格白名单、SEO 周循环硬核对、房产广告溯源、工厂发布闸 | 抽成一个共用的 fail-closed 函数，接到每个对外渠道 |

## 2. 分层判定（me-platform-tier-gate）
- 事实层入口 `getClientFacts(clientId)`：L1 平台基础设施（Kernel/Governance 类，不是新支柱）；**不新建第四份权威源**，复用 master_briefs + 知识库 + 官网 Connector，符合 §3.2。
- 行业差异进 L2：旅游（团、团期、出发地）、地产（listings）、建材（SPC/Hybrid）各有自己的「产品事实形状」，由行业 Playbook 定义，底座只提供通用的「带来源、核实时间、有效期的事实」容器。
- 客户事实只作数据，不写进共享代码（顺手清掉 `keyword-relevance.ts` 里写死的建材词，红线 2）。
- 红线 6：新增 L1 要过五道 Build Gate、PM 拍板；本草案属「整合既有能力」，仍按 L1 候选走子牙+魏征。

## 3. 建议的产品/价格权威源（技术建议，由子牙+魏征复核）
**官网为终裁（CLAUDE.md §8），底座存「带来源 URL、核实时间、有效期的快照」**：定时从官网/行业源读取，过期自动失效、对不上拒用；知识库只放需要客户确认的政策类事实。Master Brief 的 `products` 降级为「产品线索引」，不再当价格源。`verified_offer`/`verified_cta`/Creatomate `offers` 全部改成读底座，不再手填。

## 4. 分步（每步一个 PR，前一步好了才开下一步）
1. **只读事实包 `getClientFacts()`**：复用 injector 序列化；统一「生效 brief」取法；合并禁忌词（redline_phrases + avoid_words + avoid_keywords + excluded_topics）；统一官网域名；修 Reels 读不存在的列。先让 Reels 与社媒计划切过去。（B 级）
2. **品牌包进底座**：logo、品牌色、Slogan、端卡统一从底座取，下发给各出片引擎（Remotion、make_promo、Creatomate 过渡期）。（A/B 级，视频统一的前置）
3. **产品/价格/团期快照**：先做 CTS（旅游版 Tour 管理模块 P1 的落地版），带来源/核实时间/有效期；四个手填字段改读它。（A 级）
4. **共用事实闸**：价格白名单 + 原文保持 + 逐句溯源抽成共用函数，先接 Reels、社媒、每日计划、通用广告草案。（A 级）
5. 其余渠道逐个接入（SEO 写作、邮件、GBP、GEO），每个一小 PR。

## 5. 与进行中工作的关系
- **Remotion 接入（v0.3）**：品牌包与产品事实改为读底座，所以它排在第 2 步之后；原来的「外部成片入口」砍掉。
- **视频工厂统一（v0.4）**：同样依赖第 2、3 步。
- **统一发布**（另一窗口）：发布许可闸装在对外那一步；与第 4 步的事实闸互补。
- **Tour 管理模块 P1**：并入第 3 步，不重复立项。

## 6. 优先级（§11）
频率 高（每个渠道每天都在取客户事实）· IMPACT 高（内容对不对决定 Act 的质量）· 收入 高（价格/团期错会让客人下错单；W38、虚构好评等真实事故）→ 零低、三高 → **P0**。高于 Remotion（P2），所以顺序是先底座、后引擎。

## 7. 审查与执行
设计：子牙+魏征；面向客户加板桥；新增对外/写入口加狄仁杰。实施：DeepSeek 写，Claude Code 出指令/审 diff/跑测试；每步完成后再审。A 级 PR 保持草稿，合并由 PM 回「合」。

## Reuse Statement（规划阶段）
复用：master_briefs、brief-injector、知识库、brand_redline_phrases、factory_config、官网 feed、价格白名单与 SEO 原文核对函数。新增（若实施）：`getClientFacts()`、产品/价格快照（带来源与有效期）、共用事实闸。platform-shared：事实包与闸；industry-specific：各行业产品事实形状（Playbook）；client-specific：CTS 的团、价格、logo（只作数据）。
