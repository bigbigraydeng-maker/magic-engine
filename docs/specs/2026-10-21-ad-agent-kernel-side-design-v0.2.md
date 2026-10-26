# 广告 Agent 内核侧设计 v0.2：推广期闸（默认 enforce）+ 广告结构规则 + 动作请求合同（只设计，未写代码）

- 日期：2026-10-21　窗口：119　风险级：**A**（新增内核动作 `ads.pause_ad`、新增自动执行用的信封类别、批准闸、自动暂停）
- 取代：`2026-10-21-creative-promo-window-gate-design.md` v0.1 中「只检测 / 手工复制只能事后待办 / enforce 等两周」的口径（PM 10-21 否决）。v0.1 的数据结构（`promo_window`）、批准闸、解析器坑、`end_time` 封顶等**保留**，不重复。
- 对应架构稿：`docs/specs/2026-10-21-ad-agent-system-v1-architecture.md`（74 号，§2 结构框架、§3 动作请求合同）。
- 状态：待 74 号过平台层级门 → 子牙+魏征设计审 → DeepSeek 写 → 实施再审。**审完前不写代码。**

## 0. 先说三个读生产库查出来的事实（改变了设计）

1. **（10-21 复核后更正）在投广告用的视频 id ≠ 素材池里的 id，但内容就是池里那两条。** 我先前只看了广告快照，得出“没有一条在池里”，并把官方户当时的 2 条广告当作在投——**那份快照停在 10/20 06:31Z，早于今晚新建的广告，是滞后的**。用 Meta 接口 live 复核（只读）：官方户现在 ACTIVE 的 4 条广告（WhatsApp 的 A2/B3、播放量的 A2/B3）用的 `video_id` 是 1110954791640892 / 2324048611775779 / 1126238526529263 / 2052942792039743，**与池里已批的 28843889985273791（A2）/ 3626096160888481（B3）都不相等**；Meta 里这四个是标题为“Natural China | CTS Tours”、时长 15.915s / 15.872s 的视频（挂在 CTSTOURS 主页下），而池里两条是标题“…素材候选…”的原始上传（同样 15.915s / 15.872s）。也就是说：**广告经由主页帖子发布时，Meta 生成了“衍生视频副本”，id 与原始上传不同**。快照里的 `creative_video_ids` 与 live 一致（我对了 1126238526529263、2052942792039743），所以不是快照取错字段，而是 id 本来就不同。74 号说“广告用的就是池里已批的两个”在**内容**上成立，在 **id** 上不成立。
   - **直接后果（修正我 v0.2 的一个设计缺陷）**：原稿说“视频匹配只认 `creative_video_ids` 与池条目 `ref` 精确相等”——按这个规则，今晚这 4 条广告会全部落成“未声明”，而不是“已声明 11/30”。**必须加“别名登记”（§1.8），否则 74 号的“把 A2/B3 声明成 dated 11/30”对这 4 条广告不生效。**
   - 个人号（欠款停用）名下 14 条设置上开着的广告，仍是快照口径（未 live 复核），结论只作参考。
2. **所以“默认 enforce”不能对“未声明”一刀切**：一刀切等于开关一翻就把官方户全部在投广告停掉。设计成：**已声明且已过期 → 立即自动停；未声明 → 按 PM 给的过渡截止日处理**（截止日前只提醒+禁止新启用，截止日起按过期处理）。这是 PM 唯一需要给的参数，见 §1.4。
3. **“广告 ↔ 视频”对应关系目前不全**：`ad_creative_links` 仅 4 行；广告级快照里每条广告记录了 `creative_video_ids`，**扫描可以按它找到“广告用了哪个 Meta 视频 id”**，但这个 id 常常是主页帖子产生的衍生副本，需要“别名登记”才能对回原始素材/推广期（§1.8）。

## 1. 推广期闸：默认 enforce，覆盖手工复制

