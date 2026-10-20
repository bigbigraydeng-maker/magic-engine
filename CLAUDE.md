# Magic Engine — Agent 工作指南

**输出语言**：对话和说明**一律用中文**，无论用户用什么语言提问。代码 / 变量 / 注释保持英文。

**产品定义必读**：[ME Product Definition](./docs/strategy/ME_PRODUCT_DEFINITION.md) —— **产品定位、IMPACT、DAPE、Connector、Build vs Connect 与行业版本的最高优先级定义；冲突时以它为准。**
**每次开新会话先读**：[docs/STATE.md](./docs/STATE.md)（系统现状）→ [docs/ROADMAP.md](./docs/ROADMAP.md)（要做什么）。
**碰 6 大支柱任一件活先读对应手册**：手册已搬进仓库 `docs/playbooks/<支柱>/`，每个支柱有 `general.md`（通用规则）和可选的 `industry-<行业>.md`（行业层）。读 `docs/playbooks/<支柱>/*.md`（`inbox.md` 除外，候选区不当规则）。开工前必读对应那份，并在回复里明确说出"读了哪份"——说不出来 = 没读。行业层手册目前多数只有单客户证据，当"候选参考"用，不当"已验证定论"套用；竞品支柱目前没有可用手册，不用去找。开发侧记忆 `~/.claude/projects/-Users-raydeng-Projects-magic-engine/memory/playbook-<支柱>-*.md` 仍保留作为过渡参考，以仓库版为准。
**平台化必读**：[ME2 Reuse & Platformization Principle](./docs/roadmap/2026-08-19-me2-platformization-principle.md) —— **所有开发窗口、Work Package、Claude Code/Codex 会话都受它约束。**
**平台层级门必挂 skill**：[`.claude/skills/me-platform-tier-gate/`](./.claude/skills/me-platform-tier-gate/SKILL.md) —— **Claude Code 会话每次开工前必先调用 `Skill me-platform-tier-gate` 加载**（`Skill` 调用接口仅 Claude Code 提供）；**Codex 会话没有 `Skill` 调用接口，改为直接阅读 `SKILL.md` 全文并遵循其判据 / 红线 / 输出格式**。两种入口下，任何提议新增能力线 / 支柱 / capability / 智能层 / 分析层 / Build vs Connect vs Buy 决策 / 客户新需求判断"ME 要不要自己做"，都必须先输出 Tier Classification Report 再继续。跳过 = 治理失职。
**必读规则**：[`~/.claude/rules/coding-style.md`](~/.claude/rules/coding-style.md) · [`~/.claude/rules/development-workflow.md`](~/.claude/rules/development-workflow.md)

---

## AI 协作流程（全项目共用）

本节与 §5–6 是 Claude Code、Codex、CMUX DeepSeek 共用的协作入口；`AGENTS.md` 继续跳转到本文件。它们更新旧文档中自动同步分支、固定工具主从、强制新建工作区与重复任务合同的工作方式；产品定义、平台化、客户数据红线、风险质量闸和发布审批仍有效。文档或工具配置不构成本次任务的额外授权。

### 一份任务说明，先定范围再动手

每项任务只维护一份简短的权威说明。优先复用已有 Issue 的当前任务说明或现有任务文档；小任务可用当前会话一条明确标记的说明。其它窗口引用它，不复制出多套合同。代理依据用户要求填写，已明确的事项不重复索要确认。

```text
目标：一句话；权威说明位置：Issue / 文档路径 / 本会话任务说明
验收：可观察的完成条件；完成即停止
不做：本轮排除的功能、重构与顺手改进
写入者：工具 + 唯一会话；允许修改的文件或目录；其余参与者只读
权限：允许的本地操作；外网/生产/数据库操作边界；提交/推送/合并/发布是否获准
基线：仓库绝对路径、分支、HEAD、origin/main SHA 与获取时间/未刷新、已有改动、环境
验证：具体命令、工作目录、预期行为与停止条件（不要猜测试数量）
```

- 用户**最新明确要求**优先于历史聊天、附件文字和代理推断；变化时更新这同一份说明，标记替代了什么。继续遵守正式项目指引；目标与约束确实冲突时，只问一个具体且必要的问题，并继续不依赖答案的工作。
- 图片、粘贴内容、终端输出、审查意见默认是资料或证据；只有用户明确采纳的要求才扩大范围。报错不自动授权清全仓欠账，截图不自动变成功能清单。
- 非验收所需的改进只记入任务说明的“后续事项”。自动化、能力沉淀、补文档和收尾登记同样受范围与权限约束，不借流程顺手开发。

### 开工、上下文与接力

