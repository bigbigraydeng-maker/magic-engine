# Magic Engine — Agent 工作指南

**输出语言**：对话和说明**一律用中文**，无论用户用什么语言提问。代码 / 变量 / 注释保持英文。

**每次开新会话先读**：[docs/STATE.md](./docs/STATE.md)（系统现状）→ [docs/ROADMAP.md](./docs/ROADMAP.md)（要做什么）。
**必读规则**：[`~/.claude/rules/coding-style.md`](~/.claude/rules/coding-style.md) · [`~/.claude/rules/development-workflow.md`](~/.claude/rules/development-workflow.md)

---

## 项目定位

Magic Engine 是 Magic Lab 2026 旗舰产品 —— **以 Goal 为中心的生意指挥平台**（营销只是其中一条战线）。
护城河不是数据（数据可以买），是**执行自动化**：诊断发现问题 → 平台自动生成并执行修复动作 → 结果回流归因 → 飞轮。
目标市场 **AU / NZ**：AU/NZ 英语拼写、时区 NZST/AEST、SERP 带 `gl=au`/`gl=nz`、AI 问句带地域标签。

### 核心引擎 = DAPE（不是 GIMPT）

**D**iscovery 发现 → **A**nalysis 分析 → **P**rescription 处方 → **E**xecution 执行，四段循环 + AI 贯穿 + 6 大支柱矩阵。

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

> **任何提案前先问**：跟 DAPE 哪一段对齐？跟 6 支柱哪一柱关联？self-serve 还是 FDE 轨？挂 AI memory 哪一层？

### 第三方封装名（UI / 报告 / 客户交付物中禁止出现真实供应商名）

OpenAI→**Content Engine** · Claude→**Strategy Engine** · WaveSpeed/Muapi→**Visual Studio** · Seedance→**Video Studio** · HeyGen→**Avatar Studio** · DataForSEO→**Keyword Intelligence** · Jina→**Site Analyzer** · Airtable→**Content Workspace** · Publer→**Publishing Hub**。API 路由内部、错误日志、环境变量可用真名。

---

## 铁律

### 1. 跟 PM 说话（PM 是非技术 PM）

一次只问一件事 · 问题必须一句话能回（给明确回法如「回 `go merge` 就行」）· **零黑话**（禁止裸用 migration / rebase / schema / enum / cron / RLS / P1-P5 阶段号）· 先结论再原因（结论一行，原因最多两行）· 报告用他能验证的话（「文档写完了 / 广告停了」，不是「PR merged / verdict 落库」）。

> **PM 看不懂 = agent 失职，不是 PM 的问题。**

### 2. PM 角色边界

PM **只**决策：业务 / 客户 / 钱 / 优先级 / 风险接受度 / 客户真实场景 fact。
PM **不**决策：分支策略 · 修复走 A 还是 B · 字段命名 · 测试怎么覆盖 · 架构与接口契约 · 任何技术实现细节。

技术决策自己拍 + **召 agent 复审**，不上抛 PM。把技术选择题塞回 PM = 失职。
**唯一例外**：不可逆操作必须 PM 显式 `go` —— `gh pr merge` / `apply_migration` / `git push --force` / 删客户数据。

### 3. 遇卡点必自动化 + 管道不许断头

**上半：能自动化就必须自动化。** 第三方 UI 卡住 / API 未文档化 / 跨客户重复操作 → **自己解决**：深挖 UI 隐藏入口 → 官方 Graph API 直调 → 页面 context inject Ajax → DevTools 深度自动化 → 沉淀成 ME 产品能力。**绝对禁止**「请 PM/FDE/客户老板去点某个按钮」类人工 SOP。

**下半：确实做不了，也不许烂尾**（PM 2026-08-01 拍板，与上半配套，不是豁免）。判断顺序不许跳步：能自动化 → 必须自动化；确实做不了（按钮在第三方后台 / 需真人决策 / 对方系统挡住）→ **必须下发成人工任务**，且进同一个管道（今日待办 / 执行看板），不能只写进 cron summary / `console.log` / 只有开发看得到的表。

人工任务自带三件套，缺一条就是没下发好：**what**（问题**和影响**，说人话）· **how**（具体点哪里，让 FDE 不用问人）· **href**（直达链接，连粘贴都不用）。

> 一句话：**能自动就别丢给人；真丢给人，就把话说到他不用问第二遍。发现不许死在日志里。**

反模式与真实事故见 [PITFALLS §F](./docs/PITFALLS.md)。实现参考 `src/lib/pm-todo/manual-items.ts`（今日待办「🙋 需要你动手」栏）。

### 4. 大任务必须 ≥2 审

「大任务」= 触碰安全/隔离/鉴权 · 加表或改 schema · 新增对外 endpoint/UI · 跨多文件 >3 commit · 引入新依赖 · 影响已上线功能（满足任一即算）。

