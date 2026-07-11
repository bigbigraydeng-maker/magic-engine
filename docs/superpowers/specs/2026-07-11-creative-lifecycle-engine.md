# Creative Lifecycle Engine · 激进版作品生命周期 · spec v0.2

> 起草:子牙 · 2026-07-11 · v0.2 修订 2026-07-12(吸收三视角评审 34 条 findings + 真实数据校准)
> 载体客户:CTS Tours NZ(Phase 34.A winner-reel-sync pilot 进行中)
> 关联:P21.J 内容工厂闭环 spec(供给端)· Phase 34.A(分发端已上线,本 spec 升级它)
> 评审:魏征(15)/ 投放视角(11)/ 统计视角(8)· 全 verdict = approve_with_fixes
> 状态:v0.2 定稿候选 — benchmark 用真实 API 数据锚定,实现前需 Day-14 二次校准

---

## 0. 一句话

把「作品」当成有生命周期的资产:**发布即入池 → 证据充分即判生死 → 晋升成熟池 → 疲劳退役 → 尸检反哺生产**,全程机器决策 + 统计护栏,人只审成片和看周报。激进的是**判定频率和淘汰速度**,不是烧钱速度。

---

## 1. 真实数据锚点(所有 benchmark 的地基)

> ⚠️ v0.1 的 benchmark(hook 25% / CPT $0.02 / CPM $2-9)全部作废 —— 那是拍脑袋。
> 以下为 2026-07-12 从 Graph API 拉的 CTS ThruPlay Ad Set(120248221094190307)近 30 天真实值。

| 指标 | 真实值 | 来源字段 | 用途 |
|---|---|---|---|
| CPM | **$10.11** | spend/impressions×1000 | 曝光成本预估(NZ 华人窄众,天然高) |
| 3s hook rate | **84.1%** | actions.video_view / impressions | ❌ 地板效应,**弃用为判别指标** |
| **hold rate** | **81.2%** | thruplay / video_view | ✅ 真创意质量信号(看了 3s 的人里多少看完 15s) |
| ThruPlay rate | 68.3% | thruplay_watched / impressions | 参考 |
| 真 CPT(ThruPlay) | **$0.0148** | spend / thruplay | 成本判别 |
| CTR(all) | 0.24% | ctr | ❌ 量级太低,ThruPlay 池不用它判生死 |
| frequency(lifetime) | 2.20 | frequency | 疲劳参考(需换 7d 窗口) |
| 预算模式 | **ABO**($18 在 ad set 层) | daily_budget | 测试池可同 campaign 隔离 |
| **实际日花** | **$2.36/日**(预算 $18) | spend/30 | 🔴 delivery starvation —— 单条 creative 喂不饱 Meta |

**三个由真实数据推翻的 v0.1 假设**:
1. **hook rate 不能判生死**:Reels 全屏自动播使 3s view ≈ impression(84% 地板),几乎所有 creative 都 84%+。判别指标改用 **hold rate**(ThruPlay/3s-view,81% 且有区分度)。
2. **CPM 是 $10 不是 $2-9**:$5 预算只买 ~495 曝光,统计效度更差,测试池预算必须上调。
3. **delivery starvation 是主约束**:$18 池只花 $2.36/日,因为 creative 太少 Meta 没得投。**判生死前必须先确认 Meta 真把 Ad 投出去了**,否则测的是投放饥饿不是创意质量 —— 这是全 spec 判定逻辑的第一前提。

---

## 2. 指标定义(消除实现歧义)

| 指标 | 精确定义 | Meta 字段 · 窗口 |
|---|---|---|
| hold rate | ThruPlay 数 ÷ 3s-view 数 | `video_thruplay_watched_actions` ÷ `actions:video_view` · lifetime |
| CPT | spend ÷ ThruPlay 数 | lifetime |
| 3s-view | 3 秒视频观看 | `actions:video_view` · lifetime(仅作 hold rate 分母 + delivery 门槛) |
| frequency | 平均触达频次 | `frequency` · **近 7 天滚动**(不用 lifetime,小池 lifetime 单调爬升 = 年龄的同义词) |
| L3 CTR | 出站点击率 | `outbound_clicks` ÷ `impressions` · lifetime(转化层唯一意图代理) |
| L3 CPL | 单次潜客/会话成本 | cost_per_action(lead / messaging_conversation_started)· lifetime |