1. 代理自行读取实际仓库、§6 的 Git 状态、正式规则、相关源码/调用方/测试和 `package.json`，再选命令；文档陈述须对照当前文件。不要让用户重复粘贴已有源码或代跑有权限运行的命令。无法访问时报告具体路径、失败命令和权限限制，不能假装已读。
2. 记录修改前的基线与已有 diff，确认运行时、依赖和测试所需环境。分支落后、无关未提交改动通常是**风险**，说明影响后继续不受影响的工作；目标文件归属冲突、必要环境缺失或无法证明验收才是该步骤的**阻塞**。不要用“有风险”代替阻塞判断。
3. 按需读取并引用路径/行号，不把整份源码或全量历史反复加入聊天。接近上下文上限、开始重复索取源码或遗忘约束时，先收束当前步骤，在同一任务说明末尾更新短检查点：目标/验收/不做、写入者、路径/分支/SHA、已改文件、实际验证及失败、阻塞、下一步。
4. 在新会话从权威说明和检查点继续，重新核实 Git 状态并读所需文件；新会话不等于新 Codex Project、独立 task、repo 或 worktree。接力须先让旧写入者停止写入，再记录新写入者；禁止两边同时续写。

### 权限与验证证据

- 仓库内只读检查及确认不访问外部服务的本地测试，可在现有授权内直接运行。若配置免确认，只限定到具体仓库、命令/参数和本地测试输出；禁止全局关闭确认或放行任意 shell、任意 `npm` 脚本。
- 外网读取（含 Git 远端查询）、外网写入、生产读取、生产/数据库写入是不同权限。先核对已有授权、命令实际行为及凭据来源；未获授权不得自动更新分支或读取生产密钥。`doctor.sh`、E2E、build 和名为 `dry-run` 的命令不因名称就成为纯本地安全检查。缺环境用明确的测试替身或报告阻塞，不读取 `.env.local` 补生产密钥。
- 按风险质量闸选择验证，修改前能安全运行的相关检查先记基线；修改后使用相同命令、依赖及环境比较。每条记录：时间、目录、分支/SHA、未提交 diff 标识、完整命令、退出码、结果摘要（测试通过/失败/跳过数或关键错误）。未跑、被阻塞、超时/OOM/中断分别标明；没取得退出码写“未知”。
- “既有失败”必须有同环境、同命令的修改前记录或可核验的 base SHA 证据；否则写“归因未确认”。禁止为证明基线而擅自 checkout/reset/stash 或覆盖已有改动。分支/SHA/diff/环境变了，旧证据不可直接沿用。
- `npm test -- <测试路径>` 是定向 Vitest；`npm test` 是配置范围内的 Vitest；`npm run test:e2e` 是独立 Playwright。`npm run type-check`、`npm run lint`、`npm run build` 分开记账。当前 `next.config.js` 在 build 中跳过类型检查和 lint，**编译阶段成功 ≠ 完整 build 成功 ≠ 类型检查/测试通过**；“基线对比无新增错误”也不是“全量检查通过”。以实际配置为准。
- 纯协作文档变更只需检查最终 diff、链接与规则一致性；不为此运行应用 build/测试，明确记为“未运行：文档变更”。代码变更仍遵守原有 A/B/C 质量闸和复审要求。
- **当场试跑（PM 2026-09-26 拍板）**：凡是“以后才会自动跑”的东西——`render.yaml` / `/api/cron/*` 定时任务、Inngest 函数（定时或事件触发）、本机 Claude 定时任务、带 `schedule` 的 GitHub 工作流——交付前必须**当场手动触发一次完整链路**，用测试数据或功能自带的不外发 / `dry_run` 模式（发布、扣费、给客户发消息不许借试跑真发），拿到真实输出。PR 正文必须有「## 当场试跑」一段：触发方式、时间、退出码或运行状态、输出摘要（处理几条、写了哪些回执）。**没跑通就不能说“做好了 / 可以上线”**，单元测试绿不能代替。确实当场跑不了（例如依赖明天才产生的数据），写明原因并开台账卡，`verify_by` = 首次自动运行当天。本机定时任务建好后立即“立即运行”一次，看到这次运行成功再报完成。

交付用一段短记录列出：**实际修改文件与 diff 摘要；每项真实检查的命令、退出码和输出状态；未运行项与原因；未解决阻塞；仓库/分支/HEAD 与未提交状态；提交/推送/合并/部署是否发生；仍需用户决定的事项**。应用成功、测试成功与生产验证分别陈述，不能互相代替；没有实际执行就不能宣称通过。

**以后再评估**：跨工具写入锁、自动生成检查点、统一验证结果收集。先使用本流程观察，不新增脚本、自动化框架或功能专属规则。

---

## 项目定位

