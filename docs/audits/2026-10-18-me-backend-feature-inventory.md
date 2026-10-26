# ME 后台功能梳理（2026-10-18）· 统筹窗口 · 只读，未改任何代码

依据：origin/main 上全部 97 个后台页面（含客户工作台 59 个），每页的最后改动日期、规模。**仓库里没有点击/访问统计**，所以「没人用」不能下结论，只能标「半年没动」。

## 按「做什么事」分 8 组

| 组 | 页面数 | 说明 |
|---|---|---|
| 1 每天用（主战场） | 14 | 今日待办、客户页、广告健康、视频工厂审片、每日计划、CRM、推广计划、两个「等你点头」 |
| 2 计划与目标（每周） | 11 | 目标、策划、推广活动、Marketing Plan、执行看板 |
| 3 内容制作 | 11 | 内容工厂、素材库、博客、内容生产包 |
| 4 客人与销售 | 18 | CRM 子页、联系人、收件箱、私信、销售进度、行程单、团目录、电话 |
| 5 SEO/AI 可见度/诊断（长期） | 17 | SEO、GEO、AI 可见度、华佗诊断、张骞调研、客户记忆 |
| 6 经营与报表 | 9 | 月报、转化、经营测算、行业基线、广告引擎、选品 |
| 7 系统与管理员 | 14 | 9 个管理员页、自动任务健康、团队记忆、产品地图、设置 |
| 8 旧路线（Launch Hub） | 3 | Launch Hub 两个页面与一个重定向，PM 已定要删（等 PM 说） |

合计 97 页。

## 半年没动的页面（20 个，2026-07-01 前最后改动，**不等于没人用，需各线负责人认领**）

| 页面 | 最后改动 | 归属组 |
|---|---|---|
| `/dashboard/content/generate` | 2026-05-18 | 8 旧路线（Launch Hub） |
| `/dashboard/clients/<id>/seo-gap` | 2026-05-27 | 5 SEO/AI 可见度/诊断（长期） |
| `/dashboard/admin/billing-monitor` | 2026-06-01 | 7 系统与管理员 |
| `/dashboard/analytics` | 2026-06-01 | 6 经营与报表 |
| `/dashboard/clients/new` | 2026-06-01 | 7 系统与管理员 |
| `/dashboard/admin/ai-gateway` | 2026-06-02 | 7 系统与管理员 |
| `/dashboard/admin/mtc-overview` | 2026-06-03 | 7 系统与管理员 |
| `/dashboard/clients/<id>/production` | 2026-06-03 | 3 内容制作 |
| `/dashboard/clients/<id>/production/[packageId]` | 2026-06-03 | 3 内容制作 |
| `/dashboard/clients/<id>/wallet` | 2026-06-03 | 6 经营与报表 |
| `/dashboard/admin/viral-references` | 2026-06-04 | 7 系统与管理员 |
| `/dashboard/geo-composer/[clientId]/deploy` | 2026-06-04 | 5 SEO/AI 可见度/诊断（长期） |
| `/dashboard/clients/<id>/goals/history` | 2026-06-05 | 2 计划与目标（每周） |
| `/dashboard/clients/<id>/strategy` | 2026-06-05 | 2 计划与目标（每周） |
| `/dashboard/admin/mcp-keys` | 2026-06-06 | 7 系统与管理员 |
| `/dashboard/clients/<id>/brief` | 2026-06-06 | 2 计划与目标（每周） |
| `/dashboard/clients/<id>/diagnostic/report` | 2026-06-08 | 5 SEO/AI 可见度/诊断（长期） |
| `/dashboard/clients/<id>/execution/timeline` | 2026-06-08 | 2 计划与目标（每周） |
| `/dashboard/clients/<id>/blog` | 2026-06-14 | 3 内容制作 |
| `/dashboard/clients/<id>/blog/[postId]` | 2026-06-14 | 3 内容制作 |

## 每组逐页清单

### 1 每天用（主战场）

