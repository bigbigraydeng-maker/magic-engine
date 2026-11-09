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
> ⚠️ **2026-09-26 更正**:生产约束 `client_site_pages_crawl_status_check` 当时只允许 pending/crawled/failed,`antibot_challenged` **一次都没写进去过**(代码没查写入错误,静默吞掉);而且 SiteGround 新版挑战页的标题在我们这边是裸域名,检测器也认不出。所以 2026-09-26 之前按 `crawl_status = 'antibot_challenged'` 数出来的 0 是假的。修复见 migration `20260926140000_client_site_pages_crawl_status_antibot.sql` 和同 PR 的检测器指纹。下面的自检查询已改成**同时按正文特征数**。
>
> 但这两层只是**让 ME 知道"被拦了"**,不会让爬虫通过。
>
> 🔴 **2026-09-26 再更正:读页面这一路,只加本 SOP 的白名单没用。**
> - site-audit 读每一页正文都经第三方阅读服务(Site Analyzer,代码 `src/lib/brief/jina.ts` → `r.jina.ai`)转手,客户防火墙看到的是这个服务的地址,不是 ME 服务器(Render)的地址。只按代码路径确认,还没有在客户站实测过。
> - 本 SOP 的白名单只对 **ME 服务器直连客户站**的几路有效:读站点地图(`crawler.ts` 直连那几级)、改 Yoast / 发博客(`wpFetch`)。
> - 要让读页面也通过,得先由开发把被挡的站改成由 ME 服务器直接读(或走固定出口的代理),**改好之后**再按本 SOP 请客户放行。今日待办「页面被防火墙挡住」那条就是这么写的:先回一句「换通道」,别先找客户。
> - 这份文档含内部步骤(Render 后台、带内部 key 的调用),**不要直接转给客户**;要客户动手时,把 IP 和第 2 步单独整理给对方。

---

## 0 · 是不是真的需要这个 SOP?(2 分钟自检)

跑这条 SQL(在 Supabase Studio):

```sql
SELECT
  COUNT(*) FILTER (WHERE crawl_status = 'antibot_challenged') AS antibot_pages,
  COUNT(*) FILTER (WHERE left(coalesce(markdown_content,''), 4096) ~* 'robot\s+challenge\s+screen|checking\s+the\s+site\s+connection\s+security|robot-suspicion\.svg'
                      OR title = 'Robot Challenge Screen')     AS challenge_stub_pages,
  COUNT(*)                                                     AS total_pages
FROM client_site_pages
WHERE client_id = '{CLIENT_UUID}';
```

- 如 `antibot_pages` > 0 或 `challenge_stub_pages` > 0 → **必须跑本 SOP**
- `challenge_stub_pages` 按正文特征数：新版挑战页标题是裸域名，只按标题数会漏（2026-09-26 某客户 117 行里只有 11 行标题带 Robot Challenge）
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
  COUNT(*) FILTER (WHERE crawl_status = 'antibot_challenged' AND crawled_at > '{ALLOWLIST_TIME}') AS still_blocked_after_fix,
  COUNT(*) FILTER (WHERE crawl_status = 'crawled'            AND crawled_at > '{ALLOWLIST_TIME}') AS crawled_after_fix,
  COUNT(*)                                                                                        AS total_pages
FROM client_site_pages
WHERE client_id = '{CLIENT_UUID}';
```

（`{ALLOWLIST_TIME}` = 你在 Step 2 保存白名单的时间，UTC。只看这之后重爬过的行 —— 每周自动重爬一次最多 150 页，没被这轮碰到的旧行不算数。）

**期望**(前提:读页面已改成由 ME 服务器直连,见文首「再更正」;还没改的话这一步不会降到 0,不是白名单没加好):
- `still_blocked_after_fix` → **0** ✅
- `crawled_after_fix` ↑ 大幅上升

如还有 still_blocked_after_fix > 0:
- 先排除最常见的一条:读页面还在走第三方阅读服务(见文首「再更正」),白名单对它无效 —— 回一句「换通道」
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
  topics             = '{}',   -- topics 是 NOT NULL（默认 '{}'），设 NULL 会直接报错
  classification_confidence = NULL,
  crawl_status       = 'antibot_challenged',
  crawl_error        = 'legacy stub from pre-2026-06-20 antibot detection — needs re-crawl'
WHERE client_id = '{CLIENT_UUID}'
  AND (left(coalesce(markdown_content,''), 4096) ~* 'robot\s+challenge\s+screen|checking\s+the\s+site\s+connection\s+security|robot-suspicion\.svg'
       OR title = 'Robot Challenge Screen');
```

⚠️ 这是改生产数据：先跑下面的 dry-run 把行数给 PM 看，PM 点头再跑；而且要在 migration `20260926140000_client_site_pages_crawl_status_antibot.sql` 上线之后跑（之前 `antibot_challenged` 写不进去）。旧条件 `word_count <= 80` 已删掉 —— 它会误伤正常的短页面。

⚠️ 跑前 dry-run 看 `affected_rows`:

```sql
SELECT COUNT(*) FROM client_site_pages
WHERE client_id = '{CLIENT_UUID}'
  AND (left(coalesce(markdown_content,''), 4096) ~* 'robot\s+challenge\s+screen|checking\s+the\s+site\s+connection\s+security|robot-suspicion\.svg'
       OR title = 'Robot Challenge Screen');
```

(Oztop 估计 ~30-40 行)

跑完 + 重新 Re-crawl(Step 3)→ 大概 30 分钟拿到干净数据。

---

## 5 · 完工 checklist

- [ ] Step 0 自检 SQL 跑过, `antibot_pages > 0` 确认要做
- [ ] Step 1 ME egress IP 列表 拿全(2-5 个 IP)
- [ ] Step 2 SiteGround Defensive Mode → IP Allowlist 全部加上
- [ ] Step 3 Re-crawl 跑通,`still_blocked_after_fix` → 0(读页面改直连之后才可能)
- [ ] Step 4 旧 "Robot Challenge Screen" 脏数据清理(可选)
- [ ] 在客户 onboarding 笔记里记 "SiteGround Allowlist 已配 + {date}",防止后人重复踩坑
