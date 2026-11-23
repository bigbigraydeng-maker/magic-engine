# 脚本 Agent · 五关立项卡（2026-10-24）

> 按 `TEMPLATE.md` 填；状态是候选，缺证据不算过关。对应台账：`docs/ledger/2026-10-24-script-agent-five-gates.md`。

## 0. 基本

| 项 | 填 |
|---|---|
| 名字 | 新增，用户称「脚本 Agent」；正式名册登记待 PM 审五关 |
| 一个动作 | 把已转写的授权参考视频改写为大瑞可录的中文口播草稿 |
| IMPACT | A（Act：内容准备与保存草稿）；不做 P 阶段机会排序 |
| 支柱 | 现有社媒 |
| 闭环骨架 | 社媒线「产出」环节（`content_posts` 候选稿）；源稿回执与核实仍须在原闭环登记表补齐 |
| 类 | 运行时 Agent，用户触发；目前为本地候选实现 |

## 1. 四份现成产出

| 产出 | 结论与出处 |
|---|---|
| 层级门 | 社媒既有能力内的场景；抖音/Apify 应归 L3 外部连接，当前 provider 逻辑仍在路由，适配器未完成；大瑞口吻应归 L4，当前仅静态客户 ID 预设和本机覆盖，持久配置未接；无新 L1 支柱。`.claude/skills/me-platform-tier-gate/SKILL.md` |
| Build vs Connect 六问 | 1 A；2 当前 Brief 改写增强内容准备，独立事实核实尚无；3 外部转写已有 Apify Actor；4 只需转写数据；5 失败必须显示不可用；6 当前自建价值是按 Brief 出稿；出处可追溯只保留来源快照/发李白事件，学习闭环未建，不能把目标态算成既有护城河。`docs/strategy/ME_PRODUCT_DEFINITION.md` §11 |
| §11 打分 | 频率中（用户按需）；IMPACT 中（目前只到内容候选稿，未触发发布后的 Check）；收入中（影响内容制作效率）→ 中中中 → P2。`docs/ENGINEERING_QUALITY_GATES.md` §11；本次用户明确要求，按当前任务推进，不代表全局改序 |
| 子牙九问 | 1 不新支柱/共享 runtime；2 暂无 Memory 写入；3 空/错/超长输入当前拒绝，账号最多 20 条；4 海外华人语境目前仅版控客户 ID 预设/本机覆盖，商业断言待核；5 大批量需队列/幂等；6 现有权限不应扩大；7 用户先见失败，需机器回执；8 目前部分错误仅 console，缺 PM 可见消费者；9 用户触发、无定时。`docs/agents/10-ziya.md` §四b；待子牙正式复核 |

## 2. 开工前三处搜重复

| 搜哪 | 命令 / 关键词 | 结果 |
|---|---|---|
| 主干代码 | `git grep -in -e '逐字稿' -e '选题助理' -e '边走边录' -e 'whisper' origin/main -- src docs` | 已撞到 `src/lib/content-factory/topic-agent.ts` 与 `intake-runner.ts`：现有「选题助理」按爆款简介/转写生成 40–60 秒候选；另有 `docs/content/content-factory-me-integration-plan.md` 的 Apify→Whisper→爆款库方案。新需求为完整抖音账号/视频转写、长稿且按大瑞人设；长稿生成已接入现有选题助理入口；采集/转写仍在新路由，复用边界需继续核 |
| 在飞 PR + 最近合并 | `gh pr list` 因网络失败；改用已连接 GitHub `search_prs`：`is:open in:title,body \"选题助理\"`、`is:open in:title,body \"逐字稿\"`、`is:merged in:title,body \"脚本 Agent\"`，均限本仓库 | 在飞选题助理 0；在飞逐字稿命中 #2875（月度学习资料卡，非内容工厂实现）；已合并脚本 Agent 0。旧选题助理实现见已合并 #696/#698。关键词检索仍非全量语义证明 |
| 台账与 ROADMAP | `git grep -in -e '逐字稿' -e '选题助理' -e '边走边录' origin/main -- docs/ledger docs/ROADMAP.md docs/content` | 内容工厂整合方案和边走边录工作已有记录；台账/ROADMAP 的具体重叠项待逐条归并，远端新提交未核 |

## 3. 新问 A · 正式系统最近可用数据