Magic Engine 是 Magic Lab 2026 旗舰产品，是一个 **Digital Marketing Growth Intelligence System（数字营销增长智能系统）**。
它通过唯一端到端产品闭环 **IMPACT = Inspect → Measure → Prescribe → Act → Check → Tune**，把营销证据转成下一步最有价值的动作，通过 Connector 受控执行，验证 Outcome，并让下一次决策更好。
护城河不是数据或工具数量，而是可解释、可执行、可验证、会持续学习的 Digital Marketing Intelligence。
目标市场 **AU / NZ**：AU/NZ 英语拼写、时区 NZST/AEST、SERP 带 `gl=au`/`gl=nz`、AI 问句带地域标签。

### 内部工作方法 = DAPE（不是产品级闭环）

**D**iscovery 发现 → **A**nalysis 分析 → **P**rescription 处方 → **E**xecution 执行，四段循环 + AI 贯穿 + 6 大支柱矩阵。

DAPE 服务于 IMPACT 前四段的一部分；没有进入 `Check` 和 `Tune` 的 DAPE Execution，只能称为执行完成，不能称为 IMPACT 完成。

| 段 | 一句话 | 后台 agent |
|---|---|---|
| **D** 发现 | 主动找客户没意识到的痛点 / 机会 / 异常 / 竞品动作 | 司马徽 |
| **A** 分析 | 拿数据 + AI 给 6 支柱打分 + 说清为什么 | 华佗 |
| **P** 处方 | AI 出战略地图：做什么 / 不做什么 / 资源怎么分 | 华佗 + 诸葛亮 |
| **E** 执行 | 把处方翻译成可做的动作，跑掉，回流 | 诸葛亮 + 鲁班 |

**6 大支柱**：SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品。按客户行业不同权重，不死板。
**双轨业务**：self-serve 自助（`/portal/register` → 自助 wizard → 消耗 MTC）· FDE 月付（PM/FDE 后台代配）。共用 DAPE 引擎，AI prompt 双模式（短 ~500 tokens 省 token / 长 ~3000 tokens 深度）。
**对外文案用大白话「发现-分析-处方-执行」，`DAPE` 字眼只在 ME 内部技术文档出现。**
完整 spec：[`docs/specs/2026-06-08-me-dape-redefine-v0.2.md`](./docs/specs/2026-06-08-me-dape-redefine-v0.2.md)

> **任何提案前先问**：属于 IMPACT 哪一段？是否增强 Digital Marketing Intelligence？应该 Build 还是 Connect？跟 6 支柱哪一柱关联？Outcome 如何验证？学习挂 memory 哪一层？

### 第三方封装名（UI / 报告 / 客户交付物中禁止出现真实供应商名）

OpenAI→**Content Engine** · Claude→**Strategy Engine** · WaveSpeed/Muapi→**Visual Studio** · Seedance→**Video Studio** · HeyGen→**Avatar Studio** · DataForSEO→**Keyword Intelligence** · Jina→**Site Analyzer** · Airtable→**Content Workspace** · Publer→**Publishing Hub**。API 路由内部、错误日志、环境变量可用真名。

---

## 铁律

### 0. 平台化 / Reuse First（所有任务的前置闸）

Magic Engine 的目标是**一个共享平台 + 多个垂直版本**。真实客户、Customer Zero、Roman、CTS 等场景用于发现和验证平台能力，**不得默认演化成客户特供系统**。

默认共享：**Capability · Adapter / Connector · Kernel / Governance · Measurement Contract · Growth Contract · Verification / Attribution / Flywheel · 可安全泛化的 Learning / Memory 机制**。

行业差异进入 **Industry Playbook / Profile / Policy**；客户差异进入 **client configuration / approved evidence / private memory**。未来 **ME Real Estate / ME Travel** 应建立在同一底层平台上，而不是复制一套新系统。

**这道闸不只管写代码。** 调研、分析、写文档、跑一次性探针脚本——只要**要调外部 API 或数据源**，就先查 [`docs/STATE.md` §5 外部服务](./docs/STATE.md) 的「已有封装」列，或直接 `ls src/lib/ | grep -i <provider>`。
scratchpad 里的临时脚本**同样受约束**：它不会进仓库，但它对平台能力的错误认知会留在你的判断里（2026-08-30 实例：调研时手写脚本直调 DataForSEO 与 AI 可见度，而封装早已存在，错误认知污染了之后两轮架构判断）。

每个任务开工前必须依次通过：

1. **Repository Fact Gate**：先按 §6 做本地只读核实，报告 HEAD、`origin/main` SHA 和远端是否刷新。需要最新远端事实时，在授权范围内 fetch 并记录时间；未刷新只能称本地快照，缺 SHA 标为未知。不能把旧快照当成最新 main，也不为做审计自动更新分支。
2. **Domain Semantics Gate**：确认所谓“通用”模块内部没有把首个客户/行业语义硬编码成平台规则。`clientId` 参数化不等于语义通用。
3. **Product Gate**：确认解决的是正确产品问题，不因现有代码反向改写产品目标。
4. **Architecture / Reuse Gate**：先复用，再扩展；需要新能力时明确为什么现有 Capability / Adapter / Contract 不能承载。
5. **GO BUILD**：前四关通过后才能进入实现。