**所有判定窗口按广告账户时区(NZST)对齐计算**;cron 触发时刻只是触发器,不是窗口边界。

---

## 3. 三层池子架构

```
供给层(P21.J 内容工厂)· AI 量产 Reel · 人审成片(唯一人工闸)· 每天 ~1 条
        │ 发布即自动入池
        ▼
L1 测试池(独立 ABO campaign · 每条 creative 独占 ad set)
  每 ad set $4/日 · 单条 lifetime cap $8 · 目标:证据充分即判生死
  判别:hold rate 置信界 + CPT 置信界 · 淘汰率 = 观测结果(不硬凑)
        │ G2 晋升
        ▼
L2 成熟池(现 ThruPlay Pool Builder 原地升级 · $18/日 ABO ad set)
  判别:每日疲劳检查(72h 滚动窗)· 退役循环
        │ G4 精英
        ▼
L3 转化层(CTWA / Lead Form)· 素材守门轮换(learning-phase 安全)
```

**为什么 L1 每条 creative 独占 ad set**(statistician + media-buyer blocker):同 ad set 内 Meta 从不均分预算(favorite 吃 70-90%),弱侧 48h 可能只拿 100-800 曝光 → 判的是 Meta 早期竞价偏好不是创意质量。独占 ad set 消灭内部竞争,让「$X 预算 = 可预期曝光」成立。ABO 已确认(§1),同 campaign 建多 ad set 各自独立预算可行。

**为什么独立 L1 campaign**:测试池高频 create/pause churn 不污染 L2 的 delivery 稳定性;且预算彻底隔离,不与 L2 混算。

**Organic 信号角色**:从「入场券」降为「加分项」——organic 火 = G2 加权提前判定;organic 冷 ≠ 死刑(paid signal 质量高于 organic,不受发帖时段/粉丝在线噪音)。具体加权公式 **v0.3 定义,34.B 不实现**(不留悬空:此处显式标注未实现,而非假装有)。

---

## 4. 生命周期 Gates(证据触发 + 置信判定)

> 核心原则(statistician):**让「杀」变难,让 cap 管住「放」**。假阳性(杀真 winner,损失 L2+L3 全部下游价值 + 污染尸检库误导供给端)代价 ≫ 假阴性(放垃圾,被 $8 cap 封死最坏多烧 ~$3)。cap 已封死假阴性成本,激进阈值买不到额外保护、只增假阳性。

### 判定前置:delivery 门槛(所有 gate 通用)
任何 kill/promote 裁决前,该 ad 必须满足 **spend ≥ $3 且 impressions ≥ 300**(CPM $10 下 $3≈300 曝光,取交集)。
- 未达标 → 顺延到下一个 6h run,最迟 **96h** 强制判定
- 96h 仍未达标 → 标记 `insufficient_delivery`,**不算失败**,重新排队或单独占 ad set 重测(delivery starvation 是预算分配问题不是创意质量)

### G0 · 入池(发布时)
人审成片过 + 不在 blacklist → 建 L1 ad,**创建即 ACTIVE 立即投放**(否则判定时零数据全误杀)。
> ⚠️ 独立决策项:L1 ad 自动 ACTIVE = 真金消耗,需 PM 显式 `go` 批准(见 §14 签字栏);不继承 winner-sync 池的 Level-1 PAUSED config。

### G1 · 生死(delivery 达标后,最早 48h)
三桶置信判定(Wilson 90% 区间,不用点阈值):

| 裁决 | 条件 |
|---|---|
| **KILL** | hold rate 90% 置信上界 < 65% **或** CPT 90% 置信下界 > $0.030 |
| **FAST-TRACK** | hold rate 置信下界 > 78% **且** 点估 CPT ≤ $0.018 → 标记晋升候选,提前进 G2 |
| **EXTEND**(灰区) | 都不满足 → 追加一档 $4 预算(cap 临时升 $12),最多一次;两档后仍灰 → 默认晋升进 L2 观察(疑罪从无) |

阈值依据:真实 hold rate 81%、CPT $0.0148。KILL 线 65%/​$0.030 ≈ 明显劣于池均值 20%+ 才杀,给足容错。绝对 floor:hold rate KILL 线不高于 70%、CPT KILL 线不低于 $0.025(防重校准漂移)。

