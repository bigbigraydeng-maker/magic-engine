# Phase 12.J · WordPress Page Rewriter

> 起草:子牙(本窗口 modest-proskuriakova-0aa314)
> 日期:2026-06-13 NZST
> 状态:RFC 待审 (子牙 + 魏征 + 板桥)
> 负责开发窗口:左窗口(CTS execution line)或独立子牙后台 worktree
> 关联 Kanban:Oztop 卡 `68719224-5f22-4e5e-af54-c5d249e5834a`

---

## 一、问题陈述(为什么做)

**现状**:ME 已经接通 Oztop WordPress(`cms_connections` status=connected, yoast plugin 已装),
Blog Factory 能**创建新博客** + 自动写 Yoast Title/Meta/Schema → 一键发 WP。

**缺口**:**改写已有页面**没有 UI / API 路径。
- `publish-wordpress` API 只支持 source=`blog_posts` 新建路径
- FDE 想改 `/tile-sizes-explained` 的 Yoast Title + Meta + FAQ Schema → **必须回 Elementor 手抠 / 回 WP 后台手敲**
- 违反 CLAUDE.md「FDE 配置必须有 UI」强约束

**真实事故**:2026-06-13 PM 手工改 Oztop `/tile-sizes-explained`,
30 分钟改一页,5 页改写 = 2.5h 纯手工劳作,效率极低。

**ROI**:Oztop 5 页 + CTS 5 页 + 未来每 FDE 客户的页面改写工作流,
每次省 30 分钟 → 20 次回本。

---

## 二、底层能力盘点(全现成)

`src/lib/cms/wordpress-client.ts` 已提供:

| 能力 | 函数 | 状态 |
|---|---|---|
| Yoast meta 探测 | `probeYoastMetaWritable()` | ✅ 已验证 PATCH `/posts/{id}` 写 `_yoast_wpseo_title` 可行 |
| Yoast meta 字段定义 | `seoTitle` / `seoDescription` / `focusKeyphrase` | ✅ Lines 234-272 已有完整映射 |
| HTML 清洗 | `prepareCmsContent()` | ✅ Strip script/iframe/event-handler |
| Schema 注入 | `buildArticleSchemaScript()` | ✅ FAQ Schema 生成 |
| 鉴权 | `requirePaidClientAccess()` | ✅ 复用 publish-wordpress 同款 |

**只缺**:把上面 5 件事拼成「改写已有 post/page」的 API + UI。

---

## 三、范围与不范围

### IN SCOPE (本 Phase)
1. `wordpress-client.ts` 新函数 `updateExistingWordpressPost(config, postId, partial)` — PATCH 已有 post/page
2. 新 API `POST /api/clients/[id]/cms/wordpress/update-post` — 提交改写
3. 新 UI `/dashboard/clients/[id]/page-rewriter` — 表单 + diff 预览
4. Kanban 集成:从 `[O1]` SEO 改写卡一键跳到 page-rewriter,带预填
5. 真站点 sanity test:Oztop `/tile-sizes-explained` 端到端跑通

### OUT OF SCOPE
- ❌ 改 Elementor 内部数据结构(content 字段绕开 Elementor,不动 Elementor 渲染层)
- ❌ AI 自动生成新 H1/H3/正文(本 Phase 只做"机械改写",AI 增强放 Phase 12.J.2)
- ❌ 批量改写(单页提交,批量放 Phase 12.J.3)

---

## 四、API 契约

### `POST /api/clients/[id]/cms/wordpress/update-post`

**入参**:
```typescript
{
  // 必填
  target_type: 'post' | 'page'
  remote_post_id: number   // WP 数据库里的 post ID

  // 选填(至少 1 个)
  title?:           string   // <title> 标签 + WP title 字段
  seo_title?:       string   // _yoast_wpseo_title
  seo_description?: string   // _yoast_wpseo_metadesc
  focus_keyphrase?: string   // _yoast_wpseo_focuskw
  excerpt?:         string   // WP excerpt
  content_html?:    string   // WP content(注意:Elementor 页慎改)
  faq_schema?:      Array<{question: string, answer: string}>  // 自动转 FAQ Schema JSON-LD

  // idempotency
  idempotency_key?: string   // default = sha256(payload)
}
```

**出参**:
```typescript
// 成功
{ success: true, job_id: string, updated_url: string, updated_fields: string[] }

// 鉴权失败
{ success: false, error: string, code: 'UNAUTHORIZED' | 'NOT_PAID_CLIENT' }

// WP 错误
{ success: false, error: string, code: 'WP_ERROR', wp_status: number }
```

**审计**:写 `website_publish_jobs` 表新 `action_type='update_existing'`,记录:
- `before_snapshot` JSONB:改写前的 Yoast meta + title(从 WP REST GET 拉)
- `after_snapshot` JSONB:改写后的字段
- 支持 rollback(用 before_snapshot 反向 PATCH)

---

## 五、UI 设计 `/dashboard/clients/[id]/page-rewriter`

