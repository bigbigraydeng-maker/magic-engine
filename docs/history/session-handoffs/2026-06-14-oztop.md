# Oztop · 2026-06-14 (周日下午 1 点) 开工 Session Handoff

> 起草:子牙(本窗口 modest-proskuriakova-0aa314)
> 日期:2026-06-13 NZST(凌晨 5:30 收工写)
> 给:明天 1 点的 PM(以及任何接手的诸葛亮窗口)
> 触发咒语:`继续 Oztop 工作 — 下午 1 点开工`

---

## ⚡ 一句话状态

**今晚 3 篇博客实战教育出整个 ME 平台 BLOCKER 清单 → 12.R 窗口过夜全修复 + 10 PR merge → 明天 PM 用的 ME 是升级版** + Oztop 站还没装任何追踪代码 → **明天必须先装 Pixel/GTM/GA4 再启 FB 广告**。

---

## 一、今晚已完成

| 类别 | 内容 | 证据 |
|---|---|---|
| Oztop 博客上线 | 3 篇高质量 SEO+GEO 双信号(8.0+/10) | #2 #4 #5 全 published + flywheel_actions 归因 |
| ME 平台修复 | Phase 12.R 10+ PR 全 merge | M1-M4 + A1/A2/A4/A8 + B6(原 A6)+ B7(原 A7) |
| Spec 落盘 | Phase 12.R + Oztop 全站 SEO 8 块 | PR #467 已 merge |
| Kanban | 13 张新卡 | execution_items 表 |

## 二、12.R 修了什么(明天可以直接用)

| 功能 | 用处 |
|---|---|
| **page-rewriter UI** | `/dashboard/clients/[id]/page-rewriter` — 改写已有 WP 页面 |
| **wpFetch 加超时 + WAF 检测** | publish-wordpress 不再无脑 502, 遇 sgcaptcha 报明确错误 |
| **GEO 隐藏机制架构修复** | Copy HTML 不再泄漏 `[INSTRUCTIONS FOR AI AGENTS]` |
| **Blog Detail Action Bar** | Delete / Regenerate / Edit Content 按钮全有 |
| **Mode selector + Focus Keyphrase + Internal Links Panel** | Blog Factory 生成更精准 |
| **主题 text-transform 预检** | 发布前警告全大写问题 |

明天 1:00-1:15 PM 应该:
1. 进 ME 后台 → Oztop 客户 → Blog → 试一下 Delete/Regenerate 按钮
2. 进 page-rewriter UI 试改写一个 Oztop 页(不真发,只看 UI 流程)
3. 验证 502 是否真修了(随便试 publish 一个 draft)

## 三、明天 1 点开工 · 精确动线

### 🔴 必前置:Oztop 站完全没装追踪代码

WebFetch 实测 oztopbuildingsupplies.com.au 首页:
- Meta Pixel: ❌ 不存在
- GTM: ❌ 不存在
- GA4: ❌ 不存在
- Google Ads tag: ❌ 不存在

**结论**:FB 广告启动前必须先装。话术 SOP 已备:
- 主 SOP: `docs/clients/oztop/2026-06-11-pre-launch/01-conversion-tracking-sop.md`
- 备份 SOP: `docs/sops/meta-system-user-token-setup.md`

### ⏰ 精确时段表

| 时段 | 动作 | 工时 | 难度 |
|---|---|---|---|
| 13:00-13:15 | 验证 12.R 全 PR 上线状态 + 测 page-rewriter UI | 15min | 🟢 |
| 13:15-14:15 | 装 GTM + Meta Pixel + GA4 (Oztop WP) | 1h | 🟡 |
| 14:15-15:00 | Walnut LP 上线 + 装 WPForms + 配 dataLayer event | 45min | 🟡 |
| 15:00-15:30 | ME Blog Factory 排队 3 篇 + 审 + 发 (用 B6/B7 新功能) | 30min | 🟢 |
| 15:30-16:30 | Reels 入库 (PM 1 点告诉素材) + 多 LP 准备 + FB Campaign 草稿 | 1h | 🟡 |
| 16:30-17:00 | FB Campaign 设 PAUSED + 验证 Pixel 收到 Page View | 30min | 🟢 |
| 晚上 / 后天 | Pixel 24h 学习数据后 → 开 ACTIVE | — | — |

### 🎯 明天 3 篇博客发布计划

按 ROI 排,Critical AI Tracker 机会:

| 顺序 | 主题 | Mode | 预估增益 |
|---|---|---|---|
| 🥇 #6 | Slacks Creek showroom near me | unified | 本地金矿 0 竞争 |
| 🥈 #7 | Best waterproof flooring Brisbane | unified | informational 大词 |
| 🥉 #8 | Best flooring for rental properties Brisbane | unified | 投资型业主精准 |

