# Magic Lab Class · 会员说明 Deck

16 页会员体系说明演示文稿（澳新华人 AI 商业增长生态），从 Claude Design 手稿落地的可演示版本。
深蓝学院色 + 电光蓝渐变、四角星 ✦ 火花、双峰山形标水印、蓝色吉祥物，Poppins + 思源黑体；
入场上滑 + 吉祥物漂浮 + 火花闪烁动效，体现 AI 公司活力。

## 文件

| 文件 | 用途 |
|------|------|
| `index.html` | 演示主文件。`<deck-stage>` web component + 16 张 `<section>` 幻灯片。引用本地 `deck-stage.js`、`assets/`、`vendor/`。 |
| `deck-stage.js` | 幻灯片运行时（键盘 ←/→ 翻页、缩略图栏、打印一页一张、自动缩放）。vendored，勿改。 |
| `vendor/lucide.min.js` | 线性图标库（lucide 0.460.0），本地化，无 CDN 依赖。 |
| `vendor/fonts/poppins-*.woff2` | Poppins 拉丁字体（4 字重），供离线版内联。 |
| `assets/*.png` | 山形标、吉祥物三种姿势、徽章。 |
| `assets/bg-{cover,founder,cta}.jpg` | 深色页背景大图（城市夜景 / 地球夜光网络）。统一叠 navy 渐变遮罩，只用于封面 / 创始人 / CTA 三张深色页。 |
| `build-offline.mjs` | 构建脚本：把上述全部内联成单文件离线版。 |
| `MagicLabClass-会员说明-offline.html` | **离线单文件交付物** —— 图片 / 字体 / 图标 / 运行时全部内联，无网络可直接打开演示。 |
| `serve.py` | 本地静态预览服务器（`python3 serve.py` → http://127.0.0.1:8799）。 |

## 本地预览

```bash
# 方式一：随 Next.js 一起（推荐）
npm run dev
# 打开 http://localhost:3001/decks/magic-lab-class-membership/index.html

# 方式二：独立静态服务器
python3 public/decks/magic-lab-class-membership/serve.py
# 打开 http://127.0.0.1:8799/index.html
```

翻页：底部「上一页 / 下一页」按钮、`←` / `→` / 空格、或左侧缩略图栏点击。按 `P`（浏览器打印 → 另存为 PDF）导出一页一张的 PDF。

## 重新生成离线单文件

修改 `index.html` 后，重建离线版：

```bash
node public/decks/magic-lab-class-membership/build-offline.mjs
```

脚本会把 `assets/`、`vendor/lucide.min.js`、`deck-stage.js`、Poppins 字体全部内联为 data URI / 内嵌脚本。
中文字体走系统字体回退（macOS 苹方 / Windows 微软雅黑 / Noto Sans SC），故离线版无需内联庞大的 CJK 字体。

## 背景大图

封面 / 创始人 / CTA 三张深色页加了全幅背景大图（城市夜景 + 地球夜光城市网络），统一压暗并叠
品牌 navy 渐变遮罩（文字侧 ~95% 不透明、开阔侧 ~58% 透出城市），保证文字 / 吉祥物清晰、不抢
Magic Lab Class 主角地位。图片来自 **Unsplash（Unsplash License，可免费商用、无需署名）**，已下载内联，
无运行时外链。换图：替换 `assets/bg-*.jpg` 后 `node build-offline.mjs` 重建即可；遮罩浓淡在
`index.html` 对应 `<section>` 的 `background:linear-gradient(... rgba ...)` 里调。

> 注：图片生成 MCP（Higgsfield）需付费套餐，当前账号不可用，故改用 Unsplash 实拍图。若后续要 AI
> 定制生成的纯品牌色背景，可在开通套餐后用 `soul_location` 模型重做。

## 客户案例（已匿名 · 真实数据）

案例页用 CTS（某头部旅行社）+ Oztop（某地板公司）两个真实客户，**已隐去客户名称**，
数字均为平台真实快照（GSC / GA4，截至 2026-06-05），围绕 **客群 / 流量 / 社媒** 三维呈现：
- 某头部旅行社：NZ 出境游 · 月自然曝光 48,256 · 月点击 616 · 月会话 525 · FB 五周节奏投放
- 某地板公司：布里斯班+黄金海岸 · 24 篇 SEO 内容 · 月自然曝光 7,006 · FB/IG/TikTok 三波战役

> ⚠️ 数据均为「平台真实快照 / 已搭建的数字化资产」，**不是夸大的"提升后"结果**——遵守
> 「绝不凭空注入客户业务数据」红线。若要加"提升 X%"类结果，须等真实 before→after 数据落地。

## 待补充（占位符已就位）

- **创始人照片**：把照片存到 `assets/founder.jpg`（竖图 3:4 最佳），告诉我，我把占位框换成真照片并重建。
- 价格 / 权益如有调整，改 `index.html` 后 `node build-offline.mjs` 重建离线版即可
