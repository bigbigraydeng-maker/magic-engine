---
name: deploy-deck
description: >-
  把 synthesize-deck 生成的中文 HTML deck 部署到 Cloudflare Pages · 出一个可分享给客户的
  正式 https:// 链接。Use when: 用户说「部署 deck / deploy / 上线 / 给我一个链接 / 发布 /
  publish / share 给客户」。前置：/synthesize-deck 已在 docs/clients/{slug}/deck/{date}/
  产出 index.html + _headers。要求本机装了 wrangler + 登录了 Cloudflare 账户。
---

# /deploy-deck — Cloudflare Pages 部署

把客户 deck 部署到 Cloudflare Pages · 拿到 `https://{slug}-plan.pages.dev` 这类可分享链接。
复用 Roman Hu 案例走通的部署路径。

---

## 前置条件

- [ ] `/synthesize-deck` 已跑，`docs/clients/{slug}/deck/{latest-date}/index.html` 存在
- [ ] 本机装了 `wrangler`（`npx wrangler --version` 能返回版本）
- [ ] Cloudflare 账户已登录（`npx wrangler whoami` 显示 email + account id）
  - 若未登录 → 先跑 `npx wrangler login`
- [ ] Cowork 模式 → 部署权限可能只在 admin（用户）手上 · 同事需要走 sync-back-to-admin 流程

---

## 执行流程

### 1. 定位输入

- 用户给了 `{slug}` → 找 `docs/clients/{slug}/deck/{latest-date}/`（如有多个日期，用最新）
- 未给 → 列出 `docs/clients/*/deck/` 让用户选

### 2. 确认项目名

- 默认：`{slug}-plan`（如 `roman-hu` → `roman-hu-plan`）
- 用户可覆盖：`/deploy-deck {slug} --project=custom-name`
- **check**：先跑 `npx wrangler pages project list --json | grep {project-name}` 看是否已存在
  - 已存在 → 直接 deploy 覆盖
  - 不存在 → 先 `npx wrangler pages project create {project-name} --production-branch=main`

### 3. 部署

```bash
npx wrangler pages deploy docs/clients/{slug}/deck/{latest-date}/ \
  --project-name={project-name} \
  --branch=main \
  --commit-dirty=true
```

拿到两个 URL：
- Production：`https://{project-name}.pages.dev`
- Preview：`https://{hash}.{project-name}.pages.dev`（本次部署的唯一版本）

### 4. 验证

跑 3 秒健康检查：
```bash
sleep 8 && curl -sI https://{project-name}.pages.dev | head -5
curl -s https://{project-name}.pages.dev | grep -o '<title>[^<]*</title>'
```

期望：HTTP 200 + 正确 title。

### 5. 输出给用户

```
部署完成 ✅

🔗 正式链接：https://{project-name}.pages.dev
🔗 本次预览：https://{hash}.{project-name}.pages.dev
📊 大小：{XX} KB · HTTP 200

分享给客户的话术骨架：

> {客户姓名}，这是我为你做的 90 天战略提案：https://{project-name}.pages.dev
>
> 你先浏览器打开看，重点看**第二章竞争白地图**+ **第肆章处方**。
>
> 看完给我反馈，我们下周约 30 分钟对齐 v2 落地。

后续升级选项：
- 换 magicengine 子域名：`Cloudflare Pages Dashboard → Custom domains`
- 迭代 v2：改完 HTML 再跑 /deploy-deck · 客户端 URL 不变
- 导出 PDF：浏览器打开 → Cmd+P → Save as PDF
```

---

## 隐私默认

- Deck HTML 里已加 `<meta name="robots" content="noindex, nofollow">` · Google 不收录
- `_headers` 里 `X-Robots-Tag: noindex, nofollow` 加固
- 但**任何人凭链接都能看** · 客户名 / 竞对分析全部公开 · 别把 URL 发到公开渠道
- 需要更严 → Cloudflare Access 加一层密码保护（`wrangler pages access` · 手工配）

---

## Cowork 模式差异

Cowork 里跑 wrangler 有几种可能：
- **有 wrangler MCP 且已 auth** → 正常跑
- **无 wrangler MCP** → skill 打包本地 zip 让用户下载 · 提示"请在 Claude Code 或直接 dashboard 上传"
- **权限只在 admin（用户）** → 同事跑本 skill 时 sync HTML 到共享 workspace + 通知 admin 手动 deploy

Phase 1 后：ME 后台 `/dashboard/clients/{id}/deck/deploy` UI 一键触发 · 不需要本地 wrangler。

---

## 未来 ME 兼容

Phase 2 后，deploy-deck 走 ME 后台 `/api/deploy/pages` endpoint · 统一部署管道：
- 域名策略：`plan.magicengine.com.au/{client-slug}/{YYYY-MM-DD}/`
- 版本管理：ME 后台记录所有历史 deploy
- 权限：只有客户 owner FDE 能触发