| 类型 | 谁审 |
|---|---|
| 大任务 | **子牙（架构）+ 魏征（挑刺）** 至少 2 个不同 agent |
| 面向 C 端客户 | **+ 板桥**（非技术视角）必须参与 |
| 触碰隔离/安全核心 | + 狄仁杰（攻击验证），实施后再补一刀 |

设计阶段审一次（出方案后、动手前），实施完再审一次。**「我自己审过了」不算 2 审。**

### 5. Codex 协作

Claude Code 主导，Codex 辅助，**PM 不亲自给 Codex 派活**。
Codex 干：精准 bug 修复（单文件局部）· 补单元/回归测试 · 修测试断言 · 死代码清理 · API 端点小幅扩展。
Claude Code 干：大范围重构 · 跨模块长链路 · 复杂调试 · 架构决策。

派活提示词必带：文件清单（绝对路径+行号）· owner 独占声明 · 验证清单（具体测试命令 + 预期测试数 + `npm run build`）· 交接证据（分支 / commit hash / PR 号 / 测试输出）· 撒谎防御。
**Codex 交付的 PR merge 前必须子牙复审**，见 [PITFALLS G2](./docs/PITFALLS.md)。

### 6. Git

- **禁止**：force push · rebase · 直接 commit 到 main · 删任何 `feat/*` / `claude/*` 分支
- 新窗口开工前必跑：`git fetch origin` → `git checkout <分支>` → `git pull --ff-only` → **`git merge origin/main`**（永远 merge，永不 rebase）→ 重跑 build + 测试 → 才写新代码
- **能合就快合**，别过夜拖天。登记类改动拆独立小 PR 立即合
- 别在功能分支里顺手改 `docs/ROADMAP.md` / `CLAUDE.md`（头号冲突磁铁）
- 一个分支同一时间只允许一个窗口开；并行用 `git worktree` 物理隔离
- 详见 [PITFALLS §C](./docs/PITFALLS.md)

### 7. 代码

- TypeScript strict，无 `any`；函数 < 50 行，文件 < 800 行
- SDK 客户端（OpenAI / Anthropic 等）**必须在 handler 内部初始化**，不在模块顶层
- 可复用逻辑放 `src/lib`，路由层只放 `src/app/api`
- **外科手术式改动**：只改必须改的，不顺手「优化」相邻代码 / 注释 / 格式
- **写前先读**：改任何文件前先读它的 exports、直接调用方、共享工具；不确定某段代码为何如此设计时**先问再改**
- 新表 migration 的 RLS 一律 service-role 模板（禁止 `workspace_id` / `client_team` / `auth.uid()`），见 [DECISIONS](./docs/DECISIONS.md)
- 新建 `/api/cron/*` 路由必须**同一个 PR 内**加 `render.yaml` 调度条目

### 8. 客户数据红线（违反 = 直接伤害客户）

- **绝不凭空注入客户业务数据**：写任何 Goal / Initiative / 关键词前，先查 `master_briefs` + `clients.primary_keywords`。搜索量 / KD / 点击数**必须来自 DataForSEO 或 GSC**，不能估不能编
- **对外内容必先 grounding 官网**：写 reel / post / 广告 / 邮件前先 WebFetch 客户官网真实产品页。`master_briefs` 只给方向，不含运营细节。发布前逐句标「官网可溯 / brief 可溯 / 未证实」
- **客户营销落地页必须建在客户自己的域名**，绝对禁止 `magicengine.com.au/<客户>/...`
- **FDE/PM 要填的字段必须连 Settings UI 一起做完**，绝不写「让 PM 进 Supabase Studio 直填」
- **素材不足去全网抓**：Unsplash/Pexels（首选，零风险）→ Apify（找参考定风格）→ 客户自传（质量最高）。但客户**真实产品 / 真实价格**的画面只能用客户自己提供的素材
- 每条都是真实事故，细节见 [PITFALLS §D](./docs/PITFALLS.md)

### 9. 会话结束前必做

1. 未完成任务回写 [docs/ROADMAP.md](./docs/ROADMAP.md)（禁止只留在 TodoWrite）
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

---

## 文档索引

| 文档 | 什么时候看 |
|---|---|
| [docs/STATE.md](./docs/STATE.md) | **唯一真相源** — 现在什么在跑 / 部署在哪 / 38 个 cron / 模块↔代码映射 |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | 还有什么没做（只留未完成） |
| [docs/ENV.md](./docs/ENV.md) | 环境变量总表（113 个，含哪些没登记） |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | 为什么是现在这样 / 哪些老决策已作废 |
| [docs/PITFALLS.md](./docs/PITFALLS.md) | **动手前扫一眼** — 真实事故清单 |
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