### 1.1 目标行为
- 每个**客户登记的广告账户**里，所有在投广告（不论谁建、在哪建、是否复制），只要它用的**任一**视频推广期已过 → 自动暂停该条广告，留回执，给待办“已自动停 N 条过期视频”。
- 过期的口径：`promo_window.kind='dated'` 且 新西兰当天日期 **>** `end`（`end` 含当天）。
- 不是“检测”：默认 `creative_promo_expiry_mode = 'enforce'`（v0.1 的 `detect` 保留为客户级可选，用于新接入客户的试运行；CTS 默认 enforce）。

### 1.2 新内核动作 `ads.pause_ad`（A 级核心）

**为什么必须新增**：现有暂停是广告组级（`ads.pause_unit`）与系列级。一个组里常有多条视频，一条过期整组停会误伤；而 PM 要的是“正确方向的最小 MVP”，所以单条广告暂停是必要的。

- 类别：**收类**，只会让花费变少；Meta 写入 = `POST /{ad_id} {status: PAUSED}`；幂等（反复暂停无害）。
- 注册：`registry-ads.ts` 新增 `ActionDefinition<'ads.pause_ad'>`（输入：`cycle_date / ad_account_id / ad_id`；`sideEffect:'outward'`；`rollback:'provider_native'`；`idempotency.keyFields:['cycle_date','ad_id']`；`costModel` 各 step 上界 0，与现有六动作一致）；能力实现仿 `pause-unit.ts`（`snapshot_pre → apply → readback verification`，apply 先读现状：已是 PAUSED 则 noop）。
- 同步登记：`ads-autonomy-sync` 的动作清单（现有 9 个 action_key 的策略同步）、`capabilities/index.ts`、`dedicated-approval-entries`（若适用）、`envelope-facts.ts`（归属校验：该 ad 的 campaign 属于该客户登记账户）。**漏登记任何一处 = 动作存在但策略同步不到客户**（之前 9 个 key 都靠同步表；新增 key 必须一起加，并有测试断言“清单里每个 key 都有 handler 与策略”）。

### 1.3 信封：新增第三类 `compliance_stop`（A 级最敏感的一处，请重点审）

**现状**（读 `autonomy-envelope.ts`）：两类信封——AI 自治信封（20% 幅度、日上限、**72 小时冷却**、**排除学习期**、排除实验）和人工止损信封（只要求撤回处理函数存在 + 动作真的只收不放）。`HUMAN_STOP_ACTION_KEYS` 是穷举白名单，故意“默认收紧”。

**问题**：过期暂停由系统触发（不是人按）。若走 AI 信封，会被 72 小时冷却（刚改过预算）和学习期排除挡住——**过期的视频照样在烧钱**，等于闸失效。若走人工信封，又冒充“人按的”，违反 `triggeredBy` 必须来自服务端授权上下文的规矩。

**方案**：新增 `COMPLIANCE_STOP_ENVELOPE`（`kind:'compliance_stop'`），特征：
1. **只对白名单动作 `ads.pause_ad`（及“整组全过期”时的 `ads.pause_unit`）开放**，穷举白名单，新 key 默认走 AI 信封；
2. **触发身份由服务端授权上下文决定**：只有 `triggered_by='schedule'`（定时任务；`action_runs.triggered_by` 现有取值是 signal/schedule/human/agent/run，没有 system）且 `purpose='compliance'`（`purpose` 已有此取值）才进此信封；请求体里自报无效；
3. **必须带可复核的“过期事实”**：信封事实不取自请求，而由 `envelope-facts.ts` 现场计算——(a) 该 ad 当前确实 ACTIVE（读 live，不信快照），(b) 它的 `creative_video_ids` 中至少一个在素材池/工单里 `promo_window.end` < 今天（NZ）。任何一项读不到 → 视为不过，**转待办，不执行**（读不到不是“放行”）；
4. **不走冷却、不走学习期排除**（合规优先于学习稳定），**仍要求撤回处理函数存在**（撤回=重新激活，但见下“撤回风险”）；
5. **爆炸半径上限（断路器）**：单客户单次扫描，自动暂停数 > `max(3, 当前在投广告数的 30%)` → **整批不执行**，只写一条红色待办“一次要停 N 条，超过安全上限，请人工确认”。防的是“推广期数据被写错/被批量改成过去”这种一次性误伤全部在投广告的事故；
6. **不允许夹带其它变更**：请求必须是 `pause`，预算变更一律拒（同人工信封第 4 条）。

