# Magic Engine — Roadmap（未完成事项）

> 最后整理：2026-08-01（并入 main 一周新增）· **本文件只留未完成的事**（162 条）。
> 已上线的功能见 [history/CHANGELOG.md](./history/CHANGELOG.md)。
> 系统当前跑着什么见 [STATE.md](./STATE.md)。架构决策见 [DECISIONS.md](./DECISIONS.md)。
> 完整历史底稿（含 344 条已完成 + 全部 Phase 背景）：[archive/ROADMAP-full-2026-07-25.md](./archive/ROADMAP-full-2026-07-25.md)

**新增任务的规则**：先登记到本文件，再写代码。完成后从本文件删除、追加到 `history/CHANGELOG.md`。commit 带 Phase ID，如 `feat(ads): xxx [P18.B.1]`。

> ## 🔴 Roadmap 全局约束：Reuse First / Platformization
>
> 本文件**所有未完成事项**都受 [ME2 Reuse & Platformization Principle](./roadmap/2026-08-19-me2-platformization-principle.md) 约束。真实客户与 Customer Zero 用来验证平台能力，不得默认演化成客户特供系统；未来 **ME Real Estate / ME Travel** 等垂直版本必须建立在同一共享底层上。
>
> **开工顺序固定**：`Repository Fact Gate → Domain Semantics Gate → Product Gate → Architecture / Reuse Gate → GO BUILD`。
>
> - Current State Audit 第一行必须报告 `remote fetched at + exact main SHA`；没有 SHA，审计不成立。
> - 复用 shared Module / Capability 前必须检查内部语义是否仍 hard-code 首个客户/行业；接口参数化不等于语义通用。
> - 默认共享 Capability、Adapter / Connector、Kernel、Measurement/Growth Contract、Verification / Attribution / Flywheel 与可安全泛化的 Learning / Memory 机制。
> - 行业差异进入 Playbook / Profile / Policy；客户差异进入 configuration / approved evidence / client-private memory。
> - 每个有实质产出的交付必须附 **Reuse Statement**：说明复用了什么、哪些是 platform-shared / industry-specific / client-specific，以及有没有客户名、客户 ID、行业规则或客户私有事实进入 shared runtime。

---

## Creatomate Connector 落地后续

> 代码见 [docs/specs/2026-09-09-creatomate-connector-spec-v1.md](./specs/2026-09-09-creatomate-connector-spec-v1.md)（spec v2）。2026-09-13 端到端真实验证已跑通（PR #1570/#1594/#1604，见 memory `project-cts-video-factory-decision-ledger` 完整记录），下面只留还没做完的。

- [x] `CREATOMATE_API_KEY` 已配进生产（PM 2026-09-12 确认）
- [x] webhook payload 真实字段结构已通过多次真实渲染验证，正常工作
- [x] 至少一个试点客户（CTS）已在 `factory_config.render.creatomate` 配好 template_id + scene_field_map，多次真实渲染成功
- [x] 镜头槽位入场/推拉动画已确认真实存在（模板源码里每个 Still-N 都有 scale 动画，2026-09-13 直接读取模板源码确认，不再是假设）
- [ ] 找 Creatomate 客服或后台账单确认超出 2,000 credits/月后的真实计费行为（硬顶拒绝还是继续扣钱）（spec §6.2）
- [ ] `pickRealPhoto`/`loadRankableClientAssets` 补一道质量分门槛（`client-asset-pool.ts` 的 `MIN_QUALITY=5` 口径目前真实照片路径没用上）
- [ ] `PreparedScene.visualSource` 接入人工分镜自检表 UI，让 FDE 逐镜看时能分清"这镜是真图"
- [ ] `pickRealPhoto` 内部调用 `rankAssetsByPrompt` 的 `gpt-4o-mini` 排序成本（分钱级）没有计入 `content_factory_render_jobs.cost_usd`
- [x] CTS 真实素材库缺 Hutong（Still-5 专属）、西安城墙（Still-6 专属，不是兵马俑）的真实照片——2026-09-13 发现公司自己的 Dropbox 素材库（`CTS/footage/photos/`）里其实早就有 2 张胡同 + 1 张西安城墙真实照片，只是从未录入 `client_assets`，不需要去 Unsplash 找。已上传+PM 过目确认+标记 `client_verified`。**注意**：这两个landmark 目前仍不在 `factory_config.render.creatomate.scene_field_map`（该客户脚本目前只生成 4 个镜头，对应 Still-3/4/7/8），要真的让这两张照片出现在成片里，还需要把内容生成扩到 6 个镜头并给 Still-5/Still-6 各加一条 `scene_field_map` 条目——这是下一步待决定的事，不是"现在已经在用"
- [x] 那个已确认"退役但没真的关掉、还在偷偷抢渲染任务"的老 Render 服务（`content-factory-render-worker`）——PM 2026-09-13 拍板彻底删除，已在 Render 后台执行删除，服务已不存在
- [ ] PM 拍板"AI 配音统一用 ElevenLabs"，账号免费版无法通过 API 调用任何声音——PM 2026-09-13 拍板暂不升级付费，先维持现状；CTS 出片全程仍未真正测过配音这一步
- [ ] "多开发不同模板"：PM 不想招人代画，已验证 Creatomate 模板编辑页的 Code 视图（`{}` 图标）能直接读出完整模板 JSON 源码，理论上也能反向粘贴编辑保存，但只验证了"读"，没验证"改并保存"这一步
- [x] 背景音乐——2026-09-13 发现模板其实自带一个通用的 `Music` 音频图层（此前的模板结构记录漏记了这个，只记了画面/文字元素），PM 上传了 3 首新曲目到 Dropbox（`MagicLab_Studio/Music/`），已全部转存到正式素材库，PM 选定 `Horizon's Call` 作为默认背景音乐，通过已有的 `static_overrides` 机制接入（不需要改代码），已用真实渲染验证音轨确实有声音且不是哑的
- [x] 片尾信息（团名/路线/天数价格/出发日期）此前 100% 是模板作者写死的示例内容，从不随视频变化——新增 `CreatomateTemplateContract.requiredPostFields` + `content_posts.generation_context_snapshot.endcard`（PR #1613），每条视频可以有自己真实的片尾内容，缺字段直接拦渲染不许静默套用旧内容。已用两条真实渲染验证（"Best of China"/"China Awaits"两条视频片尾信息各自正确、互不相同）
- [x] 🔴 早前记录"MUAPI_API_KEY 缺失是低频 P3"是错的判断——2026-09-13 当天晚些时候真正用全新脚本出片（不复用旧 scenes）才发现真正根因：`loadRankableClientAssets`（自动选真实照片）的数据库查询有 bug，把 47 张已核实真实照片里的 46 张误判成"视频"过滤掉了，池子实际只剩 1 张，几乎每次都会命中"配不到真实照片→AI 现画兜底"这条路，而不是低频边缘情况。已修复（PR #1615）：改成跟同文件另一处已经写对的逻辑一致的判断。修复后验证：真实照片池从 1 张恢复到 50 张，两条全新脚本各自正确匹配到长城/故宫/兵马俑/上海真实照片。`MUAPI_API_KEY` 本身仍未配置，但命中率修复后应显著下降，不再是当天最紧迫的事
- [x] 上一条遗留的 `MUAPI_API_KEY` 缺失当天晚些时候真的命中了三次（全新脚本每次都触发一个镜头配不到真实照片、回退现画、卡在 Muapi 图生视频缺密钥）——2026-09-13 PM 直接在 Render 后台补上，已用真实渲染验证 Muapi 回退路径恢复正常
- [x] 片尾信息此前虽然有 `requiredPostFields` 机制（PR #1613），但全仓库没有任何代码真的往 `content_posts.generation_context_snapshot.endcard` 写值——此前两次"验证通过"全靠人工手写数据库代填，等于每条视频出片前都要一次人工介入，撞了 CLAUDE.md「FDE/PM 要填的字段必须连 Settings UI 一起做完，不能进 Supabase 后台直填」这条红线。新增 `CreatomateTemplateContract.offers`（按团/出发城市变体分的真实事实字典）+ `postFieldSources`（元素名→事实字段映射）+ 自动写入机制（PR #1632，子牙+魏征两轮设计复审 + 实施后复审共抓出 3 处真问题都已修）：这几个字段现在是纯函数确定性映射（不走 LLM，杜绝幻觉/改写风险），且"没指定用哪个团 + 客户配了 ≥2 个团"时 fail-closed 抛错，不会猜一份不相关的事实套上去。已用真实渲染验证：`endcard` 自动写对（团名/路线/价格/出发日期全部正确且互不相同），零人工数据库写入
- [x] 上两条遗留全部补完（PR #1642）：①`client-config.ts::mergeFactoryConfig` 的 Settings UI 写入路径此前确实没有回写 `static_overrides`/`required_post_fields`/`offers`/`post_field_sources`——已修，四个字段现在按"没带就沿用已存值、带 null 就清空、带合法值就覆盖"的语义正确合并。②新增结构化"资料包"管理界面（设置页 → 内容 tab → 视频工厂配置）：FDE/PM 自己就能增删团/档位及其真实字段，不用再找工程改代码；内容工厂看板"确认做"这一步新增归属下拉框（`content_posts.generation_context_snapshot.offer_key`），客户配了 ≥2 个资料包时必须先选。实施后复审（对抗性）额外抓出并修复两个真洞：offer_key 写入前不校验是否存在于客户配置里（会让选错/选到已删档位的视频混进渲染队列，等 Inngest 任务异步失败才发现——已改成确认那一刻同步 400 拦下）、资料包表单里档位名重复会静默互相覆盖（已改成阻塞报错）。CTS 真实的 7 个在售团（Golden China / 圣诞团奥克兰+基督城 / Best of China / 丝路 / 双城记 / 上海周边）已从 `config/clients/cts/offerings.yaml`（见下面"内容/私信"分组的说明）导入配置好，用真实产品数据在生产环境跑通完整闭环验证（UI 选团 → 自动核对 → 自动填对片尾信息 → 渲染成功）。
- [ ] 上面这次发现：CTS 现在有**两套**"这个客户在卖哪些团"的真实事实存储——视频工厂这边（`factory_config.render.creatomate.offers`）和私信回复 Agent 那边（`config/clients/cts/offerings.yaml`，#1577）各存一份，语义高度重叠，以后团有变动要改两个地方，容易漏改。建议后续把其中一份定为唯一真相源，另一份改成读它、不再各自维护。
- [ ] 真实照片排序（`rankAssetsByPrompt`）疑似没有匹配度门槛，会把明显文不对题的照片当"匹配成功"返回（如故宫文案配上长城照片、兵马俑文案配上梯田照片，`reason` 字段自己写的解释都文不对题）——2026-09-13 诊断发现，已建独立任务调查范围和优先级，不在这批改动里处理
- [ ] NAL（New Asian Logistics，物流客户）首次接入视频工厂——PM 拍板"先用现有真实素材做1图1视频"，2026-09-13 已完成（真实素材取自 NAL 自己的 Facebook 主页，走 ffmpeg 本地合成，未走 Creatomate，NAL 没有专属模板）。素材偏薄（只有1张车队照+1条员工讲解视频），正式量产前建议向客户要更多真实素材

## 新客户 Meta 广告户接入 — SOP 已验证，ME 操作侧步骤待并入后台流程

> 背景：2026-09-13 给 Magic Picks 接入 Meta 广告户时，实测走通了"业务账户互为合作伙伴"路径（不用建应用、不用踩系统用户挂应用的死循环），写成 [`docs/sops/client-meta-ads-onboarding.md`](./sops/client-meta-ads-onboarding.md)，同一时间另一个并行会话把系统用户按客户隔离（角色必须"员工"不能"管理员"）、`leads_retrieval`/`pages_manage_ads` 权限、令牌命名规则等真实事故教训也补全了。PM 拍板：这份 SOP 要变成 ME 后台"新客户引导流程"里的一步，不能一直靠人读文档手动点。

- [x] 客户方那一半（把资产 Partner-share 给 Magic Engine）已有自助页面 `src/app/authorisation/page.tsx`，文案和步骤已经和 SOP 对齐（`META_BUSINESS_ID` 常量一致）
- [ ] ME 操作侧那一半（确认资产到账 → 建员工系统用户 → 分配资产 → 生成令牌 → 令牌写进 Render → 广告户写进 `clients.meta_ad_account_id`）目前全靠 SOP 文档人工按步骤点，还没有任何后台 UI/脚本辅助——评估要不要做成一个"新客户接入"向导页（读 `client_meta_ad_accounts` + `clients.meta_ad_account_id` 状态，缺哪步提示哪步），或者至少先把「客户已共享资产但 ME 还没确认」这个等待态接进 `src/lib/pm-todo/client-doc-manual-tasks.ts`（SOP 里已经要求这么做，但目前是"要求 ME 操作人手动记得加"，没有代码强制）
- [x] Magic Picks 是第一个用这条新路径接入的客户；2026-09-13 完成 ME 操作侧全部步骤——但走的是**「复用共享系统用户」**这条备选路径，不是 SOP 原本设计的「专属系统用户」路径：
  - 广告户 `act_2120170612255462` 分配给 Magic Engine 现有的共享系统用户 **MagicEngine**（Admin 权限，Facebook 用户编号 61590843864555），权限"完全访问权限"——没有新建 Magic Picks 专属系统用户，原因见下面新增的风险项
  - 用 Magic Engine App（App ID 1752513682785923）为 MagicEngine 系统用户生成一个"永不过期"令牌，含 8 项权限（`ads_management` `ads_read` `business_management` `pages_read_engagement` `pages_show_list` `read_insights` `leads_retrieval` `pages_manage_ads`）
  - 令牌已写入 Render crazycontent 服务的环境变量 `META_SYSTEM_USER_TOKEN_MAGICPICKS_CO_NZ`，并已触发重新部署
  - 用 Graph API Explorer 验证过两项：`/me` 返回 MagicEngine 系统用户信息（健康检查通过）；`/act_2120170612255462/insights` 无权限报错（返回空数据是因为广告刚发布还没花费，不是权限问题）
  - `clients` 表 Magic Picks（`client_id` = `71b5ec11-3abc-4ae8-9ea2-563219228f3a`）的 `domain` 已补成 `magicpicks.co.nz`（令牌环境变量命名规则要求），`meta_ad_account_id` 确认为 `act_2120170612255462`
  - 这是"新客户接入 Meta 广告数据到 ME 后台"这条路径第二次实际跑通（第一次是 CTS/Oztop，走的是更早/不同的路径）
- [ ] 🔴 新增风险点：Magic Engine 的 Meta 企业账户目前"未验证"（业务验证状态），导致给 Magic Picks 建专属系统用户时被 Meta 拦截，报错提示"名字无效"具有误导性——实际原因是企业未认证时可建的系统用户数量受限，不是命名问题。PM 拍板跳过企业认证、改走"复用共享系统用户 MagicEngine"这条路完成了 Magic Picks 接入，但只要企业账户一直不认证，**未来所有新客户都只能走这条共享路径**，做不到 SOP 原本要求的"每客户独立系统用户/令牌"隔离——需要决定是否要推进 Meta 企业验证，还是把"复用共享系统用户"正式定为默认路径并更新 SOP 文档

## CTS Meta CAPI — CRM 表格数据源接入（PR #1597，dry_run，未 merge）

> 背景：`me_sale_outcomes`/`me_conversion_writebacks` 表结构（Issue #1397）2026-09-05 已定稿，
> 本次会话（2026-09-13）apply 到生产库并跑完 5 项自验。这条待办是给它接第一个真实数据源：
> CTS 人工维护的 Google Sheet（FB 即时表单留资 + 员工跟进记录）。设计经子牙+魏征两轮独立
> 复审后实施，详见 PR #1597 描述。

- [ ] PM 确认 `source_kind='crm_sheet_sync'` 命名（或改用别的名字）——迁移
      `supabase/migrations/20260913000001_conversion_source_kind_crm_sheet_sync.sql` 已写好未 apply
- [ ] PM/FDE 把 Google Sheet 分享给 `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` 里的 `client_email`（查看者权限即可），
      并把分享设置从"任何人可查看"改成限定名单（顺手修的安全问题，跟本任务本身无关）
- [ ] 确认 GCP 项目里 Sheets API 已启用
- [ ] 上面三条做完后，用 `POST /api/admin/conversions/cts-crm-sync` 真实跑一次，核对 `/dashboard/conversions`
      审核页面上的记录是否看得懂、数字是否对得上（这一步之前代码从未接触过真实 Google Sheets API 响应）
- [ ] 实测发现：`阶段Stage` 列 1599 行只填了 1 行，`阶段更新日` 列 100% 空白——"已成交"检测目前几乎找不到信号，
      是表格填写现状不是代码问题；等 PM/FDE 开始真正使用这两列，成交同步会自动生效，不需要改代码
- [ ] 若未来这条同步的记录量明显起量（不再是当前的 0-1 条成交/次），"查不到价格/缺日期"的搁置项要不要
      升级成正式的 `pm-todo` manual item（而不是只在同步响应里一次性返回），需要重新评估

## CTS Messenger+WhatsApp 治理式客服 v3 —— 事实层改用客户知识库平台能力（2026-09-14）