| 页面 | 最后改动 | 规模(行) |
|---|---|---|
| `/dashboard` | 2026-10-18 | 733 |
| `/dashboard/clients` | 2026-10-18 | 449 |
| `/dashboard/clients/<id>` | 2026-10-18 | 842 |
| `/dashboard/clients/<id>/promo-plan` | 2026-10-18 | 16 |
| `/dashboard/factory` | 2026-10-18 | 299 |
| `/dashboard/clients/<id>/crm` | 2026-10-17 | 34 |
| `/dashboard/clients/<id>/ads-health` | 2026-10-16 | 658 |
| `/dashboard/clients/<id>/crm/all` | 2026-10-16 | 756 |
| `/dashboard/clients/<id>/daily-plan` | 2026-10-16 | 170 |
| `/dashboard/clients/<id>/story` | 2026-10-13 | 161 |
| `/dashboard/ad-approval` | 2026-10-04 | 270 |
| `/dashboard/clients/<id>/ad-health/auto-pause` | 2026-09-28 | 132 |
| `/dashboard/kernel-approvals` | 2026-09-26 | 85 |
| `/dashboard/today` | 2026-09-26 | 294 |

### 2 计划与目标（每周）

| 页面 | 最后改动 | 规模(行) |
|---|---|---|
| `/dashboard/clients/<id>/execution` | 2026-10-17 | 16 |
| `/dashboard/clients/<id>/marketing-plan` | 2026-10-14 | 16 |
| `/dashboard/clients/<id>/campaigns` | 2026-10-12 | 41 |
| `/dashboard/clients/<id>/goal/[goalId]` | 2026-10-10 | 16 |
| `/dashboard/clients/<id>/goal/new` | 2026-10-04 | 16 |
| `/dashboard/clients/<id>/onboarding` | 2026-09-14 | 421 |
| `/dashboard/clients/<id>/projects` | 2026-08-04 | 60 |
| `/dashboard/clients/<id>/execution/timeline` | 2026-06-08 | 241 |
| `/dashboard/clients/<id>/brief` | 2026-06-06 | 235 |
| `/dashboard/clients/<id>/goals/history` | 2026-06-05 | 16 |
| `/dashboard/clients/<id>/strategy` | 2026-06-05 | 16 |

### 3 内容制作

| 页面 | 最后改动 | 规模(行) |
|---|---|---|
| `/dashboard/clients/<id>/content-factory` | 2026-10-15 | 578 |
| `/dashboard/clients/<id>/content-factory/series` | 2026-10-15 | 145 |
| `/dashboard/clients/<id>/content-factory/lesson/[postId]` | 2026-10-13 | 1038 |
| `/dashboard/clients/<id>/tiktok/[orderId]` | 2026-10-13 | 28 |
| `/dashboard/clients/<id>/assets` | 2026-09-15 | 819 |
| `/dashboard/clients/<id>/pages/[pageId]/upgrade` | 2026-09-05 | 455 |
| `/dashboard/clients/<id>/content-factory/settings` | 2026-07-31 | 213 |
| `/dashboard/clients/<id>/blog` | 2026-06-14 | 630 |
| `/dashboard/clients/<id>/blog/[postId]` | 2026-06-14 | 696 |
| `/dashboard/clients/<id>/production` | 2026-06-03 | 456 |
| `/dashboard/clients/<id>/production/[packageId]` | 2026-06-03 | 829 |

### 4 客人与销售

| 页面 | 最后改动 | 规模(行) |
|---|---|---|
| `/dashboard/clients/<id>/crm/payments` | 2026-10-17 | 302 |
| `/dashboard/clients/<id>/tour-catalog` | 2026-10-17 | 51 |
| `/dashboard/clients/<id>/crm/phone-review` | 2026-10-13 | 124 |
| `/dashboard/clients/<id>/sales-progress` | 2026-10-13 | 63 |
| `/dashboard/clients/<id>/messenger` | 2026-09-29 | 188 |
| `/dashboard/clients/<id>/contacts` | 2026-09-28 | 379 |
| `/dashboard/clients/<id>/crm/unclaimed` | 2026-09-28 | 193 |
| `/dashboard/clients/<id>/tailor-made` | 2026-09-16 | 153 |
| `/dashboard/clients/<id>/tailor-made/[quoteId]` | 2026-08-30 | 42 |
| `/dashboard/clients/<id>/business-inbox` | 2026-08-29 | 195 |
| `/dashboard/clients/<id>/business-inbox/[conversationId]` | 2026-08-29 | 93 |
| `/dashboard/clients/<id>/crm/decisions` | 2026-08-29 | 173 |
| `/dashboard/clients/<id>/listings` | 2026-08-06 | 69 |
| `/dashboard/clients/<id>/listings/[listingId]` | 2026-08-06 | 82 |
| `/dashboard/voice` | 2026-07-16 | 134 |
| `/dashboard/voice/calls/[callId]` | 2026-07-16 | 111 |
| `/dashboard/voice/manage` | 2026-07-16 | 62 |
| `/dashboard/voice/tenants/[tenantId]` | 2026-07-16 | 70 |

