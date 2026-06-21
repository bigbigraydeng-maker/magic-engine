# Oztop 询价 LP 上线 SOP — Stage 1 (Formspree) → Stage 2 (ME endpoint)

> **适用范围**:Oztop `oztopbuildingsupplies.com.au/quote/` 询价落地页的部署 + 切换。
> 同样 SOP 套到任何客户都行(把 client_id / domain 换一下)。
>
> **目标**:让 FDE 当天上线 LP 收 Formspree 邮件, 1-2 周后切到 ME endpoint 让 lead 流回 Kanban。
>
> **耗时**:Stage 1 全套 ~40 分钟(含 Formspree 注册 + Elementor 部署 + 7 占位符填值)。Stage 2 切换 5 分钟。
>
> **维护人**:FDE
>
> **关联代码**:
> - LP mockup: [`docs/mockups/oztop-quote-lp.html`](../mockups/oztop-quote-lp.html)
> - ME endpoint(Stage 2 用): `POST /api/clients/[id]/leads` ([source](../../src/app/api/clients/[id]/leads/route.ts))
> - Sanitize 规则: `src/lib/leads/sanitize.ts`

---

## 0 · 红线 — 部署目标必须是客户域名,不是 ME

LP **必须**部署在 `oztopbuildingsupplies.com.au/quote/`。**永远不要**部署在:
- `magicengine.com.au/oztop/...`
- `magicengine.com.au/quote/...`
- 任何 ME 域名子路径

理由见 [CLAUDE.md `🔴 客户业务/营销 LP 必须建在客户自己的域名`](../../CLAUDE.md)。

---

## 1 · 收集 7 个占位符的真实值(15 分钟)

打开 [`docs/mockups/oztop-quote-lp.html`](../mockups/oztop-quote-lp.html) 顶部注释里有清单。准备好以下 7 个值:

| 占位符 | 怎么填 |
|---|---|
| `{{OZTOP_PHONE}}` | 客户主电话(展示给 LP 访客)。**问 Oztop 老板**最近能值班的号 |
| `{{OZTOP_ABN}}` | 11 位 ABN(澳洲商业代码)。从 [abr.business.gov.au](https://abr.business.gov.au) 查 Oztop 公司名能拉到 |
| `{{OZTOP_ADDRESS}}` | 实体地址(展厅地址)。例 `Unit X, Slacks Creek QLD 4127` — 问老板 |
| `{{OZTOP_MAP_EMBED_URL}}` | Google Maps 地图嵌入 URL。**Maps → 找到客户位置 → Share → Embed a map → 复制 `src="..."` 里 URL** |
| `{{GOOGLE_RATING}}` | Oztop GMB 当前评分,如 `4.8`。打开 Google 搜 "Oztop Building Supplies" → 右侧 GMB 卡眼看 |
| `{{GOOGLE_REVIEW_COUNT}}` | Oztop GMB 评论数,如 `126`。同上 |
| `{{FORM_ENDPOINT_URL}}` | **Stage 1 先填 Formspree URL**(见下一步),Stage 2 切到 ME endpoint |

⚠️ **绝不编**:这 7 个值都是 Oztop 老板的运营事实,不能猜。猜错了 ABN 是法律风险,猜错电话客户失去 lead,猜错评分是品牌欺诈。**问老板**或在公开 Google 信息上眼看。

---

## 2 · Stage 1 · 注册 Formspree 拿 form ID(5 分钟)

Formspree = 第三方表单 webhook 服务,免费版每月 50 个 submission 够测转化。

1. 去 [formspree.io](https://formspree.io) 注册账号(用 FDE/Oztop 共用邮箱)
2. 点 **New Form** → 输 form name `oztop-quote` → 收件邮箱填 Oztop 老板邮箱(收 lead 通知)
3. 创建后得到 endpoint URL,形如 `https://formspree.io/f/xyz123abc`
4. **复制完整 URL,这是 `{{FORM_ENDPOINT_URL}}` 的值**

> 高级用法:Formspree 后台可以 enable Akismet 反 spam / 加 reCAPTCHA / 自定义 thank-you redirect。LP 自带 honeypot,Stage 1 可以不开 reCAPTCHA。

---

## 3 · 把 mockup 填好占位符(5 分钟)

打开 [`docs/mockups/oztop-quote-lp.html`](../mockups/oztop-quote-lp.html) 在文本编辑器(VS Code / Sublime / Notepad++)。

按 Ctrl+H 一次性 find-and-replace 全部 7 个占位符:

```
{{OZTOP_PHONE}}             →   07 3xxx xxxx          (你 Step 1 拿到的)
{{OZTOP_ABN}}               →   XX XXX XXX XXX
{{OZTOP_ADDRESS}}           →   Unit X, Slacks Creek QLD 4127
{{OZTOP_MAP_EMBED_URL}}     →   https://www.google.com/maps/embed?pb=...
{{GOOGLE_RATING}}           →   4.8
{{GOOGLE_REVIEW_COUNT}}     →   126
{{FORM_ENDPOINT_URL}}       →   https://formspree.io/f/xyz123abc   (你 Step 2 拿到的)
```

**case-photo 3 块占位**(灰色斜纹方块)— 上传 3 张真实施工案例图片到 WP Media Library,把 3 个 `<div class="case case--placeholder">...</div>` 替换成:
```html
<div class="case" data-caption="SPC plank — Wynnum reno"
     style="background-image:url('/wp-content/uploads/case-1.jpg')"></div>
```

⚠️ **不要用 stock 图** — 客户老板看到 stock 图会愤怒(发现你拿别人施工照片冒充)。**真实 Oztop 施工案例**,问展厅经理拿。

保存为 `oztop-quote-lp-final.html`(本地备份,跟 mockup 区分)。

---

## 4 · Stage 1 · Elementor 部署到 oztopbuildingsupplies.com.au/quote/(10 分钟)

1. 登录 WP admin: `https://oztopbuildingsupplies.com.au/wp-admin`
2. **Pages → Add New** → 标题填 `Get a Quote`(slug 自动变 `get-a-quote`,改成 `quote`)
3. 右上角 **Edit with Elementor** → 进入 Elementor 编辑器
4. **从左侧 widget 面板拖一个 "HTML" widget** 到页面 canvas 顶部全宽 section
5. **把 Step 3 改好的整个 HTML 文件内容粘贴到 HTML widget 的 HTML 框**(从 `<!doctype html>` 到 `</html>` 全部贴入)
6. 右下角 **Update / Publish**
7. 访问 `https://oztopbuildingsupplies.com.au/quote/` 看效果

### 关键 sanity check

| 检查 | 期望 |
|---|---|
| Hero 标题 | "Flooring, tiles & bathware done right — quote back to you in 1 business day." |
| 移动端(浏览器开发者工具切手机)| 单栏布局,表单在 hero 下方 |
| 3 信任格 | Transparent pricing / In stock / Expert installation 全显 |
| Google 评分 | 显示真实数字(不是 `{{GOOGLE_RATING}}`)|
| 底部 Google Map | 真实地图嵌入,不是空白 |
| ABN | 真实 11 位 |

### 如果布局崩了

- Astra / GeneratePress 等主题可能跟 mockup CSS 撞 → 把整个 HTML widget 包在 Elementor "Full Width" Section + 设 Padding/Margin = 0
- 如果**整页全大写** → 见 [docs/sops/](.) (待补) 或调 WP Customizer → Typography → Body → Text Transform = None
  (P12.R.A8 已在 ME 后台 publish 流程加预检警告,但 LP 不走 publish 路径,要手动验)

---

## 5 · Stage 1 · 测一次表单提交,确认 Formspree 收到(2 分钟)

1. 打开 LP `https://oztopbuildingsupplies.com.au/quote/`
2. 填 name=`Test FDE` / phone=`0400000000` / project_type=`Tiles` / 其它随便
3. 点 **Send quote request**
4. 看见绿色 "Thanks — your request is in"
5. 去 Formspree 后台 → form `oztop-quote` → 看到刚才那条提交
6. 收到老板邮箱的 Formspree 通知邮件(可能在 spam,加白名单 `noreply@formspree.io`)

✅ Stage 1 上线完成!FDE 可以观察 Formspree 后台 14 天看 lead 量 / 转化率。

---

## 6 · Stage 2 · 切到 ME endpoint(5 分钟,任何时候都能切)

**前置**:`leads` 表已 apply(✅ 2026-06-19 完成)+ POST `/api/clients/[id]/leads` 已上线(✅ PR #488 merged)。

**操作**:

1. 在 WP admin 找到 quote page → Elementor 编辑 → 找到 HTML widget
2. Find `https://formspree.io/f/xyz123abc` → Replace `https://app.magicengine.com.au/api/clients/d5c98811-1c1d-4ded-bdf0-4cefec6afb84/leads`
3. Update / Publish
4. 再做一次测试提交(Step 5 流程),验证:
   - LP 仍然显示绿色 "Thanks"
   - Formspree 后台 **不再** 出现新 submission(端点切走了)
   - ME 数据库 `leads` 表出现新行(用 Supabase Studio 或 ME admin MCP 查):
     ```sql
     SELECT id, name, phone, project_type, source_url, created_at
     FROM leads
     WHERE client_id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
     ORDER BY created_at DESC LIMIT 5;
     ```
5. 把这条 test row 标为 spam 后清掉:
   ```sql
   UPDATE leads SET status='spam' WHERE name='Test FDE' AND client_id='d5c98811-1c1d-4ded-bdf0-4cefec6afb84';
   ```

⚠️ Stage 2 切了之后:
- ME 后台 Kanban 未来上 "Lead" dimension(Phase 12.R 后续 PR)会自动 surface 新 lead
- 老 Formspree submission 不会自动迁移 — 如有需要 FDE 手工 export Formspree CSV 后 SQL 导入 leads

---

## 7 · 常见排错

| 现象 | 排查 |
|---|---|
| 提交后红色错误 "Could not send" | 看浏览器 DevTools Console 看 fetch 错误。CORS 拒绝 → 检查 LP 域名是否匹配 `clients.domain` 的 apex / www |
| Stage 2 切完后 ME 没收到 | 检查 endpoint URL 准确 + 客户 IP 是否被 Render edge 抓到(看 ME 日志 `[leads POST] ...`)|
| 429 RATE_LIMITED | 60 秒 5 次限额触发。等 1 分钟或换 IP。如果是 FDE 测试拖到 5+ 次,正常 |
| Formspree 邮件进 spam | 加白名单 `noreply@formspree.io` |
| LP 移动端布局崩 | 看是不是 WP 主题 wrap 了多余 div。改 HTML widget 包在 Elementor Full-Width Section + 0 padding |
| 老板说 ABN 写错了 | 立刻改(法律风险)。Find `{{OZTOP_ABN}}` 已替换值 → Replace |

---

## 8 · 完工 checklist

部署完打钩,贴到 Oztop FDE 笔记里:

- [ ] 7 占位符全部用**真实数据**填(无猜值)
- [ ] 3 张 case 图换成**真实** Oztop 施工照
- [ ] LP URL 在 oztopbuildingsupplies.com.au/quote/(不在 ME 域名)
- [ ] Hero / 3 信任格 / 评分 / Map / ABN 视觉正常
- [ ] 移动端布局单栏
- [ ] 表单提交 → Formspree 收到(Stage 1)或 leads 表新行(Stage 2)
- [ ] LP 已在 GA4 配 `generate_lead` 自定义 event 跟踪(LP 自带 `gtag('event','generate_lead')`,确认 GA4 容器/Tag Manager 接好)
- [ ] (Stage 2)把 ME endpoint URL 记到 LP 文档,以便日后改
