# 技能卡

专家视频/文章提炼出的技能卡，按 `.claude/skills/me-expert-source-to-skill/SKILL.md` 的六步产出。
状态：candidate（没验证）→ verified / rejected → adopted（已落成 skill/手册/代码）。

## 索引（每张卡的裁决一眼看）
| 卡 | 状态 | 裁决摘要 |
|---|---|---|
| [2026-10-18 Facebook 素材先行测试顺序](2026-10-18-meta-ads-creative-first-test-order.md) | candidate | 部分吸收（待验证）：测试≠放量；忽略：1:4:1（对 CTS）、点击率选赢家；吸收：ABO 测/CBO 放量（已有） |
| [2026-10-18 Facebook 广告入门六步与指标线](2026-10-18-meta-ads-beginner-setup-and-metrics.md) | candidate | 吸收（已有一致）：落地页/盈亏CPA/加预算幅度；~~忽略：Advantage+开启~~（已更正为吸收，见卡内复核更正）；忽略：电商数字线（依据是 E-06）；待验证：开始时间次日0点、点击率×点击成本矩阵 |
| [2026-10-18 Meta 创意测试工具（Post Andromeda）](2026-10-18-meta-ads-creative-testing-post-andromeda.md) | candidate | **待验证（优先）**：相似创意被合并只投一条（该细点 ME 无记录；Andromeda 本身 ME 审计已展开）、后台「创意测试」可否成为可执行测试路径、钩子测试；吸收（已有一致）：指标要选对、别硬做 20 条；忽略：Hyros 推广 |
| [2026-10-18 Sabri Suby 8 个技巧](2026-10-18-meta-ads-eight-hacks-sabri-suby.md) | candidate | **待验证（优先）**：身份关键词、再营销换报价（用不买原因）、落地页镜像标题、静态图；吸收（已有一致）：有机赢家转广告、宽泛定向；忽略：僵尸系列、20–40 标题、放大到盈亏线 |
| [2026-10-18 Sam Piliero 创意飞轮](2026-10-18-meta-ads-creative-flywheel-sam-piliero.md) | candidate | **待验证（优先）**：广告组「日最低花费」可作 AD-EXPL-1（A+ 档）的实现机制；竞品广告库只读扫描；忽略：不要怕学习期、增量归因 |
| [2026-10-18 Ben Heath 两系列与 10 钩子](2026-10-18-meta-ads-two-campaigns-and-10-hooks-ben-heath.md) | candidate | 待验证：放量+测试两系列、10 钩子（并入创意测试卡）；忽略（PM 层面）：请创作者/网红做广告 |
| [2026-10-18 Ben Heath 2026 年 8 个新打法](2026-10-18-meta-ads-eight-strategies-ben-heath-2026.md) | candidate | **待验证（优先）**：拉新组实际有多少钱花在已互动/老客户上（决定「收割/拉新分开」值不值）；待验证：价值规则、按三层拆报表；PM 拍板项：创作者合作广告；忽略：每组 20 条、入口价位说；吸收（已有一致）：合并数据、WhatsApp |
| [2026-10-18 Jared Robinson 一个 CBO + 3 角度×5 类型](2026-10-18-meta-ads-cbo-batches-jared-robinson.md) | candidate | **待验证（优先）**：角度之外再记「素材类型」第二层标签（补 SOP §6 缺口，交 AD-LINK-1）；忽略：CBO 同等机会（与 ME 实测相反）、每组 15–30 条；PM 拍板项：创始人出镜、先买后付；吸收（已有一致）：按批建组、排除老客户 |
| [2026-10-18 Sergio C 小预算：先测创意、按展示量关停、砍掉拖后腿的](2026-10-18-meta-ads-small-budget-cut-fat-sergio-c.md) | candidate | **待验证（优先）**：每条广告设展示上限、到量关停，作为 AD-EXPL-1 的候选机制（与 Sam Piliero「最低花费」互补，只做预筛）；忽略：用点击率直接选赢家、电商阈值；吸收（已有一致）：别拆多系列、小步加预算 |

新增卡必须在此表加一行，写明裁决。没有裁决的卡不算完成。

**复核更正（2026-10-18）：** 独立复核员通读 ME 原文，对 48 条断言判：成立 33、不成立 4、存疑 11，另补出 5 个遗漏冲突。各卡文末已加「复核更正」。**身份关键词必须先过 S-13①（Meta 个人属性规则）才能试验。**

## 对账用的规则摘要
[ME-ADS-RULES-DIGEST.md](ME-ADS-RULES-DIGEST.md)：ME 广告规则索引（约 134 条，每条带来源位置）。每日学习任务先读它，**只有疑似冲突时才读来源原文**，不再每天通读手册。16 行标「待核」；摘要只是索引，下「忽略/冲突」结论前必须读来源原文并引出原文位置。

## 机器索引（给 ME 后台「Agent 学习库」页读）
每张卡末尾必须有一节 `## 机器索引`，下面一个 ```json 块：`{"points":[{"key","text","state",...}]}`。一个点只能有一个 state，以复核更正后的结论为准（note 里写「复核更正后」）。没有这一节的卡会在页面上进「还没整理」红区。

| state | 页面分组 | 必填 | 什么时候用 |
|---|---|---|---|
| learning | 学习中 | – | 有价值、还没派出去验证 |
| pm_decision | 学习中 · 等 PM 拍板 | – | 涉及钱、外部执行方、对客外发 |
| verifying | 待验证（已派出） | handoff：台账卡 id | 已开交接卡派给某窗口 |
| adopted | 已合并进 ME | rule：规则手册编号（如 C-18），且该规则那一行写着本卡文件名 | 已写进广告 Agent 规则手册 |
| not_applicable | pass · 判断不适用 | note | 看完就判不适用/与 ME 冲突，没试 |
| tried_failed | pass · 试过不成立 | handoff + note | 验证结论不成立 |
| cannot_check | pass · 查不了 | note | 数据/接口拿不到 |
| already_in_me | ME 早已在做 | rule：规则手册编号，或规则摘要里方括号标签原文（如 `PG§十二`） | 视频印证了 ME 现有规则 |
| merged | 不计数 | merged_into：`<卡文件名去 .md>#<key>` | 与别处同一个点，去重 |