### 5 SEO/AI 可见度/诊断（长期）

| 页面 | 最后改动 | 规模(行) |
|---|---|---|
| `/dashboard/clients/<id>/agents` | 2026-09-28 | 50 |
| `/dashboard/clients/<id>/site-audit/pages` | 2026-09-26 | 519 |
| `/dashboard/ai-visibility` | 2026-09-23 | 182 |
| `/dashboard/ai-visibility/[clientId]` | 2026-09-23 | 533 |
| `/dashboard/clients/<id>/seo-intelligence` | 2026-09-20 | 1535 |
| `/dashboard/clients/<id>/knowledge` | 2026-09-14 | 198 |
| `/dashboard/clients/<id>/operating-agent` | 2026-09-14 | 312 |
| `/dashboard/clients/<id>/memory` | 2026-09-07 | 722 |
| `/dashboard/geo-composer` | 2026-09-05 | 76 |
| `/dashboard/geo-composer/[clientId]` | 2026-09-05 | 404 |
| `/dashboard/clients/<id>/diagnostic` | 2026-08-12 | 16 |
| `/dashboard/clients/<id>/zhangqian` | 2026-08-12 | 719 |
| `/dashboard/clients/<id>/page-rewriter` | 2026-08-05 | 646 |
| `/dashboard/clients/<id>/prescription/new` | 2026-08-04 | 1855 |
| `/dashboard/clients/<id>/diagnostic/report` | 2026-06-08 | 524 |
| `/dashboard/geo-composer/[clientId]/deploy` | 2026-06-04 | 194 |
| `/dashboard/clients/<id>/seo-gap` | 2026-05-27 | 265 |

### 6 经营与报表

| 页面 | 最后改动 | 规模(行) |
|---|---|---|
| `/dashboard/clients/<id>/business-calculator` | 2026-10-16 | 55 |
| `/dashboard/conversions` | 2026-09-26 | 757 |
| `/dashboard/industry-baselines` | 2026-09-23 | 694 |
| `/dashboard/reports` | 2026-09-23 | 63 |
| `/dashboard/reports/[clientId]/monthly` | 2026-09-23 | 439 |
| `/dashboard/ad-engine` | 2026-09-14 | 382 |
| `/dashboard/commerce` | 2026-08-17 | 36 |
| `/dashboard/clients/<id>/wallet` | 2026-06-03 | 184 |
| `/dashboard/analytics` | 2026-06-01 | 119 |

### 7 系统与管理员

| 页面 | 最后改动 | 规模(行) |
|---|---|---|
| `/dashboard/clients/<id>/settings` | 2026-10-18 | 391 |
| `/dashboard/admin/cron-health` | 2026-09-26 | 199 |
| `/dashboard/admin/flywheel` | 2026-09-26 | 134 |
| `/dashboard/admin/users` | 2026-09-24 | 56 |
| `/dashboard/workflows-health` | 2026-09-23 | 244 |
| `/dashboard/me2/product-map` | 2026-08-19 | 24 |
| `/dashboard/team-memory` | 2026-08-03 | 202 |
| `/dashboard/admin/prospecting` | 2026-07-14 | 408 |
| `/dashboard/admin/mcp-keys` | 2026-06-06 | 244 |
| `/dashboard/admin/viral-references` | 2026-06-04 | 978 |
| `/dashboard/admin/mtc-overview` | 2026-06-03 | 226 |
| `/dashboard/admin/ai-gateway` | 2026-06-02 | 451 |
| `/dashboard/admin/billing-monitor` | 2026-06-01 | 216 |
| `/dashboard/clients/new` | 2026-06-01 | 89 |

### 8 旧路线（Launch Hub）

| 页面 | 最后改动 | 规模(行) |
|---|---|---|
| `/dashboard/content` | 2026-10-17 | 1329 |
| `/dashboard/visuals` | 2026-10-17 | 1401 |
| `/dashboard/content/generate` | 2026-05-18 | 6 |

## 规模说明
规模为 16 行左右的页面多是「服务端包装」（真正界面在同目录的客户端组件里），行数不代表功能大小。

## 建议（最小成本）
1. 左栏与客户页按这 8 组重排（118 号方案已有）。
2. 「半年没动」清单让各线负责人 10 分钟认领：留 / 并 / 退役候选；PM 只看结果。
3. Launch Hub 一组等 PM 说「删」后按已定三步走。
4. 想真正知道哪些页面没人用，需要加页面访问计数（新表，A 级，先问）。