### 流程
1. **第一屏 · 选页**
   - 输入 WP post URL(如 `/tile-sizes-explained-...`)
   - ME 后台调 WP REST GET 拉当前 title / Yoast meta / excerpt → 显示「当前值」
2. **第二屏 · 改写表单**
   - 左列「当前」(只读) / 右列「目标」(可编辑)
   - 每字段差异 highlight
   - FAQ 区:可视化加 question/answer 对(自动转 Schema)
3. **第三屏 · diff 预览 + 确认**
   - 显示要改的字段列表
   - 「Submit Rewrite」按钮 → 调 API
4. **完成屏**
   - 显示 updated_url + 「Open in WP」/「Verify in GSC」按钮

### Mockup 复用
- `PrimaryKeywordsPanel.tsx` / `ExcludedTopicsPanel.tsx` 同款 form pattern
- diff 预览复用 `BlogPostEditor` 的 left/right 双栏布局

---

## 六、Kanban 集成

`[O1]` 系列 SEO 改写卡片(execution_items)上加 action button:
```
「在 ME 中改写此页 →」 → 跳 /dashboard/clients/{id}/page-rewriter?prefill={card_id}
```

card_id 关联到 page-rewriter 的预填(从卡片 description 提取 URL + 目标 title/meta)。

---

## 七、安全 & 红线

1. ✅ 复用 `requirePaidClientAccess()` 租户隔离
2. ✅ `prepareCmsContent()` 清洗 HTML,杜绝 XSS/iframe 注入
3. ✅ `wp_fetch()` 内部 DNS SSRF guard 保留
4. ✅ before_snapshot 保证 rollback
5. ✅ **不动 Elementor**:content_html 字段仅在「非 Elementor 页」开放,Elementor 页 UI 上禁用(灰掉 + tooltip 提示走 Elementor 改)
6. ✅ Yoast 字段对所有页开放(meta 字段独立于 Elementor 渲染)

---

## 八、测试 plan

| 层 | 测试 |
|---|---|
| 单元 | `wordpress-client.updateExistingWordpressPost()` mock fetch / 各错误码 / Yoast meta 写入 |
| 集成 | API 路由 `update-post` 鉴权 + idempotency + before/after snapshot |
| 真站点 | Oztop `/tile-sizes-explained` 端到端:GET → 改 SEO Title + Meta + FAQ → 验证前台显示 |
| 回归 | publish-wordpress 创建新博客流程不受影响 |

---

## 九、工时 + 里程碑

| Step | 内容 | 工时 | 负责 |
|---|---|---|---|
| M1 | `updateExistingWordpressPost()` + 单测 | 1h | 子牙派 Codex |
| M2 | `update-post` API + 鉴权 + 审计 + 单测 | 1.5h | 同上 |
| M3 | UI page-rewriter + 三屏流程 | 4h | 同上 |
| M4 | Kanban 集成 + 跳转预填 | 2h | 同上 |
| M5 | 真站点 sanity test(Oztop tile-sizes)+ 魏征复审 | 2h | 子牙 + 魏征 |
| **合计** | **~10.5h ≈ 1-1.5 day** | | |

---

## 十、审查清单(开工前)

- [ ] 子牙:架构方案审 (本文档)
- [ ] 魏征:代码挑刺(开工后,实施完再审)
- [ ] 板桥:面向 C 端客户 UI 通沟通审(M3 mockup 完出图后)
- [ ] PM:RFC 拍板

---

## 十一、下一步

1. 本文档 push 到 `claude/modest-proskuriakova-0aa314` 分支
2. 同步给左窗口 / 子牙后台 worktree(由它们接手开发)
3. ROADMAP.md 加 Phase 12.J 登记(本文档同步追加一行)
4. Oztop Kanban 卡 `68719224-5f22-4e5e-af54-c5d249e5834a`(等开发)与本 Phase 关联

---

## 附录 A · 范围扩充(2026-06-13 04:30 NZST 子牙追加)

实战发现 ME 还缺两个关键 UI 入口,与 page-rewriter 同批做掉:

### A1 · Blog Detail 页加 Action Bar

当前 `/dashboard/clients/[id]/blog/[postId]` 顶部只有 Copy/Publish/Approve/Reject,
**缺**:
- **Delete** 按钮(确认对话框 → 调 DELETE endpoint,后端已有)
- **Regenerate** 按钮(同 topic + 切换 mode + 调 POST `/api/clients/[id]/blog`)
- **Edit Content** 按钮(进入 markdown/HTML 编辑器 → PATCH endpoint,后端已有)

**真实事故**:2026-06-13 PM 发现 Karndean draft 卡质量检查无法发布,UI 上**没有任何按钮**让他重新生成或删除。
错误提示文字"请重新生成本文,或人工编辑后再保存"对应的按钮**不存在** — 死胡同 UI。

**工时估算**:+3h(三个按钮 + 一个 markdown editor 复用 BlogPostEditor 模式)

### A2 · Blog Generate 表单加 Mode 选择器

当前 Blog Factory 主页「Generate Blog Post」按钮**直接生成**,不让用户选 mode。
真实问题:老 draft 5 篇里 2 篇是 seo_only,质量门槛升级后过不了。
默认 mode 应该是 **unified**(双信号最强)。