### G2 · 晋升(spend ≥ $8 或 D5,先到)
- CPT lifetime 90% 置信上界 ≤ $0.025 → 晋升 L2
- 否则 → 杀(测试池毕业失败)
- ❌ 删除 v0.1 的「CTR ≥ 中位数」条件:区分 CTR 1.0% vs 1.3% 需 ~2 万曝光/组,G2 只有几百曝光 = 抛硬币;CTR 降级为 G4 参考项
- G1 幸存者 cap $8→$15(晋升判定值得多买数据),需 PM 批预算增量

### G3 · 疲劳(L2 内,每日 1 次)
- 双信号:近 7d frequency > 3.5 **且** 近 72h 滚动 hold rate < 该 ad 自身晋升后首周 hold rate × 0.75
- 自基线对比(不用池中位数)→ 消除小池噪音 + 跑步机效应(池中位数会随集体疲劳同步下降,永远检测不到集体衰退)
- L2 保护期:promoted_at 距今 < 7 天豁免 G3;存量 7 条 ad 的 promoted_at 统一记为 34.B 上线日
- 6h cron 保留但只做数据采集 + G1 判定;G3 疲劳裁决**每日 1 次**($18 池 6h 只花 $4.5,6h 判疲劳是对噪音做决策)

### G4 · 精英 → L3(每周日结算)
准入复合条件(防 ThruPlay-便宜 = passive watch magnet 的指标错配):
- CPT 排名 L2 前 50% **且** outbound CTR ≥ L2 池 P75 **且** 存活 ≥ 7 天
- 进 L3 身份 = 「带守门的新测试」不是「已验证 winner」:7 天独立观察窗,CPL/单次会话成本劣于该 campaign 30 天基线 30% → 自动回滚 pause,**不淘汰原有素材**

---

## 5. 天龄状态机(补 v0.1 的判定真空)

| ad 天龄/状态 | 行为 |
|---|---|
| age < 48h | 沉淀期,不判定 |
| 首个 ≥48h 且 delivery 达标的 run | 判 G1 |
| delivery 未达标 | 顺延,最迟 96h;仍不足 → `insufficient_delivery` 不杀 |
| 48h–G2 触发之间 | 仅受 lifetime cap 控制,**不重复 G1**(防 D4 掉线被二次处决) |
| spend ≥ $8 或 D5(先到) | 判 G2 |
| L2 内 promoted_at < 7d | 豁免 G3 |
| L2 内 promoted_at ≥ 7d | 每日判 G3 |

**L1 ad 完整状态**:`active` / `delivery_starved` / `killed_g1` / `killed_g2` / `promoted` / `cap_paused_pending`(烧满 cap 待判,与 kill 区分)。

---

## 6. 判定频率与基础设施

| 34.A(现) | 激进版 |
|---|---|
| 每天 1 次(GHA cron `0 15 * * *` = 03:00 NZST) | **每 6h**(`0 3,9,15,21 * * *` UTC) |