**风险与对策**
| 风险 | 对策 |
|---|---|
| 推广期数据录错（把明年写成今年）→ 误停好广告 | 批准入口校验 `end ≥ 今天`；断路器；每次停都留“依据的视频 id、推广期、读到的 live 状态”进回执；撤回路径可用 |
| 视频 id 对错（广告用的视频对应到别的条目） | 扫描只按 `creative_video_ids` 与池条目 `ref`（Meta 视频 id）**精确相等**匹配；多条目命中、或工单侧一对多 → 视为“未声明”，不自动停（宁可漏停，不错停，对应 `creative-link` 的“拿不到就空，不猜”） |
| 撤回=重新激活，会把过期广告重新开起来 | 撤回 handler 保留（结构闸要求），但 `compliance_stop` 的 action_run **禁止被系统自动撤回**；只有人工在回执页点“撤回”且二次确认，并写审计 |
| 系统误用此信封做别的暂停 | 穷举白名单 + `purpose='compliance'` 双条件 + 测试断言“其它任何 ActionKey/purpose 进此信封返回 not within” |
| 账户已欠款/停用（如个人号） | 该账户状态≠1 时不提交暂停（本来就不投放），只记“账户不可用，已跳过 N 条”，避免大量失败调用刷屏 |
| Meta 接口失败/节流 | 内核已有可重试与 `needs_human`；扫描幂等，次轮重做；连续失败 → 待办 |

### 1.4 过渡参数：未声明推广期的在投广告（唯一需要 PM 给的参数）
- 事实：此刻官方户在投 2 条、个人号 14 条设置上开着的广告，用到的视频**全部未声明**。
- 默认设计：`undeclared_grace_until`（客户配置，日期）。**到期前**：这些广告不被停，但每天出一条待办（未声明清单+去哪里补）、**禁止新启用/新建引用未声明视频的广告**；**到期当天起**：按“已过期”处理（进入同一条 enforce 路径，受断路器约束——此时数量大会触发断路器，转人工确认，不会静默停一片）。
- PM 要定：这个截止日。若 PM 不想有宽限，等于要求开关当天停掉官方户 2 条在投广告——我会在待办里标红明说后果，而不是静默照做。
- 回填：官方户 2 条先补（视频 id 已知），个人号 14 条因账户已欠款停用，建议整体标“账户不可用，不回填”，由 FDE 决定是否清理。

### 1.5 扫描怎么覆盖“手工复制”
- 数据源：`ad_entity_snapshots` 的广告级行（含 `creative_video_ids`、`effective_status`），覆盖**客户登记账户内所有广告**，与谁建无关。
- 触发：① 每天新西兰 00:05（刚过 `promo_end` 当天）；② 每次广告快照 cron 跑完之后（一天 4–5 次；需确认快照 cron 是否已发 Inngest 事件，没有则新增 `ads.snapshot.completed`）——这样 Meta 后台刚复制出来的广告最迟约一个快照周期内被发现。
- 覆盖不到的缝：快照与暂停之间的几小时；以及“用了完全不在任何库里的视频 id”的广告（按未声明处理，见 1.4）。此外 Meta 后台复制出来的广告组如果 `end_time` 晚于视频推广期，扫描同样会处理该组下的**广告**（单条暂停），不依赖广告组 `end_time`。
- 每次运行写回执：`checked_ads / expired_found / paused / skipped_account_unusable / blocked_by_breaker / undeclared_in_grace`，事件名 `ads.creative_promo_expiry.checked`；N>0 出待办“已自动停 N 条过期视频”（含每条 what/how/href）。

