# Phase 12.R · WordPress Page Rewriter

> 起草:子牙(本窗口 modest-proskuriakova-0aa314)
> 日期:2026-06-13 NZST
> 状态:RFC 待审 (子牙 + 魏征 + 板桥)
> 负责开发窗口:子牙后台 worktree `stoic-brown-327cb3` → `claude/phase-12j-page-rewriter`
> 关联 Kanban:Oztop 卡 `68719224-5f22-4e5e-af54-c5d249e5834a`
>
> **命名修正**(2026-06-13 子牙拍板):起草时误用 `Phase 12.J`,但该 ID 已被 ROADMAP.md:1912 "博客头图配图生成 ✅ 已完成" 占用。正式登记用 **Phase 12.R**。spec 文件名 + git 分支名 (`phase-12j-page-rewriter`) 保留作历史标识,内容全部按 12.R 算。

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
- ❌ AI 自动生成新 H1/H3/正文(本 Phase 只做"机械改写",AI 增强放 Phase 12.R.2)
- ❌ 批量改写(单页提交,批量放 Phase 12.R.3)

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
3. ROADMAP.md 加 Phase 12.R 登记(本文档同步追加一行)
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

### A3 · Phase 12.R 总工时更新

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

### A9 · Phase 12.R 总工时(2026-06-13 04:53 更新)
- 原 page-rewriter: 10.5h
- A1 Action Bar: 3h
- A2 Mode 选择器: 1h
- A4 Focus Keyphrase 编辑: 0.5h
- A6 wpFetch timeout + sgcaptcha 检测: 3h(原 1.5h, 因 sgcaptcha 探测复杂)
- A7 Copy HTML GEO 修复: 1h
- A8 主题 text-transform 预检: 2h
- **新总计: ~21h ≈ 2.5-3 day**

---

## 附录 B · 修正版(2026-06-13 子牙拍板 + 魏征复审 + DB 真相)

> 本次修正基于:
> 1. **魏征独立复审**(5 条 P0 全部采纳)
> 2. **DB 真相核查**:查 `blog_posts.geo_html_snapshot` 最近 20 行(oztop + CTS),锁定 A7 真根因
> 3. **PM 业务事实**:2026-06-13 04:53 PM 事故是按 "Copy HTML" 按钮粘到 WP(印证 A7 真凶)
> 4. **PM 业务决策**:回填全部 20+ 篇博客的 geo_html_snapshot 字段

附录 A 章节(A1-A9)保留作 RFC 起草历史,**实施以本附录 B 为准**。

---

### B6 · A6 修正版 — wpFetch 加固

**真根因**(已核实 `src/lib/cms/wordpress-client.ts:70-87`):
- `wpFetch()` 用裸 `fetch()`,**0 timeout / 0 AbortSignal / 0 WAF 检测**
- 502 走 `expectJson()` line 109-113 兜底,只 echo 响应前 300 字符 → 前端看到 `Unexpected token '<'`

**修正方案**(吸收魏征 P0):

| 维度 | A6 原方案 | A6 修正版 |
|---|---|---|
| 超时 | `AbortSignal.timeout(25_000)` | **`AbortController` + `setTimeout(controller.abort, 10_000)` + `finally controller.abort()`**(防 Node < 18.17 静默失败 + 防 socket keep-alive 泄漏) |
| Timeout 时长 | 25s | **10s**(SiteGround captcha 通常 < 5s 就 302) |
| 重试策略 | 无 | **5xx + network error 重试 1 次,4xx / captcha redirect 不重试** |
| WAF 检测面 | 只查 `sgcaptcha` / `sg-block` | **多组合判定**:① `res.url` 检测(`sgcaptcha` / `sg-block` / `sgs-block` / `sucuri_cloudproxy_uuid`)② response headers 检测(`x-sucuri-id` / `cf-mitigated` / `wfwaf-authcookie` cookie)③ response body 前 **2KB** 检测(`Generated by Wordfence` / `Sucuri` / `Just a moment` / `<title>Security check</title>`)④ status 组合(403 / 406 / 503 + body 标识)|
| 错误分类 | 通用 "not JSON" | **分类**:`SITEGROUND_ANTIBOT` / `CLOUDFLARE_CHALLENGE` / `WORDFENCE_BLOCK` / `SUCURI_BLOCK` / `GENERIC_WAF` / `WP_REST_DISABLED` |
| expectJson body 抓取 | 前 300 字符 | **前 2KB**(WAF 拦截页常 > 1KB,关键标识在 `<meta>` 里) |
| 可测试性 | hardcoded 25s | **加可选 `timeoutMs` 参数** + 抽出 `detectWafFingerprint(res, body)` 纯函数 |

