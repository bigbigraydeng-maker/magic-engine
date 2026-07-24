# Magic Engine — Agent 工作指南

> 每次打开新会话：先看底部 **§ 当前焦点** → 按需读 [ROADMAP.md](./ROADMAP.md)。

## ⭐ ME 核心引擎 = DAPE（2026-06-08 PM 拍板上线）

> **不是** GIMPT (Goal/Initiative/Marketing-plan/Prescription/Task 11 层) — 那是早期工程师视角堆叠。
> **是** **DAPE** = **Discovery → Analysis → Prescription → Execution**，4 段循环 + AI 贯穿全程 + 6 大支柱矩阵。
>
> | 段 | 一句话 | ME 后台 agent |
> |---|---|---|
> | **D** Discovery 发现 | ME 主动找客户没意识到的痛点 / 机会 / 异常 / 竞品动作 | 司马徽 (新建, Week 4+) |
> | **A** Analysis 分析 | ME 拿数据 + AI 给客户 6 支柱打分 + 说清楚为什么 | 华佗 (huatuo) ✅ memory 接通 |
> | **P** Prescription 处方 | AI 出战略地图: 该做什么 / 不做什么 / 为什么 / 资源怎么分 | 华佗 + 诸葛亮 (zhuge) ✅ Goal 一对一 + 版本化 |
> | **E** Execution 执行 | FDE / 客户把处方翻译成可做的动作, 跑掉, 回流 | 诸葛亮 + 鲁班 (luban) ✅ AI 推荐今天做 3 件 (短模式 0 MTC) |
>
> **6 大支柱（横向切片）**：SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品。每段 × 6 支柱 = 24 格矩阵，**不死板** — 按客户行业 plugin 不同权重。
>
> **AI 学习闭环**：3 层 memory（客户级 + 行业级 + 全局），huatuo + zhuge 都接通已有 14 张 memory 表 (Phase 23/30 沉淀)，每周 `agent-learning-rollup` cron (Mon 07:00 UTC) 把 outcome 回灌 client_learned_preferences。
>
> **双轨业务（PM 强约束 不能打翻）**：
> - **self-serve 自助客户**：`/portal/register` 域名注册 → 自助 wizard → 全程消耗 MTC
> - **FDE 月付客户**：跟 ME 团队对话签约 → PM/FDE 后台代配 Goal/Initiative/Campaign/Plan → 月付套餐 MTC 充足
> - 两轨**共用** DAPE 4 段引擎 + 四视角分层 UI：自助客户 / FDE 客户老板 / FDE 内部 / 数据层
> - AI prompt 双模式：**短** (~500 tokens, 自助省 token) / **长** (~3000 tokens, FDE 深度)
>
> **完整 spec**：[`docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md`](./docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md) (949 行, 5-agent 签字: 子牙 / 板桥 / 魏征 / 狄仁杰 / 诸葛亮)
>
> **对外文案**：用大白话「发现-分析-处方-执行」，**对外不出现 DAPE 字眼**。DAPE 仅 ME 内部技术文档用 (板桥强约束)。
>
> **任何 agent 提案前必先问**：跟 DAPE 哪一段对齐？跟 6 支柱哪一柱关联？是 self-serve 还是 FDE 轨？跟 AI memory 哪一层挂钩？

### DAPE 改造硬约束（v0.3 spec 教训沉淀，所有 worker 必读）