### 1.6 最小 MVP（A 级，DeepSeek 写；仍然分两个 PR，不是“只检测”）
**PR-1（地基）**：`promo_window` 解析器+类型+往返测试；批准入口 422；起草门；`ad-publisher` 的 end_time 封顶与启用前复核；纯函数 `promoVerdict`。
**PR-2（执行）**：`ads.pause_ad` 动作+能力；`compliance_stop` 信封+facts+断路器；每日/快照后扫描 Inngest 函数（默认 enforce，带未声明过渡逻辑）；回执+待办；cron 登记。
**不做**：自动重新激活；广告级预算/受众变更；其它客户开启（默认 off，按客户配置开）。
**两周验证**：夹具里造“昨天过期的视频 + 3 条广告（1 过期 1 未过期 1 手工复制）”，扫描必须只停 1 条且留回执；断路器用“全过期”夹具必须转人工；CTS 真实数据只读跑一次应只列出“未声明”2 条且不停；上线后首次自动运行次日查回执；第 7 天查误停（目标 0）；第 14 天看是否有“手工复制”被抓到的真实回执。**没有当场试跑跑通，不叫做好。**

### 1.8 别名登记（衍生视频副本 → 原始素材 → 推广期）
- 数据：素材池条目（或推广期注册表）增加 `alias_refs: string[]`——该素材在 Meta 上被广告实际引用的所有视频 id / 帖子 id（`effective_object_story_id`）。匹配时 `广告视频 id ∈ {ref} ∪ alias_refs` 才算命中。
- 来源（优先级）：① **ME 自己发布时自动写**（`ad-publisher` / 发帖链路拿到 post_id 后读出帖子里的 video_id，写入对应素材的别名；与 `ad_creative_links` 同一时刻，避免事后回填）；② **扫描发现“未声明视频”时**，待办里给出该视频 id、标题、时长、被哪些广告使用，由 FDE 一键“归到某素材”（受限入口，写审计）；③ 本次存量：官方户 4 条 live 广告的 4 个衍生视频 id，建议由 74 号确认归属后写入——按时长/标题推断 1126238526529263、1110954791640892（15.872s）→ B3，2052942792039743、2324048611775779（15.915s）→ A2，**这是推断，需要 74/PM 确认后才写，系统不自己写**。
- 不做：按标题或时长自动归并（会把别的视频错归）。
- 对设计的影响：PR-1 增加“别名”字段与 `promoVerdict` 的别名匹配；PR-2 的扫描与 `compliance_stop` 事实重算都按“ref 或别名”匹配；断路器与“多命中不自动停”不变。

## 2. 广告结构规则（机器可读）+ 校验函数

### 2.1 分层（平台 / 行业 / 客户）
- **平台（L1，纯函数）**：规则引擎 + 通用规则类型（“一个系列一个目标”“广告组结束日 ≤ 所用视频推广期”“同模板不超过 N”“受众互斥”“预算 ≤ 客户日上限”“命名必须匹配模式”）。不含任何旅游/CTS 词。
- **行业（L2，Playbook/Profile）**：`AdStructureProfile`——系列阶段枚举（养池/转化/再营销）、广告组维度（“团 × 受众类”）、受众类枚举（冷/暖）、模板族名单、每组广告条数范围、命名模式。旅游版写一份；物流（NAL）另写（看消息不看留资，结构不同）。
- **客户（L4，配置）**：团名/班期列表、受众具体 id 与排除名单、命名里的客户前缀。

### 2.2 规则表（每条一个稳定 id，可单独开关、可标 block/warn）
| id | 层 | 内容（来自 74 号 §2） | 默认 |
|---|---|---|---|
| S1 | 系列 | 一个系列只有一个目标阶段；不同目标不混 | block（新建） |
| S2 | 系列 | 不设系列预算（ABO），各组独立预算 | block（新建） |
| A1 | 组 | 一个组 = 一个维度键（团）× 一个受众类 | block（新建） |
| A2 | 组 | 受众互斥：暖排冷、全部排除“已付/不再联系/即将出行”名单 | block（新建） |
| A3 | 组 | 一个组一个预算、一个结束日 | block |
| A4 | 组 | **结束日 ≤ 所用视频中最早推广期末**（与 §1 同源，复用 `promoVerdict`） | block |
| D1 | 广告 | 一个组 2–3 条广告；同模板 ≤ 2 | warn→block（试运行两周后） |
| D2 | 广告 | 新素材另建新组，不往在投组加 | block |
| D3 | 广告 | 每条广告必须写入 `ad_creative_links` | block |
| N1 | 命名 | 匹配 Profile 的命名模式；utm_content 规则 | 新建 block；存量 warn |
| B1 | 预算 | 总额 ≤ 客户日上限；单次改幅/72h/冻结遵守内核信封 | 沿用内核，不重复实现 |