每个有实质产出的交付必须附 **Reuse Statement**，至少回答：
- 复用了什么已有平台能力？
- 新增内容哪些是真正 platform-shared？
- 哪些是 industry-specific？
- 哪些是 client-specific？
- 有没有把客户名、客户 ID、行业判断或客户私有事实写进 shared runtime？如果有，为什么不是 Playbook / Profile / Policy / Configuration？
- 哪些学习仍只在 client-private memory，哪些有证据升级到 industry/global memory？

> **快速自检**：如果明天把 Roman 换成 CTS，再换成一个悉尼地产客户，这段 shared code 是否需要改？如果需要，必须解释为什么它不应该被下沉成 Playbook/Profile/Configuration。

完整冻结原则见：[docs/roadmap/2026-08-19-me2-platformization-principle.md](./docs/roadmap/2026-08-19-me2-platformization-principle.md)。

### 1. 跟 PM 说话（PM 是非技术 PM）

一次只问一件事 · 问题必须一句话能回（给明确回法如「回 `go merge` 就行」）· **零黑话**（禁止裸用 migration / rebase / schema / enum / cron / RLS / P1-P5 阶段号）· 先结论再原因（结论一行，原因最多两行）· 报告用他能验证的话（「文档写完了 / 广告停了」，不是「PR merged / verdict 落库」）。

> **PM 看不懂 = agent 失职，不是 PM 的问题。**

### 2. PM 角色边界

PM **保留**范围 / 优先级 / 发布决定权，并决策业务 / 客户 / 钱 / 风险接受度 / 客户真实场景 fact。
PM **不**决策：分支策略 · 修复走 A 还是 B · 字段命名 · 测试怎么覆盖 · 架构与接口契约 · 任何技术实现细节。

技术决策自己拍 + **召 agent 复审**，不上抛 PM。把技术选择题塞回 PM = 失职。
涉及范围、优先级、发布或超出任务权限的动作必须由 PM 决定；不可逆操作须明确授权。Git 禁令仍有效，普通“继续”不是发布授权。

**合并分两档（PM 2026-09-25 拍板、09-26 确认）**：B/C 级 PR 由 `Risk gate` 按实际改动文件判级，必过检查全绿、评论全解决后机器自动合，**不再在聊天里问 PM**；A 级（含改本文件、`.github/`、数据库结构、鉴权、Kernel、钱等受保护路径）机器不合，由构建控制在聊天里问 PM 一句，PM 同意后才 `gh pr merge --admin`，agent 不得自行对 A 级用 `--admin`。细则见 [合并审批](./.github/merge-authorization.md)。

### 3. 遇卡点必自动化 + 管道不许断头

**上半：能自动化就必须自动化。** 第三方 UI 卡住 / API 未文档化 / 跨客户重复操作 → **自己解决**：深挖 UI 隐藏入口 → 官方 Graph API 直调 → 页面 context inject Ajax → DevTools 深度自动化 → 沉淀成 ME 产品能力。**绝对禁止**「请 PM/FDE/客户老板去点某个按钮」类人工 SOP。

**下半：确实做不了，也不许烂尾**（PM 2026-08-01 拍板，与上半配套，不是豁免）。判断顺序不许跳步：能自动化 → 必须自动化；确实做不了（按钮在第三方后台 / 需真人决策 / 对方系统挡住）→ **必须下发成人工任务**，且进同一个管道（今日待办 / 执行看板），不能只写进 cron summary / `console.log` / 只有开发看得到的表。

人工任务自带三件套，缺一条就是没下发好：**what**（问题**和影响**，说人话）· **how**（具体点哪里，让 FDE 不用问人）· **href**（直达链接，连粘贴都不用）。

> 一句话：**能自动就别丢给人；真丢给人，就把话说到他不用问第二遍。发现不许死在日志里。**

#### Inngest 工作流硬约束（2026-09-03）

凡是代码设计涉及**跨步骤异步接力**或**外部副作用**，必须把 Inngest 作为默认工作流层接入，而不是只靠页面状态、脚本日志或人工记忆串联。包括但不限于：内容生成 → Ray 审核 → 发布/排期 → provider 回执 → T+N 监控 → Outcome 回写。