- **cron 沿用 GHA**(34.A winner-sync-daily.yml 已验证可用,PR #545 merged),非 Render —— 本仓 cron 混合两栈(render.yaml 有 Render cron,.github/workflows 有 GHA cron),34.B 沿用 34.A 同栈
- **时区已核对**:03:00 NZST = **15:00 UTC**(NZST=UTC+12 冬令时)。34.A SOP 里「03:00 NZST = 14:00 UTC」是笔误,本 spec 附带修正
- 6h 仅 G1 需要小时级精度;G3 每日 1 次
- **rate limit**:Marketing API 用 BUC(Business Use Case)按 ad account 滚动积分制,非简单 200/小时。当前 ~10 调用/次 × 4 次/天充足;10 客户规模化用 per-client token 分摊 + `insights level=ad` 一次拉整个 ad set(合并调用)

---

## 7. 风险护栏

| 护栏 | 值 | 执行精度 |
|---|---|---|
| L1 单 ad lifetime cap | 软顶 $8(触发线设 $6 留缓冲) | 6h 轮询 + insights 15min-3h 延迟 → 实际落点 $6-9 |
| L1 每 ad set 日预算 | $4/日 · 独立 ABO campaign | 精确 |
| **本 spec 新增日预算** | **L1 峰值 ~3 ad set × $4 = $12/日**(需 PM 批) | — |
| L2 日预算 | $18/日 既有 Pool Builder,**维持不变** | — |
| 人审成片闸 | 保留(G0 前置,机器永不直接发布内容) | — |
| 单日新增上限 | L1 ≤ 2 条/日;溢出 FIFO 排队次日 | — |
| 池子保底 | L2 ≥ 3 条活跃才允许退役;单周期最多退 1 条(限速阀防雪崩) | — |
| placement 锁定 | L1 锁 Facebook/Instagram Reels + Feed,**关 Audience Network + Advantage+ placements** | 消除 placement 混杂污染 hold rate + 排除 AN 垃圾流量 |
| kill switch | config `enabled=false` 一键全停 | 继承 34.A |
| 只 pause 永不 delete | 保留历史降低个人账户风控异常度 | 继承 34.A |

**误杀防护**(statistician):
- kill 一律要求强证据(置信界),灰区 EXTEND 不杀
- 尸检记录区分死因置信度:清晰失败(置信区间整体劣于阈值)进 DNA 负样本集;灰区死亡(预算规则杀)单独标记、**不喂供给端学习**(防单次误杀经反哺闭环放大)
- 每月抽 2-3 条被杀 creative 做 5% 流量复活重测(~$10-15/月),直接度量真实假阳性率,作为阈值松紧校准信号

---

## 8. Benchmark 校准机制(防幸存者偏差棘轮)

- **上线前 2 周 observe-only**:L1 跑但只记录判定结果、不真杀,用首批 8-14 条实际分布定 benchmark 初值(不提前拍死)
- **ITT 校准**(intention-to-treat):分位数用全体入池 creative(含被杀者完整 lifetime 数据,来源 = 尸检表)算,**不用幸存池**(幸存池分布被从下方截断,截断后中位数=旧 P75,单调上漂 → 最终没人能过 → 撞降级放水 → 震荡)
- **移动封顶 ±10%/次** + 绝对 floor/ceiling:hold rate KILL 线 ∈ [70%, 拍板初值];CPT 上限无论如何 ≤ $0.05
- **小池禁用相对规则**:池 n < 8 时只用绝对锚定值(初值 + 慢速 EMA);n ≥ 8 才可用滚动 7 天 trimmed mean(掐头去尾 20%,不用中位数)
- **L1 / L2 benchmark 分账**:两池 population 分布结构性不同(L1 新 ad 零历史 + 高首日 CPM + 永久 learning;L2 已被 Meta 偏爱 + 充足投放),混算必偏

---

## 9. 分阶段实施

| 阶段 | 内容 | 前置 | 工作量 |
|---|---|---|---|
| **34.B** | ①口径审计(Day-14 checklist)②建 L1 独立 ABO campaign + 状态机 ③**creative_autopsy 表 migration**(死亡/退役落库,解循环依赖)④G1/G2/G3 证据触发+置信判定 ⑤observe-only 2 周 | 34.A pilot Day-14 数据 | 2-3 天 |
| **34.C** | G4 精英晋升 → L3 素材守门轮换 | 34.B 稳定 + CTWA 有 2 周数据(campaign 120248364536030307 已建,§10) | 1 天 |
| **34.D** | 消费端:DNA 周报 + storyboard 提示词自动生成(消费 autopsy 表) | 34.B 积累 ≥ 20 条尸检样本 | 2 天 |
| **34.E** | 对接 P21.J 内容工厂供给端 | P21.J M1 落地 | 联调 |

**时序**:34.B 在 pilot Day-14(约 2026-07-24)复盘后动工,用真实 2 周数据二次校准所有 benchmark 初值。

**L3 learning-phase 铁律**(media-buyer 最伤钱一条 · 34.C 强约束):
1. 永远新增 Ad,**绝不编辑现有 Ad 的 creative**(significant edit = learning 重置,营收主力永久困 learning,CPL 劣化 20-50%)
2. 不 pause 当前 CPL 最优的 Ad
3. 轮换频率硬顶每 2 周 1 条/每 conversion Ad Set
4. 用 existing post ID(同 winner-sync 机制)复用已积累互动的帖子,新 Ad 继承社交证明、learning 冲击最小
5. 轮换后 7 天 CPL 守门

---

## 10. 与现有资产的关系

- **34.A winner-sync 升级不推翻**:继承 G0/blacklist/kill switch/留痕/通知;**G3 为升级替换**(非继承)。参数对照:

  | 参数 | 34.A | 本 spec G3 |
  |---|---|---|
  | 判别指标 | CTR < median × 0.5 | hold rate < 自身首周 × 0.75 + freq > 3.5 |
  | 基准 | 池中位数 | ad 自身基线 |
  | 频率 | 每天 1 次 | 数据采集 6h / 疲劳裁决每日 |
  | 保护期 | ad_min_age 14d | promoted 后 7d |
  | 最小样本 | insufficient_ctr_signal | delivery 门槛 spend≥$3 & imp≥300 |

- **per-run guard 换算 per-day**:34.A `max_new_ads_per_run=3` × 4 次/天 = 理论 12/日,本 spec 硬顶 L1 ≤ 2/日(engine 加 per-day 计数,不靠 per-run)
- **L2 = 现 ThruPlay Pool Builder 原地升级**,现有 7 条 Ad 直接算 L2 存量
- **L1 测试池 = 新建独立 ABO campaign**(不塞现 campaign,避免污染 + 彻底隔离预算)
- **L3 CTWA campaign 已建成**:120248364536030307(2026-07-12 API 建 + activate,$40/日)· Reborn Lead Form 120247480862390307($82/日)—— 34.C 的 conversion 承载体已存在,非隐藏前置
- **P21.J 供给端姊妹 spec**:「每天 1 条新 Reel 自动进入生命周期」接轨,34.E 联调

---

## 11. 供给节奏(瓶颈转移)

winner 率 = G1 存活 × G2 通过(v0.1 漏了 G2 独立淘汰,高估):
- G1 存活预期 30-50% · G2 通过 60-80% · 周净新增 winner ≈ 7 × 40% × 70% ≈ **2 条**
- L2 稳态规模目标 6-10 条(退役有补给)
- 每周测试成本 ≈ 7 条 × $6-8 = **$42-56**(一条传统拍摄的 ~1% 价格买 7 次真实市场投票)
- 供给 < 3 条/周(滚动 7 天入池计数)→ 降级:G1 只杀 CPT 90% 置信下界 > $0.05 的明显失败者,G2 阈值不变

---

## 12. 尸检反哺(高频化)

1. 每条 ad 死亡/退役时落 `creative_autopsy`:主题标签 / hook 类型 / 城市 / 存活天数 / lifetime hold rate / lifetime CPT / lifetime impressions / **死因(清晰失败 vs 灰区 vs delivery_starved)** / entry_day_of_week / entry_hour
2. 每周日自动生成「赢家 DNA 周报」:哪类主题赢 / 哪种 hook 赢 / 最优发布时段;**先检查死亡率是否与入池星期相关**,相关则按星期分层再归因(防把 day-of-week 混杂误读为主题差异)
3. DNA 周报喂供给端 → 自动生成下周 storyboard 提示词初稿(接 storyboard-image-prompt / seedance-video-prompt skills)
4. 灰区死亡不进 DNA 负样本集(防误杀经闭环放大)

---

## 13. Day-14 校准 checklist(34.B 动工第一步)

1. 口径审计:核对 hold rate / CPT / CPM 真实分布(本 spec §1 已做首轮,Day-14 用 2 周新数据复核)
2. 用 observe-only 首批 8-14 条实际分布定 G1/G2 阈值初值
3. 确认 L1 独立 campaign 的 delivery 能力(单 ad set $4/日在 CPM $10 下 48h 能否达 spend≥$3 & imp≥300 门槛;若否 → 上调至 $6/日)
4. business verification 状态检查(个人账户风控前置,规模化硬前置)

---

## 14. 签字栏

| Agent | 角色 | 状态 |
|---|---|---|
| 子牙 | 架构主笔 | ✅ v0.2(吸收 34 findings + 真实数据) |
| 魏征 | 挑刺评审 | ✅ 15 findings · approve_with_fixes |
| 投放视角 | Meta 机制现实性 | ✅ 11 findings · approve_with_fixes |
| 统计视角 | 判定统计效度 | ✅ 8 findings · approve_with_fixes |
| **PM · 业务拍板** | ①激进方向 ②L1 新增 ~$12/日预算 ③L1 ad 自动 ACTIVE | ⏳ 需显式 `go` |

**PM 需显式批准的 3 项**(不可逆/花钱,只上抛业务不上抛技术):
1. 激进生命周期方向(已口头同意 2026-07-11)
2. L1 测试池新增日预算 ~$12/日(月 ~$360)
3. L1 ad 自动 ACTIVE 立即消耗(而非 winner-sync 的 PAUSED-等-approve 模式)