**新 SOP** (B6 + A7 修后,跟今晚大不一样):
1. ME Blog Factory 主页 → 找对应 Critical 机会 → 点 Generate Blog Post
2. **新功能**: Generate 表单顶部应该出现 Mode 下拉,默认 `unified` ✅
3. 等 3-5 分钟自动跑完 → Approve
4. **新功能**: 点「发布到 WordPress」**不应该再 502** (B6 修了) → 等 30s 看反应
   - 如果还 502 → 看错误信息是否包含"sgcaptcha" → 那就需要 SiteGround 豁免 (B6 现在能识别这个错误)
   - 如果 200 → 直接 published 到 WP
5. 实在不行 fallback Copy HTML (A7 修后不会再泄漏 GEO)
6. Mark Published

### 🎨 Walnut LP 上线 SOP

资产: `docs/clients/oztop/landing-pages/2026-06-10-walnut-clearance/lp.html` (336 行,完整 mockup)

步骤:
1. WP → **Pages → Add New**
2. 标题: `Elegant Walnut Engineered Timber Clearance — $35.50/m²`
3. **Slug**: `/walnut-clearance/` (FB 广告 URL 用)
4. 右上三点 → **Code Editor** → 粘贴 lp.html
5. **替换 form section**:把 lp.html 里 `<form>...</form>` 那块换成 WPForms shortcode
   - 装 WPForms plugin (如果还没装)
   - 建一个表单含字段: Name / Phone / Email / Square Metres / Postcode
   - WPForms 设置 → Confirmations → 触发 dataLayer event `lead_submitted`
6. GTM 里建一个 Trigger 监听 `lead_submitted` event → 触发 Meta Pixel `Lead` event
7. Publish → Purge SG Cache → 测试 form 提交一次,看 GTM Debug 模式 + Meta Pixel Helper 都收到事件

### 🎬 Reels + FB Campaign 结构

PM 1 点告诉 5+ 条 Reels 信息后子牙做的事:
- 按主题分组 (Walnut / SPC / 品牌 / 其他)
- 每主题分组配一个对应 LP (Walnut LP 已有;其他需要现做或先用 Oztop 现有页)
- Campaign 结构: 1 Campaign + 3 Ad Set (Cold / Retarget / Lookalike)
- 每 Ad Set 多个 Ad creative (= Reels)
- 每 Ad 落地页 = 对应分组 LP

**预算**: AU$1,500/月 = AU$50/day (Cold 30/Retarget 15/Lookalike 5)

---

## 四、待 PM 决定的项

1. ❓ ME `META_SYSTEM_USER_TOKEN` 是否设到 Render env? (今晚没装就拉不到 Meta 广告数据回 ME)
2. ❓ SiteGround 豁免 wp-json/* 路径的工单是否发了? (B6 改 ME 端能识别 sgcaptcha 错误,但永久修复要 SG 配合) — 话术见 [docs/clients/oztop/2026-06-13-full-site-seo-audit/00-strategy.md] 末尾
3. ❓ 新一批 Reels 素材 (5+ 条) 文件名/主题列表 — 1 点告诉子牙

---

## 五、关键文件速查

| 资产 | 位置 |
|---|---|
| Walnut LP mockup | `docs/clients/oztop/landing-pages/2026-06-10-walnut-clearance/lp.html` |
| Reel 1 资产 | `docs/clients/oztop/reels-production/2026-06-09-reel1-walnut-price-attack/` |
| 转化追踪 SOP | `docs/clients/oztop/2026-06-11-pre-launch/01-conversion-tracking-sop.md` |
| 全站 SEO 8 块 spec | `docs/clients/oztop/2026-06-13-full-site-seo-audit/00-strategy.md` |
| Phase 12.R spec | `docs/superpowers/specs/2026-06-13-phase-12J-wordpress-page-rewriter.md` |
| Meta token SOP | `docs/sops/meta-system-user-token-setup.md` |
| keyword-gap 调研 | `docs/clients/oztop/2026-06-11-keyword-gap/` 5 份文档 |

---

## 六、Oztop 战略框架(active Initiative)

| Initiative | 月预算 | Posture |
|---|---|---|
| 🔥 Walnut FB 销售推动 | AU$1,500 | fast ← 明天主战场 |
| Walnut + 主营品类 LP 转化优化 | AU$500 | fast |
| Brand 曝光 FB+IG 内容矩阵 | AU$700 | slow |
| SEO Phase 1/2 + 技术 + 本地 (4 个) | AU$2,200 | slow |

→ **明天 FB 战场预算 AU$1,500/月** (= AU$50/day)

---

## 七、子牙明天接手第一句话

```
Oztop 1 点开工。

12.R 验证状态:[等 PM 测]
新 Reels 素材:[等 PM 1 点告诉]
SiteGround 工单是否发了:[等 PM 答]

今天我从 [Pixel 装 / 博客 / LP / Campaign 草稿] 哪个先动手?
```

---

**晚安 PM。 明天 1 点见。** 🌙