| # | 要求 | 结果 |
|---|---|---|
| 1 | 读代码与筛选 | `src/lib/content/brief-injector.ts:7-15` 从 `master_briefs` 按 `client_id` 和 `(status='active' OR is_active=true)` 取最高版本；改写路由现用客户绑定的签名回执重新读 Apify run/dataset 并核视频 ID；**没有可查询的持久来源输入表/读取筛选** |
| 2 | 同条件查询 | 实际执行：`select count(*) as active_briefs, count(*) filter (where coalesce(brand_name,'') <> '') as active_briefs_with_brand from public.master_briefs where client_id = '377468af-b103-45f0-984a-b353febb56a1' and (status = 'active' or is_active = true);`，两项均为 1；第一个计数与代码过滤条件一致，第二个仅作质量检查；逐字稿现仅可核已有 `content_posts` 快照：`client_id='377468af-b103-45f0-984a-b353febb56a1' and created_at>=now()-interval '3 days' and generation_context_snapshot->>'source_platform'='douyin' and coalesce(generation_context_snapshot->>'source_transcript','')<>''`，这是**输出侧代理计数，不等于未来输入筛选** |
| 3 | N 与条数 | 用户触发型没有固定运行间隔，N=间隔×3 不能确定；不可用「拟每日」冒充正式间隔。补充观察窗口 3 天：已入库抖音**输出快照** 0，有正文草稿 0；活动 Brief 1。真正请求输入可消费条数不可测 |
| 4 | 库与时间 | Connected Supabase `CrazyContent` 业务库；2026-10-24 16:29–16:38 NZDT，只读 SQL。尚未独立核实 Render Web 正式环境绑定此库；另名为 `magic-engine-platform-prod` 的连接项目无这三张业务表，不能拿它算数 |
| 5 | 只数能用的 | Brief 查询按代码排除非活动；另作空品牌名质量检查，未算入同条件查询。快照观察排除空逐字稿、非抖音、其他客户与 3 天外。**来源由用户提交链接触发，服务端可核 Apify 当次结果，但缺持久输入回执与消费筛选；可用输入数量未知，五条硬要求未满足，本关阻塞。** |

## 4. 新问 B · 一键停

| 项 | 结果 |
|---|---|
| 开关在哪 | 本地代码新增 `SCRIPT_AGENT_ENABLED` 总闸与 `SCRIPT_AGENT_ALLOWED_CLIENT_IDS` 白名单；两者齐全才开放指定客户。尚未部署或配置 |
| 谁能关 | 持有 Render 环境配置权限的运维/PM；当前无生产配置回执，故不声称已可在正式环境关停 |
| 读失败 | 本地 `scriptAgentEnabledForClient` 仅当总闸等于 `true` 且白名单包含 clientId 才放行；缺值按关 |
| 在途动作 | 开关关闭阻止新的 POST；已启动的 Actor/Claude 调用不会自动取消，仍需在途任务回执/人工核查 |
| 前置闸 | 不碰广告/GBP 两道既有开关；服务端已接现有原子日额度：每客户扫描 3、转写 20、改写 20 次，单次 Apify 上限分别 US$0.10/US$0.15；额度核对失败时拒绝付费调用。白名单启用前仍须有长期请求回执、PM 判档与真实试跑 |

## 5. 对外动作与授权档

| 动作 | 副作用 | 建议档 | 出处 | 内核 |
|---|---|---|---|---|
| 扫账号/转写 | Apify 付费请求 | 建议 2，待 PM 定 | `docs/agents/14-sudongpo.md` 社媒边界；标准 §3 | 不在，接线前不可宣称有 Kernel 许可 |
| 改写 | Claude 付费请求并写客户草稿 | 建议 2，待 PM 定 | 同上 | 不在 |
| 发布/渲染 | 本 Agent 不执行 | 不适用：明确禁止 | 社媒手册 | 不适用 |

## 6. 回执

| 项 | 结果 |
|---|---|
| 落点 | 成功草稿的 `content_posts` 已保存来源全文、Apify run/dataset ID、平台报告用量和 AI 估算费用；仅转写成功或失败时服务端 request receipt 与标准 `cron_run_logs` 尚未接，需补 |
| jobName | 拟 `script-agent-on-demand`；尚未登记 9-24 §4.4；用户触发型须有 request receipt→run receipt 对账，不能以无日志推断漏跑 |
| Inngest run ID | 不适用：当前是 API 用户触发；若改事件型再用 `cronRunIdFromInngestRun` |
| `processed` / `failed_count` | 否，尚未写 `cron_run_logs` |
| summary 五键 | 否，尚未写 `agent/produced/undeterminable/reasons/cost_usd` |
| 重跑 | 当前只用旧草稿查询复用，非原子；并发可重复付费/建稿，待补服务器幂等键与首次回执保护 |
| 180 天以上 | 来源逐字稿和成稿随草稿保留；成本/失败回执若需长期须明确保留期，不能仅依赖 180 天硬删的运行日志 |

## 7. 核实日

| 项 | 结果 |
|---|---|
| 核实什么 | 演示客户输入链接→真实逐字稿→中文成稿→`content_posts` 草稿，逐句出处/长度/录制可用性；正式客户零副作用查询 |
| 窗口 | 草稿 T+1 天由真人核；实际发布效果不在本 Agent 范围 |
| 结论词 | 单次核对 `pass / pending / not_measured` |
| 量不出来 | `not_measured` 并注明来源/运行回执缺失，不记为 0 或失败 |
| 谁核与回写 | 真人录制者核口播可用性，李白核事实；回原 `content_posts` 与现有闭环登记表的核实环节；目前自动回写未接 |

## 8. 给 PM 的立项决定

用户已要求建立脚本 Agent；建议 **P2 候选推进**。由于生产库绑定未核、来源输入不可测、旧选题助理已接入长稿生成，但采集边界未整合、PR 搜重已通过连接器补查，仍有费用/运行回执缺失；本地关停代码尚未部署核实，立项关不能签通过。下一步先把一条用户授权样本纳入可追溯来源回执，并定义事件型请求的可核对账窗口，再复查可用输入；付费动作档位在第 2 关由 PM 单独定。