最小要求：
- 事件名必须业务可读，例如 `daily_plan.publish_queue.ready` / `factory.cts_candidate.reviewed`；
- 每个关键阶段必须有机器可读 receipt：request id、client id、source record id、status、cost/provider 影响、no_publish / authorization 状态、created_at；
- 人工审核只能推进到下一事件，不等于发布授权；
- 发布、扣费、客户可见外发、排期这类副作用必须 fail-closed：没有 Ray 授权事件和 provider receipt，不许伪造完成；
- 如果某个工作流暂时不上 Inngest，PR 必须写明原因、恢复条件和替代 receipt 存在哪里。

不需要上 Inngest 的例外：纯展示 UI、单次同步读取、无外部副作用的本地纯函数或测试修复。不要为了“用了 Inngest”而把简单组件复杂化。

反模式与真实事故见 [PITFALLS §F](./docs/PITFALLS.md)。实现参考 `src/lib/pm-todo/manual-items.ts`（今日待办「🙋 需要你动手」栏）。

### 4. 大任务必须 ≥2 审

「大任务」= 触碰安全/隔离/鉴权 · 加表或改 schema · 新增对外 endpoint/UI · 跨多文件 >3 commit · 引入新依赖 · 影响已上线功能（满足任一即算）。

| 类型 | 谁审 |
|---|---|
| 大任务 | **子牙（架构）+ 魏征（挑刺）** 至少 2 个不同 agent |
| 面向 C 端客户 | **+ 板桥**（非技术视角）必须参与 |
| 触碰隔离/安全核心 | + 狄仁杰（攻击验证），实施后再补一刀 |

设计阶段审一次（出方案后、动手前），实施完再审一次。**「我自己审过了」不算 2 审。**

#### 风险分级质量闸（强制）

所有 Issue / PR **编码前先定 A / B / C 风险级别**，并按 [风险分级工程质量闸](./docs/ENGINEERING_QUALITY_GATES.md) 决定测试、集成、mutation 与 review 强度：

- **A 级**（安全、隔离、Kernel、migration、资金、发布、不可逆副作用）：强验证；
- **B 级**（普通业务逻辑/API/报表）：核心测试 + 少量集成 + 一次集中 review；
- **C 级**（UI/文案/原型）：smoke/截图/build，保持快速。

