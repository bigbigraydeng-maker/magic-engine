# 部署到 Cloudflare Pages

`dist/` 里有 **3 个文件**，上传时**整个 `dist` 文件夹一起拖**：
- `index.html` —— 自包含的整套 deck（图片/字体/图标/运行时全内联）
- `og.jpg` —— 分享卡片缩略图（微信/社交平台抓这张）
- `_headers` —— 基础缓存头

> ⚠️ 项目名建议用 `magic-lab-class`，这样默认域名 `magic-lab-class.pages.dev` 正好对上
> `index.html` 里写死的 `og:image` / `og:url`。**若你改了项目名或绑了自有域名**，记得把
> `index.html` 里两处 `https://magic-lab-class.pages.dev` 换成真实域名 → `node build-offline.mjs`
> → `cp` 到 `dist/`，否则微信卡片缩略图会拉不到。

---

## 方式 A · 控制台拖拽上传（推荐，零工具，2 分钟）

1. 打开 <https://dash.cloudflare.com> → 左侧 **Workers & Pages**
2. **Create** → 选 **Pages** 标签 → **Upload assets**
3. 项目名填：`magic-lab-class`（决定默认域名 `magic-lab-class.pages.dev`）
4. 把本目录下的 **`dist` 文件夹**整个拖进上传框 → **Deploy site**
5. 完成后得到公开链接：`https://magic-lab-class.pages.dev`

> 之后要更新：改 `index.html` → `node build-offline.mjs` → 重新 `cp` 到 `dist/` → 再拖一次（或用方式 B 一行命令覆盖）。

---

## 方式 B · 命令行（你本机有 node 时，一行搞定）

```bash
cd public/decks/magic-lab-class-membership
npx wrangler login                    # 首次：浏览器授权 Cloudflare（仅一次）
npx wrangler pages deploy dist --project-name=magic-lab-class
```

输出里会给一个 `https://magic-lab-class.pages.dev`（及本次部署的预览 URL）。
重新部署只需再跑最后一行。

---

## 自定义域名（可选）

Pages 项目 → **Custom domains** → 添加你的域名（如 `deck.magiclab.com`），
按提示在 DNS 加一条 CNAME 即可。

## 微信分享卡片（重要 · 请先读）

链接在微信里显示成卡片，靠的是页面 `<head>` 的 **Open Graph** 标签（标题 + 描述 + 缩略图）——
这些**已经加好了**，缩略图是品牌卡 `og.jpg`（`og-card.html` 是它的源文件，改了用 macOS 的
`qlmanage -t -s 1200 -o . og-card.html` 重渲染 → `sips -s format jpeg` 转 jpg）。

**但有一个现实要知道**：`xxx.pages.dev` 是**海外、无 ICP 备案**域名。在大陆微信里：
- 可能弹「非微信官方网页」提示，或加载较慢（Cloudflare 海外节点）；
- 卡片缩略图有时会被微信吞掉、只剩标题。

**想要稳定又好看的微信卡片，按可靠度排序：**
1. **绑已备案的自有域名**（Pages → Custom domains）——卡片 + 大陆加载都最稳。记得同步改
   `index.html` 里的 `og:image` / `og:url` 为该域名并重建。
2. **放进公众号图文**——分享出来是微信**原生完美卡片**（最推荐给大陆传播）。
3. **直接发 PDF / 长图**——deck 里按 `P` 导出一页一张的 PDF，微信发文件，零依赖。

> 已加的 og 标签在**微博 / Telegram / iMessage / LinkedIn / X(Twitter)** 等都会正确显示大图卡片。
> 部署后可用 <https://cards-dev.twitter.com/validator> 或各平台调试器预览卡片效果。

## 说明

- 中文走系统字体（苹方/微软雅黑/Noto Sans SC），公网访客的 Win/Mac 都自带，显示正常。
- `dist/_headers` 已设基础缓存 + `X-Content-Type-Options`，可按需调整。
- 我（当前环境）无 node、无 Cloudflare 凭证，无法代跑部署命令；上面两条都由你在本机/控制台执行。
  若你愿意提供 Cloudflare API Token + Account ID（且本机有 node），我可以帮你把命令跑通。