**测试矩阵**(vitest,期望 ≥ 8 pass):
1. happy path: 200 + JSON 返回
2. timeout: mock 永不 resolve 的 fetch,期望 10s 内抛 `AbortError`(`vi.useFakeTimers`)
3. socket 泄漏自证:循环调用 100 次 timeout 路径,断言无 EMFILE(用 mock counter)
4. SiteGround redirect: `res.url='https://x.com/sgcaptcha/?...'` → 抛 `SITEGROUND_ANTIBOT`
5. Wordfence: status 403 + body 含 `Generated by Wordfence` → 抛 `WORDFENCE_BLOCK`
6. Sucuri: header `x-sucuri-id` 存在 → 抛 `SUCURI_BLOCK`
7. Cloudflare: status 503 + body 含 `Just a moment` → 抛 `CLOUDFLARE_CHALLENGE`
8. 重试:第一次 502,第二次 200 → 成功返回(断言重试 1 次)
9. 不重试:第一次 captcha redirect → 立即抛错,不再发请求

**Codex prompt 撒谎防御三件套**(魏征 P0):
1. `gh pr view <N> --json headRefOid` 回贴 oid(防 commit hash 伪造)
2. `gh pr checks <N>` 输出截图(CI 真跑过)
3. **变异测试自证**:故意把 `detectWafFingerprint` 改 `return null`,跑测试断言 fail 数 ≥ 4(防空架子测试)
4. 独占文件清单 + "期间禁动 wordpress-client.ts 外的任何文件"

**工时**:3h(实施 1h + 单测 1h + 魏征复审 + Codex 三件套自证 1h)

---

### B7 · A7 修正版 — GEO 隐藏机制架构级修复

**真根因**(已 DB 核查,20 行样本一致):

`blog_posts.geo_html_snapshot` 字段**是好 HTML**,顶层结构:
```html
<!-- Instructions for AI Agents -->
<div class="seo-instructions" aria-hidden="true"
     style="position: absolute; top: -9999px; overflow: hidden;
            width: 1px; height: 1px; clip: rect(0,0,0,0); white-space: nowrap;">
  [INSTRUCTIONS FOR AI AGENTS] ...
</div>
```

但 **WordPress Gutenberg / Classic editor / Elementor 粘贴时会剥 inline positioning style**(`position:absolute` 被当不安全过滤)→ 留下 `<div class="seo-instructions" aria-hidden="true">[INSTRUCTIONS...]</div>` 没了 hidden 样式 → 前台可见。

**这是架构级缺陷**,影响 20+ 篇老博客(2026-05-25 起 published 5 篇 + draft 15+ 篇全部)。

**修正方案**(吸收魏征 P0 删伪修复 + 上移 sanitize):

| 层 | 原 spec | 修正版 |
|---|---|---|
| 1. iframe `.replace` | 删 | **保留不动** — 它是 iframe sanitize 渲染,删了反而让预览出现可见 `[INSTRUCTIONS]`,更糟(魏征 P0) |
| 2. `buildBlogHtml` 测试 | 测好 HTML 保留 | **改测 sanitize 路径**:输入"只有 inline positioning style 的 div" → 断言 builder 自动包 `hidden aria-hidden="true"` |
| 3. handleCopy runtime 警告 | 弹警告 | **删** — 用户已点按钮,警告太晚。改成 sanitize 上移到 `buildBlogBodyHtml`,不让坏数据进 clipboard |
| 4. GEO Composer 输出格式 | 无 | **新增**:从根源改造 — 输出 `<style>.seo-instructions{...}</style><div hidden aria-hidden="true" class="seo-instructions">...</div>` 组合,即便 WP 剥 inline style,`hidden` HTML 属性 + style class 任一保留就生效 |
| 5. DB backfill | 无 | **新增**:全部 20+ 篇 SQL UPDATE 改新格式(PM 已授权"回填数据")|
| 6. published 老博客重发 | 无 | **新增**:page-rewriter (P1 M1-M5) 完工后用它自动重发 published 老博客覆盖 WP(分两步走)|

**新 GEO HTML 模板**(由 GEO Composer 生成):
```html
<!-- ME_GEO_BLOCK_V2 — robust hidden marker -->
<style>
  .me-geo-instructions {
    position: absolute !important;
    top: -9999px !important;
    left: -9999px !important;
    width: 1px !important;
    height: 1px !important;
    overflow: hidden !important;
    clip: rect(0,0,0,0) !important;
    white-space: nowrap !important;
  }
</style>
<div hidden aria-hidden="true" class="me-geo-instructions" data-me-geo="v2">
  [INSTRUCTIONS FOR AI AGENTS]
  ...
</div>
```

**为什么这种模板抗 WP 剥**:
- `hidden` HTML 属性是 native boolean,WP 不剥
- `<style>` 块通常被 WP 保留(Gutenberg classic block 不剥 style 标签)
- `class="me-geo-instructions"` 不会被剥(保留 class)
- 三重冗余:即便 WP 剥了 inline style 块,`hidden` attr 还在,前台不可见

