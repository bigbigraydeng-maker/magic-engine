# Phase 12.R · M5 — Oztop tile-sizes 真站点端到端 sanity test SOP

> **适用范围**:P12.R Page Rewriter 上线后(M1-M4 全 merged),Render 部署完成后跑一次真站点端到端验证。
>
> **目标**:确认 FDE 能在 ME 后台对 Oztop `oztopbuildingsupplies.com.au/tile-sizes-explained/` 改写 Yoast meta + 自动写回 WP + 审计回流 `website_publish_jobs`。
>
> **耗时**:30 分钟(含 Render 部署等待)。
>
> **维护人**:PM(M5 需要登 ME dashboard + Oztop WP,sandbox 子牙做不了)。
>
> **前置 PR(全 ✅ merged)**:
> - #468 PM 角色边界规则
> - #469 Phase 12.R Spec + ROADMAP
> - #471 B6 wpFetch 加固
> - #472 B7 GEO 隐藏机制 + backfill
> - #473 M1 客户端 getExistingWordpressPost / updateExistingWordpressPost
> - #474 M2 POST /api/clients/[id]/cms/wordpress/update-post
> - #475 M3 lookup-post + UI 三屏
> - #476 M4 Kanban "在 ME 中改写此页 →" 按钮

---

## 0 · 前置 5 分钟 — Render 部署确认

```bash
# 从 main 最新 commit hash 拉到 Render
gh pr view 476 --json mergeCommit,mergedAt
# Render 部署通常 1-3 分钟。打开 https://app.magicengine.com.au/ 看 footer build hash
```

如果 build hash ≠ main 最新 commit,等 Render 部署完成再继续。

---

## 1 · 进 Oztop 执行看板,找 SEO 卡(2 分钟)

1. ME 后台 → 客户列表 → Oztop
2. 进 **Execution**(/dashboard/clients/{oztop_id}/execution)
3. 找 **dimension = seo** 且**未完成**的卡(status: pending / in_progress)
4. 点开 drawer

### 期望

drawer 里 **按钮区下方**应看见一个 **violet 按钮**:

```
在 ME 中改写此页 →
```

**如果没看见 → P12.R.M4 没生效**。检查 Render 部署 build hash + 浏览器 hard refresh(Cmd+Shift+R)。

---

## 2 · 点 violet 按钮,跳到 page-rewriter(30 秒)

点 "在 ME 中改写此页 →"。

### 期望

- URL 跳到 `/dashboard/clients/{oztop_id}/page-rewriter?kanban_item_id={UUID}`
- 页面顶部出现 **amber chip** 文字 "Linked to Kanban card"
- Stepper 高亮 **Step 1 · Look up**

---

## 3 · Lookup 屏:粘贴 Oztop tile-sizes URL(1 分钟)

1. By URL radio button 默认选中
2. URL 输入框粘:
   ```
   https://oztopbuildingsupplies.com.au/tile-sizes-explained/
   ```
3. 点 **Look up**

### 期望

- 1-3 秒后跳到 Step 2 · Edit
- 显示 `post` `#XXX`(WP post ID)
- 显示 last modified 时间(Oztop WP 上的真实 modified)
- **左列 "Current"** 显示 Oztop 当前 Yoast SEO title / Meta description / Focus keyphrase / Title / Slug / Excerpt
- **右列 "New"** 是可编辑输入框,默认值跟 Current 一致

### 排错

