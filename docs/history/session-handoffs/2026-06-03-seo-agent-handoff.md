# SEO + Agent Handoff to Claude Code

> Date: 2026-06-03
> Owner transfer: Codex -> Claude Code
> Scope: CTS / Oztop SEO work, plus the new SEO agent orchestration layer

## 这次交接的边界

- 从现在开始，SEO 相关的主线工作交给 Claude Code 继续推进。
- Codex 只做辅助、补丁式支持，不再主动扩展 SEO / agent 设计。
- 现有的内容生成链路不重做，SEO agent 只保留为上游决策层，不要再变成第二套博客系统。

## 当前已经完成的东西

### 1) SEO agent MVP

已落地的文件：

- `src/lib/seo-agent/types.ts`
- `src/lib/seo-agent/scorer.ts`
- `src/lib/seo-agent/assembler.ts`
- `src/lib/seo-agent/conductor.ts`
- `src/app/api/clients/[id]/seo-agent/plan/route.ts`
- `src/lib/seo-agent/__tests__/scorer.test.ts`
- `src/lib/seo-agent/__tests__/conductor.test.ts`
- `docs/agents/35-sunzi.md`
- `docs/agents/CODEX.md`

这个 agent 的定位是：

- 读 `Goal`
- 读 `Master Brief`
- 读 keyword / gap / ranking / position change 信号
- 输出 SEO 优先级

它**不是**内容生成器，也**不是**发布器。

### 2) 现有内容链路已经存在

不要重复造一套博客系统。现有能力已经够用：

- Blog 生成：`src/app/api/clients/[id]/blog/route.ts`
- Keyword suggestions：`src/app/api/clients/[id]/blog/keyword-suggestions/route.ts`
- Existing page upgrade：`src/app/api/clients/[id]/pages/[pageId]/upgrade/route.ts`
- GitHub publish / PR flow：`src/app/api/clients/[id]/cms/publish-blog/route.ts`

### 3) CTS 的当前 SEO 焦点

现在 CTS 不再只盯单个团，而是围绕 Spotlight 四件套：

- `Beijing & Xi'an`
- `Shanghai & Surroundings`
- `Chongqing & Chengdu`
- `Silk Road 2027`

对应执行单：

- `docs/clients/cts-tours/best-of-china-spotlight-seo-checklist-2026-06-03.md`

### 4) Oztop 的当前 SEO 焦点

Oztop 继续走内容 + 人工发布的路径，先不强依赖 WP 自动发布链：

- `clients/oztop/seo-execution-kitchen-flooring-brisbane-2026-06-03.md`
- `clients/oztop/wp-me-seo-sop-2026-06-03.md`

## 交接后 Claude Code 应该怎么接

### CTS

优先做这几件事：

1. 确认 `ctstours.co.nz/campaigns/october-2026` 是否已有可用 Spotlight hub。
2. 决定这个 hub 是单页四卡，还是 hub + 4 个子页。
3. 为四件套统一 title / meta / H1 / CTA / FAQ / schema。
4. 把老 campaign、社媒、后续内容全部回流到同一个 hub。
5. 如果需要支撑内容，只加 1 篇高意图 support article，不要先堆博客量。

### Oztop

优先做这几件事：

1. 继续用现有 Blog Studio 产出内容。
2. 先人工发布，别卡在不稳定的 WP 自动链路上。
3. 关键词判断先看业务匹配，再看本地意图，再看搜索量。

### SEO agent

如果继续迭代 agent，请守住这个边界：

- 只做 decision layer
- 不做 content generator
- 不做 publish layer
- 不要把它变成 Blog / Strategy 的第二套实现

## 目前风险

- Oztop 的 WordPress 发布链曾经出现 `response is not JSON` 和 Yoast 字段未注册的问题。
- 不要默认生产链路已经修好，先验证再自动化。
- `outputs/` 和 `.claude/` 下有很多本地产物和日志，不要把它们当成产品代码。

## 建议 Claude Code 接手时先读的文件

- [ROADMAP.md](../../ROADMAP.md)
- [AGENTS.md](../../AGENTS.md)
- [docs/clients/cts-tours/best-of-china-spotlight-seo-checklist-2026-06-03.md](../clients/cts-tours/best-of-china-spotlight-seo-checklist-2026-06-03.md)
- [src/lib/seo-agent/conductor.ts](../../src/lib/seo-agent/conductor.ts)
- [src/lib/seo-agent/assembler.ts](../../src/lib/seo-agent/assembler.ts)
- [src/app/api/clients/[id]/blog/route.ts](../../src/app/api/clients/[id]/blog/route.ts)
- [src/app/api/clients/[id]/pages/[pageId]/upgrade/route.ts](../../src/app/api/clients/[id]/pages/[pageId]/upgrade/route.ts)

## 交接完成标准

- Claude Code 能继续 CTS Spotlight 的 title/meta/hub 设计。
- Claude Code 知道 Oztop 先走人工发布，不要硬怼不稳定的自动化。
- SEO agent 的职责边界被固定在“优先级决策”。
- 后续工作可以直接从当前 roadmap 和 checklist 继续，不需要重新梳理上下文。