1. **migration 必 PM 拍板**：worker 严禁自行 `apply_migration` (W4/W5 worker 都踩过，导致 1 个 P0 Kanban 崩 + 1 个 BLOCKER P→E 链断)
2. **加 enum / status 新值必同步前端 type + UI fallback**：每次改 `type X = 'a' | 'b' | 'c'` 必 grep 全仓 Record / switch / STATUS_META key 同步 (superseded 事故教训)
3. **删 PR 分支前必 verify `gh pr view <N> --json state` = MERGED**：不能 force push 完立刻 delete branch (PR #410/#415 误删事故教训)
4. **worker 报"已 apply migration"必 SQL 验证 `supabase_migrations.schema_migrations`**：不能信 worker 口报 (W4/W5 都误报)
5. **大改动前 5-agent live 复审**：子牙独裁起草必被 PM 拉回 (今天 PM 拉回 4 次)

---

**⚠️ 必读规则（每次会话开始前强制执行）：**
- [`~/.claude/rules/coding-style.md`](~/.claude/rules/coding-style.md) — 含「删除代码前的强制流程」，**PM 反问 ≠ 删除指令**
- [`~/.claude/rules/development-workflow.md`](~/.claude/rules/development-workflow.md) — 含「删除决策：先读意图，再动手」步骤 0.5
- **§ Codex 协作分工**（见下方）— ME 项目 Claude Code 主导，Codex 辅助，PM 不亲自分配 Codex 任务

**输出语言**：对话和说明**一律用中文**，**无论用户用什么语言提问**（包括纯英文）。代码 / 变量 / 注释保持英文。

---

## 跟 PM 说话的格式（强约束 · 2026-07-20 PM 拍板 · 永久）⭐⭐⭐

> **PM 是非技术 PM。给他的每一句话都要「他不用问第二遍就能回」。堆专业词 = 沟通失败,不是他的问题,是子牙的问题。**

### 硬规则(每次回复 PM 都适用)

1. **一次只问一件事**。不要一口气抛 2-3 个待决项让他挑。其余的等这件办完再问。
2. **问题必须能一句话回**。给他明确的回法(「回 `go merge` 就行」),不要开放式「你觉得呢 / 要不要这么排」。
3. **专业词一律翻译成人话**,或者干脆不说。禁止在给 PM 的话里裸用:migration / force-pause / rebase / schema / enum / cron / payload / P1-P5 阶段号 / CHECK 约束 / RLS…… 这些是内部词,只写进文档和代码。
   - ❌「P1 要建 `ad_daily_insights` 表,需要你 `go apply` 才能跑 migration」
   - ✅「要建数据库表的时候,我会停下来单独问你一次」
4. **先说结论,再说为什么**。结论一行,原因最多两行。他要细节会自己问。
5. **不要把技术选择题塞给他**(这条跟 § PM 角色边界 是同一件事的两面)。技术方案子牙自己拍,只把**业务/花钱/不可逆**的决定交给他。
6. **报告干了什么,用他能验证的语言**:「文档写完了 / 合进系统了 / 广告停了」,不是「PR merged / branch synced / verdict 落库」。

### 真实事故(2026-07-20)

Ad Strategy Engine spec 写完后,子牙给 PM 抛了一段「下一步(你定)」:里面同时塞了 `go merge`、force-pause 守卫、migration `go apply`、P1-P5 阶段号,还反问「要我现在就这么排吗?」。PM 直接回:**「看不懂你的问题」**。

改成一句话「**文档写完了,要不要现在合进系统?回 `go merge` 就行**」之后,PM 立刻就办了。

PM 当场拍板:「你写到 claude 文档里,今后对于我问的问题都按照上述格式,不要甩太多专业词语」。

### 一句话

> **一次一件事 · 一句话能回 · 零黑话 · 先结论。PM 看不懂 = 子牙失职,不是 PM 的问题。**

---

## PM 角色边界（强约束 · 2026-06-13 拍板）⭐⭐⭐

> **PM 只决策业务 / 客户 / 钱 / 优先级 / 风险接受度。技术决策永远不上抛 PM。**
>
> ME 项目里 PM 是非技术 PM,Claude Code(尤其子牙)的职责是**给方案**,不是抛问题。把技术选择题塞回 PM = agent 失职。

### PM **能** 回答的(业务/优先级/风险)

- 「这事现在做还是下周做」「优先级排哪儿」
- 「这条业务规则对不对」「客户能接受吗」「钱怎么算」
- 「这个 trade-off 你选 A 速度还是 B 质量」(给业务影响选项,不是技术选项)
- 「这个不可逆操作(merge / migration / 删分支)go or stop」
- 「客户 X 真实场景是什么」「事故现场细节」

### PM **不**回答的(技术决策子牙拍板)

- 分支策略 / commit 拆分 / PR 拆分 / merge 顺序
- 修复路径走 A 方案还是 B 方案(三层防御 vs 单点修)
- spec / 文档放哪个 worktree / 怎么 push / 怎么落库
- Codex prompt 怎么写 / 字段怎么命名 / 测试怎么覆盖
- 代码架构 / 接口契约 / 数据模型
- 任何**技术实现细节**

### 子牙正确做法

1. **自己拍方案**:基于已有上下文 + 代码事实,给出**单一推荐路径**(不是选项 ABC 让 PM 选)
2. **召 agent 复审**:大任务召魏征(挑刺)/ 板桥(C 端 UI 沟通)/ 狄仁杰(攻击验证),不是召 PM
3. **告诉 PM 的是结论**:「我们决定走 X,因为 Y。要你回 OK 或挑战业务影响」
4. **只问 PM 业务输入**:「客户 X 在事故现场具体点了什么按钮?」「这页改写客户老板能接受多大风险?」

### 反模式(绝不做)

- ❌ 一次抛 4 个技术问题让 PM 挑(2026-06-13 子牙踩 — PM 拍桌"我无法回答,你给方案")
- ❌ 「我建议 A,但你也可以 B,你选?」(技术选择题塞回 PM)
- ❌ 把"自己审过"当复审,不召其他 agent(自审无效,必须不同视角)
- ❌ 因为方案有不确定性就上抛 — 不确定就**召 agent 复审 + 自己拍**,不是问 PM

### 唯一例外

- **不可逆操作 go-or-stop**:`gh pr merge` / `apply_migration` / `git push --force` / 删客户数据 — 这是风险接受度,属于业务决策,必须 PM 显式 `go merge` / `go apply`

### 一句话

> **PM 给业务输入 + 不可逆操作显式 go。技术决策子牙拍 + 召 agent 复审。技术选择题塞回 PM = 子牙失职。**

---

## 遇卡点必自动化(强约束 · 2026-07-11 拍板 · 永久)⭐⭐⭐

> **业务增长模型必须自动化。任何工作出现卡点,子牙必自己解决,把「让 PM/FDE/客户老板去手动点」当作不存在的方案。**

### 触发场景(必自动化)

- 第三方 UI 卡住 / 找不到入口
- API 未文档化或需要 reverse engineer
- 需要跨客户 / 跨账户 / 跨月度重复的操作
- 未来客户规模化下会指数放大的手动工作

### 绝对禁止(2026-07-11 PM 拍桌)

- ❌ 「请 PM 手机 Business Suite 手动 boost N 个视频到广告组」类甩手方案
- ❌ 「让 FDE / 客户老板去 XX 平台点击 XX 按钮」类人工 SOP
- ❌ 「这个 UI 找不到入口,你能不能自己操作」类工人思路
- ❌ 因为 3rd party UI 麻烦就 handoff 给 PM 或客户

### 必须做(自动化路径清单)

1. **深挖第三方 UI**:hover 状态 / 二级 dropdown / URL 参数 / 隐藏 flow / 键盘快捷键 / 右键菜单
2. **官方 Graph API 直调**:Meta Graph API / GA4 Data API / GBP API / Mailchimp API / GSC API / Google Ads API — 主流平台都有官方 API
3. **javascript_tool inject Ajax**:在页面 context 里复现前端 GraphQL/REST mutation(F12 → Network 抓真实 request,复现到 fetch)
4. **Chrome DevTools 深度自动化**:puppeteer-like 长交互链、多 tab 协调、隐藏 iframe 操作
5. **ME 后台 scenario 沉淀**:同一操作跨客户复用,写进 ME 变成可复用产品能力(如「winner Reel → paid Ad Set 自动同步」应该是 ME 的 media-planner 模块)

### 唯一例外(还是那 2 条)

- **不可逆操作 go-or-stop**(PM 显式 `go publish` / `go merge` / `go apply`)
- **客户真实业务场景 fact**(PM 是唯一 source of truth,如「客户老板决策」「事故现场发生了什么」)

### 一句话

> **业务规模 = 自动化 × 无人工兜底。UI 卡了自己深挖,API 未知自己 reverse,别把手工丢回 PM。**

### 真实事故(2026-07-11)

子牙给 CTS ThruPlay Pool Builder 加 4 winner Reel,Meta Ads Manager「使用现有帖子」radio 没暴露 post 切换器 — 子牙 handoff「请 PM 手机 Business Suite boost 4 个 Reel」。PM 拍桌:「我不接受人工来做,考虑到未来的业务增长模型,还是需要自动化来做,子牙你要写到 CLAUDE 里,任何工作出现卡点都需要先自己解决,把人工替代当作不存在的方案」。

---

## 素材来源政策（PM 2026-07-25 拍板 · 强约束）⭐⭐

> **素材不足不是借口 —— 去全网抓。** PM 原话:「素材不足你去全网给我抓!!!apify,pinterest,unsplash 都给我用上。好看的图就转视频,或者图转图,再转视频。」

**抓取优先级(按合规性排序,不是按方便程度):**
1. **Unsplash / Pexels** —— 明确免费商用许可,**首选**,零风险
2. **Apify 各类 scraper** —— Pinterest / IG / FB 等,用于**找参考、定风格、判断什么好看**
3. 客户自己上传的真实素材 —— 免登录上传链接已上线,**质量最高、唯一能打真价**

**加工链路**:好看的图 →(i2v)→ 视频;或 图 →(图转图,换风格/换主体)→ 再转视频。引擎走 Muapi(见 [[feedback-disable-higgsfield-use-muapi]])。

**版权**:PM 明确拍板「版权的事情不需要你考虑」,**风险由 PM 承担,agent 不再就此反复请示**。
但仍执行两条,因为它们是**客户利益**不是版权洁癖:
- 优先用 1、3 类来源(既合规又不用讨论)
- **客户真实产品/真实价格**的画面**只能**用客户自己提供的素材(见「绝不凭空注入客户业务数据」红线)—— 抓来的图可以做氛围,不能冒充客户的产品

---

## Codex 协作分工（PM 强约束）⭐

> ME 项目里 PM 同时开多个 Claude Code 窗口并行做事，**Claude Code 是主导，Codex 是辅助**。Codex token 便宜，适合大量精准修复 + 测试覆盖。**PM 不亲自给 Codex 派活，由 Claude Code 统筹分配。**

### 核心原则

1. **单文件单负责人**：同一时间一组相关文件只允许一个代理写入。
2. **先分工，后动手**：开工前先明确每个任务的 owner，会碰共享组件 / route / schema 必须先确认边界。
3. **小步提交**：每个完整改动一个独立 commit，不混不相关修复。
4. **交接必须可验证**：留下改了什么 / 跑了什么测试 / 还有什么风险。
5. **不并行改同批文件**：必须并行就物理隔离（独立 worktree / 独立分支）。

### 分工边界

| 任务类型 | 主担 | 原因 |
|---------|------|------|
| 大范围重构 / 批量迁移 | **Claude Code** | 需要全局视野 + 多轮试错 |
| 长链路实现（跨模块端到端）| **Claude Code** | 持续上下文 |
| 复杂调试（涉及多文件因果）| **Claude Code** | 子牙判断 + 多 agent 协作 |
| 架构决策 / 战略判断 | **Claude Code（含子牙）**| 不可下放 |
| **精准 bug 修复**（单文件局部）| **Codex** | 便宜、专注 |
| **补单元测试 / 回归测试** | **Codex** | 模板化工作 |
| **修测试断言不一致** | **Codex** | 低风险机械任务 |
| **死代码清理 / 文案对齐** | **Codex** | 范围窄 |
| **API 端点小幅扩展** | **Codex** | 有现成 pattern |
| **审查 Codex 的修复** | **Claude Code 调用子牙** | 防 Codex 撒谎 / 漏覆盖 |

### Codex 任务交付要求（PM 转发提示词时必带）

每次给 Codex 派活，提示词必须包含：

1. **明确文件清单**（绝对路径 + 行号范围）
2. **明确 owner 声明**：「本任务由你独占，期间 Claude Code 不会动这些文件」
3. **验证清单**：
   - 测试命令（具体到 `npx vitest run <path>`）
   - 预期测试数
   - build 验证（`npm run build`）
4. **交接证据要求**：
   - 分支名 / commit hash / PR 号
   - 改动 diff 概要
   - 测试输出
5. **撒谎防御**：「如未真实落地代码，不要谎报通过；上次曾发生 Codex 声称修复但仓库无此 commit 的事故」

### 子牙复审（强制）

**任何 Codex 交付的 PR 在 merge 前必须由子牙 agent 复审**，重点：

1. **真实性**：commit 是否真的存在（不是幻觉）
2. **测试覆盖**：测试数量是否对得上（Codex 容易虚报）
3. **变异测试**：故意改坏校验逻辑，对应测试是否会 fail（防空架子测试）
4. **边界覆盖**：Codex 容易只覆盖 happy path 漏边界
5. **架构旁路**：校验放在最里层，确认无 API 绕过

子牙复审通过才能 merge。**PM 不亲自审 Codex 代码**——交给 Claude Code 调用子牙处理。

### Agent 审查协议(PM 强约束 · 2026-06-05 确立)⭐⭐

> 任何大任务都必须走至少 2 审。面向 C 端客户的必须加板桥。这条规则**适用于所有 session、所有 agent、永久生效**。

#### 「大任务」如何界定(满足任一即算大)

- 触碰**安全 / 隔离 / 鉴权**核心(P34 这类)
- 加**新数据库表**或改现有 schema
- 新增**对外/对客户暴露的 endpoint 或 UI**
- 跨**多文件、>3 个 commit、>半天工作量**
- 引入**新依赖**或**新外部服务**
- 影响**生产已上线功能**(改现有路径)

满足任一,走「大任务」流程;否则普通小活(改文案、单文件 bug fix)一审即可。

#### 审查矩阵

| 任务类型 | 必须谁审 |
|---|---|
| 普通小活 | 一审即可 |
| **大任务** | **子牙(架构) + 魏征(代码挑刺)** 至少 2 审 |
| **面向 C 端客户**(客户能看到/接触的 UI、文案、推送内容) | **+ 板桥**(非技术 PM/客户视角通沟通)**必须参与** |
| **触碰隔离/安全核心** | + 狄仁杰(攻击验证)实施后再补一刀 |

#### 审查时机

- **设计阶段**(出方案后、动手前):子牙出方案 → 魏征/板桥审 → PM 拍板 → 动手
- **实施完**:再让魏征审代码 + 狄仁杰断案(像 P34.1/P34.2 那样)
- **PR merge 前**(尤其 Codex 交付的):子牙复审(见上节)

#### 反模式(绝不做)

- ❌ 大任务跳过 2 审直接动手
- ❌ 面向 C 端的方案没经板桥过滤就抛给 PM(PM 会被技术问题绕晕,事故现场:2026-06-05 我把 6 个 P3 二期问题全堆给 PM,他回"看不懂",事后魏征+板桥筛只剩 3 个真商业决策)
- ❌ 把"我自己审过了"当 2 审(自审无效,必须不同 agent)
- ❌ 因为子牙的方案"看起来很扎实"就跳过魏征(同级别 agent 互查,挑遗漏角度才是价值)

#### 一句话

> **大任务 ≥ 2 审,面向 C 端 + 板桥,触碰安全 + 狄仁杰。审完才动手,实施完再审一次。**

### 冲突处理

- 同文件被另一代理修改 → 先停，比对差异再决定
- 两代理都在改同一功能 → 一主一辅，不双写
- 分支已分歧 → 先 commit 当前进度，再基于最新 commit 重新接手
- **多 Claude Code 窗口并行** → 各自用独立 worktree（`git worktree add`），不共用同一物理目录的脏文件

### 一句话总结

> **PM 不分配 Codex 任务，Claude Code 统筹。Claude Code 写提示词 + 子牙复审 + 决定 merge。Codex 干便宜的精准活，Claude Code 干贵的复杂活。**

---

## 多窗口 / 咒语接力工作流（强约束 · 2026-06-12 沉淀）⭐⭐

> **事故背景**：2026-06-12 审 4 个 open PR（#460 / #455 / #452 / #448）发现**全部 `dirty`（跟 main 冲突）无法 merge**。最老的放了 4 天。根因 = **长命分支 × 高频共享文件（ROADMAP.md/CLAUDE.md）× 多 session 不同步** 三者叠加。两个 docs-only PR（2 文件 / 1 文件）也照样冲突，全因抢改 ROADMAP/CLAUDE.md；#460 描述说改 8 文件、GitHub 显示 78 文件 +4718 行 = 典型「分支基于旧 main、从没 sync」的 diff 虚胖症状。

### 根因三条（记住这三个就够）

1. **PR 开太久没合** → main 漂远 → 冲突必然。能合的几小时内合，别过夜拖天。
2. **抢改 ROADMAP.md / CLAUDE.md** → 这俩是头号「冲突磁铁」，几乎每个 PR 都动它们。
3. **多 session 各开各的、开工前不 sync main** → 全基于旧 main，最后全撞一起。

### 咒语接力：新窗口拿到咒语后，**写代码前必做**（顺序不能乱）

```bash
git fetch origin                      # ① 永远先 fetch（只读，绝对安全）
git checkout <咒语里的确切分支名>
git pull --ff-only origin <分支>       # ② 拉该分支远程最新（别的窗口可能推过）
git merge origin/main                 # ③ 把最新 main 合进来 —— 关键防漂移步骤
# 解冲突（此刻冲突最小）→ 跑 npm run build + 测试 → 才开始写新代码
```

- **同步 main 必须用 `git merge origin/main`，禁止 rebase**：本仓强约束「绝对禁止 force push / rebase」，而 rebase 已 push 的分支必须 force push → 违规。merge 产生 merge commit、push 是 fast-forward、零违规（这是验证过的安全姿势）。
- **merge 完务必重跑 build + 测试**：文本不冲突 ≠ 语义不冲突，main 的新改动可能悄悄破坏分支假设。

### 咒语本身必须带的信息（光给任务名不够）

1. **确切分支名**（不是让新窗口猜 / 新建重复分支）
2. **PR 号**（若已开）
3. 明示一句 **「开工前先 `git merge origin/main`」**
4. **已完成 / 下一步**（让新窗口不重推导、不重做）
5. **base 以最新 main 为准**

### 其他铁律

- **一个分支同一时间只允许一个窗口开**：开新窗口前先确认旧窗口已关；接力同一大任务用**同一分支**，全新并行任务基于**最新 main** 开新分支 + 旧窗口不关就用 `git worktree` 物理隔离。
- **别在大任务/功能分支里顺手改 ROADMAP.md / CLAUDE.md**：登记类改动拆**独立小 PR 立即合**（纯文档、风险极低），把冲突源从功能 PR 里剥离。
- **「文件数 vs 描述对不上」当漂移警报**：描述说 8 文件、GitHub 显示 78 → 分支太旧没 sync，早发现早 merge main。
- **PR 切小、切短命**：别一个 PR 塞「核心修复 + 新 API + UI + migration + ROADMAP」（#460 的反面教材），拆小块快进快出。
- **区分「不能合」vs「不该合」**：纯机械冲突 = 不能合（merge main 即可）；等 migration apply / 等真决策 = 不该合（合了也是半成品）。看 PR 先问卡在哪一类。
- **带 migration 的 PR 天生两步合**：migration 必 PM 拍板、worker 不许自行 apply（见 § 开发约定），merge 要配合 PM 手动 apply 那一步，提前按两步规划。

### 一句话

> **长命分支是万恶之源。治本三招：①能合就快合 ②ROADMAP/CLAUDE.md 登记拆独立小 PR 立即合 ③新窗口开工先 `git fetch` + `git merge origin/main`（永远 merge，永不 rebase）。**

---

## 产品战略方向（2026-05-18 确立）⭐

> **DataForSEO 提供数据地基 → Magic Engine 在上面跑自动化执行引擎 → 同时覆盖 Google SEO + AI 搜索两个战场**

Magic Engine 的核心护城河不是数据（数据可以买），而是**执行自动化**：诊断发现问题后，平台自动生成并执行修复动作，结果回流归因，形成飞轮。

竞品定位：
- **SEMrush**：数据基础设施（Magic Engine 的上游，不是竞争对手）
- **Search Atlas / OTTO**：最接近的竞品方向，但 OTTO 只覆盖 Google SEO 一个战场，**Magic Engine 同时覆盖 Google SEO + AI 搜索（GEO），这是 2026 真正的差异化窗口**
- **DataForSEO**：数据层供应商，替代 SEMrush 直连 API，节省 96–99% 数据成本

---

## 项目定位

Magic Engine 是 Magic Lab 2026 旗舰产品，**四大模块**（不偏离）：

| 模块 | 封装名 | 状态 | 核心功能 |
|------|--------|------|---------|
| **SEO** | SEO 内容引擎 | ✅ 成熟 | 关键词情报、双信号博客（SEO×GEO）、AI 可见度追踪 |
| **社媒** | 社媒内容矩阵 | ✅ 成熟 | 多客户 Brand Brief、Campaign 批量生成、视觉工坊、多平台发布 |
| **广告** | Ads Intelligence | 🔄 建设中 | 多平台广告账户连接、AI 诊断引擎、一键 Fix / Talk to Us |
| **数据** | Insight Reports | 📋 规划中 | 月报 PDF 自动生成、客户 Portal、跨模块数据聚合 |

**广告模块四平台优先级**：Meta（已有 MCP）→ Google Ads（申请 developer token）→ TikTok → LinkedIn

**Fix vs Talk to Us 边界**：
- ✅ Fix（可自动执行）：暂停亏损关键词、调整出价、添加否定词、启停广告
- 🔴 Talk to Us（需人工介入）：重构广告系列结构、预算策略调整、创意方向、跨账户决策

原则：全自动→半自动→手动+UI 辅助；内部工具优先，不做付费墙；客户层不暴露第三方供应商名。

---

## 第三方服务封装名 ⭐

UI / 报告 / 客户交付物中**禁止出现真实供应商名**，只用封装名：

| 真实服务 | 封装名（UI 对外） |
|---------|----------------|
| OpenAI GPT-4o-mini | **Content Engine** |
| Anthropic Claude Sonnet | **Strategy Engine** |
| WaveSpeed / Atlas | **Visual Studio** |
| Seedance / Atlas | **Video Studio** |
| HeyGen | **Avatar Studio** |
| SEMrush | **Keyword Intelligence** |
| Jina.ai Reader | **Site Analyzer** |
| Airtable | **Content Workspace** |
| Publer | **Publishing Hub** |

规则：UI 文案用封装名；API 路由内部可用真实代号；错误日志内部可含真实名；环境变量保留真实命名（如 `ATLAS_API_KEY`）。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14 App Router + Tailwind CSS |
| 后端 | Next.js API Routes |
| 数据库 | Supabase (PostgreSQL + Storage) |
| AI 文本 | OpenAI GPT-4o-mini + Anthropic Claude Sonnet |
| AI 图片/视频 | Atlas Cloud (WaveSpeed Flux-dev + Seedance 2.0) |
| AI 头像 | HeyGen |
| 关键词/SEO | SEMrush API + DataForSEO |
| 网页抓取 | Jina.ai Reader |
| 内容协作 | Airtable REST API |
| 社媒发布 | Publer API v1 |
| 部署 | Render（监听 `main`，PR 合并后自动部署） |

---

## 开发约定

- TypeScript strict mode，无 `any`；函数 < 50 行，文件 < 800 行
- SDK 客户端（OpenAI、Anthropic 等）**必须在 handler 内部初始化**，不在模块顶层
- Airtable 写回用 `.catch()` 静默失败，不影响主流程
- 乐观更新：先更新 UI，再调 API
- 可复用逻辑放 `src/lib`，路由层只放 `src/app/api`
- UI 层禁止出现第三方供应商真实名
- **外科手术式改动**：只改必须改的，不顺手"优化"相邻代码、注释或格式；风格与现有代码保持一致
- **写前先读**：修改任何文件前，先读该文件的 exports、直接调用方、共享工具函数；不确定某段代码为何如此设计时，先问再改
- **FDE/PM 配置类数据必须有 UI（强约束）⭐**：任何需要 FDE/PM 在客户级别填的字段（brand_aliases / competitor_domains / primary_keywords / GA4 property_id / GBP account_id / 任何 connector 配置），**必须连同 Settings 页 UI 一起做完才算 ready**。**绝不能写"让 PM 进 Supabase Studio 直填" / "FDE 跑 SQL UPDATE" 这种 SOP**——运营人员不应该碰数据库。判断标准：如果某个字段被 FDE 工作流读，它的写入路径必须是 ME 后台的可视化 UI。新功能 PR 如果只加了字段没加 UI 就上线，按"产品缺陷"对待，下一 PR 必须补。复用 pattern：`CompetitorDomainsPanel` / `PrimaryKeywordsPanel`（chip + add input 模板）+ `/api/clients/[id]/{field}` 对称 GET/PATCH 路由。
- **🔴 客户业务/营销 LP 必须建在客户自己的域名（红线 · 永久禁止）⭐⭐⭐**：任何为客户（CTS / Oztop / 任何 FDE 月付客户）做的**对外营销落地页 / 销售落地页 / Lead 收集页 / 产品页 / 活动页**，**必须建在客户自己的域名下**（如 `oztopbuildingsupplies.com.au/walnut-clearance/`），**绝对禁止**建在 `magicengine.com.au/oztop/...` 或任何 ME 域名子路径下。理由：①客户的 SEO 权重必须积累在客户自己的域名 ②客户业务身份和 ME 身份必须严格隔离 ③客户老板看到自家活动页挂在供应商域名下会感到品牌被绑架 ④ME 是工具不是客户身份。**判断标准**：如果某 URL 用户/搜索引擎能直接访问，且内容服务于某客户的销售/获客/品牌，URL 必须在客户域名下。**实施路径**：①给客户写 React/HTML LP mockup → ②转 Elementor Template JSON 或 WP 主题模板 → ③Oztop FDE / 客户老板在 WP 后台 import → ④表单后端通过 webhook 调 ME API 收数据。**真实事故**：2026-06-10 子牙提议把 Oztop Walnut 清仓 LP 建在 `magicengine.com.au/oztop/walnut-clearance/` 作为"方案 B 更简单"，PM 拍桌定红线"这就是放屁，必须严肃，永久写入文档"。ME 只能做内部工作台 / Discovery 落地页 / 自家品牌活动页，**绝不承载客户对外营销页**。
- **绝不凭空注入客户业务数据（强约束）⭐⭐**：任何给客户写战略 Goal / Initiative / Action / 关键词列表 / 业务方向之前，**必须先做两件事**：①查 `master_briefs.{brand_name, core_proposition, target_audience, content_pillars, keyword_seeds}` 拿真实业务方向；②查 `clients.primary_keywords` 拿 PM 配的真实主关键词。**绝不能从外部对话/记忆/直觉假设业务方向**，绝不能编 search_volume / KD / 月点击 等数字——数字必须来自 DataForSEO（用 ME 的 keyword-snapshots-weekly cron 或调 `bulkKeywordVolume()`）或 GSC snapshots。**两次重大事故教训**：(1) CTS 子牙凭空假设"queenstown inbound 旅游" — 实际 CTS 是 outbound Kiwi→中国旅游；(2) Oztop 子牙编了"vinyl/herringbone/plantation shutters/sheer curtains" 5 个品类页 + 编 18100/22200 搜索量 — 实际 Oztop 不卖 shutters/curtains/herringbone，且数字全是编的。判断标准：**任何 SEO/营销内容/数据相关 SQL 写入或 Initiative hypothesis，必须能在 master_brief 或 clients 表里指明真实来源**；否则停手问 PM。
- **客户 tour/产品对外内容必先 grounding 官网真实行程（强约束）⭐⭐**：给客户写任何**对外内容**（reel/post/caption/文案/广告/邮件）前，**必须先 WebFetch 客户官网的真实产品/行程页**，一切具体运营 claim（地点 / 时段 / 含项 / 节奏 / 价格 / 怎么玩）**以官网为核心事实源**。`master_briefs` 只给定位/受众/支柱（方向），**不含真实行程细节**——具体怎么安排只有官网行程页有。发布前过一道 **claim 审**：逐句标「官网可溯 / master_brief 可溯 / 未证实」，未证实的删或让 PM 确认。**真实事故**：2026-07-13 CTS 长城 reel 编了「日出登长城 / at DAWN」，查官网 Tale of Two Cities 真实行程是**慕田峪 Mutianyu、early start 全天、缆车上+滑道下、无日出**，PM 追问来源当场揭穿、已撤 Publer 排期。这跟上一条「绝不凭空注入客户业务数据」是同一红线的两面：那条防编**数字**，这条防编**运营细节**，同样致命（客户看到会觉得误导、到店体验落差）。
- **PR 动 ROADMAP.md 必须魏征扫 diff（强约束）⭐⭐**：多并行 session 时，PR 改 ROADMAP.md 极易在 rebase / merge 时**意外删掉别 Phase 的登记**。子牙开 PR 前**必须**：①跑 `git diff main -- ROADMAP.md`；②确认 diff 里所有 `-` 删除行都是**有意的本 PR 应该删的**（如本 Phase 自己的旧状态）；③看到任何**与本 PR 主题无关的 `-` 删除行**（如别的 Phase 的登记被删）→ 立刻停手，从 `git show <base-commit>:ROADMAP.md` 恢复，不要让事故 PR 进 main。**真实事故**：2026-06-04 PR #353（fix goals 入口）merge 时意外删除了 PR #348/#350 登记的 Phase 22.E S9-S13 + 决战日 schedule（105 行），靠子牙下个 session 开工 S13 时 grep "S13" 0 行才发现，PR #359 才恢复。判断标准：ROADMAP.md 的 diff `-` 行必须**100% 与 PR title 相关**，否则就是误删。
- **新 migration 的 RLS policy 一律 service-role 模板（强约束）⭐⭐**：ME 的数据访问模型是 **service-role + Bearer-token API（supabaseAdmin）**，从不走 end-user RLS。所以新建表 migration 的 RLS policy **一律使用**：
  ```sql
  ALTER TABLE <new_table> ENABLE ROW LEVEL SECURITY;
  DO $$ BEGIN
    CREATE POLICY "service_role_full" ON <new_table> FOR ALL USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  ```
  **禁止引用**：`clients.workspace_id`（不存在）、`client_team` 表（不存在）、任何未实现的多租户模型对象。**禁止用 `auth.uid()` / `auth.jwt()`**——ME 没用 Supabase Auth 做 end-user 鉴权。**真实事故**：2026-06-05 审计发现 13 处 schema 漂移（9 表未建 + 4 列缺失），根因正是早期 migration 的 `CREATE POLICY` 引用了 `workspace_id`/`client_team`，apply 时炸在 policy 步骤、整个事务回滚——文件在仓里但 DB 里啥都没建。影响 19 客户关键词排名 cron 全瘫 + 5 模块功能（月报/案例库/诊断叙事/线索埋点/本地 SERP）。PR #365 用 service_role 模板补齐。判断标准：写完 migration **必须** grep `workspace_id\|client_team\|auth\.uid\|auth\.jwt`，命中→重写 policy。

---

## Phase 管理原则（PM 强约束）⭐

**不要轻易新建 Phase**。新功能优先归入现有 Phase，只有满足以下条件才开新 Phase：
- 涉及全新的战略模块（新的飞轮支柱 / 新的用户角色）
- 工作量 ≥ 5 个独立任务，且与现有 Phase 逻辑不相关
- PM 明确指示「这是新 Phase」

**归入现有 Phase 的判断顺序**：
1. 先看功能属于哪个模块（SEO / 社媒 / Ads / Portal / 基础设施）
2. 找最相关的现有 Phase，作为子任务（如 P21.B.8 / P20.D.3）
3. 在 ROADMAP 对应 Phase 的任务清单里追加，不新建章节
4. 只有找不到归属时，才向 PM 确认是否新建 Phase

**待归入的积压任务**（已登记为 Phase 28，实际应并入现有 Phase）：
- **FDE Inbox / 待处理收件箱**：执行看板顶部「📥 未读」聚合视图 + `reviewed_at` 字段 → 应归入 **Phase 20.D**（统一看板扩展）

---

## 任务跟踪（防丢任务）⭐

三层体系：**ROADMAP.md**（持久化）→ **TodoWrite**（会话内）→ **Git commit**（事实层）

强制规则：
- 新需求必须先登记 ROADMAP.md，再开始写代码
- 会话结束前，未完成任务必须回写 ROADMAP.md（禁止只留在 TodoWrite）
- Commit message 格式：`feat(module): description [P8.3.2]`
- 完成后在 ROADMAP.md § 9 功能完成日志 追加记录

---

## 会话工作日志（自动写入 fde_work_logs）⭐⭐

> **强制规则**：每次会话结束前（PM 说「结束」/「关闭」/「下一个会话」/「好了今天到这里」，或 Claude 发出「下一会话启动咒语」时），**必须自动写入工作日志**。
>
> 不需要 PM 提醒，Claude 主动执行。不写日志 = 会话结束协议不完整。

### 客户 ID 对照表

| 客户 | client_id |
|------|-----------|
| **CTS Tours NZ** | `c0000000-0000-0000-0000-000000000000` |
| **Oztop Building Supplies** | `d5c98811-1c1d-4ded-bdf0-4cefec6afb84` |

### 写入规则

1. **判断本次会话操作了哪些客户**（从上下文推断：改了哪个客户的 GBP / Meta / SEO / GEO / AI 等）
2. **每个客户写一条日志**（不同客户分开 INSERT）
3. **摘要格式**（不超过 300 字，中文，结构化）：
   ```
   【SEO】xxx（如有）
   【GEO】xxx（如有）
   【Meta 广告】xxx（如有）
   【GBP】xxx（如有）
   【AI 可见度】xxx（如有）
   【其他】xxx（如有）
   下一步：xxx
   ```
4. **通过 Supabase MCP 直接 INSERT**（不走 API，不需要 session）：

```sql
INSERT INTO fde_work_logs (client_id, log_date, summary, author_email)
VALUES (
  '<client_id>',
  CURRENT_DATE,
  '<摘要内容>',
  'bigbigraydeng@gmail.com'
);
```

5. **INSERT 完成后告知 PM**：「✅ 工作日志已写入：[客户名] · [日期]」

### 本次会话未触碰客户不写日志

- 只有本次会话**实际做了操作**的客户才写（不要每次都写两个客户）
- 纯对话、纯查询、未落地的讨论不算「实际操作」

---

## Phase 12 工作协议（飞轮数据闭环）⭐⭐⭐

> 启动日期：2026-05-17。为**非技术 PM** 设计的「踩扎实」协议，不追快。详见 [ROADMAP.md § Phase 12](./ROADMAP.md)。

### 协作准则（强约束，每个任务必须遵守）

1. **每个任务 = 一个独立 commit**（P12.A.1 – P12.A.15 共 15 commit），便于逐条 review / revert
2. **每完成一个任务，必须做三件事**：
   - 在 ROADMAP.md § Phase 12 勾选对应 checkbox
   - commit message 带 `[P12.A.X]` 后缀
   - 在 ROADMAP.md § 9 功能完成日志追加一行 ≤30 字的「人话总结」
3. **每个 commit 必须附 PM-review 卡片**（让 PM 不读代码也能 review）：
   - 改了什么**用户能感知**的事？
   - 加/改了什么**数据**？
   - 如果这次**回滚**，会丢什么？
4. **三个里程碑关卡，不通过不许往下**：
   - **M1 地基**（P12.A.1–3 完成）：`npm run build` 通过 + Supabase 后台能看到 3 张新表
   - **M2 第一个 adapter**（P12.A.4–6）：本地 dev server 点击"在 GEO 中执行"能弹抽屉、能落库
   - **M3 端到端 demo**（P12.A.7–13）：CTS 真实数据跑出第一条 outcome 卡片

### Session 管理

- **主动提醒开新会话**：每过一个里程碑（M1/M2/M3）后，或单会话上下文超过约一半时，**Claude 必须主动告知**
- **新会话启动**：PM 只需说"继续 Phase 12 第 X 任务"，X 来自**上个 session 的告别信息**（首选）或 **CLAUDE.md § 当前焦点表第一行**（备选）
- **会话结束信号（强制格式）**：Claude 最后一条消息**必须**包含字面量的下一会话启动咒语，例如：
  ```
  ✅ 已 commit & push (PR #123 状态: open)。
  📋 下一个会话第一句话: `继续 Phase 12 第 2 任务 P12.A.2`
  ```
- **当前焦点维护**：每完成一个任务，必须更新 CLAUDE.md § 当前焦点表（移除已完成行 / 把下一个任务挪到第一行）
- **会话结束前**：当前进度必须**回写**到 ROADMAP.md（禁止只留在 TodoWrite）

### Git 工作流（强约束，每个 session 必须遵守）

- **工作分支**：
  - Phase 12.A（已完成）：`feat/phase-12-flywheel`，已 merge 到 main
  - **Phase 12.Q 起每个 sub-phase 用独立分支**，命名格式 `feat/phase-12-{letter}-{slug}`；Phase 12.Q 实施分支为 `feat/phase-12-q-content-quality`，ROADMAP 登记 PR 用 `chore/roadmap-phase-12q-registration`
- **每个 session 开头必跑 3 项检查**（任何一项失败立即停下问 PM）：
  1. `git status` 必须干净（无未提交改动）
  2. `git branch --show-current` 必须返回当前 sub-phase 的工作分支
  3. `git fetch origin && git status -sb` 必须无 diverge
- **每个 session 结束前必做**：commit + `git push origin feat/phase-12-flywheel`，最后一句话告诉 PM "已 commit & push，可以关闭"
- **PR 策略**：Phase 12.A 全部 15 commit 完成后**一次性开 PR 到 main**，不要每任务一个 PR
- **绝对禁止**：force push / rebase main / 直接 commit 到 main / 删除任何 `feat/*` 或 `claude/*` 分支
- **多 session 安全**：开新 session 前 PM 必须确认上一个 session 已关闭；同一时间禁止两个 session 同时改文件

### PM 在 Phase 12 期间的手动职责（你必须做的）

Claude 不能替你做这些（无法跨 session 自驱动），需要你当"调度员"：

1. **会话切换**：上个 session 发出"已 commit & push，可以关闭"信号后，**你**关闭旧窗口、打开新窗口
2. **启动咒语**：新会话第一句话固定为 `继续 Phase 12 第 X 任务`（X = 下一个 P12.A.X 编号）
3. **PM-review 卡片决策**：每个 commit 完成后看三个问题（用户感知 / 数据改动 / 回滚损失），回 OK 或 revert
4. **里程碑验证关卡**（不通过禁止 Claude 往下走）：
   - **M1**：打开 Supabase 后台，确认能看到 `flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes` 3 张新表
   - **M2**：打开 `http://localhost:3001/dashboard/clients/[id]/execution`，点击 GEO 任务"在 X 中执行"按钮，确认抽屉弹出
   - **M3**：在执行看板看到一条 outcome 卡片（含 baseline / after / verdict）
5. **远程同步**：**Claude 自动做** — session 结尾用 `gh` CLI（`gh auth status` 验证可用 → `gh pr view` / `gh run list`）确认远程已更新，结果写进 PM-review 卡片。若 `gh` 未配置，降级为打印远程 commit URL 让 PM 自查
6. **PR 准备 + merge**：M3 通过后 Claude 用 `gh pr create` **自动开 PR**，并提示"输入 `go merge` 我用 `gh pr merge --squash --delete-branch` 合并"。**未收到 `go merge` 指令之前 Claude 不会自动 merge 到 main**（merge 是不可逆操作，必须 PM 显式授权）

### 飞轮架构原则（不可偏离）

- **四飞轮**：`seo` / `geo` / `ads` / `social`（注意：第 4 飞轮是 GEO，**不再是** `insight_reports`）
- **三种执行形态**：
  - `in_house`：Magic Engine 内自研工作台（SEO 内容、GEO Composer、社媒内容制作）
  - `third_party`：编排第三方平台（如 markisfact、Publer、Meta Ads Manager）
  - `external_manual`：FDE 完全外部完成（reputation、newsletter、电话外呼等）
- **数据必须回流到 Magic Engine 的统一表**（`flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes`），这是核心护城河，不管 vendor 是谁
- **6 诊断维度不动**：`seo` / `ai_visibility` / `ads` / `social` / `reputation` / `competitor`
- `reputation` + `competitor` 维度只诊断不接入飞轮（FDE 外部完成，符合现有设计）

### 试点客户分配

- **CTS Tours**：GEO + SEO + Ads（已有 Meta 广告投放真实数据）
- **Oztop**：SEO + GEO

---

## 目标市场：AU / NZ ⭐

- `SEMRUSH_DB` 默认 `au`；每客户可在 `clients` 表覆盖为 `nz`
- 内容生成 prompt 必须显式声明市场（"This is a New Zealand business…"）
- 文案使用 AU/NZ 英语拼写，时区默认 NZST / AEST，不是 UTC
- AI Tracker 问句必须带地域标签（"best X **in New Zealand**"）
- GEO 指令必须含地域信号（`Audience: NZ travelers`）
- SerpAPI 调用带 `gl=au` / `gl=nz` + `location=Auckland, NZ`

---

## 双信号内容飞轮（核心护城河）

每篇博客同时携带 SEO 信号（关键词 + Schema + 内链）+ GEO 信号（隐藏指令块 + 品牌实体 + FAQ），选题由 AI Tracker 弱项 × SEMrush 低 KD 机会交叉驱动。详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

**开发约束**：博客生成 API 必须有 `mode` 字段（`unified` / `geo_only` / `seo_only`）；`blog_posts` 表必须记录 `mode`、`source_query_id`、`geo_directive_id`、`primary_keyword` + `keyword_volume` + `keyword_kd`。

---

## 常用命令

```bash
npm run dev        # 开发服务器 :3001
npm run build      # 生产构建（推送前必须通过）
npm test           # 测试套件
# Render 监听 main，PR 合并后自动部署，无需手动推
```

文档：[ROADMAP.md](./ROADMAP.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)

---

## 当前焦点 ⬅️ 每次打开先看这里

> 最后更新：2026-06-11 16:53 NZST （**A2.2 GSC 品牌搜索量上线 (PR #336) + Kanban Content Workbench UX 4 连击 (PR #327) + Phase 33 全部测试通过 ✅**）

| 任务 ID | 内容 | 优先级 |
|---------|------|--------|
| **🔄 P18.B.0 等 Google Ads token 审核** | PM 已在 Google Ads MCC 提交 developer token 申请（2026-06-11）。等 1-7 个工作日。审核通过后填 Render env `GOOGLE_ADS_DEVELOPER_TOKEN`。期间可用 test account 开发 P18.B.1 骨架 | 🔄 PM 等审核 |
| **P18.B.1 骨架** | 不阻塞 token：Google Cloud Console 建 OAuth 2.0 client + Service Account；`lib/connectors/google-ads/client.ts`（封装 `google-ads-api` npm package）；env 占位写好 | 📋 子牙可先做（test account）|
| **🧪 A2.2 端到端验证** | PR #336 已 merged。等 Render 部署完后：①CTS 客户建 Goal 主指标=`brand_search_volume` ②Supabase clients 表 CTS 行的 `brand_aliases` 填 `{"cts tours","cts travel","china travel service","ctsnz"}` ③Goal 详情页主指标卡应显示 ~166 + 数据源 "GSC clicks (28-day brand searches)" ④Oztop 同样跑一遍（aliases `{"oztop building supplies","oz top"}`）。SOP: `docs/sops/brand-aliases-setup-for-gsc.md` | ⚠️ 今日晚上跑 |
| **A2.3 Oztop GA4 generate_lead 配置** | PM 已熟练 SOP，15 分钟跑完同样配置。GTM trigger + GA4 Event Tag + Mark as key event | 📋 PM 操作 / 15 分钟 |
| **A3 案例沉淀** | A2.1/A2.2/A2.3 全部跑通后，把 CTS/Oztop 经验固化到 Clients/ 笔记 | 📋 半天（A2 全部上线后做）|
| **B1 AU/NZ Marketing Index** | 独立项目战略议题，Q4 2026 评估 → Q1 2027 启动 MVP | 📋 战略级 / 6-8 周 |
| **PM 操作（Meta Ads）🔴** | Render 设 `META_SYSTEM_USER_TOKEN`（长效 System User Token），否则执行看板「直接执行 (Meta API)」返回 424 | ⚠️ 待操作 |
| **GBP.0** | Google Cloud：enable Business Profile API + Account Management API | ⚠️ PM 操作 |

**已完成全景（最近几个 Phase）**：
- ✅ **A2.2 brand_search_volume GSC 接入**（2026-06-04，PR #336 merged）：Goal 主指标 `brand_search_volume` 改读 GSC rolling 28 天品牌词 clicks（替代 DataForSEO 估算）。两层解析（GSC 优先 / DataForSEO fallback）。**P0 修复**：发现 token equality 漏 80% 多词品牌（CTS "cts tours" 不能匹配域名根 "ctstours"），新增 `clients.brand_aliases` 字段 + substring 匹配（不污染原 isBrandedKeyword）。+ SOP 文档。17 测试通过，CTS 真实数据回归验证 166 brand clicks（之前 ~5）
- ✅ **Kanban Content Workbench UX 4 连击**（2026-06-04，PR #327 merged）：FDE 最高频用的内容生成工作台 — 修 4 个痛点（反复点击 / 看不到进度 / prompt 太小 / 失败回退）+ 顺手修 1 个生产 CRITICAL bug（不存在的 GET endpoint 把 completed item 拉回 in_progress）。子牙+魏征双审，三阶段状态机 + useRef 同步去重 + 卡片三态（制作中/失败重试/超时）。8 commits，45/45 测试通过
- ✅ **Phase 33 P33.9/P33.10 + M4 测试回归通过**（2026-06-04）：Goal filter 状态 chips、未归类分组、Goal 详情页 Execution Progress 卡片、Initiative 完成率 chip、Campaign 状态点 — 数据层 + UI 层全部跑通。Phase 33 整体收官
- ✅ **CRON_SECRET 已配置 + GSC connector 已运行**（2026-06-04 audit 发现）：之前焦点表标"待 PM 操作"是滞后的。CTS + Oztop GSC 已连，daily cron 已每天凌晨跑（2026-06-04 03:00 UTC 跑过），`gsc_performance_snapshots` 已有 10 行真实数据。焦点表 CRON_SECRET 那条已移除
- ✅ **Phase 22.A.2 GA4 每日采集**（PR #225 merged，实际已上线）：每日 3am UTC cron 把 GA4 5 指标（sessions / users / pageviews / bounce_rate / avg_session_duration）写入 `flywheel_metrics`，前缀 `seo.ga4.*`
- ✅ **Phase 33 M4 — Goal-level Execution Summary**（2026-06-03，PR #304 merged）：子牙 review 修正版（合并 P33.11+P33.12 为一套数据双视角）。新 `GET /api/goals/[goalId]/execution-summary` 一次聚合返回；ExecutionSummaryBar 顶部 4-stat row + 完成率进度条；InitiativeExecutionPanel 加完成率 chip + Campaign 状态点。修复 3 个子牙杀手锏 bug：skipped 排出分母 / 死 campaign ID 过滤 / paused campaign 不漏算。9 个新测试，97/97 strategy lib 全过
- ✅ **Phase 33 P33.9/P33.10 修复**（2026-06-03，PR #301 + #302 merged）：状态 chips 数字跟 Goal filter 变化；「未归类 Actions」分组判断条件扩展为 `null || initiative_type='unassigned' placeholder`；endpoint 不再过滤 unassigned；PlanGenerator 前端补 filter 排除下拉。**测试待跑**（见焦点表第一行）
- ✅ **A1 reputation 公式修复**（2026-06-03，PR #298 + #300 merged）：RATING 0.60→0.70 / REVIEW 0.40→0.30 / MAX_REVIEWS 100→30 + 抽出纯函数 `scoreReputation()` 预留 TripAdvisor/ProductReview 字段（A2 接驳零改动）+ GBP 查询从 domain → "name+city+country"。CTS Tours NZ reputation 44 → ~71（进入健康区间）
- ✅ **诸葛亮全局工作台 FAB**（2026-06-03）：清除 batch merge 残留冲突标记 + 恢复完整 Workbench FAB 设计（当前线程/待处理摘要/下一步建议/最近线程/快捷切换）+ hover-fan 鼠标悬停展开 + z-30 让 drawer 自动遮盖
- ✅ **Phase 33 M1-M3**（2026-06-03，PR #299 merged + migration 已应用）：Strategy-Execution Bridge — initiatives 加 campaign_ids、marketing_plans 加 initiative_id、Initiative 卡片展开关联 Campaign + 生成 Plan、Kanban Goal filter + Initiative badge + Unassigned 分组
- ✅ **QA 测试加固轮**（2026-06-02 下午，6 个 PR）：CF AI Gateway 401 修复（PR #248）+ Client portal 按钮 UI（PR #270）+ initiatives PATCH 三道闸校验（PR #290）+ outcomeChip/buildExecutionGroups 回归测试（PR #293）+ zhangqian/connectors 内部 HTTP 自调用根治（PR #297）+ Codex 协作分工规范写入 CLAUDE.md
- ✅ **Phase 32 Goal sub_types + decrease + multi-active**（2026-06-02，PR #294）：Phase 31 自然延伸
- ✅ **Phase 31 Strategy Layer (Beta)**（2026-06-02，PR #259）：Goal→Initiative→Action 三层骨架 + 4 步向导 + 诸葛亮 Sonnet 润色 hypothesis + 90 天 verdict 自动归档 + Goal 历史页 + 每日 cron
- ✅ **Phase 30 Industry Baseline Engine**（2026-06-02，PR #251）：5 细分 / 44 域名 / 月度 cron 自动重跑 / 华佗实时读基准（含 city 维度命中）

**下一候选（按优先级）**：
1. 🧪 **A2.2 端到端验证** — CTS/Oztop 跑 SOP 配 brand_aliases + 建 Goal + 看 Goal 主指标卡（30 分钟）
2. 📋 **A2.3 Oztop GA4 generate_lead** — PM 操作，15 分钟
3. 📋 **A3 CTS/Oztop 案例沉淀** — 半天事，A2 系列全部上线后做
4. 📋 **Phase 24.B** — GBP 数据摂取（依赖 GBP.0 + migration）

**ME 定位升级（2026-06-02 确立）**：
旧 → 营销自动化平台
**新 → 以 Goal 为中心的生意指挥平台**（Kanban 汇总所有能帮客户达成 Goal 的因素，营销只是其中一条战线）

下一 session：`继续 ME 工作 — A2.2 端到端验证`

**更新规则**（每次上线新功能）：
1. ROADMAP.md 勾选对应任务 checkbox
2. 更新本表（移除已完成，加入新任务）
3. 在 ROADMAP.md § 9 功能完成日志 追加一条记录
4. commit 引用 Phase ID：`feat(...): ... [P12.A.X]`
