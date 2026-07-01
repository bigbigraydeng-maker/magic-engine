# 客户站 SiteGround 防火墙白名单 SOP — 让 ME 爬虫 / page-rewriter 通过

> **适用范围**:客户站托管在 SiteGround,ME 爬虫(site-audit / page-rewriter / publish 流程)被 SiteGround Security 拦截(Robot Challenge / sgcaptcha / sg-block)。
>
> **目标**:让 ME 服务器 egress IP 通过 SiteGround Defensive Mode,使 ME 后台能正常 crawl 客户页 / 改写 Yoast meta / 发布博客。
>
> **耗时**:5 分钟(每个客户一次性配置)。
>
> **维护人**:FDE → 客户老板(谁有 SiteGround 后台访问权)。
>
> **背景事故**:2026-06-20 Oztop SEO 诊断发现 30+ 张产品分类页 `client_site_pages.title = "Robot Challenge Screen"` / word_count=63 — ME 爬虫被 SiteGround anti-bot 拦截,Jina Reader 把 challenge 页 markdown 当真实页内容存进 DB,导致整片 product-category 数据失真,SEO 诊断无法跑。
>
> **代码侧补强**(已上 main):
> - ✅ P12.R.B6:`wpFetch` 改进 + 5 种 WAF 检测 + 重试(写路径)
> - ✅ 本 PR:`detectAntibotChallenge` 检测 Jina 输出 + crawler 标 `crawl_status='antibot_challenged'`(读路径)
>
> 但这两层只是**让 ME 知道"被拦了"** — 真正让爬虫**通过**还是要客户站这边加白名单。这份 SOP 就是这一步。

---

## 0 · 是不是真的需要这个 SOP?(2 分钟自检)

跑这条 SQL(在 Supabase Studio):

```sql
SELECT
  COUNT(*) FILTER (WHERE crawl_status = 'antibot_challenged') AS antibot_pages,
  COUNT(*) FILTER (WHERE title = 'Robot Challenge Screen')    AS legacy_robot_titles,
  COUNT(*)                                                     AS total_pages
FROM client_site_pages
WHERE client_id = '{CLIENT_UUID}';
```

- 如 `antibot_pages` > 0 或 `legacy_robot_titles` > 0 → **必须跑本 SOP**
- 如两者都 0 → 客户站可能不在 SiteGround,或者 SiteGround 已默认放行,**不需要**

---

## 1 · 拉 ME 服务器的 egress IP(2 分钟)

ME 部署在 Render。Render 给每个 service 一组固定 egress IP(白名单时填的就是这些)。

**两种拿法**:
- **(A)** 登 Render dashboard → 选 ME web service → Settings → "Outbound IP Addresses" 一栏看到 4 个 IP(IPv4)+ 1 个 region 区段
- **(B)** 后台 shell 跑(更精确)`curl ipv4.icanhazip.com` 几次连续看落到哪些 IP

记下来,通常 2-5 个 IP,例:`44.230.xxx.xxx / 54.214.xxx.xxx`(澳洲 region 实际值)

⚠️ **不要把 IP 写进客户站任何公开页或仓库**(部署相关内部信息)。

---

## 2 · 进 SiteGround 后台白名单(2 分钟)

需要客户老板 / 委托人的 SiteGround 登录权(同 WP 不同账号)。

1. 登 https://login.siteground.com
2. 进 Tools → Site Tools(那个客户的 site)
3. 左侧菜单 **Security → SiteGround Security → Defensive Mode**
4. 滚到 **IP Allowlist** 或 **Whitelist** section
5. 点 **Add IP**,逐个添加 Step 1 拿到的 ME egress IP
   - Comment 字段填 `Magic Engine — ME crawler & API`(便于以后识别)
6. Save

某些 SiteGround plan 入口在:
- **Security → IP Blacklist & Whitelist**
- 或 **Anti-Bot AI** 配置页

🔑 关键:必须放进 **Allowlist / Whitelist**,不是 Blacklist。少数老 UI 还有"sgcaptcha" 单独开关,如果存在的话,把 ME IP 加到 captcha 豁免名单。

---

## 3 · 验证 ME 能爬通(2 分钟)

回 ME 后台:

```bash
# 在 ME 客户列表里找到该客户,进 Site Audit 页,点 "Re-crawl"
# 或者管理员直接调:
curl -X POST https://app.magicengine.com.au/api/clients/{CLIENT_ID}/site-audit/crawl \
  -H "Authorization: Bearer {INTERNAL_API_KEY}"
```

等 5-15 分钟 crawl 完成,然后重跑 Step 0 的 SQL:

```sql
SELECT
  COUNT(*) FILTER (WHERE crawl_status = 'antibot_challenged') AS antibot_pages_now,
  COUNT(*) FILTER (WHERE crawl_status = 'crawled')             AS crawled_pages_now,
  COUNT(*)                                                      AS total_pages
FROM client_site_pages
WHERE client_id = '{CLIENT_UUID}';
```

**期望**:
- `antibot_pages_now` → **0** ✅
- `crawled_pages_now` ↑ 大幅上升

如还有 antibot_pages > 0:
- 可能 SiteGround Allowlist 没保存(回 Step 2 重做一遍)
- 可能 Render egress IP 多过 SiteGround 加的(回 Step 1 再补)
- 可能 SiteGround 还有其他 anti-bot 层(Cloudflare 上层等)— 看 `crawl_error` 列具体 evidence

---

## 4 · 清理旧 "Robot Challenge Screen" 历史污染数据(可选,3 分钟)

旧 crawl 已经存了一堆 title="Robot Challenge Screen" 的脏行。重新 crawl 不会覆盖(因为 onConflict 走原 url + 新逻辑 crawl_status='antibot_challenged' 不覆盖 title / markdown / word_count)。如果想清干净,执行:

```sql
-- 把旧脏行标记到 'antibot_challenged' 并清掉污染字段,等下次 crawl 重填
UPDATE client_site_pages
SET
  title              = NULL,
  markdown_content   = NULL,
  word_count         = NULL,
  topics             = NULL,
  classification_confidence = NULL,
  crawl_status       = 'antibot_challenged',
  crawl_error        = 'legacy stub from pre-2026-06-20 antibot detection — needs re-crawl'
WHERE client_id = '{CLIENT_UUID}'
  AND (title = 'Robot Challenge Screen' OR word_count <= 80);
```

⚠️ 跑前 dry-run 看 `affected_rows`:

```sql
SELECT COUNT(*) FROM client_site_pages
WHERE client_id = '{CLIENT_UUID}'
  AND (title = 'Robot Challenge Screen' OR word_count <= 80);
```

(Oztop 估计 ~30-40 行)

跑完 + 重新 Re-crawl(Step 3)→ 大概 30 分钟拿到干净数据。

---

## 5 · 完工 checklist

- [ ] Step 0 自检 SQL 跑过, `antibot_pages > 0` 确认要做
- [ ] Step 1 ME egress IP 列表 拿全(2-5 个 IP)
- [ ] Step 2 SiteGround Defensive Mode → IP Allowlist 全部加上
- [ ] Step 3 Re-crawl 跑通,`antibot_pages_now` → 0
- [ ] Step 4 旧 "Robot Challenge Screen" 脏数据清理(可选)
- [ ] 在客户 onboarding 笔记里记 "SiteGround Allowlist 已配 + {date}",防止后人重复踩坑
