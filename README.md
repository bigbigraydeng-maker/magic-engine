# Magic Engine

> **以 Goal 为中心的生意指挥平台**，SEO × AI 搜索双战场执行自动化。
>
> 运营法人：**Magic Engine AI Technology Limited（New Zealand）**。
> **Magic Lab** = `proposed_future_holding_brand, unregistered, not current legal parent` —— 仅内部工作代号，任何对外内容/JSON-LD/客户交付物不得声称它为 Magic Engine 的 legal parent / holding company。

护城河不是数据（数据可以买），是**执行自动化**：诊断发现问题 → 平台自动生成并执行修复动作 → 结果回流归因 → 飞轮。

目标市场：AU / NZ。

---

## 四大模块

| 模块 | 状态 | 功能 |
|------|------|------|
| **SEO 内容引擎** | ✅ 成熟 | 关键词情报、双信号博客（SEO × GEO）、AI 可见度追踪、网站直连发布 |
| **社媒内容矩阵** | ✅ 成熟 | 多客户 Brand Brief、Campaign 批量生成、视觉工坊、多平台发布 |
| **Ads Intelligence** | 🔄 建设中 | 多平台广告账户连接、AI 诊断引擎、一键修复 |
| **Insight Reports** | ✅ 上线 | 月报自动生成、客户 Portal、跨模块数据聚合 |

完整模块 ↔ 代码映射见 [docs/STATE.md](./docs/STATE.md)。

---

## 快速开始

```bash
npm install
cp .env.example .env.local   # 填变量，说明见 docs/ENV.md
npm run dev                  # http://localhost:3001
```

```bash
npm run build            # 生产构建（推送前必须通过）
npm test                 # vitest
npm run type-check       # tsc --noEmit
npm run test:e2e         # Playwright
bash scripts/doctor.sh   # 系统自检：环境变量 / 外部 API / cron 调度
```

**部署**：推 `main` → Render 自动读 `render.yaml` 部署（约 3-5 分钟）。
生产地址 `https://app.magicengine.com.au`。

> 仓库里还有一个历史 `master` 分支，跟部署无关，别往那推。

---

## 技术栈

Next.js 14 App Router · TypeScript 5 strict · Tailwind CSS 3.4 · Supabase (PostgreSQL + Storage) ·
OpenAI GPT-4o-mini · Anthropic Claude Sonnet · Muapi / Atlas Cloud（图 / 视频）· HeyGen（头像）·
DataForSEO（关键词主数据源）· Publer（发布）· Stripe（MTC 计费）· Resend（邮件）· Render（部署）。

外部服务全表见 [docs/STATE.md §5](./docs/STATE.md)。

---

## 文档

| 文档 | 内容 |
|------|------|
| [CLAUDE.md](./CLAUDE.md) | Agent 工作指南 + 铁律（开工前必读） |
| [docs/STATE.md](./docs/STATE.md) | **唯一真相源** — 现在什么在跑、部署在哪、38 个 cron |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | 还有什么没做 |
| [docs/ENV.md](./docs/ENV.md) | 环境变量总表 |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | 架构与业务决策记录 |
| [docs/PITFALLS.md](./docs/PITFALLS.md) | 踩坑清单（真实事故） |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 技术架构 |
| [docs/PRODUCT.md](./docs/PRODUCT.md) | 产品总览 |
| [docs/voice-agent/](./docs/voice-agent/) | Voice Agent 本地跑通 / SIP / Runbook |