| 错误 | 诊断 |
|---|---|
| 404 NOT_FOUND | Oztop 上是否真有 `/tile-sizes-explained/`?浏览器直接打开看 |
| 502 + code `SITEGROUND_ANTIBOT` | SiteGround 反爬虫拦截 ME 服务器 → 让 Oztop 找 SiteGround support 把 ME egress IP 加 allowlist |
| 502 + code `CLOUDFLARE_CHALLENGE` | Oztop 用 Cloudflare WAF 拦了 → 配 WAF skip rule for /wp-json/* |
| 504 TIMEOUT | wpFetch 10s 超时(B6 上限)。如果偶发,刷新重试一次;持续 → SiteGround 后端慢,联系托管 |

---

## 4 · Edit 屏:改一个 SEO title 测试(2 分钟)

1. **右列 "New — SEO title"** 把现值改一下,例:加 " | Oztop"(确保是改动而不是清空)
2. 看见右列字段名旁出现 ● amber **changed** 标记 + 边框变 amber
3. 其它字段保持不变
4. 点底部 **Continue** 跳到 Step 3 · Confirm

### 期望

- Confirm 屏只显示**这一行 SEO title 的 diff**(其它字段没改不显示)
- 红色删除线 = old / 绿色 = new

---

## 5 · Confirm 屏:Submit rewrite(30 秒)

点 **Submit rewrite**。

### 期望

- 1-3 秒后跳到 Step 4 · Done
- 绿色卡 "✓ Rewrite published"
- 显示 updated_fields(应只含 `seoTitle`)
- 3 个按钮:**Open in WP** / **Verify in GSC** / **Rewrite another**

---

## 6 · 验证 WP 前台真的改了(1 分钟)

1. 点 **Open in WP** → 新窗口打开 `https://oztopbuildingsupplies.com.au/tile-sizes-explained/`
2. **查看页面源代码**(Cmd+U / 右键 View source)
3. 找 `<title>...</title>` 或 `<meta property="og:title"`
4. 应看到改后的 SEO title("...| Oztop")

### 排错

| 现象 | 诊断 |
|---|---|
| title 还是老的 | 浏览器缓存。Cmd+Shift+R hard refresh。如还不变,Oztop WP 有 page cache plugin → 让 FDE 清缓存 |
| title 变成英文 lowercase | Astra 主题 text-transform 影响 → 跟 P12.R.A8 主题预检相关,但这是 title meta,前端 CSS 不应该影响 source HTML 里的 title。看 source 确认 raw 是否对 |

---

## 7 · 验证审计回流 ME 数据库(2 分钟)

打开 Supabase Studio(或用子牙的 admin MCP query):

```sql
SELECT
  id,
  source_type,
  source_id,
  platform_post_id,
  target_url,
  status,
  content_snapshot->>'action' AS action,
  content_snapshot->'before_snapshot'->>'seo_title' AS before_seo,
  content_snapshot->'after_snapshot'->>'updated_fields' AS after_updated,
  created_at
FROM website_publish_jobs
WHERE client_id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
ORDER BY created_at DESC
LIMIT 1;
```

### 期望

| 字段 | 期望值 |
|---|---|
| `source_type` | `'kanban_execution_item'` ✅(因为从 Kanban 跳过来带了 kanban_item_id)|
| `source_id` | 等于 Step 1 SEO 卡的 UUID(Kanban ↔ rewrite 双向追溯) |
| `platform_post_id` | Oztop WP 上 tile-sizes 那篇的 post ID |
| `target_url` | `https://oztopbuildingsupplies.com.au/tile-sizes-explained/` |
| `status` | `'completed'` ✅ |
| `action` | `'update_existing'` ✅ |
| `before_seo` | Step 4 之前的 SEO title 原值 |
| `after_updated` | JSON array `["seoTitle"]` |

### 排错

| 现象 | 诊断 |
|---|---|
| 表里没新行 | 检查 P12.R.M2 是否真上线(`POST /api/clients/[id]/cms/wordpress/update-post`)|
| source_type = `wp_rewrite_adhoc` | 说明跳转没带 kanban_item_id。回 Step 2 看 URL 是否含 `?kanban_item_id=...` |

---

## 8 · 验 Kanban 卡有标记(1 分钟,可选)

理论上 M4 只是加了"在 ME 中改写此页"按钮,**没**做 Kanban 卡 ↔ rewrite job 反向显示(那是后续 Phase)。但你可以手工验追溯链是通的:

- 上面 Step 7 拿到的 `source_id` UUID
- 回 Oztop 执行看板找这个 UUID 的卡
- 卡本身仍是 SEO pending(M4 没改它),但 DB 链已建立

---

## 9 · 收尾:M5 标记完成 + spam 清理

1. 上面 Step 4 改的 SEO title 如果是 sanity test 用,**手工改回原值**(再点一次 page-rewriter,把那条改回去)。或者就当一次真改写不动了
2. ROADMAP.md 上 P12.R.M5 改 `✅`(子牙下个 PR 顺手登记;或 PM 自己改一下打钩)
3. 在 Oztop FDE 笔记里记: M5 done @ {date},Page Rewriter 端到端跑通

---

## 完工 checklist

- [ ] Render build hash = main 最新 commit
- [ ] Oztop 执行看板 SEO 卡 drawer 有 violet "在 ME 中改写此页 →"
- [ ] 点跳到 page-rewriter,顶部 amber "Linked to Kanban card" chip
- [ ] Lookup tile-sizes URL → Edit 屏显示真实 Yoast meta
- [ ] 改 SEO title → Confirm 屏只显示这条 diff
- [ ] Submit → Done 屏 ✓ Rewrite published
- [ ] WP 前台 source title 真的改了
- [ ] `website_publish_jobs` 新行 source_type=`kanban_execution_item` + source_id 对得上 Kanban 卡
- [ ] (可选)恢复 SEO title 原值