> 完整方案（v1/v2/v3 全在一份文件里，v3 = WhatsApp 双渠道扩容 + 9 条必补项 + §9.14 C 客户
> 知识库同步修订）：`~/.claude/plans/cts-tours-messenger-dynamic-pearl.md`（不在仓库里，
> 本地文件）。平台层级登记：[docs/registry/platform-candidates.md](./registry/platform-candidates.md)
> 第 79 行（Governed Lead-Reply Agent）。跟踪 issue：
> [#1290](https://github.com/bigbigraydeng-maker/magic-engine/issues/1290)。

**进度**：方案已过子牙+魏征 2 轮复审 + 板桥客户视角复审，Build Gate 五关走完，拆成 18 个
GitHub issue（#1574-#1592）。**wave-1/wave-2 共 7 个 issue 已合并到 main**：数据库表结构
（#1628）、跨渠道退订检测（#1625）、对话分类逻辑（#1621）、CTS 团清单资料层（#1626，**已
作废，见下**）、channel-dispatch 查表分发（#1636）、WhatsApp webhook 退订+事件接线
（#1637）、Messenger webhook（#1640）。

**2026-09-14 重大变更**：开发过程中发现 #1577/#1626 的 `offerings.yaml` 事实层方案跟一条
更早的真实 PM 决策（`docs/DECISIONS.md` 2026-09-13 记录："客户知识库作为 Governed Lead-Reply
Agent 的事实层，替代 offerings.yaml 路线"）矛盾。PM 拍板"一步到位建客户知识库平台能力"
（独立 L1 候选，见 [docs/registry/platform-candidates.md](./registry/platform-candidates.md)
及本文档下一节"客户知识库"），6 步建设中前两步已合并：
- [x] Issue #1643 敏感度检测器 —— PR #1650 已合并
- [x] Issue #1644 表结构 + `getClientKnowledge` 读取入口 —— PR #1652 已合并（过子牙架构+
      魏征挑刺+狄仁杰攻击验证三方复审，合并前修了邮箱比较缺 trim、身份唯一性设计跟冲突
      检测需求冲突两处真问题；确认人登记写入 API 尚未建，见 issue #1669）

本方案 Layer 1（事实层）/2（4 只读工具）/3（五闸）/4（F1 auto-ack）/5（daily-todo 复核栏）
六处已改接 `getClientKnowledge`，`config/clients/cts/offerings.yaml` 及其加载器整条路线
已作废（详见方案文末"§9.14 C 同步修改"章节）。

**Held 待重做的 PR**（依赖 `getClientKnowledge`，等它合并后改接）：
- [ ] #1638 Verifier 框架 + CTS policy —— 改接新的 `forbiddenFactKeys`/数字核实闸设计
- [ ] #1639 agent-core prompt.ts + tools.ts —— 4 只读工具改用 purpose+visibility 模型

**审查过程发现并已修复的关键问题**（wave-1，不是走过场，逐条真实验证）：数据库外键漏写级联
删除；退订判断第一版设计换渠道即失效（已改用现成的 `contacts.do_not_contact` 机制）；CTS
团清单目录名（`cts`）跟数据库客户 ID（UUID）对不上会导致整套功能在生产环境直接报错。

**已知但不阻塞的后续项**：
- `optout.ts` 的撤销入口/分页/写路径归属校验三项小缺口，详见 issue #1290 评论
- 确认人登记写入 API（issue #1669，P3，随 #1645/#1646 排期）

- [ ] 剩余 issue（Verifier 治理层重做、Inngest 编排 4 函数、Messenger/WhatsApp webhook 剩余
      接入、门户 UI、dry-run 验证、Delivery day 灰度切换）——客户知识库剩余 4 步（#1645 萃取
      工作流 / #1646 FDE审核+客户确认页 / #1647 brief.ts 去 CTS 化 / #1648 rollout）见下一节
      "客户知识库"，进度共享同一个 ROADMAP
- [ ] Meta 企业验证仍未通过（issue [#1299](https://github.com/bigbigraydeng-maker/magic-engine/issues/1299)，需要 PM 本人上传公司文件）——不卡继续开发，但卡 Messenger/WhatsApp webhook 真正上线那天

## 客户知识库（Client Knowledge Base）—— L1 平台能力，6 步建设中（2026-09-14）

> 方案：`~/.claude/plans/client-knowledge-base-capability.md`（本地文件）。PM 2026-09-13
> 拍板："长期来看 Magic Engine 后台一定要有自己的客户知识库这样的专门存储，一步到位按正确
> 做法建"。让 AI 对客户说价格/时效/承诺/政策类事实前，必须先过"ME 内部批准+客户本人确认"
> 双签闸——直接解决了 CTS "AI 报停售团价格"这类事故的根因（AI 靠训练数据背景知识乱编，不是
> 靠受控事实源）。

**6 步进度**：
- [x] 步骤 1（issue #1643）敏感度检测器 —— PR #1650 已合并
- [x] 步骤 2（issue #1644）表结构 + 读取入口 —— PR #1652 已合并
- [x] 步骤 3（issue #1645）萃取工作流（Inngest，从 Messenger 对话里提炼知识候选）—— PR #1671
      已合并。移植自另一窗口 PR #1616 已过魏征复审的核心算法，改接真实
      `detectSensitivity()`/`checkBudget()`，并经过新一轮子牙+魏征复审又修了 6 处真问题
      （PII 脱敏对英文地址完全无效、entitlement 检查顺序、进程崩溃恢复缺口等）。PR #1616 已
      关闭并 credit。
- [ ] 步骤 4（issue #1646）FDE 审核页 + 客户确认页（客户对外可见，需板桥复审）
- [ ] 步骤 5（issue #1647）`brief.ts` 去 CTS 化 + CTS 历史事实迁移 —— **已有两个重复实现**
      （PR #1623 已关闭 credit 给下方 PR；PR #1629 已合并作为紧急修复主线，`brief-client-
      facts.ts` 临时文件明确标注等本步骤替换）
- [ ] 步骤 6（issue #1648）rollout 阶段

**后续跟踪**：issue #1669（确认人登记写入 API，P3）。

## ME Web Intelligence v0.1 [ME-WI.0.1] — #1497

- [ ] Latest-result follow-up: show newest signal per page/direction including ignore; collapse earlier records without implying they are resolved. Read-only presentation, risk C, based on main bd6d3c4e47ae4d02feccabc9dcb88aabb744c1c6 fetched 2026-09-09.

- [ ] Readable UI follow-up: result-first views, collapsed configuration/evidence, Chinese future interpretations; locally verified, pending review/production release. Hiring/People/Partnership/Reviews/Technology collection remains a separate extension.

- [x] Implementation merged (#1500); production migration and CTS-only pilot explicitly approved and enabled. Existing Industry Baselines UI → Inngest → Apify → immutable snapshot/evidence → actual cost settlement verified on Wendy Wu homepage. Compatibility fixes #1506/#1507 deployed. [Implementation / rollout receipt](./specs/2026-09-09-web-intelligence-v01.md).
- [ ] Verify an actual later website change through LLM classification/recommendation; do not manufacture live evidence. One UI draft-refresh follow-up remains deferred; queued-run target recheck and content-limit failure settlement are implemented and regression-tested. Hiring/People/Partnership/Reviews/Technology remain future extensions. No automatic action.

## ME Web Intelligence 多管道外部情报 [ME-WI.0.2]

> **新需求登记（2026-09-11）**：WI 是面向高级客户的外部市场情报与竞争预警能力，不能收窄成竞品官网抓取。范围新增主流新闻媒体、行业新闻、行业杂志、招聘信息，并逐步接入 SERP、公开广告库、AI 可见度和口碑。完整需求与分期见 [多管道外部情报需求 v1](./specs/2026-09-11-me-wi-multichannel-intelligence-v1.md)。

- [ ] **ME-WI.0.2-A**：统一 source / observation / evidence / event 契约、来源等级、新鲜度、去重、运行状态与结果呈现。
- [ ] **ME-WI.0.2-B**：主流新闻、行业新闻、行业杂志/行业网站采集与事件抽取；旅游行业首批纳入 Travel Today 等垂直来源。
- [x] **ME-WI.0.2-B0**：完成首批 Apify Actor 适配和 Travel Today、TRAVELinc、Tourism New Zealand 来源登记；待生产 migration、真实小样本和调度验收。
- [ ] **ME-WI.0.2-C**：首期接入新西兰 SEEK、Indeed 公开招聘信息，识别组织与战略领先信号，并明确不等同于已发生业务事实。
- [ ] **ME-WI.0.2-D**：SERP、公开广告库、AI 可见度、口碑接入统一事件模型，复用既有 provider，不恢复已退役 `ai-tracker`。
- [ ] **ME-WI.0.2-D1**：通过 Apify `themineworks/similarweb-scraper` 接入竞品网站流量方向信号；仅保存域名级公开估算、变化率、来源结构和主要国家，标记低置信度，不将其解释为真实访问量、销售影响或 NZ 精确市场流量。已完成小样本验证、统一 observation/snapshot、经营 Agent 页面展示、历史趋势和默认关闭的月度调度；下一步做小样本线上验收，再决定是否打开 `WEB_INTELLIGENCE_TRAFFIC_ENABLED`。
- [ ] **ME-WI.0.2-E**：跨来源事件聚合、高级客户预警与周度情报摘要。
- [x] **ME-WI.0.2-F0**：登记 Facebook Group 受控情报源契约；仅支持客户授权导出或 Meta 审批后的接入，不实现绕过权限的社交抓取。
- [ ] 每条管道必须完成“采集 → 证据 → 时效 → 变化分析 → 结果呈现”，保持只读、建议型、人工复核；不自动执行外部经营动作。

## ME2 — Roman GEO / AI 可见度参考闭环（史诗 [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872)）🔄 GEO 测量线已跑出首个生产 baseline（WP08）

> **新窗口开工前必读**：[WP00 契约冻结 v1.0](./specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md)。
> 它冻结了七层边界、五个概念结构、禁令清单与未决登记表，**后续每个 WP 从那里取自己的边界，不重新讨论**。

**治理规则（跟本仓其它 Phase 不一样，别照惯例办）**：
- 架构、PR 边界、验收与合并决策归 **ChatGPT Build Control Room**；**不要自行启动任何 WP**，等它明确授权。
- 一个 Claude 窗口 = 一个已授权的 WP / PR。
- 生产 migration 的 apply 是**单独授权的运维动作**，必须 PM 显式 `go`，**绝不夹带进任何 PR**。
- 🔴 **PR [#844](https://github.com/bigbigraydeng-maker/magic-engine/pull/844) 不许合并**（独立 Website Growth Agent 架构已被本史诗取代），也**不许从它摘代码**。

**已合入 `main`**（下面注明哪些真跑过、哪些仍不活动；另见 [STATE.md §3.1](./STATE.md)）：
- ✅ WP00 [#873](https://github.com/bigbigraydeng-maker/magic-engine/issues/873) 契约冻结（PR #888，docs-only）
- ✅ 执行内核 v1（PR #863）—— 生产 migration **未 apply**、**无提交 / 执行调用方**。⚠️ 但**已有一条只读接线在生产跑**：`pm-daily-todo` cron 经 `pm-todo/manual-items.ts` 读 `action_runs` 生成交接待办（表不存在时报错被吞成警告）。详见 [STATE.md §3.1](./STATE.md)
- ✅ WP01 [#877](https://github.com/bigbigraydeng-maker/magic-engine/issues/877) 纯 Growth 契约（PR #890 / `700f57e`）—— `src/lib/growth/`，**仍零 importer、不活动**
- ✅ **WP02** [#876](https://github.com/bigbigraydeng-maker/magic-engine/issues/876) GEO 测量运行时契约（PR [#894](https://github.com/bigbigraydeng-maker/magic-engine/pull/894)）—— `src/lib/geo-measurement/`。issue 已关闭
- ✅ **WP03** [#875](https://github.com/bigbigraydeng-maker/magic-engine/issues/875) 不可变测量存储（PR [#897](https://github.com/bigbigraydeng-maker/magic-engine/pull/897)）—— `src/lib/geo-measurement-store/` + migration `20260811000001`，**已 apply**，并已真实承载 Roman Baseline v1。issue 已关闭
- ✅ **WP04** [#874](https://github.com/bigbigraydeng-maker/magic-engine/issues/874) 测量执行 + 成本 / 覆盖率控制（PR [#914](https://github.com/bigbigraydeng-maker/magic-engine/pull/914) / `caf8d481`）—— `src/lib/geo-measurement-runtime/`。issue 已关闭
- ✅ **WP04A** [#917](https://github.com/bigbigraydeng-maker/magic-engine/issues/917) 真 provider / parser / WP03 store 接线（PR [#922](https://github.com/bigbigraydeng-maker/magic-engine/pull/922) / `885fe6e1`）—— `src/lib/geo-baseline/`。**Roman Baseline v1 就是它跑出来的**。issue 已关闭
- ✅ **WP06** [#878](https://github.com/bigbigraydeng-maker/magic-engine/issues/878) 共享 Page 能力 resolve / snapshot / draft / diff / validate（PR [#895](https://github.com/bigbigraydeng-maker/magic-engine/pull/895) / `e818d9dc`）—— `src/lib/page-optimization/` + `src/lib/capabilities/page-optimization/snapshot.ts`，**零线上写、零持久化、零调用方**。issue 已关闭
      ⚠️ **交付的是被缩小过的范围，不是能力契约的全集**：Build Control Room 的 WP06 MINIMUM 实施指令（2026-08-10）冻结决定第 5 条明写「**WP06 的模型花费固定为零，不许加通用预算引擎或可配置花费政策**」，因此**代码里没有成本上限，也不该有**。
      但 [页面能力契约 v1.0](./specs/2026-08-10-me2-page-optimization-capability-v1.0.md) §10 的验收要点仍写着「draft 与 snapshot 的模型 / provider 调用都声明了成本上限，建立不起来就 fail closed」—— **两份权威文档打架，后发的实施指令赢**。真要恢复成本闸门，那是 WP07（#880，它才有真的对外调用）的事，不是回头改 WP06。
- ✅ **K-WP02** [#882](https://github.com/bigbigraydeng-maker/magic-engine/issues/882) ActionCandidate→ActionKey 治理 + per-action 副作用政策（PR [#898](https://github.com/bigbigraydeng-maker/magic-engine/pull/898) / `2d9e426a`）——
      📍 **主实现在 `src/lib/action-bridge/`**（`MAPPING_TABLE` / mapper / 词汇表 API 都在这里，且 `MAPPING_TABLE` 目前是**空数组**）；**只有副作用授权那一段在 `src/lib/kernel/`**（`outward-authorization.ts`）。
      🔴 K-WP02 的冻结边界要求 **bridge 不许放进 Kernel** —— 要加新映射就加在 `action-bridge/`，**别加进 Kernel 层**。
      🔴 **只是合并了，没在生产跑过**：映射注册表为空、**零调用方**，且它依赖的执行内核四张表在生产**根本不存在**（见下）。**不要把它跟真跑过生产的 WP03 / WP04A 归成一类。** issue 已关闭，关闭说明里逐字写明了「已合并 ≠ 已启用」

> **哪些真跑过生产 —— 2026-08-12 对生产库做对象存在性只读实查（不认文件名、不认版本号）**：
>
> | 对象 | 生产实际 |
> |---|---|
> | `geo_query_sets` · `geo_queries` · `geo_batches` · `geo_observations` · `geo_evidence` | **都在** —— 3 个批次 / 25 条观测 / 12 条证据 |
> | 批量原子写入 RPC（migration `20260812000001`） | **在** |
> | `action_runs` · `action_run_steps` · `authorization_decisions` · `client_automation_policies` | **四张全不存在** |
> | `kernel_*` RPC | **0 个** |
> | Roman 的 `client_site_pages` / `cms_connections` | **0 / 0** |
>
> 结论：**GEO 测量线（WP02→WP03→WP04→WP04A）真跑过一次生产；内核线（PR #863 + K-WP02）没有。**
> **别把「issue 已关闭」读成「功能已在生产生效」** —— 关闭只代表代码交付完成。

**未完成**：
> WP05（#879）与前置 #930 已于 2026-08-17 合入 main（PR #1032 / #1020）—— 详见 [CHANGELOG](./history/CHANGELOG.md)，此处按仓库约定不再保留完成项。

**WP05 follow-up**（本轮不扩，登记待排）：
- [ ] **#1023** WP05 follow-up
- [ ] **#1030** WP05 follow-up
- [ ] [#1040](https://github.com/bigbigraydeng-maker/magic-engine/issues/1040) 聚合分组键需按 `engine_family / model_version / query_set_version` 隔离（未知 fail-closed）—— Codex #1032 第 4 轮 P1-c，Roman 单引擎/单模型未触发但结构上带洞；已在 [comment 5315681257](https://github.com/bigbigraydeng-maker/magic-engine/issues/1040#issuecomment-5315681257) 追加两条：severity 分母独立锁减弱（P1-b 副作用）· `buildStatement` 表述错位（仍报 explicit_positive/conditional 计数但本链已不承诺）
- [ ] **WP07** [#880](https://github.com/bigbigraydeng-maker/magic-engine/issues/880) Kernel 授权的 apply / verify / rollback
- [ ] **K-WP01** [#881](https://github.com/bigbigraydeng-maker/magic-engine/issues/881) 认证审批 / 拒绝界面 + 政策 Settings UI
- [x] ~~**WP08**~~ ✅ **2026-08-12 完成** [#883](https://github.com/bigbigraydeng-maker/magic-engine/issues/883) Roman 首个有效生产 GEO baseline 已捕获并经 Product Owner 验收 —— 批次 `688bd8ae-2db6-4300-b761-b850f30c32c5`，冻结查询集 `roman_geo_baseline_v1`（12 条问题），12 / 12 观测成功 ＋ 12 条证据，累计记账成本 US$0.708 / US$5.00。
      **这是冻结的测量事实，不因后续优化、诊断或重解释而回写或重新表述**（[冻结审计记录](https://github.com/bigbigraydeng-maker/magic-engine/issues/883#issuecomment-5260895662)）：
      唯一已确认的 Roman 可见度数字是 **owned-domain citation coverage = 2 / 12 = 16.7%**；
      「12 / 12」指 12 个回答都带了引用，**不等于** Roman 被提及或被推荐；
      qualified mention / recommendation / conditional rank 的判据（M1）未决因而**不可计算**，
      `direct_owned_page_citation` 记 `not_computable`（不是 0）。
      **未执行**：diagnosis · optimization action · 第二轮测量 · 页面台账补录 · Roman 网站修改。
      Issue #883 已于 **2026-08-12 经 Product Owner 授权关闭**（[结账说明](https://github.com/bigbigraydeng-maker/magic-engine/issues/883#issuecomment-5262037905)）；其余留的 3 项前置工作已拆入 #932。
- [ ] **WP08 余项** [#932](https://github.com/bigbigraydeng-maker/magic-engine/issues/932) Roman 页面台账 + 权威来源 · 测量频率（cadence，须与 #885 对齐）· WP09 前置就位登记 —— **WP09 的前置**，与已冻结的 Baseline v1 无关
- [ ] **WP09 / WP10** [#884](https://github.com/bigbigraydeng-maker/magic-engine/issues/884) / [#885](https://github.com/bigbigraydeng-maker/magic-engine/issues/885) 首次 1–3 页优化 → T+7/14/28 复测与学习（严格串行，**两项均未开工**）
- [x] ~~**U11**~~ ✅ **已完成** —— `docs/STATE.md` 与本文件的 ME2 条目已补齐（本 PR）
- [ ] **WP00 §15 其余未决项**（**U1–U10、U12**）仍**单独**以未决形态挂着，**任何 WP 不许把它们当既定假设**
- [ ] **Product Map PR3**（WP「ME2 Product Map v1」的最后一段）—— **PR1**（组件登记册＋成熟度引擎,PR [#976](https://github.com/bigbigraydeng-maker/magic-engine/pull/976)）与 **PR2**（GitHub 只读动态同步,PR [#979](https://github.com/bigbigraydeng-maker/magic-engine/pull/979)）均已于 2026-08-15 合并**并完成生产 provisioning**（migration 已 apply · ME 仓 webhook 已建并有真实投递 · GITHUB_TOKEN/cron 密钥已配 · 首轮全量同步实测 12 PR / 14 issue / 28 条待分类）。剩 **PR3**:`/dashboard/me2/product-map` PO 控制台四视图（业务总览 / 组件清单 / 依赖 / 待拍板队列）——必须渲染 partial 轮、`manual_claim` 未核验标记、factsSource 三态,不许把不完整快照显示成完整。开工需 PO 授权。
  🔄 **2026-08-19 新增「老板摘要」视图,PR [#1076](https://github.com/bigbigraydeng-maker/magic-engine/pull/1076) 待复审,未合并**:PM 反馈现有视图对非技术管理层太细,新增一个并列标签把组件按业务线收成一行卡片(状态灯 + 在跑分数 + 下一步)。默认打开的仍是"等你拍板"(板桥 S1 原则未推翻)。经子牙+魏征两轮设计复审,两轮都真挑出问题并已按复审改(状态灯改成"有在跑就算绿灯"、needsYourCall 改成直接核对 decisionsNow、加小样本标注)——具体见 PR 描述。
      ⚠️ 已知遗留:同步的 `unresolved_threads` 恒 null(GraphQL 那一步静默失败),故每轮标 partial —— 独立修复任务在案,不阻塞 PR3

**独立并行、不并入本链**：[#886](https://github.com/bigbigraydeng-maker/magic-engine/issues/886) Operating Brief（参考闭环稳定前不开工）· [#887](https://github.com/bigbigraydeng-maker/magic-engine/issues/887) 广告安全泳道（**不许夹带进任何 ME2 的 WP**）

**运维泳道（也不并入本链，等 PM 拍板）**：
- [ ] [#911](https://github.com/bigbigraydeng-maker/magic-engine/issues/911) / PR [#912](https://github.com/bigbigraydeng-maker/magic-engine/pull/912) OPS03 事件驱动 Issue 中继试点 —— ⚠️ 它写死的唯一标的 #910 **已关闭**，试点要么改标的要么归档
- [ ] PR [#931](https://github.com/bigbigraydeng-maker/magic-engine/pull/931) OPS02「Codex 复审干净就自动合并」—— ⚠️ 前置已就绪，**卡点在 PR 自己身上**：原引用的 [#939](https://github.com/bigbigraydeng-maker/magic-engine/issues/939) 已于 2026-08-16 关闭修复，不再是阻塞点。曾经存在的另一个真实缺口——`tools/ops-review-loop/src/fix-scope.mjs` 的 `GUARDED_BRANCH_PREFIXES` 把「Codex 复审→Claude 自动修复」循环的生效分支焊死在 `claude/me2-` 前缀，团队实际工作分支（`claude/<issue号>-<slug>`）从不匹配——已由 PR [#1175](https://github.com/bigbigraydeng-maker/magic-engine/pull/1175) 于 2026-08-24 11:45 UTC 合并修复，`GUARDED_BRANCH_PREFIXES` 现已扩到 `claude/`，覆盖日常工作分支（2026-08-24 在 PR [#1174](https://github.com/bigbigraydeng-maker/magic-engine/pull/1174) 上实测过循环本身能跑通：Codex 打 P2 标签 → 自动触发修复 → Claude 推送修复 commit）。急停开关 `OPS_AUTO_MERGE_ENABLED` 也已经是 `true`（2026-08-12 设置）。**现在真正卡住的是 #931 这个 PR 自己**：其分支 `claude/me2-ops-auto-merge` 自 2026-08-12 起未再更新，与当前 `main`（已并入 #941/#942/#943/#947/#1175 等后续改动）产生冲突（`mergeStateStatus: CONFLICTING`），需要先 merge origin/main 解决冲突（禁止 rebase，见 CLAUDE.md §6），才能重新走复审流程。
      ✅ **兜底闸门这一条不是问题**：2026-08-12 实查，`main` 上有 **active 的 ruleset「Protect main」** —— 禁删、禁 force push、只许 merge commit、**所有复审线程必须解决**、`ai-orchestrator-tests` 必须过。（旧说法「GitHub Free 私有仓库开不了分支保护」已作废，ruleset 已对私有仓库开放。）

---

## 官网「免费体检」漏斗断流（2026-09-02 发现）

**症状**：`magicengine.com.au/discover` 的免费体检——两步漏斗（`/api/scout` 存 lead → `/api/report` 补 email 发报告）——自上线起从未真正存过一条 lead，也从未真正发出过一封报告邮件。生产 Supabase `discovery_leads` 表核实为 0 行。

**已确认根因（2026-09-02 直接调用 `/api/scout` 验证 `leadId` 前缀 = `demo-...`）**：`website/`（Cloudflare Pages 独立静态站，独立于本仓 Render 部署，独立 Cloudflare 账号）的生产环境**没有配置 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`**，导致 `website/functions/api/scout.js` 的 `storeLead()` 从未真正连接过 Supabase，一律返回假 `demo-` id；`website/functions/api/report.js` 据此拒绝发送报告邮件（"P0-A fix" 防御生效，符合设计但暴露了上游问题）。

**已一并修复但非本次症状根因**（子牙+魏征 2 审通过，2026-09-02 已 apply）：`discovery_leads.email` 列建表起就是 `NOT NULL`，但 `scout.js` 插入时从不传 email（设计上是两步收集）——只要 Cloudflare 侧接上 Supabase，这条 NOT NULL 约束会立刻撞库产生新的 `fallback-` 失败。migration `20260902000001_discovery_leads_email_nullable.sql` 已放开该约束。

- [ ] 🔴 **需 PM 在 Cloudflare 后台（独立账号，本仓无法访问）给 magicengine.com.au 的 Pages 项目补 `SUPABASE_URL`=`https://glbdnayojixmexgofbsd.supabase.co`、`SUPABASE_SERVICE_KEY`=（从 Render `magic-engine` 服务的 `SUPABASE_SERVICE_ROLE_KEY` 复制同一个值）→ Settings → Environment variables → Production，保存后触发一次重新部署
- [ ] 补上后必须端到端验证：重新跑一次 `/discover` 全流程，确认 `leadId` 是真实 UUID、Supabase `discovery_leads` 真的新增一行、**且真的收到报告邮件**（不能只看页面显示"发送成功"——`report.js` 的 `sendEmail()` 在 `RESEND_API_KEY` 未配置时会静默跳过发送但仍返回 `{ok:true}`，需顺手确认这个 key 也配了）
- [ ] 次要（魏征复审发现，非阻塞）：`discovery_leads` 表建表起没有任何 migration 显式 `enable row level security`/加 policy，虽然 service-role 调用不受 RLS 影响、暂无实际泄露，但应补一条独立 RLS migration 让它符合"新表必须 service-role 模板"的红线并消除账本漂移
- [ ] 次要：`website/_headers` 对 `/api/*` 声明 `Access-Control-Allow-Origin: https://magicengine.com.au`，而各 Function 自己又各设 `Access-Control-Allow-Origin: *`——未验证 Cloudflare Pages 对两者如何合并，换一个 origin（如 `www` 子域名/`*.pages.dev` 预览域）访问不排除请求直接被 CORS 拦掉

---

## 每日待办 href 落地页 action-gap（2026-09-07 审计发现，PR #1467 未合并）

**背景**：审计了 `src/lib/pm-todo/**` 下发给 PM 的所有 `href`，逐条实测「点开链接是不是真能办成那件事」。4 个「链接完全打不开 / 静默丢失」的问题已经修复并合并（`crawl_stale` 404、`blog_draft_waiting` 与两条 `conversion_*` 相对路径被链接闸丢弃）——见 [history/CHANGELOG.md](./history/CHANGELOG.md) 对应条目。

Codex 复审又挖出 6 个「落地页存在，但操作的东西跟待办要修的不是一回事」的问题，按 [ENGINEERING_QUALITY_GATES.md §11](./ENGINEERING_QUALITY_GATES.md#11-资源优先级判断pm-2026-09-07-拍板) 三维打分排了优先级（PM 2026-09-07 拍板顺序）：

- [ ] 🔴 **[P0] `price_claim_unbacked` 落地页读写错了表**（`src/lib/pm-todo/manual-items.ts` `pushPriceGateItems`）：这条待办检查的是 `visual_assets` 表按 `post_id` 关联的配图，但 href 指向的 `/dashboard/clients/{id}/assets` 素材库页读写的是 `client_assets` 表——两张不同的表，PM 点进去根本找不到要改来源的那张图。要么把 href 改到能操作 `visual_assets` 的地方，要么把这条检查也接到 `client_assets`。客户投诉风险直接（配错图客户按图下单对不上）。
- [ ] 🔴 **[P0] `factory_worker_idle` 落地页无法远程启动 worker**（`src/lib/pm-todo/manual-items.ts` `pushFactoryWorkerItems` + `/dashboard/factory`）：待办的 how 要求「在那台 Mac 上跑 `node scripts/factory-worker/worker.mjs --loop`」，但 `/dashboard/factory` 页面只能看 worker 心跳状态，没有任何远程启动/连接控制。要么加一个能远程触发 worker 的入口，要么把 worker 迁到不依赖单台 Mac 开机的执行环境（长期更优，但改动更大，先讨论方案）。
- [ ] **[P2] `kernel_needs_human` 三处分支生成空 href**（`src/lib/kernel/handoff.ts` 91/103/112 行）：这几类交接待办的 `href: ''`，PM 点开邮件根本没有入口可点，只能靠 how 里的文字描述摸索。是「管道不许断头」这条铁律的安全网本身在这几个分支失效。要给这几类交接补上真实入口（哪怕是执行看板的一个筛选视图）。
- [ ] **[P2] `leads_metric_untrusted` 落地页没有修复入口**（`src/lib/pm-todo/manual-items.ts` `pushLeadsSanityItems` + `/goal/{goalId}`）：待办要求 PM 去客户网站统计后台收窄「产生线索」触发条件，但目标页是纯展示、没有任何外部统计后台的链接。要么加一条到客户 GA4/GTM 后台的直达链接（如果连接器里存了 property id），要么在 how 里明确「这一步要联系客户或自己去 GA4 后台改」而不是暗示落地页能做。
- [ ] **[P2] `meta_stuck` 落地页跟需要做的事不对应**（`src/lib/pm-todo/manual-items.ts` 515-520 行 + `/dashboard/clients/{id}/settings`）：待办要求登录**客户自己的** WordPress 后台启用 Magic Engine 插件，但 `/settings` 页是我们自己的连接器配置（API 密钥、SEO 字段探测），不是客户 WP 后台，也没给客户后台的直达链接。要在 CmsPanel 里补上客户 WP 后台的地址（如果连接时存了站点 URL）。
- [ ] **[P2] `goal_baseline_mismatch` 目标起点数字改不了**（`/goal/{goalId}` 页 + `src/app/api/goals/[goalId]/route.ts` 只有 GET/DELETE）：待办要求把错误的起点改成重算值，但目标详情页只读展示 `baseline_value`，也没有对应的 PATCH/PUT 接口。要新增一个编辑 baseline 的入口（前端表单 + 后端接口），同时要考虑这个字段被改动后要不要留痕（谁在什么时候把起点从 A 改成了 B）。

### ME 产品动态自动发 LinkedIn（2026-08-20 建成，默认关闭）

代码已完成并测试通过：`src/lib/linkedin-progress/`（取材/敏感词硬过滤/文案生成/发布编排）+
`src/app/api/cron/linkedin-progress-post-{mon,thu}/`（每周一/四各一条 cron）+
`src/lib/pm-todo/manual-items.ts` 的 `pushLinkedinProgressItems`（待审/账号未连/发布失败三种卡点接进日常待办）。
只从 `docs/history/CHANGELOG.md` 已上线条目取材，完全自动发布，命中客户敏感信息才转人审。
前两轮 Codex 复审挑出的问题（敏感词表查询失败要 fail closed / 发布账号严格绑定 / 人工复审路径也要接上真正发布 /
并发确认要原子认领 / 发布成功但状态没同步要能对账 / 窗口边界防同日条目丢失）均已修完并测试通过。
第三轮挑出的 1 条回归（原子认领误伤视频内容重新确认）已修；另 4 条（下方 ⚠️ 清单）功能默认关闭时不触发，
按 PM 决策登记成"开启前必关"的后续任务，不阻塞本次合并。

- [ ] **上线前 PM 必做的一次性动作**：① 去 Publer 后台用自己的 LinkedIn 账号做一次性授权连接
      ② 打开 ME 后台「Magic Lab Class」客户的 connectors 设置页，把出现的 LinkedIn 账号 ID 填进 Publer 绑定
      ③ 在 Render 的 `crazycontent` 服务（不是 render.yaml 里那个不对外服务的 `magic-engine`）Environment 页手动加
      `LINKEDIN_PROGRESS_POST_ENABLED=true`（未配置=默认禁用，这三步没做完之前功能保持休眠，不会误发）
- [ ] 上线后先跑一次人工验证：确认 Publer 的 schedule 接口对 `provider='linkedin'` 真的认（目前只有代码推断，没有已连账号可实测），
      建议先手工发 1-2 条真实验证一次发布路径，再考虑打开 cron 开关

**⚠️ 打开开关（第③步 `LINKEDIN_PROGRESS_POST_ENABLED=true`）之前必须先关掉的 4 条（Codex 第三轮复审，功能默认关闭时不会触发，所以不阻塞合并，但是"开启前"的硬门槛）：**

- [ ] **[P1] 匿名客户业务数字漏过滤**（`src/lib/linkedin-progress/run.ts` 敏感过滤）：CHANGELOG 若只用匿名方式写客户指标（如「2099 条消息 / 658 个会话」），`findSensitiveMatches` 只认客户名/域名/代号/术语，完全不认运营数字，这类稿会绕过"不点名也不得披露客户数字"的要求自动发。要加代码级数字/联系方式检测，或含此类数据一律转人审。
- [ ] **[P1] 人工确认路径没处理"发布成功但数据库没同步"**（`content-factory/[postId]/route.ts` LinkedIn 分支）：cron 的 `run.ts` 已消费 `dbSyncError` 并写 `published_but_db_sync_failed` 对账标记，但看板手工 confirm 这条分支还没有——Publer 已发但回写失败时，界面会误报失败稿，可能被当失败重发。要把 run.ts 那套对账逻辑同样接到这条分支。
- [ ] **[P1] 发布失败后 approved 状态卡死、无重试入口**（同上文件 LinkedIn 分支）：Publer 调度超时/报错时，帖子已被原子认领改成 approved，这里只返 500 不回滚；无视频的 approved 帖子归"备料"段，确认按钮只在"选题"段显示，PM 修好连接后无法再确认，稿件永久卡住。要在确认外部未接受时回滚为 draft，或给 approved 提供幂等重试入口。
- [ ] **[P2] 待办查询失败被当成"零条记录"**（`src/lib/pm-todo/manual-items.ts` `pushLinkedinProgressItems`）：那次 `content_posts` 查询若失败，Supabase 返回 `{data:null,error}` 不抛异常，这里只取 `data` 再 `?? []`，账号未连/敏感稿/已发未同步等卡点会全部静默从今日待办消失。要检查并抛 `error`。

### 广告引擎中心 — 已上线部分的收尾（2026-08-05）

已上线（见 CHANGELOG）：每天扫在投广告的闸门 · ME 起草→建成暂停→过闸门→人点头才花钱 · `/dashboard/ad-approval`。

- [ ] **P21.J.M4** 起草那一步现在只有 API，**没有任何调用方** —— 得有个地方（AI 或 UI）真的产出一份草案，否则整条链路空转。优先接 Roman：留资表单 + 视频养受众各一条
- [ ] **P21.J.M5** 素材上传还没接：`imageHash` / `videoId` 要人先传到 Meta 才有。要么接 `ads_creative_upload_*`，要么从 ME 已有的成片直传
- [x] ~~**P21.J.M6/M7/M8/M9/M10**~~ 2026-08-05 全部完成：共享闸 34 种写法 0 漏 0 误拦（原漏 28 种）+ 唯一写入口 `write-lesson.ts` + `POST /api/ad-engine/lessons`；页面加 90 天窗口 + 5000 行上限 + 撞顶告警；轮播/动态商品/自然帖投流三种文案形态补齐（自然帖会去主页把文案取回来）；行业归一化统一成 `normaliseIndustry` 一个函数

#### 2026-08-14 Meta 方向审计（[docs/audits/2026-08-14-meta-ads-direction-audit.md](./audits/2026-08-14-meta-ads-direction-audit.md)）新发现，按影响面排序

> 全部来自只读审计 + 16 轮复审逐条核实，未改生产代码。审计只报缺口不写方案的，这里登记成可排期的条目。

- [ ] **AD-CUR-1 广告花费表都没有币种列 —— 跨客户金额全是混币种加总【影响面最大，且是三张表】**：2026-08-14 实读账户 `currency`：Oztop `1735240120460765` = **AUD**，CTS / Roman / 混账户 = NZD；而两张表都把 Graph 返回的账户币种金额原样存下、不换算、不记币种。
  - `ad_daily_insights.spend`（裸 `NUMERIC`，`parseDailyMetrics` 写）→ 喂**广告健康引擎 / ad-engine 看板**
  - `meta_ads_snapshots.spend`（裸 `NUMERIC`，注释直言 "total spend in account currency"）→ 喂 **`MetaAdsAdapter.ts:90`（Goal 指标）、月报、production package（`production/[packageId]/route.ts:117`）**

  ⚠️ **只修 `ad_daily_insights` 修不到报表侧** —— `20260721000001` 的注释本身就写明 "meta_ads_snapshots is left untouched — MetaAdsAdapter, the monthly report and the production-package view all still read it"。**两张表必须一起加 `currency` 列**（Graph `account_currency` 直接给），并在任何跨客户汇总处按基准日折算 + 注明汇率。

  ⚠️ **而且加列 + 改新拉取还不够，历史行仍然没有单位**：`meta_ads_snapshots` 是**每次同步只追加一行**的表，月报和 Goal 历史读的就是当时那一行 —— 新的同步不会修好已发出去的旧月报；（⚠️ 第三十一轮订正：这里原写 "production package 会永久关联某一条旧 snapshot"，**那条关联从来没成立过**，见 `AD-PKG-1`）`ad_daily_insights` 的历史行一旦超出回拉窗口也会一直是 NULL。所以本条必须包含：**① 按 `ad_account_id` 回填历史币种**（账户币种不随时间变，可安全回填）**② 读侧显式处理 NULL**（宁可拒绝汇总也不要默认同币种）。否则 migration 做完，旧月报和 Goal 历史照样解释不了

  ⚠️ **其实是三张表，不是两张 —— 派生出去的飞轮指标也裸存账户币种**（第四十轮 Codex 指出，已核实）：`flywheel/adapters/MetaAdsAdapter.ts:118-145` 把 snapshot 的 `spend` / `cpc` **原样复制**进 `flywheel_metrics.metric_value`，而它写的 `source_ref` 只有 `{snapshot_id, ad_account_id, period_start, period_end}`，**没有币种**；下游 `flywheel/attribution/job.ts:290-313` 的 `latestMetricValue` 又只取 `Number(data.metric_value)` —— 一个没有单位的裸数字。**所以回填 snapshot 修不好已经生成的飞轮历史**，Goal 和归因照样会把 AUD 和 NZD 当同一个单位比。
  → ⚠️ **而且补币种之前先做 `AD-ATTR-1`** —— 读侧连"这行是 Meta 还是 Google"都不分，币种对了平台还是错的。
  → 本条必须一并规定：**`flywheel_metrics` 怎么带币种**（加列，或统一折成基准币种存），并**重放或作废已有的 `ads.account.spend` / `ads.account.cpc` 及其派生结果**。✅ 好消息是可回填 —— `source_ref.ad_account_id` 在，按账户查币种即可
- [ ] 🔴 **AD-ORPH-1 被闸门拦下和被人否决的草案，Meta 那边的实体没人收 —— 既不删也不下发人工任务**（第四十三轮发现，`AD-GATE-1` 的同一段生命周期）：`publishDraftPaused` 成功后 campaign / ad set / creative / ads **都已经在 Meta 建出来了（暂停着）**，然后：
  - `createDraftForApproval` 的 `blocked` 分支（`draft-and-gate.ts:137-141` 回读失败、`:158-163` 闸门拦下）**只写账本，不删实体**；
  - `rejectDraft`（`:213-235`）同样**只改 payload 状态**。
  而 `publishDraftPaused` 里那套逆序 `graphDelete` 回滚**只在建的过程中失败时才跑**（`:165-169`），终态是 blocked / rejected 时根本不触发。结果：**一堆永远不可能再被批准的暂停广告长期堆在 Meta 后台**，而它们看起来跟正常的暂停草案一模一样 —— **后台的人一手滑就能把它开起来花钱**。
  ⚠️ 这正好撞在 CLAUDE.md 铁律 3 下半：能自动就自动（终态时逆序删掉），确实删不掉（比如 Meta 报错、实体被引用）**就必须下发人工任务并进同一个管道**，带齐 what（这几条是废弃草案、别开）· how（在 Meta 后台删掉这几个 id）· href（直达链接）。现在两样都没有 —— `DraftRecord.orphans` 这个字段**只在建失败那条路上会被填**，blocked / rejected 根本不写它。
  ⚠️ **但"逆序删除实体"这句现在做不到 —— 三个前置得先补**（第四十四轮 Codex 指出，已核实。上一版直接写了这句修法，是**承诺了一个当前结构根本执行不了的动作**）：
  1. **creative id 根本没被带出来**：`ad-publisher.ts:224` 的 `created.push(creative.id)` 只进了 `publishDraftPaused` 内部那个局部数组，而 `PublishedDraft`（`:22-28`）只有 `campaignId` / `adSetId` / `adIds` / `orphans`，`:243` 返回时**不含任何 creative id**。事后想删创意，连 id 都拿不到。⚠️ 而且创意在 Meta 是**账户级对象、不是 campaign 的子对象** —— 删 campaign 不会把它带走，所以这批必然漏；
  2. **`rollback` 是个局部闭包**（`:165-169`），函数一返回就不可调用 —— 终态清理需要一个**可复用的清理能力**，不能指望复用它；
  3. **否决那条路手上没有 token**：`rejectDraft(actionId, supabase, reason?)`（`draft-and-gate.ts:213-217`）**签名里就没有 accessToken**，它连 Meta 都调不了。
  修：① **`PublishedDraft` 带上 creative ids 并落进 `DraftRecord`**；② 把清理逻辑从闭包里提出来做成可复用函数（建失败回滚和终态清理共用）；③ 给 `rejectDraft` 补授权；④ 然后才谈终态（blocked / rejected）自动逆序删除；⑤ 删不掉的落进 `orphans` **并下发人工任务**（`src/lib/pm-todo/manual-items.ts` 的「🙋 需要你动手」栏）—— 注意①没做的话，**这个人工任务本身也是残缺的**（列不全要删哪些东西）
- [ ] 🔴 **AD-QUEUE-1 审批页按"最近 50 条"截断后才在内存里筛待办 —— 早的待批草案会从唯一入口永久消失**（第四十三轮发现，**首投前置**）：`ad-approval/page.tsx:34-44` 的查询**不带任何状态条件**，只 `.order('created_at', desc).limit(PAGE_LIMIT + 1)`（`PAGE_LIMIT = 50`），拿回来之后才在 `:80` 用 `rows.filter(r => r.payload?.status === 'awaiting_approval')` **在内存里**筛。页面自己在 `:23` 写明「**不做分页**」。
  → 只要 `flywheel_actions` 里攒够 50 条更新的 `active` / `rejected` / `blocked` / `failed`，**更早但仍在等人点头的草案就再也不会出现在这个页面上** —— 而这是**唯一**的审批入口。
  ⚠️ 更阴的是 `:246-248` 那句兜底文案：「还有更早的记录没显示（这页只列最近 50 条）」—— 它把漏掉的东西说成**历史记录**，看的人不会意识到**里面可能有正在等他点头的活**。这张页面存在的意义就是保证"该你点头的都在这儿"，而这个保证现在不成立。
  修：**把状态条件下推到数据库**（按 `payload->>status = 'awaiting_approval'` 查，或落一列可索引的状态），或做真分页 / 待办完整队列；兜底文案也要分清"历史被截断"和"待办被截断"
- [ ] 🔴 **AD-ATTR-1 归因取数不按来源过滤 —— Meta 和 Google Ads 共用同一批 `ads.account.*` key【隐患已武装，Oztop 两边都配了】**（第四十二轮发现，`AD-CUR-1` 的前置）：
  - `google-data-pullback-daily/route.ts:710-716` 的注释自己写着：Google Ads 的账户级指标"写进**共享的 `ads.account.*` 命名空间**，靠 `source='google_ads_pullback'` 区分，好让同时接了 Meta + Google 的客户仍然分得开"；
  - 但读侧 `flywheel/attribution/job.ts:290-313` 的 `latestMetricValue` **只按 `client_id` + `metric_key` + 时间窗取最新一行，压根不过滤 `source`**（也不过滤账户、币种）。**写侧声明的那个"分得开"，读侧没实现** —— 又一次"要求写了、另一侧没做"，跟 `20260721000001` 那条一模一样。
  - 后果：同时接两家的客户，一次 Meta 动作的 baseline 可能取自 Google 那行、after 取自 Meta 那行，**两个不同平台、不同币种的数字直接相减**。⚠️ **光给 `AD-CUR-1` 补币种字段挡不住这个** —— 币种对了，平台还是错的。
  - 📊 **现状实测（口径要准）**：`clients` 里 **Oztop 同时配了 `meta_ad_account_id` 和 `google_ads_customer_id`**，所以隐患是**武装状态**；但 `flywheel_metrics` 全表的 `ads.account.*` 行**目前全部来自 `meta_ads` / `meta_ads_pullback`，一条 `google_ads_pullback` 都还没有**（Google 那条路多半卡在 `GOOGLE_ADS_*` env 缺失上，`syncGoogleAds` 会返回 `success:false` 而不是抛错）。**所以是"还没发生"，不是"不会发生"** —— Google 那边一旦补上 env 开始写，当天就混。
  修：读侧按 `source`（或账户）隔离，或改用 provider 专属 metric key；**这条必须排在 `AD-CUR-1` 的历史重放之前** —— 不隔离来源就重放，等于把错的配对重新算一遍
- [ ] **AD-PLAY-1 两个建广告调用点没传 `play` / `playSource`，打法账本恒为 NULL**：`boost-post/route.ts:122` 与 `winner-reel-sync/engine.ts:214` 都调了 `linkAdToCreative`，但**三个打法参数一个没传**，而 `persistLink` 会照写 NULL。`LinkAdToCreativeArgs` 和 `persistLink` 早就支持这三列 —— **纯粹是调用方没传，真·接线活**。**两条路径的处理方式不同，不能一起硬编码**：
  - `boost-post` → 固定 `boost_organic_post` + `declared_at_creation`。安全：给自然帖投流，这个路由干的就是这件事，打法由路由本身决定
  - `winner-reel-sync` → ⚠️ **不能硬编码 `thruplay_pool_build`**。`engine.ts:203-211` 只是往 `winner_reel_sync_config.target_adset_id` 指定的广告组里加广告，而**那张配置表没有打法/目标字段**（`20260711000001` 只有 `target_adset_id`），代码也**从不回读该广告组的 `optimization_goal`**。目标组要是被换成非 ThruPlay 的，所有新广告就会被贴上错标签 —— 这正好违反 `play` 那条"拿不到就留空，绝不猜"的契约，而且 `declared_at_creation` 在 `PLAY_SOURCE_TRUST` 里是**高可信**，错标签会污染打法学习。修：要么给配置表加受校验的打法字段，要么建广告时回读目标组 `optimization_goal` 确认后再写；**两者都做不到就留 NULL**

  注意 `AD-LINK-1` 解决的是 variant 身份 + migration，**不覆盖这两条帖子路径**，不能互相替代
- [ ] **AD-CUR-2 写预算的入口都写死 AUD、却不读账户币种 —— 两个入口，其中一个已上线在用**：Meta 一律按**账户币种**解释传进去的数字，而 CTS/Roman 账户是 **NZD**（已实读）。
  - 🔴 **执行抽屉（已上线）**：`AdsFixDrawer.tsx:309` 的输入框标签写死 **「新日预算（AUD）」**，`meta-ads/execute/route.ts:157` 直接 `Math.round(newBudget * 100)` 发给 Meta，**不读币种、不换算** → 人以为在填 AUD，钱按 NZD 花。注释里那句 "minor currency units (cents for USD/AUD)" 本身就默认了账户是 AUD
  - `boost-post`：收 `daily_budget_aud`、同样乘 100 原样发送，回显的 `estimated_total_aud` 也是错的

  - **草案 → 审批那条路（就是本审计推荐的首发路径）**：`ad-publisher.ts:195` 同样 `String(Math.round(d.dailyBudget * 100))` 按账户币种发送,而审批页的 `describeDraft` 和按钮只显示 `$`,**不告诉批准人这是 AUD 还是 NZD** → 币种不明就点了"开"

  修：三处都回读账户币种,UI 显示、请求契约与持久化记录都按**账户币种**表达(或显式换算并标注汇率)。⚠️ 只修 boost,既漏了最常用的执行抽屉,也漏了首发要走的草案路径
- [ ] **AD-GATE-1 `approveDraft` 激活前不重新回读**：只查 `payload.status` 就 `activatePublished`，不重跑 `fetchAdSetReadback` / `checkLaunch`。草案在共用账户里躺几天，期间被改则批准人看到的是旧快照、钱按新配置花 —— 这违背 `launch-readback.ts` 自己"只有回读能看见"的立论。修：激活前重跑回读 + 闸门，有 blocker 拒绝激活。**不需 migration**
  - 🔴 **"重跑一次回读"根本看不见预算 —— 而本条正文承诺要修的就是"钱按新配置花"**（第三十九轮 Codex P1，已核实）：`src/lib/meta/readback.ts:27-29` 的 `ADSET_FIELDS` 只有 `id,name,optimization_goal,destination_type,effective_status,campaign_id,targeting` —— **没有 `daily_budget`、没有 `lifetime_budget`、没有 `start_time`/`end_time`**；`checkLaunch` 也从不拿回读预算跟 `DraftRecord.draft.dailyBudget` 比。**所以草案躺着期间有人在 Meta 后台把日预算调高，重跑回读照样全绿放行**，本条正文那句"钱按新配置花"等于没修到。
    修：① **把批准人当时看到的那套钱的包络持久化进 `DraftRecord`**（日预算 + **账户币种**，见 `AD-CUR-2` + 排期）；② `ADSET_FIELDS` 补上预算与排期字段；③ 激活前逐项比对，**对不上就是 blocker，不是 warn**
  - 🔴 **买家看不到文案时只报 warn，照样放行；创意数组为空时连 warn 都没有**（第三十九轮 Codex P2，已核实）：`launch-readback.ts:294-303` 的 `creative_without_buyer_text` severity 是 `'warn'`，而 `safeToActivate = !findings.some(f => f.severity === 'blocker')` —— **warn 不拦人**，审批页（`ad-approval/page.tsx:147-150`）只是"建议你去 Meta 看一眼"。更糟的是那条规则来自 `adSet.creatives.filter(...)`：**`creatives` 是空数组时 filter 出来也是空，一条 finding 都不产生**，于是"一条广告都没回读到"和"全都回读干净了"在闸门眼里长得一模一样。
    修：**首条真钱广告之前，把"每条预期广告都回读到完整买家可见文案"设成 blocker**（含"回读到的广告条数 ≠ 建出来的广告条数"这一种），别把这一步推给批准人肉眼核对 —— 这正是 `launch-readback.ts` 开篇自己写的「查不出来 ≠ 没问题」
  - 🔴 **另一半：批准/否决必须原子认领，否则"显示已否决、广告在花钱"**（第三十六轮补入，**升级为首投前置**）：`approveDraft`（`:179-209`）和 `rejectDraft`（`:213-235`）都是**先读状态、再无条件写状态**，中间没有条件更新。两人同时点 → 批准那边已激活 Meta 实体、否决那边最后落账 → **账本和页面写着 `rejected`，广告继续花钱，没有任何地方会喊**。⚠️ 而且 `rejectDraft` 更松：它**连状态都不查**（`:225-227` 只判 `payload` 存在），否决一条已经 `active` 的草案会直接把账本改成 `rejected` 而广告照跑 —— 这条不用并发也能触发。
    修：用条件更新或 RPC **从 `awaiting_approval` 原子认领唯一决策**（写入时带 `payload->>status = 'awaiting_approval'` 的前置条件，认领失败就不执行动作），并为"Meta 已激活但落账冲突"留一条**停投 + 对账**路径。**不需 migration**（条件更新即可；要做 RPC 才需要，届时待 PM `go apply`）
  - ⚠️ **光"重跑一次"不够，会漏掉最要命的那条检查**：`expectedGeo` 只存在于 `CreateDraftDeps`（`draft-and-gate.ts:62`，创建时用一次），**没有落进 `DraftRecord`**；而 `approveDraft(actionId, supabase, accessToken)` 手上根本没有它。缺了它 `adaptMetaAdSet` 会传 `null`，`launch-readback.ts:281` 的 `if (input.expectedGeo && ...)` 直接跳过 **`geo_mismatch`** —— 也就是"等待期间被改到别的国家"这个核心场景照样放行。**修的时候必须同时**：创建时把可信地区持久化进 `DraftRecord`（⚠️ **不能只重载 `clients.country`**，见 `AD-GEO-1`）
- [ ] 🟠 **AD-ISO-1 生产同步把整账户数据写成单个客户的 —— 同步路径允许跨客户污染，隐患已上线在跑，损害尚未证实【已上线在跑】**（第二十八轮发现；标题第五十轮更正 —— 原写"正在污染"，与本条自己第 31 轮的实测结论自相矛盾）：
  - `ads-strategy/daily-insights.ts:209+` 的 `syncCampaignDailyInsights(clientId, adAccountId, …)` 拉的是 **`getCampaignDailyInsights(adAccountId, …)`（整账户）**，然后 `rows.map(r => toInsightRow({ clientId, … }))` —— **把每一行都写成该 client，零 campaign 归属过滤**；ad 级同理；
  - `google-data-pullback-daily/route.ts:595+`（**定时**）：把 `getAdAccountInsights` 的**账户级聚合**整个 `insert` 进该 client 的 `meta_ads_snapshots`,而那张表正是 `MetaAdsAdapter`(Goal 指标)、月报、production package 读的;
  - `clients/[id]/meta-ads/sync/route.ts:82-111`(**手动**,第三十轮补入):同样 `getAdAccountInsights(adAccountId, …)` 整账户 → `insert({ client_id: clientId, … })`;
  - ⚠️ **第三十一轮更正**:上一版在这里写"`:119-127` 会用 `production_package_id` 把污染 snapshot 永久绑进已交付的交付物"—— **撤回,那一列不存在**,绑定从来没成功过(改记为独立的 `AD-PKG-1`)。

  **三个写入口必须共用同一套 campaign→client 归属过滤**,只修定时任务,手动同步照样能生成掺了别家投放的月报和交付记录。

  CTS 绑的就是混账户 `act_2775766642787274`，里面**确有 Oztop 的投流**。`20260721000001_ad_daily_insights.sql:17-22` 自己写着「该账户仍带 4 条 legacy Oztop campaign……**任何账户级 rollup 必须从过滤后的 campaign 行聚合，不能信账户级总数**」—— **要求写了，写入侧没实现。**
  📊 **第三十一轮实测（105 行 = 101 行已核对干净 + 2 行无法核对 + 2 行差 $0.09 四舍五入）**：已核对的行里每个 campaign 都属于该行客户，那 4 条 legacy Oztop campaign 一次都没出现。所以本条的准确定性是**隐患已上线在跑；已核对的部分未见损害，但不能宣称"全库无污染"**。优先级不降：那几条 campaign 一旦重新投放，**当天**就会污染 CTS 的健康诊断、月报和 Goal 指标。这不是补读一次能解决的，`AD-EVID-1` 只管审计取证，管不了每天在跑的同步。
  ⚠️ **那 2 行是"记了总额、丢了明细"，属于未知不属于干净**（第三十一轮 Codex P2 更正）：CTS `2026-07-02→08-01` 记 `spend=2840.49`、Oztop `2026-07-09→08-08` 记 `spend=2668.64`，两行的 `campaigns` 都是 `null`。**混账户下，没有 campaign 明细就无法判断这笔总额是否夹带别家花费**，而它已经进了 Goal 指标和月报。在按其他来源（Graph API 重拉该窗口的 campaign 级数据）对上账之前，这两行既不能证伪也不能采信 —— **重建对账是本条的交付项之一，不是可选项**。
  ⚠️ **"从过滤后的 campaign 行聚合"这句本身有个坑，不点破就会少算钱**（第三十七轮 Codex 指出，已核实）：定时和手动两个写入口拿 campaign 明细走的都是 `src/lib/meta/client.ts:123-166` 的 `getAdCampaignInsights`，它**默认 `limit = 10`、`sort=spend_descending`、且不读 `paging.next`** —— 也就是只拿花钱最多的 10 条（`20260721000001` 注释里"truncated to the top 10 by spend"说的就是它）。**账户里超过 10 条 campaign 有花费时，照这个明细重算 = 跨客户污染是过滤掉了，但本客户的花费被静默截断**，Goal、月报、交付物一起少算。
    → 实施 `AD-ISO-1` 时**必须同时改成完整分页并带 completeness 状态**：沿 `paging.next` 取全，**分页没取完就不许用部分行聚合**（宁可这一行不写/标为不可用）。
    ✅ 顺带确认：现存 105 行 snapshot 的 `campaigns` 最多只有 8 条（CTS 最多 6、Oztop 最多 8），**没有一行撞到 10 这个上限**，所以上面那个"101 行已核对干净"的结论不受截断影响。
  🔴 **⚠️ "按 campaign→client 归属过滤"这句现在没有依据可用 —— 归属表根本不存在**（第四十六轮 Codex P1，已核实。这是我开的药方本身缺前置，不是实施细节）：全仓搜遍 `supabase/migrations/`，**没有任何一张持久化的 Meta `campaign_id → client_id` 归属表**。现有几个带 campaign id 的地方都不能当依据：
  - `ad_daily_insights.client_id` —— **正是本条指出的那条错误同步路径写进去的**，拿它当归属证据是循环论证；
  - `meta_ads_snapshots.campaigns` —— 同一次整账户拉取的产物，同样不独立；
  - `flywheel_actions` payload —— 只覆盖 **ME 自建且成功落账**的广告（今天是 0 条，且 `AD-LOG-1` 那条路还会丢记录）；
  - `contacts.attr_campaign_id` —— 只覆盖真出了 lead 的 campaign。
  → 所以实施时若"按现有 insight 行过滤"，污染原样保留；若"只保留已知 id"，**会静默丢掉人在 Ads Manager 里给本客户建的 campaign**（今天绝大多数广告都是这么来的）。两种都错。
  **必须先建立并回填一张权威归属登记**（campaign_id → client_id，带来源与置信度），**对未知 campaign 采取 fail-closed 或标记 completeness**，或者干脆先做账户拆分（`meta-flywheel-risk-and-sequencing.md` §2.1 的结论）。
  修：① 同步侧按 campaign→client 归属过滤（**前提是先有上面那张归属表**；或推进账户拆分）；② `meta_ads_snapshots` 那条改为从过滤后的 campaign 行聚合，不用账户级总数，**且明细必须分页取全**；③ **拉不到 campaign 明细、或分页没取完时不许只落账户总额**（要么整行不写、要么显式标为不可用），并回头处理已存在的那 2 行
- [ ] 🔴 **AD-PKG-1 交付物里的「广告」那一栏从上线起就是空的 —— 写和读都指向一个不存在的列，两边都不报错【已上线在跑】**（第三十一轮发现）：实查 `information_schema`，`meta_ads_snapshots` 的 16 列里**没有 `production_package_id`**。
  - 写侧 `clients/[id]/meta-ads/sync/route.ts:119-127`：`.update({ production_package_id })` 是个**不 await 的浮动 Promise**，必然报错，错误只进 `console.error`，接口照样返回 200 —— 调用方以为绑上了；
  - 读侧 `clients/[id]/production/[packageId]/route.ts:116-120`：用同一个不存在的列 `.eq('production_package_id', packageId)` 过滤，PostgREST 报错被 `?? []` 吞成空数组 —— **每一份 production package 的 ads 维度都一直是空的，没有任何地方会喊一声**。
  - 这正是 CLAUDE.md 铁律 3 下半说的"发现死在日志里"的机器版：两端都在静默兜底，于是"没数据"和"链路根本没通"长得一模一样。
  - 🔴 **补列之前必须先补归属校验，否则一补列就变成跨客户注入**（第三十一轮 Codex P1，核实成立）：`sync/route.ts:33-51` 的 `production_package_id` **直接取自请求体**，鉴权只有 `requirePaidClientAccess(params.id)`（URL 里那个客户），**从不核对 `production_packages.client_id` 是不是同一个**；而读侧 `production/[packageId]/route.ts:116-120` 查 snapshot 时只按 package ID 过滤、不带 `client_id`。
    ⚠️ 方向要说准：读侧对 package 本身是**有**客户隔离的（`:37-46` 同时 `.eq('id')` + `.eq('client_id')`），所以这不是"能读走别家的包"，而是**"能往别家的包里塞东西"** —— A 客户提交 B 客户的包 ID，B 的授权用户打开自己的交付物，看到的是 A 的广告数据。跟 `AD-SEC-1` 同源：**信请求体里的外部主键，只校验 URL 里的客户**。
    现在因为列不存在而无害，**正因如此必须写进修复口径**：补列的那一刻它就活了。
  - 🔎 **根因是 schema 漂移，不是"这个功能没做"**（第三十五轮 Codex 指出，已实测确认）：仓库里**早就有** `supabase/migrations/20260522000001_p13d_production_package_links.sql`，它同时给 `meta_ads_snapshots` 和 `project_reviews` 加列 + partial index。但生产的迁移账本里**只有 `p13d_project_reviews_pkg_link`（20260524111001）这半边**，那个仓库文件整份从没登记过。实测三张表：
    | 表 | `production_package_id` | 说明 |
    |---|---|---|
    | `project_reviews` | ✅ 有 | 单独那半边跑过了 → **口碑维度是好的** |
    | `competitor_snapshots` | ✅ 有 | 走的是 `p13e_pre_competitor_snapshots` → **竞品维度是好的** |
    | `meta_ads_snapshots` | ❌ **没有** | 仓库文件里的那半边**从没跑过** → 只有广告维度是断的 |
    **所以不要新写一个只补 `meta_ads_snapshots` 的 migration** —— 那会在仓库里留下两份意图重复的迁移，把真正的问题（仓库有、生产没有）盖过去。正确做法：先核对 `20260522000001` 这份文件与生产账本的差异，再决定重放它（文件本身是 `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`，重放安全）还是写一份显式覆盖两侧的修复迁移。⚠️ 顺带查一遍**还有没有别的仓库迁移没落库** —— 账本里已经有一条 `backfill_drifted_schema`，说明这类漂移不是第一次。
  修：先定这条链路还要不要（P13.D 的原意是把当期广告数据钉进交付物）。要 → **按上面的口径处理漂移、把列补上**（**migration 待 PM `go apply`**）+ **写前按 `id + client_id` 校验包归属、读侧 snapshot 查询同时按 `client_id` 限定**，并把两侧的静默兜底改成显式报错；不要 → 把写侧和读侧一起删掉，别留一段永远返回空的代码。
  🔴 **但绝对不能顺手删掉 `20260522000001` 这个文件**（第四十一轮 Codex 指出，已核实 —— 上一版这里写的"把那份没落库的 migration 一并清理"**是危险建议，已撤回**）：它是**仓库里唯一**给 `project_reviews` 加 `production_package_id` + 索引的迁移（`grep` 全 `supabase/migrations/`，只此一份），而口碑链路（`review/route.ts`、`review/agent.ts`、交付包读侧）**正在用这一列**。生产之所以有这列，靠的是账本里那条单独的 `p13d_project_reviews_pkg_link` —— **那条在仓库里没有对应文件**。删了文件，生产照跑，但**任何新建/重建的数据库都会缺这一列**，口碑写入和交付包读取当场报错。真要清理，只能删该文件里 `meta_ads_snapshots` 那一段，**`project_reviews` 那一段必须留着**（或先补一份等价迁移）。
  ⚠️ 这本身就是 `AD-PKG-1` 那个漂移的第二个面：**生产账本和仓库文件对不上，两个方向都对不上** —— 仓库有生产没跑的（`meta_ads_snapshots` 半边），生产跑了仓库没有的（`p13d_project_reviews_pkg_link`）。修漂移时两边都要对，别只对一个方向。**顺带把 `AD-CUR-1` 里"production package 会永久关联某一条旧 snapshot"那句一并订正**（关联从来没成立过）
- [ ] 🔴 **AD-SPEC-1 房源广告没声明「住房」特殊类别 —— 建的时候不声明、回读也不查【投第一条真广告前必修，须与 `AD-GEO-0` 一起定】**（第三十八轮发现）：
  - `ad-publisher.ts:176` 写死 `special_ad_categories: JSON.stringify([])`，**不看客户业务类型**；
  - 而首投要走的 `draft-listing` 恰恰是**房源**（Roman / 30 Kiteroa 是住宅），客户服务协议 `docs/clients/30-kiteroa-rothesay-bay/service-agreement/2026-07-13-30-kiteroa-lead-gen-test-v1.html:380-383` 明确要求遵守住房广告与反歧视政策；
  - 闸门也看不见这个字段：`launch-readback.ts` / `readback.ts` / `meta-readback-adapter.ts` 三个文件里 `special` **零命中** —— 既不声明也不校验，**轻则拒登，重则违反投放限制**。
  ⚠️ **必须和 `AD-GEO-0` 同批设计**：住房类别下 Meta 会限制定向能力并对地理半径设下限（**具体口径动手前查一次 Meta 官方文档，不要照抄任何二手记忆值**）。也就是说 `AD-GEO-0` 那个"只发城市 + 10km 半径"的修法**在房源广告上可能根本不成立**。两条一起定，否则 geo 会按一个用不了的方案做出来。
  修：按**可信的客户业务类型**（不是请求体传进来的）决定 `special_ad_categories`，并把它加进激活前的回读校验（读 campaign 的 `special_ad_categories` 与预期比对，不符就拦）。**不需 migration**（业务类型若无现成字段，则需一列，届时待 PM `go apply`）
- [ ] 🔴 **AD-GEO-0 `targetingFor` 把国家和城市一起发出去，城市半径形同虚设 —— ME 建的广告从一开始就投整个国家【投第一条真广告前必修】**（第二十七轮发现，比 `AD-GEO-1` 更根本）：`ad-publisher.ts:105-109`
  ```ts
  const geo = { countries: d.geoCountries }            // ['NZ']
  if (d.geoCityKeys?.length) geo.cities = […radius 10km]  // 北岸 10km
  return { geo_locations: geo, … }
  ```
  Meta 的 `geo_locations` **包含项按并集生效** —— `NZ ∪ 北岸10km = 整个 NZ`。**也就是说 ME 自己起草的广告，天生就是"把北岸的房投给整个新西兰"**，正是 `launch-readback` 那条 `geo_mismatch` 引用的 2026-08-04 事故。而且回读会读到同一个错包络，**闸门自己跟自己比，永远一致、永远放行**（所以 `AD-GEO-1` 必须排在这条之后做）。
  修：**有城市就不要再发覆盖它的国家级包含项**（或把国家降为 `excluded_geo_locations` 之外的边界用法），再按 Meta 实际生效范围做批准前比较
  🔄 **2026-08-19 已修，PR [#1075](https://github.com/bigbigraydeng-maker/magic-engine/pull/1075) 待复审，未合并**：`targetingFor` 改成有 `geoCityKeys` 就只发 `cities`，不再同时带 `countries`；新增 3 条单测覆盖三种分支。⚠️ **尚未处理跟 `AD-SPEC-1` 的交互**——`AD-SPEC-1` 指出住房类广告下 Meta 会限制定向能力、对地理半径设下限，「只发城市 + 10km」这个修法在房源广告上可能根本不成立，两条需要一起复核（本次没做，PR 描述里未提及这个交互，复审时要留意）。
- [ ] **AD-GEO-1 `geo_mismatch` 闸门只到国家级，抓不到它自己写明的那次事故**（第二十五轮发现）：
  - `draft-listing/route.ts:302` 传的 `expectedGeo` 是 **`c.country`**（国家级）；
  - `launch-readback.ts:281-290` 只判断 `expectedGeo` 与 `geoNames` 是否互为子串，**从不比较草案里的 `geoCityKeys`**（`targetingFor` 里那个 10km 半径）。

  于是「北岸 10km 被放宽成整个新西兰」这种改动**照样通过** —— 而这条规则的 `learnedFrom` 写的正是「2026-08-04 Roman『IG 专投测试』把奥克兰北岸 $1.25M 的房投给了整个新西兰」。**规则抓不到它自己引用的那次事故。**
  修：把**可信的完整 targeting 包络**（国家 + `geoCityKeys` + 半径）持久化进 `DraftRecord`，激活前**按同一粒度**比较；国家级匹配只能当兜底，不能当唯一判据
  ⚠️ **2026-08-19 排查发现这条暂时排不进去**：`approveDraft()` 现在完全不重新回读/重跑闸门（那是 `AD-GATE-1`，更大的一块未授权工作），所以就算把 `expectedGeo` 存进 `DraftRecord`，approve 阶段也没有消费方，白做。而且 `draft/route.ts:71` 现在已经在传 `expectedGeo: client.country`——这本身就是段落里点名反对的"只重载 clients.country"写法，但由于 `AD-GATE-1` 没做，这行代码目前是死代码，暂时没有实际危害。**真正卡住的是一个产品判断**：`expectedGeo` 的权威来源应该是"这条广告要投的具体城市/郊区"，不是 client 级别的国家字段，需要先定这个再动 `AD-GATE-1` + `AD-GEO-1`，本次不做
- [ ] **AD-SEC-1 实体归属校验缺失 —— 五个入口，其中三个已上线在跑【本次审计发现的最严重一条】**：混账户下（CTS/Oztop 同账户）任何"只校验 URL 里的客户、实体 id 却取自请求体"的写路径，都能被 A 客户的调用方拿去动 B 客户的东西。这就是 strategy doc §2.4 狄仁杰记的 **R5 写越权**，那份文档还指出「ROADMAP §Phase 18 安全边界声称已校验账户 ownership，**与实现不符**」—— 至今仍不符。
  - 🔴 **`meta-ads/execute/route.ts:71+`（已上线、正在用的止损按钮）**：`campaign_id` 直接取自请求体，只做 `requirePaidClientAccess(clientId)`，**从不把 campaign 归属与该客户的 `meta_ad_account_id` 对账**，随后就用共享 system-user token 暂停广告 / 改预算。有 CTS 看板权限的人提交一个 Oztop campaign id 即可动别家的在投广告。**这条比 boost 那条严重 —— 它已经在生产里跑**
  - 🔴 **`ad-health/stop-loss/route.ts:94-115`（已上线、第五个入口，第四十九轮补入）**：跟 `execute` 同一个模子 —— `requirePaidClientAccess(clientId)` 只校验 URL 里的客户，`campaign_id` **直接取自请求体**，随后 `executeStopLoss(campaignId, action, …)` 就去暂停 campaign 或改它的 ad set / campaign 预算。**混账户下 A 客户点"止损"能停掉 B 客户的在投广告。**
    ⚠️ 注意这条和 `execute/route.ts` **是两个独立端点**，不是同一个的两种叫法 —— 修了一个不会自动修好另一个。
  - `boost-post/route.ts`：`post_id`/`page_id` 取自请求体（详见 AD-SEC-2 同类）
  - 通用 `meta-ads/draft`：见 AD-SEC-2
  - 🔴 **`winner-reel-sync/engine.ts`（第四十七轮补入 —— 原来这条清单漏了它，标题的"三个入口"实为四个）**：`loadConfig(clientId)`（`:69-84`）只按 `client_id` 取 `winner_reel_sync_config`，然后把 `ad_account_id` / `target_adset_id` / `fb_page_id` **原样拿去用，从不核验这个 ad set、这个账户、这个主页是不是这个客户的**。随后 `:187-218` 直接往那个组里建广告，`:228-272` 的每日任务还会按 CTR **暂停组内已有的广告**。
    → 所以 `target_adset_id` 一旦配错或残留成共享账户里**别家客户的组**，ME 会（a）把 A 客户的内容塞进 B 客户的广告组，（b）**自动暂停 B 正在投的广告**。这条跟 `execute/route.ts` 的区别是：**id 不来自请求体，来自一张没人校验过的配置表** —— 所以只加"别信请求体"那种守卫挡不住它。
    ⚠️ 这条还跟 `AD-PLAY-1` 咬合：那条已经指出 `winner_reel_sync_config` **没有打法/目标字段、代码也从不回读目标组的 `optimization_goal`**。同一张配置表，既没归属校验也没内容校验，却直接驱动建广告和停广告。
    修：让这条路径共用同一套**实体归属守卫**（ad set / account / page 三者都要），**归属查不出来就 fail closed**，别默认放行
    ↳ 触发它的有两处：`cron/winner-reel-sync-daily` 和看板上的「补新素材」按钮（`ad-health/execute-prescription/route.ts`）。**这两处本身不收实体 id**（`execute-prescription` 只按 `client_id` 查 `winner_reel_sync_config.enabled`），所以修守卫要修在 engine 里，不是修在这两个入口上。

  ✅ **第四十九轮已把全仓 Meta 写路径重扫一遍**（`pauseAd` / `updateCampaignBudget` / `executeStopLoss` / `boostPagePost` / `publishDraftPaused` / `activatePublished` + `src/app/api` 下所有 ads 相关 route），**没有第六个**。另核实 `meta-ads/draft/route.ts:58-64` 那句「不信请求体」的注释**只兑现了一半** —— `pageId: client.facebook_page_id ?? body.pageId ?? ''`，客户没配主页时**仍然回退到请求体**，所以 `AD-SEC-2` 依旧成立。

  修：统一加 **实体 → client 归属守卫**（campaign / page / post / form / creative 都要），或推进账户拆分（§2.1 子牙意见：**根治靠账户治理，不是写白名单**）

  🔄 **2026-08-19 五个入口已全部补上归属校验，两条 PR 待复审，均未合并**：
  - `meta-ads/execute` + `ad-health/stop-loss`：PR [#1075](https://github.com/bigbigraydeng-maker/magic-engine/pull/1075)，新增 `src/lib/meta/campaign-ownership.ts`（核对 campaign 的 `account_id` 是否等于客户登记的 `meta_ad_account_id`）
  - `boost-post` + `meta-ads/draft`（AD-SEC-2）+ `winner-reel-sync/engine.ts`：PR [#1080](https://github.com/bigbigraydeng-maker/magic-engine/pull/1080)
  - ⚠️ **局限没解决，两条 PR 里都写明了**：CTS/Oztop 共用同一个 Meta 广告账户时 `account_id`/`fb_page_id` 天然可能相同，这批守卫挡的是"campaign_id/配置行完全不在这个客户账户里"这一类，挡不住"同账户内配错到共享该账户的另一个客户"——根治仍然需要账户拆分或补一张权威归属表，是产品/运维决策，没有在这轮里做掉。`winner-reel-sync` 的 `target_adset_id` 本身也没核对（不在 `clients` 表任何字段里）。
- [ ] **AD-SEC-2 通用 `meta-ads/draft` 不校验素材归属**：`...(body as AdDraft)` 整体展开，`leadFormId`/`imageHash`/`videoId` 原样来自请求体，客户没配主页时 `pageId` 还回退 `body.pageId`；闸门只查买家可见内容不查资产归属。对比 `draft-listing` 已有 `client_assets` 租户守卫。修：补 page/form/creative 归属校验
  🔄 **2026-08-19 pageId 回退口子已堵上（PR [#1080](https://github.com/bigbigraydeng-maker/magic-engine/pull/1080)，待复审未合并）**：客户没配主页时改成 424 拒绝，不再回退 `body.pageId`。⚠️ **`leadFormId`/`imageHash`/`videoId` 的素材归属校验本身没做**——那部分需要理解 `client_assets` 表的归属规则，本轮判断范围会超出可控大小，特意没有一起动，仍是未完成项。
- [ ] **AD-FACT-1 事实来源从不校验，却盖"官网可溯"章**：`assertFacts` 只查 `sourceUrl` 非空，从不抓页面核对价格/地址/战绩，而 `traceClaims` 把原样传入的字段标成"官网可溯"。**第一条付费广告就会带着未核实内容投出去**，不是量大了才危险。⚠️ **修法不能是"按 `sourceUrl` 抓页核对"**（第二十四轮更正，Codex P1，核实成立）：**事实和 `sourceUrl` 是同一个调用方给的** —— 他完全可以指向一个自己控制、写着假价格假战绩的页面，抓下来照样"对得上"，然后拿到"官网可溯"的章。**拿请求体里的 URL 当信任根，等于没校验。** 而且直抓任意调用方给的 URL 还会引入 SSRF。

  正确修法两条一起：
  1. **信任根是客户配置的域名，不是请求体** —— `sourceUrl` 的 host 必须落在该客户已登记的官网/房源系统域名内（`master_briefs.source_website_urls` / `website` 这类已有字段），否则直接拒绝出稿；或干脆**只接受来自 ME 已核实数据记录的事实**（首条广告用这条最省）；
  2. **抓取必须走 `src/lib/net/safe-fetch.ts` 的 `safeFetchText`**（#965 刚落的 GET-only、连接绑定、带重定向与内网地址防护的原语），**不要自己 `fetch`**
  3. 🔴 **逐句来源必须持久化并显示在审批页 —— 现在它在创建请求结束时就没了**（第五十轮 Codex P1，已核实）：`draft-listing/route.ts:306-312` 的 `traceClaims(...)` **只写进 HTTP 响应**，代码注释自己写着「逐句可溯来源随交付一起给出 —— **红线要求，不是调试信息**」；但 `DraftRecord`（`draft-and-gate.ts:40-55`）**没有 `claims` 这个字段**，唯一的审批页（`ad-approval/page.tsx`）也只展示 `buyerWillSee`。全仓没有第二个调用方接住那份响应。
     → 于是「批准人逐句核对来源再点头」这件事**根本没法做** —— 到他面前时，那份逐字段来源已经不存在了，他只能看着文案批一条真金白银的广告。**校验做得再对，结论没传到决策点，等于没做。**
     修：`claims` 落进 `DraftRecord` 一起存，审批页在「开始投放」按钮前把每一句的来源标注（官网可溯 / brief 可溯 / 未证实）显示出来
  4. 🔴 **事实必须和"哪套房"绑定 —— 光有域名白名单还是能张冠李戴**（第四十六轮 Codex P1，已核实）：`draft-listing/route.ts` **从头到尾没查过 `listings` 表**。`listingId`（`:191-229`）只被拿去做**素材归属闸**（`pickUsableForListing(found, body.listingId, clientId)`），而 `body.listing`（`ListingFacts`：价格、地址、战绩）和 `sourceUrl` **全部来自请求体，从不与那套房的记录核对**。
     → 于是「**A 房的价格地址 + B 房的真实照片**」这种组合，域名白名单和素材闸**两道都过** —— 素材确实属于 B 房、URL 确实在客户域名下，但广告在拿 B 房的照片宣传 A 房的价格。这直接踩 CLAUDE.md §8「绝不凭空注入客户业务数据」那条红线，而且比编造更难发现（每一项单看都是真的）。
     修：**按 `id + client_id` 把那套房从 `listings` 读出来**当身份锚点；退一步至少要校验 `sourceUrl`、`ListingFacts` 与 `listingId` 三者指向同一套房，对不上就拒绝出稿
     ⚠️ **但"事实由 `listings` 这条记录派生"做不到，别照着施工**（第四十七轮 Codex P1，已核实 —— 上一版就是这么写的，错了）：`20260730145332_listings.sql:38-82` 里**没有 `sourceUrl`，也没有精确价格**。它有的是 `address_line` / `suburb` / `property_type` / `bedrooms`，价格只有 **`price_band` 档位**（`under_1m` / `1m_1_5m` / …），而且那个档位是**刻意**这么设计的 —— 迁移注释写明「NZ 很多房子 price by negotiation，真实要价到成交都不公开，**存一个编出来的数字比存档位更糟**」。另有 `status` / `vendor_notes` 是**内部**字段（`prospect` / `withdrawn` / 卖家备注）。
     → 所以照上一版施工会有两个后果：① `listing-draft-builder` 因为拿不到 `sourceUrl` **直接抛错、出不了稿**；② 更糟的是有人为了跑通，把 `price_band` 当价格、把 `status` 当对外说法**翻译成广告文案** —— 那是把内部档位和内部状态变成对客户的公开声明，本身就踩 §8。
     → 正确口径：**身份按 `id + client_id` 绑定（这半对），但事实必须取自一条带精确声明 + 逐字段来源的已核实记录** —— 这条记录今天不存在。**要么先扩数据契约**（给 listings 补 `source_url` + 精确价格声明 + 每个字段的 provenance），**要么首条广告只用 ME 已核实的数据记录**，不要从 `listings` 硬凑
- [ ] **AD-OBS-1 创意变体数不可观测**：`ad_daily_insights` 的 ad 级行无 `creative_id` / `asset_feed_spec`，`ad-level-breakdown.ts` 也只到 ad 级 —— "我们到底投了多少种说法"系统答不出来（用了 Advantage+ 素材自动化的广告尤其）。修：回读 `creative` + asset feed 并落库
- [ ] **AD-OBS-2 攒池测试无法按 hook 归因**：`client_audience_assets` 按 `audience_id` 唯一、无创意维度，而 `videoEventRule` 把一批 videoId 灌进同一个池 → `P18.E.3` 只给得出池子整体净增。修：一 hook 一池，或另建创意级增长映射。（完播成本那半由 `P21.K.8` 覆盖）
- [ ] 🔴 **AD-LOG-1 `record()` 漏读 `error`,而且失败时会留下失联的暂停实体【投第一条真广告前必修 —— 第四十五轮补入首投前置】**（第二十七轮升级,原写"小 bug 顺手修",低估了）：`const { data } = await supabase...insert()`,`error` 连接都没接;且它发生在 `publishDraftPaused` **已经建出 campaign / ad set / ads 之后**。
  所以插入失败时不只是"少一条账本":**那套暂停实体没有 `actionId`,既批不了也拒不了**,重试还会再建一套 —— 而 `ad-publisher.ts` 头部自己写着「半成品留在账户里比失败更糟:它会出现在后台、会被人误开、会进第二天的扫描」。
  ⚠️ **这比 `AD-ORPH-1` 更糟,不是同一回事**（第四十五轮补）:blocked / rejected 至少还有一条账本行记着 `campaignId` / `adSetId` / `adIds`,后面的人能顺着找;而这里**连行都没有**,那套暂停实体在 Meta 里彻底失联,**没有任何 ME 里的东西知道它存在**。而且 `:158-165` 拿到 `null` 照样返回 `status: 'awaiting_approval'`,调用方看到"成功"于是重试,再建一整套。
  修:① `record()` 读 `error`;② 账本写失败时按已返回的 Meta id **回滚**(publisher 已有逆序删除逻辑),或持久化可恢复/幂等状态;③ 回滚也失败时**下发人工任务**(what/how/href 三件套),不能只写 `console.error` —— 铁律 3「发现不许死在日志里」
- [ ] **AD-ADV-1 `ad-publisher.ts:116` 写死 `advantage_audience: 0`**：无差别关掉 Advantage+ 受众，是 ME 代码唯一与 Andromeda 打法正面冲突处。现有两种 `DraftKind`（`lead_form` / `video_thruplay`）都是冷投，应改为 `1`；将来加 `warm_pool_retarget` 这类 kind 时才需要显式关闭。**该路径没有留下任何成功建广告的记录（账本会静默丢记录，故只能说"无记录"），现在改成本极低**
- [ ] **AD-DRAFT-1 `listing-draft-builder` 硬写单条创意**：`creatives: [creative]`（`:193`/`:254`），而 `AdDraft.creatives` 是数组、publisher 已在循环建。同一语言内出 5–8 个角度需新增"批量角度选择/生成 + 去重 + 逐条溯源"编排层（**新增开发，半周到一周**，不是接线）。跨语言合并另需表单身份下沉到每条 creative + 表单广告混语言闸门
- [ ] **AD-FORM-1 选表单时不看语言，英文广告可能把买家送进中文表单【首条真钱广告的前置】**：`draft-listing/route.ts:82-105` 的 `pickForm(forms, wanted?)` **不接语言参数**，且该主页只有一个可用表单时**直接返回它**、不问语言；`launch-readback` 也不检查表单语言（它的混语言闸只覆盖私信）。于是按语言拆了草案也没用 —— 后果与 §5 问题 5 的"同一草案混语言"相同，只是路径不同。⚠️ **修法不能只是"把语言传给 `pickForm`"**（第二十九轮更正）：`BuildOptions` **早就有 `lang`**(`listing-draft-builder.ts:55`),缺的是**另一侧** —— `lead-forms.ts:118` 只请求 `fields: 'id,name,status'`,**表单本身没有任何语言信息可比**。传了也没东西可匹配。
  修(按可靠性排序):① **显式的 form→language 配置**(FDE 在 Settings 里给每个表单标语言,一次性,最可靠);② 回读表单的 `locale` 或问题文案再判定语言(需先验证 Graph 该节点确实返回 locale);③ 兜底:表单名必须带语言标记 + `pickForm` 强制要求 `formName`(禁止"只有一个就直接选")。**无论哪种,都要配一条"表单语言 ≠ 文案语言"的闸门**,别只靠选对
- [ ] **AD-EXPL-1 多角度测试要设"每臂最低探索量"，否则学不到东西【决定「找出赢家」这个卖点成不成立】**：把 5–8 个角度塞进同一个 ad set 让 Meta 分配，拿到的是**投放优化**，不是**可比较的角度实验** —— Oztop 那 14 条 hook 正是这个结构，`OZ-S1-A-spill` 一条吃掉 64.9%，另外 3 条不足 $1，大多数角度零探索。本仓 `ad-level-breakdown.ts:89-91` 早就写明「Meta 在同一广告系列内会先预测谁会转化再分配展示……把这种广告当成对照组会得出反向结论」，同文件的 `MIN_RESULTS_FOR_COMPARISON = 3` 与「从不宣称谁赢了」也是同一个意思。修：每臂最低展示/花费下限 + 分批放量，或直接用 Meta 原生 A/B test（`ads_experiment_abtest_*`，平台侧公平分流）。⚠️ **这要额外预算，属业务决策，需 PM 拍板**；没做之前对外只能说"多试几种说法、平台挑出跑得最好的"，**不能说"告诉你哪句话最打动人"**
- [ ] **AD-EVID-1 补读 Oztop + Roman 两个账户的 targeting【审计结论覆盖率的前置】**：本次审计的 broad/Advantage+ 结论**只覆盖 3 家客户里的 1 家（CTS）、17 条 campaign 里的 6 条**（⚠️ 不用花费占比表述 —— NZD 与 AUD 不可相加，见审计 §3.1）；Oztop 的 `1735240120460765` 是 `is_ads_mcp_enabled: false`，Roman 的花费在 `1018365291238494`（`is_queryable: false`，UNSETTLED）。两条路本次都实测过、都不通，**必须在有 `META_SYSTEM_USER_TOKEN` 的环境里**跑 `GET /act_<id>/adsets?fields=targeting,name,status,optimization_goal,campaign_id`。
  ⚠️ **必须沿 `paging.next` 翻到底，不能只读首屏**（第三十二轮 Codex P2）：Graph 的 `/adsets` 默认一页 25 条，而本次审计遇到的 CTS 账户就有 **26 个 ad set** —— 裸调一次会静默少一条，而"少读了"和"没有"长得一模一样，覆盖率和归属结论都会偏。照 `src/lib/meta/ads-posts.ts:36-66` 的写法（`while (url) { … url = json.paging?.next ?? null }` + 页数 guard），**并且撞到 guard 上限时必须把结果标成「不完整」，不能拿首屏去补审计结论**。
  ⚠️ **还要把混账户里剩下的 20 组也归属清楚**：`act_2775766642787274` 里只有 6 组能对上 ME 追踪的 CTS campaign,另外 20 组($1,278.76)含 Oztop 投流**和未被 ME 追踪的 CTS boost**,而**全部 8 个带兴趣定向的组都落在这 20 组里**。不归属清楚,"CTS 零兴趣定向"就只能说到"那 6 条 campaign",提不到"CTS 这家"。
  ⚠️ **必须带 `campaign_id` 并按归属过滤,不能拿整账户当某个客户的**：`act_1018365291238494` 挂在客户 Roman HU 名下,但 30 Kiteroa 那个楼盘(独立 client)的广告数据也落在同一账户里(见 `docs/clients/30-kiteroa-rothesay-bay/campaigns/live-ops-handoff.md`「广告数据其实一直在回流,只是记在了另一个客户名下」)。不过滤就会重演本审计第八轮那个错误 —— 把混账户的统计安到单个客户头上。活不大,但没做之前"投放侧已经做对了"这句话只能覆盖 3 家里的 1 家、17 条 campaign 里的 6 条
- [ ] **AD-FRAG-1 每条帖子一个 campaign + 一个 ad set，学习数据被打散**：CTS 账户 26 个 ad set 里 14 个是 `帖子："…"` 型 boost，单条 $2–$37。这不是"按兴趣拆人群"那种碎片化，但后果一样 —— 小预算跑不出 learning，创意之间无法在同一个竞价里公平竞争。⚠️ **这一条要拆成两件事，别当成一条修完**（第四十九轮 Codex P2，成立）：上一版改完变成"campaign 复用、预算或排期不同的各自一个 ad set" —— 但**本条声称要解决的"小预算跑不出 learning、创意无法在同一竞价里公平竞争"是 ad set 这一层的性质**。各自留一个 ad set，那个问题原样还在。所以现在这条修法**只是后台组织整洁，不是碎片化的解药**，不能记成同一件事做完了。
  - **(a) 组织归并（本条，低风险可先做）**：boost 走统一的常驻 campaign，不再每次新建一整套。收益是账户可读、报表可归并 —— **就到这儿，别声称它修好了 learning**。
  - **(b) 真正的碎片化修复（另一件事，须单独设计）**：要让创意真正进同一个 ad set 竞价，前提是**共享预算 + 单条广告自己的生命周期**（按广告起停，而不是靠 ad set 的 `start_time`/`end_time` 排期）。这会改掉 `boost-post` 现有的每次一份 `daily_budget_aud` + `duration_days` 契约（`route.ts:45-70,101`，预算与起止时间设在 ad set 层，见 `client.ts:696-698`），**属于新设计，不是顺手做**。
  ⚠️ **但不能一路并到"同一个 ad set"—— 那会打断现有请求契约**（第四十八轮 Codex P2，已核实。上一版写的是"统一的常驻 campaign/**ad set**"，那半句错了）：`boost-post/route.ts:45-70,101` 每次接受**这一次自己的** `daily_budget_aud` 和 `duration_days`（1–30 天），而 `client.ts:696-698` 的 `boostPagePost` 把 `daily_budget` / `start_time` / `end_time` **设在 ad set 这一层**。所以复用同一个 ad set 会有两个后果：① **新帖子没法有自己的预算和截止日期**；② **改这个组的预算/排期会同时影响之前所有还在跑的帖子**。
  → 正确口径：**campaign 复用（归并的收益主要在这一层）；预算或排期不同的仍然各自一个 ad set**。真要并到单个 ad set，得先把契约改掉 —— 定义共享预算 + 单条广告自己的生命周期（按广告起停而不是按组排期），那是另一件事，不能顺手做
- [ ] **AD-LINK-1 `creative_ref` 的身份粒度要按 variant 不按素材**：5–8 个角度常共用同一张图，按素材 id 记会让所有角度写同一个 `creative_ref`，角度归因归零。需 variant 稳定 id + 素材关系另存 + `adId → variantId` 绑定；配套 migration（`ad_creative_links.post_id` 放开 NOT NULL、`creative_source` 加 variant 层）**待 PM `go apply`**

### Onboarding / 第三方对接页面简化（2026-08-11，方案见 [specs/2026-08-11-onboarding-integrations-unify-v1.md](./specs/2026-08-11-onboarding-integrations-unify-v1.md)）

已上线（PR1 [#908](https://github.com/bigbigraydeng-maker/magic-engine/pull/908) / PR2 [#909](https://github.com/bigbigraydeng-maker/magic-engine/pull/909) / PR3a [#913](https://github.com/bigbigraydeng-maker/magic-engine/pull/913) / PR5 [#916](https://github.com/bigbigraydeng-maker/magic-engine/pull/916)）：GA4/GTM 补进真 OAuth provider 白名单 + DB 约束扩容 · GA4/GSC 真授权 + 老 `google_oauth_tokens` 表回填进新表 · 三处重复对接入口（`/connectors` 等）合并进 settings 页一个入口，19 处内部链接跟着改 · 顺手补上 Google OAuth 发起/回调此前零鉴权的越权漏洞。

- [x] ~~**PR6**~~ 2026-08-12 已合并（[#918](https://github.com/bigbigraydeng-maker/magic-engine/pull/918)）：已建好但一直没激活的 5 步自助向导正式设为新客户登录落地页。复审（魏征+板桥）已修：`isBriefComplete()` 卡两个完成戳导致的死循环锁 · 诸葛亮中文内部工具悬浮窗对 self_serve 客户可见（信任崩塌级） · Step1/2 表单不回填已保存数据（像丢数据）· 完成页死胡同没有返回按钮 · 500 MTC 欢迎奖励向导内无确认
- [ ] **PR6 板桥发现5（低优先级，随手可修）** Google 连接失败 vs 客户自己点取消，回向导后画面一模一样看不出区别——不卡人，PR6 已上线，这条留到下次顺手改
- [ ] **PR3b（contract 阶段，PM 已表态"优先级较低可以往后放"）** 老 `google_oauth_tokens` 表目前仍是读写兜底路径（PR3a 只做了双写+双读的 expand），等回填脚本在生产真正跑过、观察一段时间没问题后，再停止读写旧表并评估能不能删

### NZCPE 2026（新西兰中国贸易博览会 · 2026-08-05 建档，客户档在 [docs/clients/nzcpe/](./clients/nzcpe/)）

FDE 接手范围：网站 `nzcpe.co.nz`（Cloudflare Pages）+ Facebook，服务 11 月博览会。
已上线：假新闻清理 · GSC/GA4/Meta Pixel 全部接通（Pixel `1109538797562911`，全站 PageView + 三个报名表单 `Lead`）。

- [ ] **NZCPE-1 推广方向口径待 PM 一句话定死** —— 网站 SEO 已按 PM 2026-08-05 拍板改回 **B2B**（中国企业出海 / NZ 企业对华采购），而广告与社媒计划仍冲 **To C** 的 15,000 公众访客目标。两条线现在方向不同：是有意为之，还是广告也要一并转 B2B？没定死之前，广告线按 To C 继续跑。
- [ ] **NZCPE-2 GBP 建档** 地址挂 NZICC（101 Hobson Street, Auckland CBD）—— To C 推广也吃自然搜索流量
- [ ] **NZCPE-3 确认 `plan_tier`** 现设 `starter`，无预算信号，PM 确认后再调
- [ ] **NZCPE-4 广告账户挂谁** NZCPE 自建 vs Magic Engine `1018365291238494` 代投 —— PM 待拍板
- [ ] **NZCPE-5（可选，PM 决定要不要做）** 关键词调研发现 `things to do with kids auckland`（1900/月·低难度）比品牌词好抓，可做网站博客 / `news.html` 扩展 —— **但这跟 NZCPE-1 的方向问题绑在一起**，B2B 方向下这条不成立

### 三位 agent 复审剩下的（2026-08-05，已修的不列）

已修：26 个客户接口零鉴权 · 素材闸门能被一键洗白 · 撤回确认不可逆降级 · 上传页假隐私承诺 ·
chunked 绕过 OOM 闸 · 闸门没接在花钱那条线上 · 归档入口（全系统原来零个写 archived_at）

- [x] ~~**P21.J.UP1–UP8**~~ 2026-08-05 全部清掉：删房源被自己触发器挡死（外键 SET NULL 的级联是真 UPDATE）· 公开桶路径泄 client_id · 公开上传口零限流 + vision 队列全局 FIFO 跨客户饿死 · 上传失败原因被前端丢光 · `judgeAsset` 从不读 clientId + 库层无跨客户守卫 · 签字不限 FDE（客户能给自己背书）· 7 条逃逸变异逐条补测并复验 · 文件名用 `Math.random()`
      真库探针复验 6 条全过：删房源通了且素材归属自动置空 · 改挂/换文件/跨客户（INSERT 和 UPDATE）全被挡 · 签字/归档/放回来不受影响

- [ ] **P21.J.UP9** 两个新路由（房源素材列表、归档）+ 面板仍零测试。跨客户拿数、`uploadUrl` 的 fail-closed、20 文件截断回报、全失败分支，一条都没覆盖
- [ ] **P21.J.UP10** 上传文件零内容校验（信客户端 `file.type`，无魔数）；`visual-assets` 桶 `allowed_mime_types` 为 null（对比 `brief-uploads` 是有白名单的）
- [ ] **P21.J.UP11** `visual-assets` 桶仍是 `public=true`。路径已 hash 化不再泄 client_id，但「知道 URL 即可读」这条没变 —— 要根治得改私有桶 + 签名 URL
- [ ] **P21.J.UP12** 上传令牌非确定性（GCM nonce 随机），每打开一次页面就多铸一条永不过期、无法单独吊销的链接。至少要让签发落账可吊销

- [ ] **P21.J.M11** 卖家向 Reel 需要 **Ray White 侧的新证明点** —— 官网四条战绩全带前东家分行名 `Royal Heights Branch`，逐字引用不行、改写更不行。要跟 Roman 要 Mission Bay 的挂牌数/成交案例/Ray White 自己的奖项
- [ ] **P21.J.M12** `romanhu.com` 仍是旧行资料（含 `r.hu@barfoot.co.nz`）—— 广告线已被禁用词闸拦住，但网站本身该改（属 website-rescue 那条线）


- [ ] **NZCPE.1** NZCPE 2026（新西兰-中国商品博览会，client_id `3f3617f5-2124-475d-9212-6f8c14f0b0e2`，FDE 接管网站+FB，目标=11月展会 To C 推广，因粉丝基数≈0 已定调优先做广告非自然发帖）2026-08-05 已把 Page(`721663957708055`)共享给 Magic Engine 业务组合(`1265811139097132`，权限：内容+广告+成效分析)，Facebook 侧确认生效。**下一步**：验证 Magic Engine 广告账户(`1018365291238494`)能否用这个 Page 建广告；LinkedIn/Instagram/WeChat/小红书/TikTok 本轮暂缓不用管。详见 [docs/clients/nzcpe/client-brief.md](./clients/nzcpe/client-brief.md)
- [x] **NZCPE.1b** NZCPE 2026 追踪工具接线已完成 2026-08-05：GSC 验证+提交 sitemap、GA4 建 Property(`G-Q2L7PFQSB5`)、Meta Pixel 找到既有未装的 Pixel(`1109538797562911`)装上+接 Lead 事件，GTM 判断跳过(理由见 client-brief.md)。过程中发现本机 Cloudflare wrangler 全局登录会被并行窗口切走导致部署失败，改用专属 API token 解决，以后 nzcpe-site 部署都走这个 token
- [ ] **NZCPE.2** NZCPE 2026 GBP——2026-08-05 查到 Google 上已有未认领的旧档案"NZCN Expo Auckland office"(同一主办方旧年份用的)，PM 拍板改名/更新成2026版，但认领必须客户自己账号走验证流程，卡在等 Richard Meng 动手认领+加 ME Manager 权限。顺带发现网站全站 NZICC 地址写错("11–13 Hobson Street"→已修正为真实地址"101 Hobson Street, Auckland Central 1010"，13文件23处已部署验证)
- [x] **NZCPE.3** NZCPE 2026 DataForSEO 关键词调研已完成 2026-08-05，写入 `clients.primary_keywords`。真实发现：品牌词("NZCPE"等)搜索量≈0，"things to do with kids auckland"(1900/月,难度20)才是真实流量入口，内容方向应该从"贸易博览会"品牌向转成"奥克兰周末免费亲子活动"意图向
- [x] **NZCPE.4** NZCPE 2026 网站 SEO 技术审计+修复已完成 2026-08-05：加了 canonical/OG/Twitter Card(全站原本零覆盖，FB广告落地页分享没有预览图) + Event/Organization JSON-LD 结构化数据 + 修了首页 title 日期写错(19-22误写成20-22实际是20-22)。⚠️ 还差：Google Search Console 从未提交(无验证 tag)——需 PM 的 Google 账号登录才能拿验证码，我这边进不去；Meta Pixel 也没埋，投 Conversions 类广告前必须先装
- [ ] **NZCPE.5** NZCPE 2026 网站+FB 内容规划+广告计划已出草案，见 [docs/clients/nzcpe/content-and-ads-plan.md](./clients/nzcpe/content-and-ads-plan.md)。待 PM 拍板：广告预算量级、广告账户挂谁、要不要做"things to do with kids"博客内容、中文素材由谁做
- [ ] **TM.1** 团队工作记忆 · 套路层出第一条：机器已建好，但要先吃几天真实会话数据才提炼得出可复用套路。观察 `team_skills` 是否开始有行；一周后没有就回头看 distill prompt 的套路判据是不是太严
- [ ] **TM.2** 团队工作记忆 · 后台页 `/dashboard/team-memory` 补视觉验证：功能上线时页面在登录墙后未做视觉检查，数据层与接口层已验
- [ ] **TM.3** 团队工作记忆 · 补第二个 agent 复审：按铁律 4 属大任务（加表 + 新 endpoint + 新 UI），交付时只做了自审 + 变异测试，缺魏征挑刺那一刀

- [ ] **P29.SEO.14** AU/NZ SME service page QA pass - verify titles, canonicals, internal links, sitemap exposure, and only make tiny fixes if the new service pages need one more polish pass.
- [ ] **P30.S2.4** real_estate_auckland 8 个域名采集 + 写 industry_benchmarks
- [ ] **P30.S2.5** flooring_tiles_brisbane 12 个域名采集 + 写 industry_benchmarks
- [ ] **P30.S2.6** logistics_3pl_nz 9 个域名采集 + 写 industry_benchmarks
- [ ] **P30.S4.4** real_estate_sydney — 悉尼房产（等客户）
- [ ] **P30.S4.5** real_estate_melbourne — 墨尔本房产（等客户）
- [ ] **P30.S4.6** real_estate_christchurch — 基督城房产（等客户）
- [ ] **P30.S5.5** 前端加趋势列（domain 历史折线 / 14d 30d 涨跌）
- [ ] **P30.S5.6** 异常预警（domain 单次掉分 >10% 报警 FDE）
- [ ] **P30.S5.7** 客户对照视图（客户 vs 行业 P50 折线图）
- [ ] **P31.X.1** 月营收"季度签字对账"流程（避免客户自报数据失真）
- [ ] **P31.X.2** 主指标 measurement='auto' 时自动拉取 current_value（GA4 / SerpAPI / Apify）
- [ ] **P31.X.3** AI 参谋升级：基于历史 outcome 推荐 Initiative 组合（依赖数据沉淀）
- [ ] **P31.X.4** 评分公式重做（reputation / SEO / ai_visibility 维度独立大工程）
- [ ] **P31.X.5** Retention / Reactivation intent（需先接通 CRM/EDM）
- [ ] **P31.X.6** Initiative 类型扩展：Operations / Market Intelligence / Product / Partnerships
- [ ] **P33.11** Goal 详情页 Initiative 卡片展开显示：关联 Campaign 数量 + action 完成率
- [ ] **P33.12** Goal 详情页底部「执行进度摘要」区块（各 Initiative 进度条 + 总数统计）
- [ ] **P34-P3.9**（降级 backlog）`createMcpAuthAdapter(kind)` 抽取防 verifyToken 漂移（两 endpoint 已工作+测试覆盖，纯重构）
- [ ] **二期补强**（狄仁杰/魏征 backlog）：真 colleague-confirm code 流程 · IP 白名单升 DB 强约束 · 过期邮件（依赖 P2 SendGrid）· 老 mcp_access_log.key_id 列下线
- [ ] **P35.7** 转化闭环接线：replied → 发 `/discover` magic link；converted → `converted_client_id` 关联 clients
- [ ] **P35.8** 定价页 / 官网 Digital Foundation 套餐文案（板桥必审：C 端文案）。**退款保证措辞红线（PM 拍板 2026-07-06）**：保证挂「交付」不挂「效果」——「7 天内四项升级全部交付并附验证截图，做不到全额退款」；绝不承诺排名/客流/生意变好（SEO 见效 8-12 周，写效果 = 给退款开后门）；交付验证截图（前后对比）同时是 case study 素材；「提升」的证据由 $199 Keep-Alive 月报在第 2-3 个月兑现（续费 + 升 FDE 钩子）
- [ ] **P35.9** AI 语音外呼（PM 指定方向 2026-07-06）：ElevenLabs Conversational AI / Bland.ai / Vapi 选型 PoC。用途分级：**warm 跟进优先**（邮件已回复/未接来电回拨），cold call 需先查 AU Do Not Call Register 合规（企业号码也可注册 DNC）。AU/NZ 口音语音 + 通话结果回写 outbound_prospects
- [ ] **P35.10** 外呼专用域名（PM 已拍板不用主域）：候选近似域名查询 → PM 选定注册 → SPF/DKIM/DMARC 配置 → 2-3 周预热计划。主域只收回复，保 magic link 通道信誉
- [ ] **P35.11 邮箱深挖（治本，PM 拍板 2026-07-13）⭐**：**「假邮箱」≠「没邮箱」** —— 诊断 9 个被判无邮箱的商家（Maddren Homes / Clinic 1 / ETF Electrical / Roofing Excellence / Space Air / The Cosmetic Store / Factory Carpets / Voltsy / Moore Quality），**全部有真实官网 + 电话，4 家还有在线询盘表单**。根因 = 抓取器只读首页 HTML、抓到主题占位符（`user@domain.com`/Wix `mysite.com`）就当邮箱、漏了真邮箱。三条深挖路径（PM 全部同意）：
- [ ] **P35.12 $19.90 Tripwire Onboarding（获客漏斗第一钩，PM 拍板 2026-07-13）⭐⭐**：一次性 $19.90「onboarding 数字优化」当 tripwire → 建联建信任 → 上钩 $990 套餐（GEO / FB 代运营 / newsletter+WhatsApp）。**设计原则**：每个 $19.9 交付物 = 一个 $990 套餐的「种子」，展示价值同时暴露只有 $990 能补的缺口。
- [ ] **P35.13 社媒内容引擎升级（IG 原生 + 品牌套件，为 $990 代运营铺路）**：现输出主打 FB 文字帖、太粗不符 IG。三支柱：① IG 原生格式模板库（轮播/Reel/精修图/Story）② **每客户品牌套件**（从 logo/官网抽主色+2 字体+滤镜，治「粗犷」根因，精致来自模板不是原始 AI）③ 视频优先（Higgsfield shorts_studio/Seedance 出竖版 Reel + virality_predictor 筛）。能力已有（Atlas/Higgsfield/HeyGen/Publer），缺模板+品牌系统。医美 before/after 有 Meta+NZ 合规限制 → 主打不需临床照的科普/团队/FAQ。**先建一套医美 IG 样板跑通一家再产品化**。此项是「医美 Wave 2」的前置。

## Phase 7 — 遗留尾项 ⚠️ 计划执行日期已过期，需判断是否作废

- [ ] **P7.4.14** 第 2/4 周复跑 AI Tracker，对比排名变化（2026-05-12 执行）
- [ ] **P7.4.15** 第 4 周生成首份月报（2026-05-26 执行）

## H2 规划（Phase 8-10）

- [ ] **P8.2.4** 社媒联动：博客 approved 后，自动在策略面板生成 3 条对应社媒话题建议（Facebook / Instagram / LinkedIn）
- [ ] **P8.P.1** 新建 `paid_ad_sets` 表（client_id / brief_id / set_name / format_matrix / status / created_at）
- [ ] **P8.P.2** 新建 `paid_ad_copies` 表（set_id / format_type / headline / body / cta / visual_prompt / visual_asset_id / status）
- [ ] **P8.P.3** `src/lib/paid-social/brand-dna-extractor.ts` — 从 Master Brief 提炼 Brand DNA（价值主张 / 受众痛点 / 差异化 / 证据点），Strategy Engine（Claude）输出结构化 JSON
- [ ] **P8.P.4** `src/lib/paid-social/ad-copy-generator.ts` — 按格式矩阵批量生成广告文案，Content Engine（GPT-4o-mini）输出，AU/NZ 本地英语拼写强制约束
- [ ] **P8.P.5** `src/lib/paid-social/visual-prompt-builder.ts` — 为每条广告生成配图提示词（结合产品图描述 + 品牌色调 + 格式规格）
- [ ] **P8.P.6** `POST /api/clients/[id]/paid-social/generate` — 触发一次完整生成（brief_id + 可选 format_filter + 可选 reference_image_desc）
- [ ] **P8.P.7** `GET /api/clients/[id]/paid-social/sets` — 广告集列表
- [ ] **P8.P.8** `GET /api/clients/[id]/paid-social/sets/[setId]/copies` — 单集文案列表
- [ ] **P8.P.9** `PATCH /api/clients/[id]/paid-social/copies/[copyId]` — 编辑单条文案 / 更新状态
- [ ] **P8.P.10** `POST /api/clients/[id]/paid-social/copies/[copyId]/generate-image` — 单条文案触发 Visual Studio 配图生成
- [ ] **P8.P.11** 路由 `/dashboard/paid-social/[clientId]` 创建（含客户选择 landing）
- [ ] **P8.P.12** 生成面板：选择 Brief + 勾选格式类型 + 可选填产品图描述 → [Generate Ad Set] 按钮（预估 10 分钟）
- [ ] **P8.P.13** 广告集列表视图（按格式分组 Tab，每条展示 headline / body / CTA / 状态）
- [ ] **P8.P.14** 单条广告卡片：文案内联编辑 + 右侧配图提示词展示 + [Generate Image] 按钮
- [ ] **P8.P.15** 批量操作：[Generate All Images] 一键触发全集配图生成（复用视觉生成队列）
- [ ] **P8.P.16** 侧边栏导航加 "Paid Social 📣" 菜单项
- [ ] **P8.12.S1.6** 张骞 Apify 商业情报扩展 — 社媒真实指标 + FB 广告 + 小红书 + Google Search（张骞按需调用，非每次全跑）
  - [ ] **S1.6b** 小红书 RedNote scraper（新封装 `apify/xiaohongshu-scraper.ts`，actor `zhorex/rednote-xiaohongshu-scraper`）+ `SocialPlatform` 枚举加 `xiaohongshu` + 接入（⚠️ 该 actor 无评价，先小范围实测）
- [ ] **P9.1** 月报 PDF 导出 + 邮件自动发送（Strategy Engine 生成分析文字，Puppeteer 截图）
- [ ] **P9.2** 客户 Portal（client-facing view，只看自己内容 + 当月月报）
- [ ] **P9.3** 站点权威度追踪（DA / 外链 / 内链趋势）
- [ ] **P9.4** Cron：每日 sync Content Workspace → 主库；每周一跑 AI Tracker + 更新策略建议
- [ ] **P9.5** 批量执行：一键为所有 approved 策略条目生成对应内容
- [ ] **P10.1** 小红书 / LinkedIn / TikTok 视频自动剪辑支持
- [ ] **P10.2** 多语言内容支持（中文市场优先）
- [ ] **P10.3** Magic Lab Academy 课程化（基于 CTS Tours 实战 SOP）
- [ ] **P10.4** Plugin 形态：WordPress / Webflow GEO 自动注入插件
- [ ] **P10.5** Google AI Overview 追踪（SerpAPI，AU/NZ 市场必做）

## 技术债

- [ ] **TD.1** Content Workbench 编辑失败无错误提示（当前静默失败）
- [ ] **TD.2** 图片生成失败后无法手动重试（需刷新页面）
- [ ] **TD.3** Supabase MCP 未连接 Magic Engine 项目（需加 `glbdnayojixmexgofbsd`）
- [ ] **TD.4** 缺少 Supabase Row Level Security 规则
- [ ] **TD.5** 视觉生成队列在客户端 localStorage（需迁移到服务端）
- [ ] **TD.6** 第三方真实名在部分 UI 文案中暴露（需扫描 + 替换为封装名）
- [ ] **TD.12** `SeoContentAdapter.pullMetrics` 入库失败只 `console.error` 不抛 —— 回执会报「写了 4 行」而库里 0 行。2026-09-07 每周 SEO 快照上线时发现，属适配器旧账，未在那条链路的 PR 范围内修（[#1440](https://github.com/bigbigraydeng-maker/magic-engine/pull/1440) 复审记录）
- [ ] **TD.13** `getDomainMetrics` 两层 `Promise.allSettled` 把 provider 故障写成 0 值 —— DataForSEO 故障那一周，全体客户的 SEO 指标会被记成 0 并写进 `flywheel_metrics`，Check / Tune 读到的是假数据。同 [#1440](https://github.com/bigbigraydeng-maker/magic-engine/pull/1440)，链路开跑后它从「潜在」变成「每周可能发生」
- [ ] **TD.14** 「谁买了 SEO」这个商业事实被编码成「填没填网址」这个技术字段 —— `flywheel-seo-weekly` / `keyword-snapshots-weekly` 等 5 条链路共用 `client_status='active' AND domain IS NOT NULL` 判据，随手给不买 SEO 的客户填个占位网址就会把他拉进每周付费扫描（PITFALLS 已记）。服务范围应由 client-level 配置决定，不由字段有没有值决定
- [ ] **TD.10** Git 本地分支堆积（20+ 个 `claude/*` 和 `feat/*` 废弃分支）
- [ ] **TD.11** `agitated-mahavira-be6d17` 等 worktree 物理目录占用磁盘空间
- [ ] **TD.7** 收集器模块（6 个）缺少错误重试机制
- [ ] **TD.8** 月报聚合库缺少事务型一致性保证
- [ ] **TD.9** 聚合器性能未优化（N+1 查询）
- [ ] **TD.10** 月报查询端点缺少分页 / 排序参数
- [ ] **TD.11** API 缺少速率限制（Rate Limit）
- [ ] **TD.12** 月报页面缺少加载骨架屏（loading skeleton）
- [ ] **TD.13** 分节组件之间缺少交互（drill-down / tooltip）
- [ ] **TD.14** 月报导出功能（PDF / 邮件）未实现（P8.2 任务）
- [ ] **TD.15** 聚合器单元测试覆盖率 < 70%
- [ ] **TD.16** 未做月报端到端测试（CTS Tours 实际客户）
- [ ] **TD.17** 聚合器架构文档缺失
- [ ] **TD.18** 缺少聚合器性能 / 错误监控仪表板

## Phase 11 — Creative Intelligence Engine（未来重点开发方向）

- [ ] Markifact API 能否回传 `creative_parent_id`（绑定我们的 seed creative）
- [ ] Markifact 能否提供"创意 × 受众 × 转化"三维数据切片
- [ ] Supabase `visual_assets` 表加 `embedding vector(512)` + `style_scores jsonb` 列

## Phase 12 — 飞轮数据闭环 ⭐⭐⭐（活跃，2026-05-17 启动）

- [ ] **P8.S.8** — `batchKeywordOverview`（`phrase_these`）→ `keywords_data/google_ads/search_volume/live` + `bulk_keyword_difficulty`（两次 task 合并）

## Social IMPACT — Check → Tune 闭环（Issue [#1413](https://github.com/bigbigraydeng-maker/magic-engine/issues/1413)，CTS Customer Zero）🔄 Gate A + Gate B 步骤 1-3 已上线，Gate B/4 待授权

Gate A（激活 Check，让 Daily Plan Post 的 Facebook 发布真的能被自动测量回来）与 Gate B 步骤 1-3
（evaluator 纯函数 [#1451](https://github.com/bigbigraydeng-maker/magic-engine/pull/1451) + cohort loader
[#1452](https://github.com/bigbigraydeng-maker/magic-engine/pull/1452) + Daily Plan 页面显示效果建议
[#1453](https://github.com/bigbigraydeng-maker/magic-engine/pull/1453)）已合入 main，详见
[CHANGELOG 2026-09-08](./history/CHANGELOG.md)。CTS 因为只有一条未撤回的 Daily Plan Post，样本量凑不齐
Gate B 定的 `minSampleSize=3`，页面目前只会显示「数据还不够说话」占位——这是规则的正确表现，不是 bug。

- [ ] **Gate B/4（A 级 · 需 PM 单独授权）** —— 保存下一份 Daily Plan 时，记录本次采纳/拒绝了哪条 Tune 建议
      + source action ids，形成 lineage。这一步会动 Kernel 保存路径，是整条 Gate B 里唯一真正「写」的一环，
      按 Issue #1413 冻结的 Scope 走：人工审批保留，无自动发布 / 排期 / provider write / 广告花费。
- [ ] **evaluator cohort 全 0 时的 caveat 缺口**（魏征复审 #2，PR #1453 review）—— cohort 全部 `ok/partial`
      但 likes=0（新账号 / 权限不足未落 unmeasurable 的边界情形）时，target 只要 > 0 就判 REPEAT +
      `deltaPct: Infinity`，语义上可能鼓励重复"没人看的内容形态"。至少加一条 `cohort_all_zero` caveat。
- [ ] **阈值比较未走 roundTo 的浮点边界**（魏征复审 #3）—— `social-post-evaluator.ts` 的
      `>= repeatDeltaPct` / `<= stopDeltaPct` 判断走原始 `deltaPct`，不像展示层那样先 `roundTo(1)`。
      实数输入（如 13.7 / 10.53）可能在边界附近漂移到另一侧决策，现有测试只锁了整数边界。
- [ ] **`normalizeStatus` 三处复制**（魏征复审 #6）—— `social-post-cohort.ts` 与
      `campaign-tune-suggestions.ts` 各自定义了同样的 `normalizeStatus` / `parseNumberMap` /
      `parseStringMap`。未来 receipt status 定义变更（例如加 `'timeout'`）三处都要改，属「假件与 SQL 同步」
      同类事故模式，建议下沉到 `src/lib/flywheel/tune/` 下的共享 helper。

## Phase 24 — Execution Loop Closure（执行闭环修复）📋 已登记，2026-06-06 启动

- [ ] P24.A.1 migration: `20260606000001_execution_items_zhuge_source.sql`
- [ ] P24.A.2 `action-persister.ts` 新增 `writeExecutionItems` + 接入 `persistZhugeActions`
- [ ] P24.A.3 `__tests__/action-persister.test.ts` 补充测试（TDD 先写）
- [ ] P24.B.1 `src/app/api/cron/zhuge-recalculate/route.ts`
- [ ] P24.B.2 `render.yaml` 追加 cron 定义
- [ ] P24.C.1 `deploy/page.tsx` + `DeploymentForm.tsx` 改造
- [ ] P24.C.2 `publish-geo-snippet/route.ts` 新增路由

## Phase 24.M — Leads 营销中心（多渠道 CRM · 拳头产品，与内容工厂同级）🔄 邮件已通，其余待开工

> PM 2026-08-02 定方向：CRM 要把邮件 / WhatsApp / Messenger / 电话收进一个地方，
> 客户从一处就能看到全部进度。给**所有** ME 客户用，不是 CTS 专属。
> 渠道优先级（PM 拍板）：**电话 · 邮件 · Messenger · WhatsApp 高**；短信和 newsletter 靠后（它们不是实时交流）。
> AI 客服路由（PM 拍板）：客户开通了 Meta AI 客服就默认用它（CTS 就是这么配的）；没开通的改用 WhatsApp Business API 接我们自己的客服中心。

- [x] M1 多渠道发送总线 `lib/messaging/channels.ts` + Messenger 适配器（PR #779）
- [x] M2 公司邮箱接进来：授权 + 读信 + 落成人 + 每小时同步（PR #774 / #780 / #781）
- [x] M2.1 「今天该联系谁」版式重做：三层带底色 + 批次缩进 + 铺满宽度（PR #788 / #792）
- [x] M2.2 销售的三个出口：推迟（到期自己回来）/ 他不买了 / 这批分错了（PR #792）
      **刻意不给「手动改分组」** —— 手动状态列必烂，见 CHANGELOG 2026-08-03
- [x] M2.7 **今天的名单一天之内不变**（PR [#985](https://github.com/bigbigraydeng-maker/magic-engine/pull/985)，合并提交 `096111a7`）——
      做完的就地变灰、不跳组不消失；推迟 / 推到成交同样留在原位（原 M2.7a 缺口一并补上）；
      「周五给报价」这类相对日期能自动排上下一步（解析器原先不知道今天几号）。
      判据在 `lib/crm/day-list.ts`：**只冻结我们做的动作，不冻结客人做的动作**。
      Codex 六轮 15 条：13 改 2 驳（理由在 PR 讨论里存档）。
- [x] M2.7b **卡片上直接敲一行，说个时间自动排上下一步**（PR [#989](https://github.com/bigbigraydeng-maker/magic-engine/pull/989)，合并提交 `a097a7f5`）——
      板桥要的那个：一手拿电话，卡上敲「三月两个人去南岛，周五给报价」，回车就完事。
      关键不在输入框，在**存完那句确认**（`lib/crm/next-step.ts`）：必须分得清「读懂了 →
      说出哪天」「没说下一步 → 别出声」「说了但没读懂 → **明说没排上**」。
      漏掉第三种 = 销售以为排好了、那天没人提醒 = 答应客人的事砸了。
      「有没有约下一步」交给解析器答（`mentioned_next_step`），正则只当兜底 ——
      正则版被改了四轮、其中一轮自己制造了反向的错，见该文件头。
- [ ] **M2.7c 三段式重排** —— 现在是 3 层 + 6 组 + 底栏 + 终端/同行开关 ≈ 10 个概念，
      CTS 员工要先学术语才能干活。改成「今天要联系的 / 今天联系过的 / 先放着」三段，
      分类词降级成卡片上一行「他为什么在这」。设计与三人评审意见见 PR #985 讨论。
      **M2.7 那三样里唯一没做的**；建议等 PM 线上用过 M2.7b/d 再动，免得照着想象改版式
- [x] M2.7d **页面内回私信后立刻变灰**（PR [#988](https://github.com/bigbigraydeng-maker/magic-engine/pull/988)，合并提交 `df2c818c`）——
      `messenger/send.ts` 发送成功后当场补写出站触点，**幂等键跟每小时同步用同一个**
      （`source='messenger'` + `source_ref='<convId>:out'`），所以同步再跑不会记两笔。
      时间只许往前推（`advanceOutboundTouch` 用两条原子语句，不做「先读再写」）
- [ ] **M2.7 收尾：等 PM 拍的一件事** —— 「说好周五给报价，这几天他还该不该出现在
      今天的名单上？」现在的行为是**照旧每天出现**（`segmentContact` 规则 3 只认
      `callbackAt <= now`，未到期的约定不改变任何事）。收起来能少打扰，也可能让一个
      本该趁热跟的客人凉三天 —— 这是生意决策不是实现选择，已上抛 PM，代码注释里存了理由
- [ ] **M2.7 已知后续项：重试时那句确认会降级** —— 第一次请求写入成功、但响应在
      传输中丢失，销售用一字不差的原文重试会命中去重，看到的是「之前已经记过了」
      而不是真正排上的那天。**笔记和排期都在，丢的只是确认**。要修得对，服务端得在
      命中去重时把已存那条触点的 metadata 读回来再生成确认（不能用重试请求的新解析
      结果，两者未必一致）—— 够单独一个小 PR。见 PR #989 讨论
- [x] M2.7e **号码打不通不等于这个人不要了**（PR [#995](https://github.com/bigbigraydeng-maker/magic-engine/pull/995)，合并提交 `79873161`）——
      线上 24 个被标坏号的人里 **23 个后来又来过消息**，15 个一直在跟我们邮件往来。
      判据分层：**联系方式是渠道属性，成不成是人的状态，两件事不许互相覆盖。**
      坏号只关掉电话那条路（卡片、抽屉、「全部客人」三处一起禁用拨号），
      只有真的一条路都没有才退出名单。坏号看**最后一次判决**，不是历史上出现过；
      拨到空号**不算「今天跟进过他」**（否则待办被折叠藏起来，铁律 3）。
- [x] M2.7g **「暂时不考虑」不再被当成「明确不要了」**（PR [#996](https://github.com/bigbigraydeng-maker/magic-engine/pull/996)，合并提交 `c9b466f2`）——
      PM 给的业务事实：leads 聊过之后分「暂时不感兴趣、还要继续营销」和「明确不要」两种，
      下场必须不一样。线上 17 个人被标成终结性的 `not_interested`。
      存量记录**读的时候重判一次**（不回填，不动客户数据），否则这次改动只对以后的笔记生效。
- [ ] **M2.7h 「暂时 / 最终」的判断交给解析器，正则只留兜底** —— 上面那条做完之后，
      Codex 连续八轮在同一个地方挑出边缘用例（`ready` → `yet` → `going` → `考虑一下` …），
      每收窄一次就冒一个新说法。**这不是规则不够细，是正则做不了语义判断。**
      本仓在 `lib/crm/next-step` 已经得出过完全相同的结论并留下「别再往它上面加规则」。
      要做的两件事：解析器多答一个「这是暂时的还是最终的」；解除 `parseNote` 对规则结果的
      **无条件覆盖**（现在模型读懂了也纠正不了）。跟 M2.7i 一起做最省事
- [x] 🔴 **M2.7i 让系统读到那 90% 的对话，自动填「跟进到哪一步」** —— PM 2026-08-16 拍板「读」。
      线上实测：系统只读得到**电话手记 295 条**，而**邮件正文 523 条、私信 2099 条
      （658 个会话）从来没被读过** —— 私信内容在 `conversation_messages` 里，
      触点表只写了一句「Messenger 私信（N 条往来）」。
      所以 583 个人里 **556 个阶段是空的**，不是规则不够细，是系统没读过他们说的话。
      已做：`lib/crm/stage-from-conversation`（判断）+ `lib/crm/stage-infer`（取数落库），
      挂在已有的 `messenger-brief-hourly` 上跑第三遍，不新注册 cron。
      三条硬线：**只填空着的**（写库那一刻再判一次，绝不覆盖人工判断）·
      **模型说不出逐字原话就整条丢掉**（铁律 8）· **终结档和涉及钱的档模型一律不许落**。
      不引入任何新数据源：读的全是我们自己的号两个月前就同步进来的东西。
      **还没验证的**：线上真实填出来的准确率 —— 第一轮跑完要抽查 `contact_stage_events`
      里 `changed_by = 'ai:conversation-read'` 那些，看判词和原话对不对得上
      **读不出来就进「新线索」**（PM 2026-08-16 拍的简化）：那本来就是他真实的
      位置。写下来他就不在候选里了 —— 不必记「上次什么时候试过」，也不必轮转
      队列，原本要为此加的那一列（`stage_inferred_at`）直接不用做了
- [ ] **M2.7j 给「正向意向」一个专门的信号** —— 现在「他现在想订了」只能落成兜底的
      `spoke`，跟系统群发写下的那一笔分不开。于是二选一：要么群发抹掉客人说过的
      「现在先不考虑」，要么后续真的谈热了也解不开。本次选了后者（保住客人的话）。
      正解是解析器多答一个 `wants_to_book`，或销售一键按钮。见 PR #996 讨论
- [ ] **M2.7k 抽屉里刚标完坏号要即时刷新** —— 现在那个 `tel:` 链接要等抽屉关掉才消失。
      危害最轻（销售刚亲手打完「这个号是空号」，不会转头去点），但牵扯抽屉里所有
      写操作的局部刷新，值得单独收口一次。见 PR #995 讨论
- [x] M2.7l **可能被误判成「永久别再联系」的人，已接进今日待办** ——
      旧词表把「不打算去」当成了「别再联系」，而那个标记的含义是**任何渠道都不许再发**。
      线上 13 个被永久拉黑的人里 8 个原话确实划过界限，**1 个只因为「不打算去」**。
      **刻意不写自动解除**：让正则去解开这个闸，万一原话里同时含着真拒绝，
      就会骚扰一个明确说过别联系的客人 —— 客户红线不该由规则来赌。
      按铁律 3 下半条下发成人工任务，**进今日待办**（`pm-todo/manual-items.ts`
      的 `dnc_maybe_wrong`），带直达那个人的链接；真说过「别再联系」的人一条都不打扰。
- [ ] **M2.3 用 `crm_segment_feedback` 改判据** —— 表建好了，还没有人去看它。
      攒够一批「分错了」之后要回去改 `lib/crm/segments` 的规则，否则这个按钮
      就变成一个只进不出的许愿池
- [x] M2.4 分批规则按「只认真实对话」重做；秒回=机器（Meta AI 回复不再冒充真人跟进）；
      打了没接 3 天转自动跟进；拿掉「快出行了」；号码坏了单独成组（PR #797）
- [ ] **M2.5 新人邮件（PM 规则 1，本次明确没做）** —— 客人第一次进来当天自动发一封。
      卡在两件事上：① 挑发信通道（Mailchimp / Resend）② 文案要按铁律 8 先 grounding
      客户官网、逐句标可溯来源，且发出去之前 PM 要看过。做完之后第二层才配叫
      「发过新人邮件」，现在老实叫「还没搭上话」
- [ ] **M2.6 确认 Meta 自动化消息的真实 tag** —— `lib/messenger/automation` 里
      `AUTOMATED_MESSAGE_SOURCES` 那两个值（`subscription` / `business_ai`）到今天
      **仍是猜的**，Meta 没公开文档。现在靠「秒回 = 机器」兜住了，但拿一条 CTS 真实
      收件箱的 Graph 返回确认一次，判据会更硬。这台开发机连不上 facebook.com，做不了
- [ ] **M3 从 CRM 里回邮件** —— 权限已经要了 `Mail.Send`，缺一个邮件适配器接进总线（`lib/messaging/adapters/mail.ts`）
- [ ] **M4 邮件线程接进多渠道读取路径** —— 现在私信页面靠 `channel = 'messenger'` 把邮件挡在外面（PR #781），挡住≠接好；需要一个不挑渠道的对话页
- [ ] **M5 WhatsApp Business API（新号）** —— 申请清单已给 PM（`docs/sops/whatsapp-business-api-申请清单.md`）。⚠️ AU/NZ 单价未核实（这台开发机连不上 Meta 站点），拿到后台截图后补
- [ ] **M6 客户员工账号 + 角色 + 归属 + 转派 + 推手机** —— PM：「ME 的登陆系统需要给到 client 的员工层级」。`conversations` 已有 `owner_email` / `snooze_until` 两列待用，不需要 migration
- [ ] **M7 「谁来回」开关 + Meta AI 客服配置**（AI 先答 / 人工先答 / 分时段）
- [ ] **M8 IP 电话外呼 + 通话记录回流**（与 Phase 36 Voice Agent 合流）🔄 判断层已上线
      - [x] M8.1 判断层 `lib/threecx/call-plan.ts`（PR #821）—— 一通电话在 CRM 里意味着什么。
            **不依赖 3CX 接口长什么样**，所以对方还没开通也能先做完先审完
      > ⚠️ **2026-08-05 方案推翻重来**：3CX 那些读通话记录/录音的 REST endpoint
      > **官方不提供、没有文档、不保证长期可用，对方明确不建议用在生产环境**。
      > 改用官方支持的 **Data Connector**：我们开一个数据库给他们，3CX 最短
      > 每 15 分钟把通话记录 + 录音下载链接**推**进来。判断层不受影响（一行没改）。
      - [ ] **M8.2 落地库** —— 单独开一个 Postgres，**绝不能是主库**。方向反了：
            原来是我们拿他们的凭证去读，现在是**他们拿我们的凭证来写**，凭证泄露
            的代价从「读不到通话记录」变成「所有客户的数据」。同实例开个受限角色
            是「配置对了才安全」，单独一个库是「配置错了也还安全」—— 只选后者。
            **一个客户一张表 + 一个账号**（3CX 不知道我们的客户编号；混表靠字段区分
            = 对方配错一次，A 客户的通话记录落进 B 客户的 CRM）
      - [ ] **M8.3 取数层** `lib/threecx/landing.ts` —— 按水位线读新行 → 翻译成
            `CallRecord`。水位线要留重叠窗口（跟邮件同理：不留重叠，一次失败就在
            时间线上留一个永久的洞，而且不报错）
      - [ ] M8.4 落库层 —— 复用 `resolveContact`（电话身份）+ `contact_touchpoints`
            （`channel:'phone'` / `source:'threecx'` / `source_ref` = 通话编号）
      - [ ] M8.5 `/api/cron/call-sync` 每 15 分钟 + 同一个 PR 内加 `render.yaml` 调度条目
      - [ ] **M8.6 ⏳ 录音要不要留档 —— PM 拍板，有到期日** 推过来的是下载链接，
            录音本身在 3CX 那边**只存 3 个月**。默认做法是只存链接不复制音频
            （数据最少、风险最小、不花存储钱），代价是 3 个月前的通话将来听不回来。
            要不要复制进自己的存储是业务+隐私决策 —— **接通后第一个 3 个月内必须定，
            过了就不是改主意而是已经丢了**
      > 设计见 [`docs/specs/2026-08-04-threecx-call-ingest.md`](./specs/2026-08-04-threecx-call-ingest.md)
- [ ] M9 短信 · M10 从 ME 发 newsletter（优先级靠后，PM 明确）

**已知待补**（都不影响现在上线）：
- [ ] 设置页那个 ✅「私信正在同步」是写死的，没连也显示绿勾 —— 会骗人，要改成真状态
- [ ] `mailchimp-activity-sync` 没有 run-logging，断了看不出来
- [ ] segments / display-name 里有 3 处写死的旅游业措辞，接第二个行业前要抽出来

**M2.7n 「别再联系」判不准 —— 四张已开的票**（2026-08-17 从 PR
[#998](https://github.com/bigbigraydeng-maker/magic-engine/pull/998) 拆出，
与上面的 M2.7h / M2.7m 是同一件事的四个面，**票在 GitHub 上，这里只做索引**）：
- [ ] [#1019](https://github.com/bigbigraydeng-maker/magic-engine/issues/1019) 换掉「他是不是要求别再联系」的判据 —— **怎么判**
- [ ] [#1025](https://github.com/bigbigraydeng-maker/magic-engine/issues/1025) 🔴 Facebook 私信正文根本进不了这个判据 —— **喂什么进去**。
      私信是 CTS 客人说话最多的渠道（2099 条 / 658 会话），闸是硬的、闸后面是空的。
      ✅ **提示这一半已上线**（PM 2026-08-17 拍板 B 方案）：私信里像是说「别再联系」的人
      进今日待办「🙋 需要你动手」，销售点进去看原话再决定 ——
      `lib/crm/messenger-stop-signal.ts`，**一行写操作都没有**。
      ⏳ **接进判据自动封渠道那一半仍不做**，前提是 #1019 先把判据修准。
      两条已知代价（都写在模块文件头）：只看最近 30 天 · 每客户每轮最多 20 条。
      要做到「一条不漏又不重复骚扰」得加一列「已复核」（改 schema，A 级），单独立项
- [ ] [#1026](https://github.com/bigbigraydeng-maker/magic-engine/issues/1026) 中文「别再联系我」这类写法漏判
- [ ] [#1027](https://github.com/bigbigraydeng-maker/magic-engine/issues/1027) 「别打电话，只发邮件」记不住 —— 需要**按渠道**的信号。
      PO 2026-08-17 已拍板短期行为：这种人**继续发邮件、留在邮件营销池里**

**M2.7p 「点私信」开场白补档案的四条后续**（2026-08-17，PR
[#1031](https://github.com/bigbigraydeng-maker/magic-engine/pull/1031) 上线时逐条登记不修；
能力本身已上线，见 [CHANGELOG 2026-08-17](./history/CHANGELOG.md)）。
四条同源 —— **补档案与认亲该有自己的一轮设计，不该继续在同步链路里加分支**：
- [ ] 存量回填是逐个联系人串行查询，量级上去要改批量
- [ ] 给「试过、补不上」的人打标 —— 现在每轮都重扫这批人，看着在跑其实原地踏步
- [ ] 解绑了 Facebook 主页的客户跑不到本地回填（凭证闸之前那一步只覆盖已绑的）
- [ ] 只留电话没留邮箱时按电话认人 —— 现在会多出一条重复联系人。
      **刻意先不做**：认亲弄错是不可逆的（两个人并成一个），而重复联系人只是难看

> ✅ 原第五条「第一条入站消息没有『主语是我』这层保护」**已修**（2026-08-17）——
> 没有问候语时的门槛由两条标准字段提到**三条全齐**，见 CHANGELOG 同日条目。

## Phase 25 — Self-Serve Portal ⚠️ 已并入 Phase 20.0

- [ ] **P25.A.1** Migration：`public_scan_jobs` 加 `client_id` 可空 FK
- [ ] **P25.A.2** 新建 `POST /api/onboard/self`
- [ ] **P25.A.3** `/prospect` 页面加转化 CTA
- [ ] **P25.B.1** 新建 `/portal/[clientId]/discovery/page.tsx`
- [ ] **P25.B.2** Portal 首页加 Discovery 摘要卡
- [ ] **P25.B.3** PortalNav 加 Discovery 链接
- [ ] **P25.C.1** 新建 `/portal/[clientId]/diagnosis/page.tsx`
- [ ] **P25.D.1** 新建 `/portal/[clientId]/prescription/page.tsx`
- [ ] **P25.D.2** 新建 `/portal/[clientId]/plan/page.tsx`

## Phase 21 — AI Content Factory（旗舰能力 · FDE 默认产能引擎）📋 MVP 计划已登记，待开工 P21.1

- [ ] **P21.J.M1 地基**(≈1 周):migration 7 表 + `clients.brand_redline_phrases` + claim RPC + `content-factory` bucket(**一次 PM 拍板 apply,worker 严禁自行 apply**);`POST /api/factory/signals`;策略 agent 全闸(brief/goal 溯源 + 去重 + fail-closed)+ 工单生成。验收:模拟疲劳信号→带溯源+人话理由的工单;撞红线→人话拒绝;同 ad 重复信号→`duplicate_open_order`
- [ ] **P21.J.M2 生产线**(≈1.5-2 周):本地 worker(claim/heartbeat/complete/fail)+ Video Studio + Edit Engine 接入;独立审核 base `ME Factory Ops`(Factory Review + Winner Intake)+ 双向 sweeper + 审核人白名单;`BrandRedlinesPanel`;muapi 计费模式+视频上传权限双 spike(开工第一天)。验收:PM 在 Airtable 卡片内直接播片,过审/打回(分类+意见)全链路跑通
- [ ] **P21.J.M3 闭环**(≈1-2 周):发布($50 绝对硬顶 + publish_intent 幂等 + publish_failed 收敛)+ UTM 沿用 + 表现回流单链路 + winner 判定拆片入库 + 工厂内部自发疲劳信号。验收:真实成片上 CTS Meta 账户(**PM 显式 go 后才首发**,$10/天×3 天)+ 回流数据落 `flywheel_metrics` + 工作日志人话叙事无"工厂"字眼
- [ ] **开放项**:信号契约与 34.A 对齐冻结(M1 前置)· asset_gap 信号归属 · MTC 计费触点(v1 占位不扣)· Airtable 观测层↔ME 真值同步(M2 起)
- [ ] **P21.J.SEC 接口安全完整审计**:狄仁杰三审报"26 个 `/api/clients/[id]/*` 无鉴权",逐个核实后发现多数(ads 执行/cms 发布)其实已有锁、是误报,真裸奔仅 5 个已补。**需一次系统性复核**:grep 全部 access 守卫关键词 + 逐个确认,把"真裸奔"与"已有锁被误报"彻底分开,补齐真缺的。今天只是止血
- [ ] **P21.J.SEC-2 `/api/publer/create-post` 至今无鉴权**:任何人拿一个 `post_id` 就能把该客户的成片发到他的社媒账号。**不能像 schedule/draft 那样直接加登录鉴权** —— 这条同时被 Zapier/Airtable webhook 调用(仅 body 带 `post_id`,没有会话),加了就当场打断线上自动化。正解是 Bearer Token,而 token 要同时配到 Zapier 那边 = 需要 PM 动手一次。此项 2025 年就登记过(`docs/archive/AUTOMATION_SPEC.md` D-2),躺在 archive 里没人看,2026-08-05 补进主线。同批的 `/api/publer/schedule` 与 `/api/publer/draft/[assetId]` 只有后台一个调用方,已直接补上鉴权
  🔄 **2026-08-19 代码已写完,PR [#1081](https://github.com/bigbigraydeng-maker/magic-engine/pull/1081) 待复审,未合并**:读 `PUBLER_CREATE_POST_TOKEN` 环境变量做 Bearer 比对。**合并前需要 PM 配合两步,顺序不能反**:①先在 Render 生产环境变量加 `PUBLER_CREATE_POST_TOKEN` ②再去 Zapier 那个触发 create-post 的 webhook 步骤配上同一个密钥,两边都配完才能合并 PR——反过来的话线上自动发布会先被打断。
- [ ] **P21.J.UP 上传链接两取舍**:①无单条吊销(作废靠换 `UPLOAD_LINK_SECRET`,所有链接一起失效)②无速率限制(有真链接者可刷存储/烧 Vision 额度)。规模化前需补 per-client 限流 + 单链接吊销
- [ ] **本地 worker 没在认领**:今天 00:18 有 CTS 新工单卡在 `queued` 没人做 = 那台 Mac 的 worker 没跑/没连。工厂要真转,先确认 worker 进程在跑(仓库无 launchd/pm2 配置,`ps`/`pm2 list` 上机看)且已在 07-24 后重启(否则风格下发用旧逻辑)
- [ ] **`FACTORY_PUBLISH_LIVE` 未设 = 静默发草稿**:未配时片子 `status=published`+三落库全绿,FB 主页却只是没人看见的 DRAFT。验完草稿格式后 PM 显式在 Render 设 `=true` 才真发
- [ ] **`auto_order_enabled` 无客户开启**:调度器每天照跑但一单不下(安全默认)。要工厂自己下单,逐客户开;首个跑通客户 = CTS
- [ ] **`creative_profile` 无客户填**:出片风格仍全靠本地 JSON。CTS 现有风格(龙旗破云/golden_hour/短句大字/xfade 0.35)可抄进 ME 配置页接管
- [ ] **1 条 `rendered` 旧单**(CTS 07-12,有 caption)永久卡住:交付直连修复只对新单生效,这条旧单需手动迁 `in_review` 或归档(PM 判断)
- [ ] **P21.K.7 ad 级数据脊柱**(登记 2026-07-25,PM 拍板):日度 cron 补拉 **ad 级**(每条广告每天一行,复用 `ad_daily_insights` 的 `level='ad'`),让「某天新增了哪条广告 / 哪条在拖后腿」可被系统自查,不依赖 Meta MCP(Oztop 账户未开通)也不用人翻广告后台。**背书案例**:Oztop Lead Form Cold Broad 的 CPL 7/17 起翻倍,campaign 级只能定位到「填表率腰斩 + 出现出站点击」。含 `parent_id` 列(ad→campaign 归属,**migration 待 PM `go apply`**)+ 首拉 30 天回补 + 分页完整性守卫。顺带铺好 34.B Creative Lifecycle 要的作品层日度基础设施
- [ ] **P21.K.8 objective 感知 + 视频疲劳正向检测**(登记 2026-07-26,PM 拍板 `排`):把 P21.K 止血从「不误判视频广告」升级到「真正体检视频广告好不好」。需 ① `ad_daily_insights` 加 `objective` 列 + 采集时拉 campaign 节点 objective(**migration 待 PM `go apply`**)② 脊柱补拉视频完播指标(ThruPlay 完播成本 / CPM / video_p100)③ 按 objective 切换判定指标:视频/播放量目标用完播成本或 CPM,表单/流量目标保留 ctr+cost_per_result,拿不到 objective 或样本太少判 `insufficient_history`。价值:CTS 这类主打视频的客户,看完成本涨→主动提醒换素材。半天到一天。附:止血注释已在 `baseline.ts` 登记本项为 follow-up
- [ ] **P21.K.9 每日分析 cron 的候选客户名单仍只看主账户**(2026-09-13 子牙+魏征复审
      PR [#1595](https://github.com/bigbigraydeng-maker/magic-engine/pull/1595) 发现,同批
      发现的另一半已修):`readback-sweep.ts` 的每日安全巡检已改成同时看
      `clients.meta_ad_account_id` 和 `client_meta_ad_accounts`(见
      `getActiveClientsWithMetaAccounts`),但 `google-data-pullback-daily/route.ts`
      的每日分析/健康摘要 cron 没跟着改——如果某客户的主账户被清空、只剩登记在
      新表里的次账户,这条 cron 会把这个客户整个漏掉,`ad_daily_insights`/健康检查
      /每日摘要全部停摆(安全巡检不受影响,已经修好)。触发条件:今天 CTS 主账户
      还在,不会发生;一旦有人清空某客户主账户就会撞上。修法应该是这条 cron 的候选
      客户查询也换成 `getActiveClientsWithMetaAccounts`,并把主账户专属逻辑
      (30 天快照、token 解析里用到的域名/客户名)在"无主账户但有次账户"时优雅退化。
      未修原因:改动涉及这条 900 行 cron 的主循环结构,复审当天为控制风险没有仓促改
- [ ] **多视角对抗复盘工作流**(1-2 天,可后置):battle-plan §8 方法论固化成可复用 Workflow/agent(N 视角互相证伪前提 → 作战计划 → 喂鲁班),异常触发非每日跑
- [ ] **开放项**:三张新表 migration 逐次 PM `go apply`(`ad_daily_insights` / `ad_strategy_configs`+`_triggers` / `ad_health_narratives`)· P5 泛化首批客户(Oztop?)· 姊妹 spec Creative Lifecycle 同一 GHA 笔误待独立小 PR 修

## Creatomate L3 Connector · 最小可交付版 📋 2026-09-09 立项，PM 已订购

> 背景：本窗口延续 [CHANGELOG 2026-09-04](./history/CHANGELOG.md) 的 4 个已合 PR（#1351 配方对账 · #1360 imageToClip · #1367 分镜自检 · #1373 shot-guards），把 Creatomate 从 PM 手动开浏览器点导出的模式，接成 `src/lib/creatomate/` L3 Connector。走**最小版**（PM 2026-09-09 拍板），不做 quota 闸和后台 UI，跑起来后再加。

**PM 决定**（2026-09-09）：走最小版；已订 Creatomate Essential $54/月 + Muapi 起充；Spec 阶段和落地实施**另开新窗口做**（不在本窗口继续，避免混入归档窗口）。

- [ ] **Spec 起草**（1-2 天，C 级）：`src/lib/creatomate/` 客户端接口签名 · 模板 JSON 落库 · Inngest 工作流编排 · 错误恢复 · 幂等 · Reuse Statement（明确哪些复用 `imageToClip` / `shot-guards` / `factory` 既有能力）
- [ ] **三审并行**（半天）：子牙（架构）+ 鲁班（执行）+ 魏征（挑刺）· Spec 未过审前不动生产代码
- [ ] **L3 Connector 开发**（2 天，B 级）：`src/lib/creatomate/client.ts` 提交 · 轮询 · 转存 Supabase
- [ ] **模板 JSON 落库 + 参数化**（半天）：CTS 圣诞 / Golden China / 通用模板
- [ ] **Inngest 工作流串联**（2 天）：`video-render` 编排 `imageToClip` + `shot-guards.classifyRenderMode` + `creatomate.render` + Supabase 存
- [ ] **端到端联调 + PR 复审**（1 天）：用 CTS Golden China 场景跑一次

**砍掉的两块**（跑起来后再加）：
- ~~分档 AI 视频配额闸~~ — 已进 [`docs/registry/platform-candidates.md`](./registry/platform-candidates.md)，10-04 复查（PR #1396）
- ~~后台自助 UI~~ — 管理员触发即可，等真实客户需求验证后再加

**总时间预估**：4-5 工作日（不含 PM 审 Spec 和等 CI 时间）

**关联**：memory `[[project-creatomate-connector-b-min]]`（本项完整状态）· `[[reference-creatomate-silent-failures]]`（Spec 必写死的 5 个坑）· `[[project-social-video-i2v-muapi]]`（i2v 使用禁忌）

## Phase 18.E — Audience Asset Engine / 中介私域买家库 🔄 建池器已落地（2026-07-29 登记）

> 蓝图：[`specs/2026-07-28-audience-asset-engine.md`](./specs/2026-07-28-audience-asset-engine.md)（v0.3 · 魏征 + 板桥双审 + PM 四项拍板）
> 三段模型：冷广告灌池 → 暖池便宜转化 → 智能判断每人在哪一级并自动递进。
> 边界铁律：资产层**永不裁创意、永不动预算**，只输出信号（18.D 管创意生死 / Ad Strategy Engine 管账户健康）。
> A 线机制已验证：暖池 CPL NZ$6.65 vs 冷启动 NZ$11.12（**低 40%**，n=100/146，CTS campaign 级）。
> ⚠️ 反例：同一暖池投 Messenger 对话单次成本 NZ$38.53（n=5，已暂停）→ **优势只在表单 lead 上成立**，30 Kiteroa 走 Messenger 不可直接引用 40%。
> P18.E.0 建池器已完成（`src/lib/meta/audience-ladder.ts`，16 单测 + 3 变异测试）。

- [ ] **P18.E.1 语法验证** — 视频源规则（`video_view_15s` / `video_view_50_percent`）需用 Render 上的 `META_SYSTEM_USER_TOKEN` 实调验证；MCP 工具面建不了（错误 2654）但平台 UI 支持 + CTS 生产在用
- [ ] **P18.E.2 账本表** — `client_audience_assets`：`audience_id ↔ client_id / layer / ladder_stage / scope / owner_account / source_type(organic|paid)`。**存 id 不靠解析名字**（重名/改名会静默炸）。🔴 **migration 待 PM `go apply`**
- [ ] **P18.E.3 采集** — 池 size 快照 → `flywheel_metrics` 的 `ads.audience.*`；台账画**净增 = 新进 − 到期掉出**（受众是衰减存量，不能只画总量）。新 cron 必须 link `me-shared-cron-secret`。依赖 P18.E.2
- [ ] **P18.E.4 画像** — 现有 `google-data-pullback-daily` 加 `breakdowns=age,gender`（不新起 cron）
- [ ] **P18.E.5 归属交付** — 归属条款 + 隐私告知（IPP 3/6/7/9/**12 跨境披露**）+ 同意文书 → **必须在任何受众共享动作之前完成**。待 PM 定条款
- [ ] **P18.E.6 月报** — 《你的买家库月报》客户面渲染（客户永不见 `L0/L1` 代号）。依赖 P18.E.3
- [ ] **待 PM**：Roman vendor deck「500+ Chinese buyer database」口径 · 海外买家资格口径（OIA 2018）· 开发商合同数据条款

> PM 已拍板：①归属=中介（红线，删除「带不走」黏性论）②无独家，平行服务多 agent ③定价随 agent package 再定 ④Roman 只作结构样板。
> kill criteria：暖池 CPL 若相对冷启动无显著优势 → 产品叙事重估。**当前未触发**。

## Phase 21.L — 讲课式系列课 · 单讲工作台（大瑞 IP「AI海外获客」6 讲试点）✅ 首条成片定版（2026-08-02）

> 登记 2026-08-01 · 客户 = Magic Lab Class（`377468af`）· 形态：上课件 slide + 下真人的讲课式短视频。
> 层1-2（PR #726）、层3（PR #735）、录屏智能剪辑（#765）、PM 实拍反馈四修（#757/#772）已上线。
> **制作方案定版**：[sops/lecture-video-production.md](./sops/lecture-video-production.md)（客户三步 + 系统自动七件事 + 七个已修的坑 + 换客户要准备什么）。
> 第 1 讲成片 169 秒，PM 验收通过。

- [ ] **做片任务表防双击唯一索引** —— 动数据库，🔴 **PM `go apply`**
- [ ] **数字人首跑实测** —— 生成要花钱，需 PM 说一声再试
- [ ] **发布端按平台带不同 CTA 接线**

## Phase 22.E — SEO 盯梢体系（S15-S18）📋 2026-07-31 立项，按序推进

> PM 拍板四决定：①小修（标题/描述/旧文小更新）全自动 + 周报可见，新文章/新页面/内链进待办等点头 ②Blog 每家每周 1 篇 ③每周一人话周报邮件，大异常当天单发 ④**先修断的再上新的**。
> S14（盯梢复活三连修）已上线（PR #709）。

- [ ] **22.E.S15 内链 + 收录数据采集**（P1）— 补 R2/R5 的 pages 输入（site-audit 爬虫内链图 + GSC 收录状态）；内链改动按 PM 界线进待办审批，不全自动
- [ ] **22.E.S16 每周 Blog 恢复**（P1）— CTS/Oztop 每家每周 1 篇，自动选题（AI 可见度弱项 × R4 机会词），直调 `generateBlogPost` lib（禁内部 HTTP 自调用），产出进待办等 PM 点头发布
- [ ] **22.E.S17 CTS 自动执行手**（P1）— 照 `seo_meta_log` 队列模式，CTS Next.js 仓 meta 安全窄道 + applied 回执；blog 发布通道（自动 PR + 人 merge）单独估算
- [ ] **22.E.S18 每周一 SEO 周报邮件**（P1）— 排名变化/自动改动/待点头 + 社媒栏 + 社媒广告栏；每栏带数据新鲜度检查，**断流标注不装新鲜**
- [ ] **[P2] 22.E.S16 每周 Blog 链路没接自动化管理系统（Inngest）**（`src/lib/blog/weekly-blog.ts` + `src/lib/cms/blog-publisher.ts`，2026-09-09 CTS 会话审计发现）：这条链路（选题→写文章→查一遍→变成等 PM 确认的修改请求→PM 在客户仓合并）符合 CLAUDE.md 铁律 3「Inngest 工作流硬约束」明确点名的场景（内容生成→人审→发布→…→Outcome 回写），但现在完全没接，只有一行 `flywheel_actions` 日志。三个具体缺口：①每一步（选题/生成/查过关）没有机器能读的记录点，只有开始时那一行；②PM 在客户仓库点确认合并之后，magic engine 这边不知道点没点、什么时候点的；③文章上线后有没有效果（排名/AI 引用变化）完全没有回头看的机制，等于写完就扔了。ME 别的地方已经在用这套自动化系统（网站情报、每周 SEO 报告），这条写文章的链路建的时候没接进去，是遗留缺口不是从零造。**按 CLAUDE.md §11 资源优先级三维打分**：频率=中（每周固定跑一次，出问题不容易被发现）／IMPACT 闭环关键度=高（现在完全没有"发布后有没有效果"这一环，这块内容产出没法证明有没有用，Check/Tune 两段对这条链路完全空着）／收入关联度=中（不会马上导致客户投诉，但长期看没法拿数据证明这块工作值不值钱）。三项零"低"、仅一项"高"（未达两项以上）→ 按穷尽表落 **P2**。改动会碰多个文件、影响已上线功能，按铁律 4 属于「大任务」，动手前后各要子牙（架构）+ 魏征（挑刺）过一遍，不是随手接一下就行。

## Phase 27 — Visual Reference Library（视觉参考库）📋 已登记，待开发

- [ ] **P27.1** — DB migration：`visual_reference_library` 表
- [ ] **P27.2** — FDE 上传 UI：Assets 页面「参考库」标签，支持批量上传 + 标注来源（FDE/客户/竞品）
- [ ] **P27.3** — GPT-4o Vision 分析管道：提取配色 + 构图 + 元素类型 + 风格标签
- [ ] **P27.4** — 行业标签过滤 + 相似图搜索（pgvector embedding）
- [ ] **P27.5** — 视觉得分：参考 viral_score 逻辑，给每张图打 1-10 分
- [ ] **P27.6** — 竞品爬取接入：URL 输入 → Jina.ai 抓取 OG 图 → 自动入库分析
- [ ] **P27.7** — AI Factory 注入：图片/封面生成时，从参考库取 top-3 相似风格约束注入 prompt
- [ ] **P27.8** — 参考库浏览 UI：瀑布流展示 + 筛选 + 得分排序 + 删除

## Phase 28 — FDE Inbox（待处理收件箱）📋 已登记 · ⚠️ 待并入 Phase 20.D（统一看板扩展）

- [ ] **P28.1** — DB migration：4 张产物表各加 `reviewed_at TIMESTAMPTZ`
- [ ] **P28.2** — 执行看板顶部「📥 待处理」收件箱区域 UI（聚合查询 + 时间倒序）
- [ ] **P28.3** — 收件箱条目点击展开 + 「标记已读」动作（PATCH reviewed_at）
- [ ] **P28.4** — 「发送到看板」后写入 reviewed_at=NULL（已是默认，确认 reels_drafts 行为）
- [ ] **P28.5** — 收件箱 badge 计数：侧边栏「执行看板」入口显示未读数

## Phase 29 — Unified User Experience（统一用户体验 · Portal/Dashboard 合并 + Self-Serve 准入门）📋 已登记，待开工

- [ ] **P29.C.1** — Brief 填写页 `/dashboard/clients/[id]/brief`：5 字段表单 + 保存 → `brief_completed_at = NOW()`
- [ ] **P29.C.2** — `BriefGateBanner` 通用组件：检查 `isBriefComplete`，未完成时显示 Banner + 内容操作区覆盖半透明蒙层
- [ ] **P29.C.3** — 接入内容生成页（博客 / 社媒 / Reels Studio）
- [ ] **P29.C.4** — 接入执行看板顶部
- [ ] **P29.C.5** — 接入 Launch Hub
- [ ] **P29.D.1** — AI Agent 辅助补 Brief：给出公司名 / 网址后 AI 自动提议 5 字段（可编辑确认）
- [ ] **P29.D.2** — Brief 完成后可随时在 Settings 页完善为 Full Brief

## Phase 36 — Voice Agent（AI 电话销售/客服）🔄 建设中

- [ ] 首呼后校准 `mapRealtimeEvent`（需真呼一次才知实际事件名）
- [ ] **0. 真机 spike**（验 verbatim 哑巴模式，最先做 · 1d）— 决定后 3 周走法
- [ ] 1. **真实外呼发起**（现为 mock stub，provider 真拨号 API · 2–3d）
- [ ] 2. 浏览器↔通话实时通道（SSE 下行 + POST 上行 · 3–4d）
- [ ] 3. operator 编排层（STT→翻译/KB→注入 · 3–4d）
- [ ] 4. bridge 改造（逐字朗读 + 哑巴模式 + 垫场 · 4–6d）
- [ ] 5. 操作台 UI（纯语音，双语字幕+模式开关+价格确认+kill switch · 4–5d）
- [ ] 6. 操作员语音转文字 STT 接入（1–2d）
- [ ] 7. 安全（通道租户鉴权 + kill switch + 掉线兜底 · 2–3d）+ 狄仁杰攻击验证
- [ ] 8. 填充语/轮次管理/快捷话术打磨（2–3d）
- [ ] 9. 合规（披露脚本 + DNC + 录音，**过法务** · 1–2d + 法务）
- [ ] WhatsApp 文字 + 语音消息（P1）
- [ ] CRM adapter（接外部 CRM，现只内置权威）
- [ ] 全自动外呼 campaign（批量）+ suppression 逻辑
- [ ] 生产级知识库（OpenAI 向量库语义检索，替代关键词版）

---

## Platform Partner Outreach（ME 自己的上游渠道伙伴 BD，非客户能力）📋 2026-09-02 登记

> 背景：PM 提供 spec，要找 AU/NZ 已获 Meta/Google/TikTok 官方 partner 资质的公司，建立 ME 自己的上游渠道合作（不是找客户）。经 me-platform-tier-gate 判定为 L4 内部运营工具，不占用平台能力线；复用了 `src/lib/prospecting/`（Phase 35）的状态机/打分/AI草稿/人工审批架构模式，但因业务语义不同（客户漏斗 vs 上游伙伴漏斗）新建独立表，不与 `outbound_prospects` 混用。子牙 + 魏征双审已过，四条缺口（RLS checklist、认证状态防幻觉硬约束、独立合规页脚、domain 去重约束）已在代码里落实。

- [x] Migration `supabase/migrations/20260902010000_platform_partner_outreach.sql`（RLS 从一开始就写对 `TO service_role`）
- [x] `src/lib/partner-outreach/`（types.ts / score.ts / outreach.ts，24 条测试全绿，不 import `src/lib/email/sender.ts` —— 这一轮零发送路径）
- [x] 研究 25 家 AU/NZ 候选（Meta 8 / Google 10 / TikTok 7，去重 1 家跨平台重复），全部诚实标注 verified/unverified，无编造
- [x] Wave 1 选出 10 家、生成完整邮件草稿（人工撰写个性化句，未接 AI 调用路径，因为本次会话没有确认 `ANTHROPIC_API_KEY` 可用性）
- [x] migration 已跑到生产 Supabase（`glbdnayojixmexgofbsd` / CrazyContent，2026-09-02 PM 手动执行）；匿名 key 探针验证 RLS 正确锁定 service_role(对照 `outbound_prospects` 已知修复表，响应 signature 一致)
- [x] 24 条候选（10 drafted + 14 discovered）已写入生产表，同样探针复验 RLS 未松动
- [ ] **待办 1**：实际发送 —— 严格等 PM 逐家或批量明确说"发"，不自动发送
- [ ] **待办 2**：`generatePersonalizationLines()`（AI 调用路径）尚未在生产环境验证可用，目前 wave-1 草稿的两句个性化文案是人工按同一套规则手写的，不是 AI 生成的——下一批候选建议先确认 API key 可用再接上自动生成
- [ ] **待办 3**：回复分类 + follow-up 调度 + admin 审批 UI（spec §16-17）尚未实现，这一轮范围只到"草稿就绪待审"
- [ ] **待办 4**：Meta 官方 Partner Directory 需要登录态才能核验，公开调研工具查不到——8 家 Meta 候选全部卡在 unverified；如果 PM 有 Meta Business 账号登录态,可以人工核一遍这批公司

---

## 平台治理层 · me-platform-tier-gate 后续跟进 📋 2026-08-27 登记

> 背景：2026-08-27 因 HBay KOL 事故设立 [`me-platform-tier-gate`](../.claude/skills/me-platform-tier-gate/SKILL.md) skill，约束 agent 在提议新增 ME 能力线时的思考边界。经魏征（对抗挑刺）+ 子牙（架构）两轮复审，v1 落仓时已修必改项 owner 责任链（问题 1）与候选清单载体（问题 2，见 [`docs/registry/platform-candidates.md`](./registry/platform-candidates.md)）。以下 4 条子牙终审时提出、v1 未修、进本 ROADMAP 分批跟进。

- [ ] **P.G.1** 补 harness 层挂载 hook —— 子牙终审问题 3。当前挂载靠 agent 自觉读 CLAUDE.md，跟事故根因（agent 没自认为在做平台决策）同构。方案：`.claude/settings.local.json` 加 Stop hook，扫本轮产出文本命中 `能力线|智能层|分析层|新增支柱|XX Intelligence|加一条(能力|支柱|柱)` 且未见 `Platform Tier Classification` 章节时输出提醒（先不阻断）。硬约束只有 harness 层能给。
- [ ] **P.G.2** 改名 skill 避免与 `src/lib/kernel-approval/tier-gate.test.ts` 语义碰撞 —— 子牙终审问题 4。同仓库 "tier-gate" 缩写会永久混淆平台层级与 kernel 权限档位两套概念。建议改成 `me-capability-layer-gate` 或 `me-platform-layer-gate`。改点：SKILL.md 目录名、CLAUDE.md 第 8 行、`docs/registry/platform-candidates.md` 里对 skill 的引用。
- [ ] **P.G.3** 澄清 skill 在五道 Build Gate 中的位置为 Gate 0 / Pre-Gate —— 子牙终审问题 5。SKILL.md 现在"红线 6"与"与既有治理机制的关系"表两处对 skill 从属关系的表述矛盾（一说是 Gate 4 前置子步骤，一说强化 Gate 2）。改成"Gate 0 / Pre-Gate，不替代任何后续 Gate，分歧走 owner 仲裁"。
- [ ] **P.G.4** 抽 `docs/registry/pillars.md` 作为 6 支柱唯一名单来源 —— 子牙终审问题 6。当前 SKILL.md、CLAUDE.md 两处硬编码"SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品"，跟 skill 自己声明的"支柱数量是 PM 拍板项"直接冲突。建仓后 skill、CLAUDE.md、其他引用点全部改成引用 registry 文件。同类还有五道 Build Gate 顺序 / 客户名单，可一并统一到 `docs/registry/` 下。
- [ ] **P.G.5** 平台候选复查治理界面 —— Codex 复审 P2 遗留意见。当前 `platform_candidate_review_due` 待办的 href 指向 GitHub `blob` 只读页面，PM/FDE 收到待办后要同时改 `docs/registry/platform-candidates.md` 表 + `src/lib/pm-todo/platform-candidate-reviews.ts` 数组，非技术收件人做不了。要么建一个真正的治理界面（可以直接更新证据 + 推下次复查日），要么把 `platform-candidate-reviews.ts` 里的日期改为从 markdown 表自动派生。当前 workaround：接到待办后回一句 "把 X 候选复查日推到 YYYY-MM-DD"，由 agent 帮改两处并提 PR。

---

## ME 会员制度五档 · 免费 / $39 / $199 / $499 / 定制 📋 2026-08-31 PM 拍板，四张合同票均为 SPEC DRAFT

> 分档尺子是**「谁在干活」**（PM 原话，从旧三档沿用）：免费=系统搭好你自己用 · $39=系统把你摆出去 · $199=AI 替你干活 · $499=AI 替你花钱干活 · 定制=真人接管。
> **旧的 NZ$500 起步版 / NZ$2,500 高级企业版固定报价已于 2026-08-31 全部作废**（PR [#1279](https://github.com/bigbigraydeng-maker/magic-engine/pull/1279) 把 `docs/registry/pricing-playbook-enterprise-fde.md` 标为 RETIRED）。**定制 / Enterprise 档 case by case 逐单报价，代码与对外材料一律不挂数字。** 已签客户不受影响。
> 落地顺序是「先给客户一个网站和一个邮箱」，依赖 [#1269](https://github.com/bigbigraydeng-maker/magic-engine/issues/1269)（OpenSRS 域名 + 邮箱，Phase 0 未动）。

**四张票全部是 SPEC DRAFT —— 没有 `BUILD CONTROL — GO BUILD` 之前任何窗口不许动手。**

- [ ] **[#1273](https://github.com/bigbigraydeng-maker/magic-engine/issues/1273)** [风险 B] AI 单页站生成器 —— 免费档与 $39 档的第一块砖。
      🔴 **技术路线已冻结：AI 只出结构化 JSON，绝不出 HTML。** 版面由模板决定。AI 吐 HTML 则每次结构不同 → 没法断言 noindex / 角标 / 无编造事实 → 扫街跑几百个会坏掉几十个而无从定位。多样性靠「模板 × 配色 × 首屏版式」的**可枚举组合**，不靠 AI 即兴。
      🔴 **别重造**：`src/lib/tailor-made/` 已经是同形状流水线（AI 抽结构化数据 → 归一化 → 注入 HTML 模板 → 出成品，生产在跑行程单与画册），换的是对象不是形状。配套复用 `diagnostic/report-generator.ts` · `images/unsplash.ts` · `factory/stock-pipeline.ts` · `brief/jina.ts`。
      ⚠️ **最大短板是配图**：没有商家真实照片只能用图库，同一条街几家同业配到同一张图会直接毁掉扫街杀伤力，必须按行业 + 氛围选并去重。
      平台候选「AI 单页站生成器」已登记 `docs/registry/platform-candidates.md`（PR #1278 已合并）。
- [ ] **[#1274](https://github.com/bigbigraydeng-maker/magic-engine/issues/1274)** [风险 A] 免费档 —— 认领、隔离与永不删除的生命周期。免费站边界：永久能用能发链接，但 **noindex 不收录 + 带 ME 角标 + 无邮箱 + 无自有域名** —— 这四条正是 $39 档的卖点。
- [ ] **[#1275](https://github.com/bigbigraydeng-maker/magic-engine/issues/1275)** [风险 A] $39 订阅与四项解锁 —— **用 Stripe Billing，禁止自建订阅状态机**（承接 [#1122](https://github.com/bigbigraydeng-maker/magic-engine/issues/1122) 的 Build Control 决议）。$39 含自有域名 + **公司邮箱 1 个，第 2 个起 $9/月/箱**。`src/types/magic-engine.ts:7` 的 `ClientPlan` 需对齐五档，且 `custom` 档不许在代码里挂任何价格数字。
- [ ] **[#1276](https://github.com/bigbigraydeng-maker/magic-engine/issues/1276)** [风险 A] 扫街预建站管道 —— 先把网站做好再去谈。口径：**不公开 · 一商家一链接 · 只用公开事实 · 不用商家照片和 logo**。

**🔴 唯一卡住的数字**：CTS + Oztop 过去 30 天真实外部 API 消耗（美元）仍未到手（v0.4 就要求过）。**在它到位之前 $199 / $499 的具体额度不许写进代码**；任一档毛利 < 40% 就得调额度或加价。免费档与 $39 档不受此约束，可以先跑。

**⚠️ 对外仍挂着已作废的旧价**：公开收费页 `magic-engine-pricing.pages.dev` 还显示 NZ$500 / NZ$2,500 三档。源码不在当前主力 Mac 上（线上是 37KB 自包含 HTML，可 curl 抓下来当基线重建）。改页面前先解决 Cloudflare 账号权限：该项目在 `hello@magicengine.cloud` 名下，本机 wrangler 登录身份看不到它。