**工时估算**:+1h(下拉框 + 默认值改 unified)

### A3 · Phase 12.J 总工时更新

- 原计划 ~10.5h
- + A1 Action Bar: 3h
- + A2 Mode 选择器: 1h
- **新总计:~14.5h ≈ 1.5-2 day**

### A4 · Blog Detail 页加 Focus Keyphrase 编辑

实战场景:Quality Checklist 7/7 过的 draft 顶部仍可能弹"缺少焦点关键词 — Yoast SEO 字段将为空"warning。
当前**没有 UI 让 PM 在前端补 primary_keyword 字段** — 只能 SQL 直接改 blog_posts.primary_keyword。

**修复**:Blog detail 顶部加 "Focus Keyphrase" inline editor(单字段 + Save 按钮),
PATCH `/api/clients/[id]/blog/[postId]` 已有,接通即可。

**工时**:+0.5h

### A5 · 总工时再更新
- A1 Action Bar: 3h
- A2 Mode 选择器: 1h
- A4 Focus Keyphrase 编辑: 0.5h
- 原 page-rewriter: 10.5h
- **新总计:~15h ≈ 1.5-2 day**

### A6 · publish-wordpress 502 异常处理 + 重试策略

**真实事故**:2026-06-13 04:42 NZST,PM 点「发布到 WordPress」返回
`POST /cms/publish-wordpress → 502 Bad Gateway`。
DevTools 确认是 Render 反向代理超时(后端 ME 进程冷启动或 Oztop WP REST 响应慢)。

**当前问题**:
- 前端拿到 502 后只显示 "Unexpected token '<'... not valid JSON" 完全没法理解
- 没有自动重试机制
- 没有 fallback 提示("Copy HTML 手动发"按钮在,但 UI 不引导)

**修复**:
1. publish-wordpress route handler 加 timeout 优雅处理(超过 25s 提前返回 504 JSON)
2. 前端遇到 502/504 自动重试 1 次,失败后弹明确提示:
   "服务繁忙,请 1 分钟后再试,或使用 Copy HTML 手动发布"
3. 加 Sentry/PostHog 埋点跟踪 502 频率

**工时**:+1.5h

### A7 · Copy HTML 不应把 GEO directive 以纯文本嵌入

**真实事故**:2026-06-13 04:53 NZST, PM 用 Copy HTML fallback 粘到 Oztop WP 后, 文章末尾出现可见的
`[INSTRUCTIONS FOR AI AGENTS]` 大段配置文字 — 用户/Google 可见, 严重 SEO + 品牌问题。

**根因**:`src/app/dashboard/clients/[id]/blog/[postId]/page.tsx:228-231`:
```
showGeoBlock && post.geo_html_snapshot
${post.geo_html_snapshot.replace(/<[^>]+>/g, '').trim()}
```
当 PM 切「Show GEO Block」预览时, Copy HTML 把 GEO directive **以纯文本**包进 HTML
(replace 剥掉所有 HTML 标签包括 `style="display:none"`), 粘到 WP 后变可见。

**修复**:
- Copy HTML 永远输出原始 HTML(含 `<section class="geo-signals" aria-hidden="true" style="display:none">`)
- 「Show GEO Block」按钮控制的是 ME 后台 UI 是否预览 GEO 块, 不应影响 Copy HTML 输出
- 同时增加 WP 集成时的 GEO 块兼容性: 检测 Gutenberg Block Editor 是否剥 style 属性, 如果是, 改用 inline CSS 或 SVG-encoded 隐藏方式

**工时**:+1h

### A8 · 客户主题强制 text-transform: uppercase 时给出预发布警告

**真实事故**:2026-06-13 04:53 NZST, PM 把 ME 生成的博客发到 Oztop WP 后, Astra 主题
的 paragraph CSS `text-transform: uppercase` 把所有正文渲染成全大写, 视觉极差。
之前 5/25 5/28 published 的两篇也是同样问题。

**修复**:
- publish-wordpress 流程前增加预检: fetch 客户主题前台样式表, 检测 .entry-content p
  或 article p 的 text-transform 是否 = 'uppercase'
- 如果是, 弹警告: "客户主题 {theme_name} 强制段落大写, 建议在 Customizer → Typography
  → Body → Text Transform 改为 None, 否则正文将渲染为全大写"
- 不阻塞发布(只是警告), 但 Kanban 记录此事故

**工时**:+2h

### A9 · Phase 12.J 总工时(2026-06-13 04:53 更新)
- 原 page-rewriter: 10.5h
- A1 Action Bar: 3h
- A2 Mode 选择器: 1h
- A4 Focus Keyphrase 编辑: 0.5h
- A6 wpFetch timeout + sgcaptcha 检测: 3h(原 1.5h, 因 sgcaptcha 探测复杂)
- A7 Copy HTML GEO 修复: 1h
- A8 主题 text-transform 预检: 2h
- **新总计: ~21h ≈ 2.5-3 day**