### 2.3 校验函数（纯函数，三处复用）
```
validateAdStructure(profile, tree, mode) → Violation[]
  tree = 规范化的 { campaigns[ { adsets[ { ads[ … ] } ] } ] }（草稿或快照都能转成它）
  Violation = { ruleId, severity:'block'|'warn', entityRef, message(人话), evidence }
```
- **建组/建广告前**（`ad-publisher` / `draft-and-gate`）：对“即将创建的草稿树”跑，任何 block → 拒绝创建并说明；
- **每日审计**：对快照还原的树跑，存量对象的 N1 等历史不合规一律 `warn`，**只对新建对象 block**（否则一上线就把所有老广告判违规）；输出进“广告结构”待办（去重，不天天重复提醒）；
- **请求合同**：生成 `creative_request`/`budget_request` 前先校验，不合规的请求不发出。
- 数据缺口：快照里没有“团”“模板”“受众类”标签 → 来源：①命名解析（仅存量审计，低置信）②工单（新建，高置信）。**拿不到标签的对象不判，标“无法判定”，不猜。**

## 3. 动作请求合同

### 3.1 先复用，不重造
下游“回执”已有成熟载体：**内核 `action_runs`**（预算/受众/暂停类）、**`execution_items` + `POST /api/clients/[id]/execution` + `promo_ref`**（105 号 10-18 确认：开着、带闸、不建生产包）、工厂工单。因此合同只新增**一张薄索引表 `ad_agent_requests`**（谁请求了什么、现在到哪一步、指向哪个下游记录），**不复制回执**——回执仍在下游，索引表存引用，避免两份真相。新表走 service_role RLS 模板（`FOR ALL TO service_role`）。

### 3.2 通用信封（五类共用）
`request_id`（uuid）· `client_id` · `request_type`（budget|audience|creative|page|seo）· `created_at` · `created_by`（agent 名 + 版本）· `diagnosis_ref`（哪次诊断/哪条规则 id）· `evidence[]`（{来源表, 行 id/日期窗口, 指标名, 值, 数据日, 新鲜度}）· `rationale`（一句人话）· `expected_effect`（{指标, 方向, 验证窗口 T+7/T+14}）· `constraints`（`no_publish:true` 恒真；`promo_end`；`brand/tone` 引用）· `approval`（{required_by:'auto'|'kernel'|'pm', status, approver, decided_at}）· `idempotency_key`（类型+对象+诊断日）· `status`（requested→accepted→executing→fulfilled|rejected|expired|failed）· `downstream_ref`（{kind:'action_run'|'execution_item'|'work_order'|…, id}）· `receipt`（见 3.4）。
- 所有请求**默认 `no_publish:true`**：Agent 只出请求与草稿；发布/开投/加预算只认 PM 本人原话。
- 过期：请求自带 `valid_until`；过了就 `expired`，不再执行。

### 3.3 五类请求
| 类型 | 载荷（payload） | 谁批准 | 下游 | 事件名 |
|---|---|---|---|---|
| budget | `{entity_ref, direction:'cut'|'pause'|'scale', from_cents, to_cents, reason_code}` | 收类（降/停）= kernel 自动（信封内）；放类（加预算/scale）= **PM 本人** | 内核 `ads.*` → `action_runs` | `ad_agent.budget_request.created` |
| audience | `{op:'create_exclusion'|'create_lookalike'|'update_exclusion', source_ref, exclude_refs[]}` | 创建/更新排除名单：广告 Agent 自执行但走内核留回执；**涉及上传客户名单（个人数据）= PM 批准** | 内核（待定动作）/广告 Agent | `ad_agent.audience_request.created` |
| creative | `{dimension_key(团), angle, taboo[], promo_window, template_family, count, based_on:ranking_ref}` | 工厂产出后：**苏东坡质检 → PM 批准入池**（Agent 不放行） | `execution_items`（素材缺口任务）→ 工厂工单 | `ad_agent.creative_request.created` |
| page | `{page_ref, block, change_type, reason, evidence_ref, tour_slug?}` | **PM 批准上线**；Agent 出草稿+预览 | 网站 Agent 的变更草稿 | `ad_agent.page_request.created` |
| seo | `{keyword/page_gap, intent, evidence(DataForSEO 快照≤14天+SERP), target_page?}` | 信息完整闸门不过则不发；发布 **PM 批准** | SEO Agent | `ad_agent.seo_request.created` |