**`buildBlogBodyHtml` sanitize 兜底**(`src/lib/blog/html-builder.ts`):
```typescript
function sanitizeGeoSnapshot(snapshot: string): string {
  if (!snapshot) return ''
  // 检测顶层 div 是否依赖 inline positioning style 隐藏 (易被 WP 剥)
  const isLegacyVisuallyHidden = /^<div[^>]*style="[^"]*position\s*:\s*absolute/i.test(snapshot.trim())
  const hasHiddenAttr = /<div[^>]*\bhidden\b/i.test(snapshot)
  if (isLegacyVisuallyHidden && !hasHiddenAttr) {
    // 在最外层再包一层 hidden div 兜底
    return `<div hidden aria-hidden="true" data-me-geo-fallback="v2">\n${snapshot}\n</div>`
  }
  return snapshot
}

export function buildBlogBodyHtml(post) {
  const parts = [
    buildHeroFigure(post),
    post.html_body,
    sanitizeGeoSnapshot(post.geo_html_snapshot ?? ''),
  ]
  return parts.filter(Boolean).join('\n\n')
}
```

**DB backfill SQL**(PM 已授权):
```sql
-- 把所有用旧 inline-positioning-style 模式的 geo_html_snapshot
-- 换成新 ME_GEO_BLOCK_V2 模板
-- 真值在 GEO Composer 一次性 regenerate (preferred) 或正则替换 (fallback)
-- 决策: GEO Composer 重生成更准,因为指令文本可能也需要刷新
-- 但 GEO Composer 重跑要 token,先做正则替换上线,再 schedule 重生成

UPDATE blog_posts
SET geo_html_snapshot = regexp_replace(
  geo_html_snapshot,
  '<div class="seo-instructions"[^>]*style="[^"]*"\s*>',
  '<style>.me-geo-instructions{position:absolute!important;top:-9999px!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;}</style><div hidden aria-hidden="true" class="me-geo-instructions" data-me-geo="v2">',
  'i'
)
WHERE geo_html_snapshot ~* '<div class="seo-instructions"[^>]*style="[^"]*position\s*:\s*absolute';
-- 期望 affected rows: ~20+
```

**published 老博客重发计划**:
- 现在:只 backfill DB(WP 上的老文章不动 — 已经粘进去的就这样)
- P1 page-rewriter 完工后:用 page-rewriter 拉 ME 最新 `geo_html_snapshot` → 自动 PATCH WP post → 覆盖 WP 老内容
- **WP 老博客窗口**:从现在到 page-rewriter 完工 ≈ 1.5 天,期间 published 老博客在 WP 上仍可能有可见 `[INSTRUCTIONS]`(若客户主题恰好没自带 hidden CSS),已是既定事实

**工时**:5h(GEO Composer 改造 2h + html-builder sanitize + 单测 1h + DB backfill SQL + 验证 1h + page-rewriter 重发集成 1h)

---

### B10 · 新增 A10 章节 — Blog Detail Internal Links Panel

**问题**(已 grep 核实):
- `blog_posts.internal_links` 字段存在(`BlogInternalLink[]` = `{anchor, target_slug, resolved}`)
- ME 后台 `src/app/dashboard/clients/[id]/blog/[postId]/page.tsx` **完全没渲染 `internal_links`**
- FDE 看不到博客有几条内链 / 哪些 resolved / 哪些 broken → 上 WP 发完文章后无法人工 mark resolved

**修复**:Blog Detail 页右栏(Quality Checklist 下方)加 `<InternalLinksPanel>`,显示:
```
Internal Links (3)
├─ ✅ "engineered timber Brisbane" → /products/engineered-timber  [Resolved]
├─ ⚠️ "Pet-friendly SPC" → /collections/pet-friendly  [Unresolved · Add target page in WP]
└─ ⚠️ "Bathroom showroom" → /showroom-slacks-creek  [Unresolved · Mark Resolved]
```

Unresolved 链接红色边框 + "Mark Resolved" 按钮(PATCH `/api/clients/[id]/blog/[postId]` 已有,只需把 `internal_links[i].resolved=true` 写入)。

**工时**:1.5h(panel 组件 + toggle resolved + 单测)

---

### B-总工时(2026-06-13 修正后)

| 项 | 工时 | 优先级 |
|---|---|---|
| **B6** wpFetch 加固(timeout + WAF 三件套 + 重试 + 分类错误) | 3h | **P0 BLOCKER** |
| **B7** GEO 隐藏机制架构修复 + sanitize + backfill | 5h | **P0 BLOCKER** |
| 原 page-rewriter M1-M5 | 10.5h | P1 |
| A1 Blog Detail Action Bar(Delete/Regen/Edit Content) | 3h | P1 |
| A8 客户主题 text-transform 预检 | 2h | P1 |
| A2 Mode 选择器 | 1h | P2 |
| A4 Focus Keyphrase inline editor | 0.5h | P2 |
| **B10** Internal Links Panel | 1.5h | P2 |
| **总计** | **~26.5h ≈ 3-3.5 day** | |

---

### B-审查签字

- [x] 子牙起草(本附录 B)
- [x] 魏征独立挑刺(5 条 P0 全采纳,文档化在 B6/B7)
- [x] DB 真相核查(20 行样本)
- [x] PM 业务事实确认(Copy HTML 按钮粘 WP)
- [x] PM 业务决策(回填全部数据)
- [ ] 板桥 C 端 UI 审(B7 GEO 新模板 + B10 Panel mockup 完后)
- [ ] PM `go merge` PR-SPEC
