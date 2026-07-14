# Magic Engine

> Magic Lab 2026 旗舰产品 — SEO × AI 搜索双战场执行自动化平台

Magic Engine 的核心护城河不是数据，而是**执行自动化**：诊断发现问题后，平台自动生成并执行修复动作，结果回流归因，形成飞轮。

---

## 四大模块

| 模块 | 功能 |
|------|------|
| **SEO 内容引擎** | 关键词情报、双信号博客（SEO × GEO）、AI 可见度追踪、网站直连发布 |
| **社媒内容矩阵** | 多客户 Brand Brief、Campaign 批量生成、视觉工坊、多平台发布 |
| **Ads Intelligence** | 多平台广告账户连接、AI 诊断引擎、一键修复 |
| **Insight Reports** | 月报 PDF 自动生成、客户 Portal、跨模块数据聚合 |

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
| 部署 | Render |

---

## 快速开始

```bash
npm install
npm run dev        # 开发服务器 :3001
npm run build      # 生产构建
npm test           # 测试套件
```

部署：`git push origin master` 触发 Render 自动部署。

---

## 文档

- [CLAUDE.md](./CLAUDE.md) — 开发工作指南（AI Agent 指令）
- [docs/voice-agent/](./docs/voice-agent/) — Voice Agent（AI 电话销售/客服）本地跑通、SIP/WhatsApp 配置、Runbook
- [ROADMAP.md](./ROADMAP.md) — 产品路线图与任务跟踪
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 技术架构设计
- [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md) — 产品视角概览

---

## 目标市场

AU / NZ（澳大利亚 / 新西兰），内容默认 AU/NZ 英语拼写，时区 NZST / AEST。