### 3.4 回执字段（每条请求最终都要有）
`request_id · status · executed_at · actor(kernel|agent名|人) · approver · downstream_ref · cost(provider影响，广告花费不计入) · no_publish · result_summary(人话) · verify_due(T+7/T+14) · verify_status(pending|confirmed|reversed|inconclusive|unmeasurable) · error(若有)`。
- 终态事件：`ad_agent.request.fulfilled / rejected / expired / failed`，均带 `request_id`。
- **T+N 对账**：到期后写 `confirmed/reversed/inconclusive/unmeasurable`，**不写因果**；只有 confirmed/reversed 才允许更新规则权重（复用 memory-extractor 的 proven/failed 通道，三层分开）。

### 3.5 Inngest 与失败闭合
- 请求创建 = 事件（上表）；各 Agent 消费者幂等（以 `request_id` 去重）；
- 没有 PM 授权事件和下游回执，**不许伪造 fulfilled**；执行类缺授权一律停在 `requested/accepted`；
- 不上 Inngest 的例外：纯展示、单次同步读取。

## 4. 风险与未核实
- **A 级、碰钱**：`compliance_stop` 信封是本稿最敏感处——它是“系统在没人点的情况下停真实广告”的授权。必须：穷举白名单、服务端身份、现场重算过期事实、断路器、禁止自动撤回，缺一不可。
- 快照滞后：官方户广告级快照最新一轮停在 10/20 06:31Z，早于今晚新建的广告——扫描依赖快照时必须先判新鲜度，过旧就改走 live 读取（`ads_get_ad_entities` 同类的服务端读取）或先刷新快照，不能拿旧快照当“现在在投”。
- 我没核实：快照 cron 是否已发 Inngest 事件；`ads-autonomy-sync` 里新增 action_key 的确切登记点（读过名单的写入形态，没逐行读实现）；`dedicated-approval-entries` 是否适用 `ads.pause_ad`；Meta 对已被暂停/已归档 ad 的 `POST status` 返回形态。
- 现在 enforce 对 CTS 的实际影响：官方户 2 条在投广告“未声明”→ 取决于 PM 的过渡截止日（§1.4）。
- 个人号账户已欠款停用：设置上开着的 14 条广告不会投放，本设计只记不停；是否清理由 FDE 决定。
- 与既有 PM 规则一致性：10-14 “CTS 广告禁用还剩几周/倒计时”仅约束文案，推广期是内部有效期。

## 5. 平台层级（Inline）
挂在“广告”支柱的 Act/Check 段：规则引擎、`promoVerdict`、`compliance_stop` 信封、请求索引都是 L1 平台通用；结构 Profile 属 L2（旅游、物流各一份）；团/班期/受众 id/命名前缀属 L4 配置。共享代码不含客户名、日期、团名。已有候选（“素材智能”）下扩展，不另登记。

## 6. Reuse Statement（设计阶段）
复用：内核 `registry-ads / autonomy-envelope / envelope-facts / ads-autonomy-sync / action_runs`、`ad_entity_snapshots.creative_video_ids`、`creative_pool` 批准入口、`/execution + promo_ref`、`ad_creative_links`、`memory-extractor`、`campaign-ownership`、`account-status`。新增（若采纳）：`ads.pause_ad`、`compliance_stop` 信封类别、`validateAdStructure`、`ad_agent_requests` 索引表、`promo_window` 字段。