**禁止一刀切最高强度，也禁止高风险降级。** 只实现当前调用方需要的最小契约；完整 mutation 只在 A 级冻结 head 上跑一次。Review 轮次严格遵守 [#964](https://github.com/bigbigraydeng-maker/magic-engine/issues/964)：普通最多两轮，机器人新评论不自动授权继续修。

#### 资源优先级判断（强制，PM 2026-09-07 拍板）

同时有 ≥2 件待做的事要决定先做哪个时，**必须先按 [ENGINEERING_QUALITY_GATES.md §11](./docs/ENGINEERING_QUALITY_GATES.md#11-资源优先级判断pm-2026-09-07-拍板) 三维打分排序，再动手**——这道闸跟上面的 A/B/C 风险分级并列，都是开工前必答项，判的是不同的事：风险级别决定「做的时候多小心」，这道闸决定「资源先给谁」。

三个维度：**频率**（天天撞上 vs 偶发）、**IMPACT 闭环关键度**（卡在 Act/给错误信号的 Measure = 高）、**收入关联度**（直接影响客户投诉/续费 = 高）。判定顺序不许跳步，先看低的个数、再看高的个数：只要三个维度里有两个或以上是低，一律 P3 记入 ROADMAP 待认领，不因剩下那个维度是高而例外；否则若恰好一个低——两个高 → P1，其余 → P2；否则（零低）——两个以上高 → P0，其余 → P2。完整穷尽表见 [§11](./docs/ENGINEERING_QUALITY_GATES.md#11-资源优先级判断pm-2026-09-07-拍板)。

**必须把打分过程亮出来，不能只给结论**（PM 2026-09-07 拍板）：回复里要显式写「按 §11：频率 X / IMPACT Y / 收入 Z → P几」，逐项都要出现，不许只丢一个 P0/P1 的结论。这不是为了好看——文档写的规则不会自己生效，唯一能让 PM 不用追问就看出「这次是不是真的跑了这道判断」的办法，是让判断过程本身可见：漏判了，从回复里"没有这句话"就能一眼看出来，不用去猜、去翻代码、去问。

### 5. 三种工具分工与唯一写入者

Claude Code、Codex、CMUX DeepSeek 都可承担规划或审查；用户可直接给任一工具派活。每项代码变更开工前指定**一个工具中的一个会话为唯一写入者**，同时列出它负责的文件。

**写代码默认交给 DeepSeek（PM 2026-09-25 拍板，替代 2026-09-23 的试行）**：
- 默认：Claude Code 会话出每轮指令（文件 + 行号 + 验收）→ 用 Bash 直接跑 aider one-shot 让 DeepSeek 写 → Claude Code 审 diff、跑测试/build、提交/建 PR、查库。不需要 PM 开 CMUX 当操作员。此时唯一写入者仍是这个 Claude Code 会话。配方与已知坑见 [DeepSeek 分轮手册](./docs/codex-prompts/2026-09-24-ads-impact-deepseek-rounds.md) 与记忆 `reference-aider-deepseek-oneshot-recipe`。
- 两类例外可由 Claude Code 自己写：①要同时看懂多个文件才能写对的核心改动（Kernel、接线进上千行的大文件等）；②A 级安全核心（权限/RLS/鉴权/合并闸/资金/不可逆副作用）。走例外须在 PR 写一句原因。
- PR 写明 DeepSeek 跑了几轮、合计花费；只有例外部分由 Claude Code 自写。

- 写入者负责范围内实现、验证与交付；其它工具只读规划/审查，给出建议，由写入者统一落地，不自动代修。
- 可并行处理独立且文件不重叠的工作，但各自必须有明确写入者和文件边界；同一工作区同一文件（含公共文档、锁文件、生成物）禁止多代理同时修改。测试也不得互相覆盖 `.next` 等共享产物；不能证明不冲突就串行。
- CMUX 中的 DeepSeek 会话须先读取本文件和权威任务说明，并声明实际可用的读文件/执行命令工具；不假定终端容器或模型会自动加载规则。不能直接读仓库时交由有权限的参与者完成读取，只传必要证据与路径，不让用户反复贴源码。
- 交接先停止旧写入者，记录文件/diff/验证结果，再转移写入权。无人确认归属时先做只读检查，不抢写。
- 原有大任务多审、风险质量闸不变；**Codex 交付的 PR merge 前仍必须子牙复审**，见 [PITFALLS G2](./docs/PITFALLS.md)。不能把计划中的审查说成已完成。

**CMUX/Aider（DeepSeek）新会话开场**：当前仓库没有 `.aider.conf.yml` 的 `read` 配置；本机 `ds` 别名只选择模型，不自动载入指引。在 `/Users/raydeng/Projects/magic-engine` 启动的 Aider 中逐条输入（先确认显示已加入只读文件，再发 `/ask`）：

```text
/read-only AGENTS.md CLAUDE.md
/ask 请先阅读并遵守上述 Magic Engine 项目指引，确认已读文件和本轮角色；默认只读规划或审查，只有被指定为唯一写入者后才修改约定文件。不得自动提交、推送、合并或部署；读不到文件就准确报告限制，不要让我粘贴仓库已有源码。
```

### 6. Git

- 开始先运行：`pwd`、`git rev-parse --show-toplevel`、`git branch --show-current`、`git rev-parse HEAD`、`git status --short --branch`、`git diff --stat`、`git diff --cached --stat`。再用 `git rev-parse origin/main` 与 `git rev-list --left-right --count HEAD...origin/main` 核实本地记录的差距；引用不存在时如实记录，不能沿用旧终端截图的数字。
- 默认在用户指定的现有仓库/工作区工作，不自动 fetch、pull、切分支、stash、reset、merge、提交、推送或新建 worktree。需要同步或隔离时先说明风险与必要动作，核对任务授权；已获明确授权无需再问。fetch 只刷新远端引用，不等于更新工作分支。
- 保留已有改动，区分原有与本任务 diff；发现无关文件被其它窗口改动时不回滚。目标文件正在被其它写入者修改时停止该文件写入并协调归属。
- **禁止**：force push · rebase · 直接 commit 到 main · 删任何 `feat/*` / `claude/*` 分支。确需获准同步时沿用 merge 策略，之后重新核实基线并按风险重跑相关检查。
- 同一分支的 Git 状态变更由一个写入者负责；只读审查不必新建工作区。并行写入优先串行或采用已获准的隔离方案，不能因旧“一窗口一 worktree”惯例擅建。
- 不顺手改 `docs/ROADMAP.md` / `CLAUDE.md`；当用户明确要求项目流程变更时可直接最小修订现有指引。是否提交、推送、合并和部署按本次授权及 [合并审批](./.github/merge-authorization.md) 执行；“能合就快合”不是授权。B/C 级 PR 等机器自动合，不要手动合、更不要用 `--admin` 绕过 `Risk gate`；`Risk gate` 报“判定作废”是 PR 落后主干，`gh pr update-branch` 刷新即可。
- [PITFALLS §C/G](./docs/PITFALLS.md) 的历史事故仍作参考，其中自动同步及窗口数量的旧操作建议按本节执行。

### 7. 代码

- TypeScript strict，无 `any`；函数 < 50 行，文件 < 800 行
- SDK 客户端（OpenAI / Anthropic 等）**必须在 handler 内部初始化**，不在模块顶层
- 可复用逻辑放 `src/lib`，路由层只放 `src/app/api`
- **外科手术式改动**：只改必须改的，不顺手「优化」相邻代码 / 注释 / 格式
- **写前先读**：改任何文件前先读它的 exports、直接调用方、共享工具；不确定某段代码为何如此设计时**先问再改**
- 新表 migration 的 RLS 一律 service-role 模板 —— **必须写 `FOR ALL TO service_role USING (true)`，漏掉 `TO service_role` = 对匿名访客敞开读写**（2026-08-03 实测泄露 118 条策略）。禁止 `workspace_id` / `client_team` / `auth.uid()`。见 [DECISIONS](./docs/DECISIONS.md)
- 新建 `/api/cron/*` 路由必须**同一个 PR 内**加 `render.yaml` 调度条目
- **做网页 / 落地页 / 界面，上线或交付前必过 Impeccable 检查**（`.claude/skills/impeccable`，PM 2026-10-04 拍板）：运行 `.claude/skills/impeccable/scripts/impeccable detect <目录或网址>`，真问题当场修，误报写明理由；PR 或交付说明里写检查前后数字。客户页面的品牌色 / logo 必须先读 `master_briefs` 的 VI 再交给它，客户私有信息不写进共享 skill。它是现成工具（Buy），首次使用要下载检查程序（属外网读取，须先获准，再设 `IMPECCABLE_ALLOW_DOWNLOAD=1`），之后本地运行、无外部副作用，**不需要 Inngest**；只管网页，不管视频（视频仍走工厂）

### 8. 客户数据红线（违反 = 直接伤害客户）

- **绝不凭空注入客户业务数据**：写任何 Goal / Initiative / 关键词前，先查 `master_briefs` + `clients.primary_keywords`。搜索量 / KD / 点击数**必须来自 DataForSEO 或 GSC**，不能估不能编
- **对外内容必先 grounding 官网**：写 reel / post / 广告 / 邮件前先 WebFetch 客户官网真实产品页。`master_briefs` 只给方向，不含运营细节。发布前逐句标「官网可溯 / brief 可溯 / 未证实」
- **我们管理的 FB / IG 等社媒账户，所有要发布的视频一律只能走视频工厂流程（`src/lib/factory/`），禁止任何窗口另写脚本直接调生成 API（Muapi / WaveSpeed / Seedance 等）+ 平台发布 API 绕过工厂**：工厂流程自带查配方、出对账表、分镜自检这几道闸，绕开工厂等于把这几道闸一起绕开，而且绕过之后不会报错、不留痕迹，跟真正走过闸的产出长得一模一样。**窗口自己写「已完成、没问题」不算审查**——生产方和质检方必须是两个不同的角色（工厂产出 → 苏东坡 / 马良审 → PM 授权发布）。PM 2026-09-28 拍板；2026-09-28 East Inter 事故：另开脚本直接生产+发布，两条视频没有声音、文案数字编造，客户 Facebook 主页上已经真实发出去，见 [PITFALLS D14](./docs/PITFALLS.md)
- **对外画面必先跑配方对账**：只要要**写视频模板 / 调生图·生视频 API / 拼片出成片**，先查 `viral_reference_library` 拿该行业配方，**并输出一张对账表**（配方每一列 → 这次做了什么 → 满足 / 未满足 / 不适用），再动手。**只满足镜长、切点这类「改个数字就行」的列，跳过真人出镜 / 航拍 / 真实感这类「要换素材才行」的列 = 没照配方做**，成品会是「卡得很准的幻灯片」。2026-07-20、2026-09-03 两次同样事故，见 [PITFALLS D5](./docs/PITFALLS.md)
- **对外成片交付前必先出「分镜自检表」**：把成片截成逐镜缩略图（9 宫格），**自己逐镜过一遍再发 PM**——每镜检查①图对不对（是不是这个城市/地标，AI 生成的有没有糊脸/糊字）②文字对不对（错别字/张冠李戴）③logo 完不完整清不清晰。**禁止用「渲一版给 PM 看 → PM 挑错 → 重渲」的循环替代自检**：那样每轮五六分钟，本该一次抓全的问题拖成四五轮。图库图 / i2v 输出必逐帧核对来源与内容（见 [PITFALLS D6](./docs/PITFALLS.md)）
- **客户营销落地页必须建在客户自己的域名**，绝对禁止 `magicengine.com.au/<客户>/...`
- **FDE/PM 要填的字段必须连 Settings UI 一起做完**，绝不写「让 PM 进 Supabase Studio 直填」
- **素材不足去全网抓**：Unsplash/Pexels（首选，零风险）→ Apify（找参考定风格）→ 客户自传（质量最高）。但客户**真实产品 / 真实价格**的画面只能用客户自己提供的素材
- **自动改客户网站文案（标题/摘要/正文）前必过信息完整闸门**：目标词有 DataForSEO 搜索量+难度（快照 ≤14 天或现场查到）· 已取实时 SERP 前 3 标题 · SERP 里客户排名的是这一页而不是自家另一页 · 词含该页主题词且为受众语言 · 同词 90 天内未被别页用过 · 新文案不与原文事实矛盾。**任何一项缺失 = 跳过并写原因，绝不按 0 或借别页的词兜底。** 给客户打开自动开关前先跑 `dry_run` 给 PM 看；验收看最终改出来的文字，回执全绿不算数。2026-09-20 W38 事故见 [PITFALLS D10](./docs/PITFALLS.md) · [DECISIONS 2026-09-20](./docs/DECISIONS.md)
- 每条都是真实事故，细节见 [PITFALLS §D](./docs/PITFALLS.md)

### 9. 会话结束前必做

先按“AI 协作流程”交付真实证据。以下登记只在适用且本任务授权时执行；纯本地文档任务不因此追加提交、上线记录或客户数据库写入。未获准的后续事项留在权威任务说明。

1. 未完成任务写成台账卡（第 6 条）；只有需要排期、跨多窗口的大项才另写 [docs/ROADMAP.md](./docs/ROADMAP.md)（禁止只留在 TodoWrite）
2. 已上线功能追加到 [docs/history/CHANGELOG.md](./docs/history/CHANGELOG.md)
3. commit message 带 Phase ID：`feat(module): description [P21.J.M1]`
4. **本次实际操作过的客户**各写一条工作日志（不写 = 会话结束协议不完整）：
   ```sql
   INSERT INTO fde_work_logs (client_id, log_date, summary, author_email)
   VALUES ('<client_id>', CURRENT_DATE, '<摘要>', 'bigbigraydeng@gmail.com');
   ```
   摘要格式：`【SEO】… 【GEO】… 【Meta 广告】… 【GBP】… 下一步：…`（≤300 字，中文）
   客户 ID：CTS Tours NZ `c0000000-0000-0000-0000-000000000000` · Oztop `d5c98811-1c1d-4ded-bdf0-4cefec6afb84`
   纯对话 / 纯查询 / 未落地的讨论**不算**实际操作，不写。
5. 有实质开发/审计交付时附 **Reuse Statement**；不能只写“完成了什么”，还要说明共享/行业/客户边界与是否复用了已有平台能力。
6. **本窗口聊定的每条结论写进 [docs/ledger/](./docs/ledger/README.md)**（一条一文件，状态 decided/done/verified/failed）。只写记忆或 ROADMAP 不算——那两处没有程序在读；台账每个工作日会被今日待办邮件读一遍，改了 `src/` 没写台账的 PR 合并前会被拦。

---

## 文档索引

| 文档 | 什么时候看 |
|---|---|
| [docs/STATE.md](./docs/STATE.md) | **唯一真相源** — 现在什么在跑 / 部署在哪 / 38 个 cron / 模块↔代码映射 |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | 还有什么没做（只留未完成） |
| [docs/ENV.md](./docs/ENV.md) | 环境变量总表（113 个，含哪些没登记） |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | 为什么是现在这样 / 哪些老决策已作废 |
| [docs/PITFALLS.md](./docs/PITFALLS.md) | **动手前扫一眼** — 真实事故清单 |
| [docs/ENGINEERING_QUALITY_GATES.md](./docs/ENGINEERING_QUALITY_GATES.md) | **每个 Issue / PR 开工前** — A/B/C 风险级别、对应验证强度、review 停止条件；≥2 件事排先后时看 §11 资源优先级三维打分 |
| [docs/roadmap/2026-08-19-me2-platformization-principle.md](./docs/roadmap/2026-08-19-me2-platformization-principle.md) | **所有开发窗口必读** — Reuse First、垂直版本共享底层、五道 Build Gate、Memory 泛化边界 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) · [docs/PRODUCT.md](./docs/PRODUCT.md) | 数据模型 / API 分域 · 产品愿景与商业模式 |
| [docs/specs/](./docs/specs/) · [docs/sops/](./docs/sops/) | 单功能设计文档 · 可复用操作手册 |
| [docs/agents/](./docs/agents/) · [docs/clients/](./docs/clients/) · [docs/history/](./docs/history/) | agent 人设（Codex 入口 `CODEX.md`）· 客户交付物 · 完成日志与历史快照 |

## 常用命令

```bash
npm run dev              # 开发服务器 :3001
npm run build            # 生产构建（推送前必须通过）
npm test                 # vitest
npm run type-check       # tsc --noEmit
bash scripts/doctor.sh   # 系统自检：env / 外部 API / cron
```

部署：推 `main` → Render 自动部署（**不是 master**）。
