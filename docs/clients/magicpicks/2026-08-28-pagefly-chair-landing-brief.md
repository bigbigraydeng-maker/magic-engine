# Magic Picks — PageFly 椅子 Landing 施工清单

- **日期**：2026-08-28
- **owner**：Claude Code 起草施工清单 · PM 在 PageFly 拖拽编辑器里施工
- **目标页面**：`Magic Picks Ergonomic Chair`（product handle `magic-picks-ergonomic-chair`，Product ID `10517670986003`）
- **为什么手动**：PageFly 无对外 API/MCP，页面数据存在 PageFly 自己的系统里，只能在其编辑器内拖拽构建
- **VI 来源**：`docs/clients/magicpicks/vi/tokens.json`（Claude Design 2026-08-28 交付）

---

## 开工前

1. Shopify Admin → Apps → **PageFly** → 打开
2. **Product Pages** → 找到 `Magic Picks Ergonomic Chair` → **Edit with PageFly**
3. 若跳模板选择页：选一个 **"Hero + Feature List + FAQ"** 类模板起步（省排版时间），不要选"多品类目录"模板

---

## 品牌值（施工时随时对照）

| 用途 | 值 |
|---|---|
| 主文字色 / 边框 | `#1F3B4D`（Harbour Ink 深海军蓝）|
| CTA 按钮 / 强调色 | `#C15B3A`（Warm Clay 陶土橘）|
| 次要点缀 | `#8C5B6B`（Twilight Mauve）|
| 页面背景 | `#FBF6EF`（Warm Cream 暖奶白）|
| 卡片/区块背景 | `#FFFFFF` |
| 边框/分隔线 | `#E7DDD0` |
| 正文文字 | `#241F1B` |
| 次要文字 | `#6E6459` |
| 标题字体 | Noto Serif（PageFly 字体库搜 "Noto Serif" 直接选）|
| 正文字体 | Noto Sans |
| 圆角 | 按钮/卡片用 12px，大容器用 20px |

---

## 8 段施工清单（按顺序从上往下拖）

### ① Hero

- **组件**：PageFly "Hero Banner" 或 "Image + Text"
- **背景**：暂用产品占位图（等仓库实物图替换）或纯色 `#1F3B4D` 深蓝背景
- **标题**（Noto Serif, 深蓝或白字取决于背景）：
  ```
  Auckland's chair, ready to sit on.
  ```
- **副标题**：
  ```
  Height adjustable. Reclines when you need it to. Ships from Mt Wellington — no 30-day wait.
  ```
- **价格标签**：`NZ$119`
- **CTA 按钮**（Warm Clay `#C15B3A` 背景，白字）：`Add to Cart`

### ② 痛点

- **组件**：PageFly "Text Block" 居中
- **文案**：
  ```
  Your desk chair should support you for the next ten years —
  this one does, without the $500 price tag.
  ```

### ③ 产品实拍（等仓库实物图片）

- **组件**：PageFly "Image Gallery" 或 "Slider"
- **占位说明**：现在放 1 张产品占位图 + 一行文字 `[Real photos from our Mt Wellington warehouse coming soon]`
- 收到仓库实拍图后替换（5-8 张：主图/侧面/后背/扶手/底轮/细节）

### ④ 规格 + 差异化对比

- **组件**：PageFly "Comparison Table" 或 "Feature List"
- **两列对比**：
  | | Magic Picks | Sihoo NZ |
  |---|---|---|
  | 发货地 | Auckland（本地）| 跨境 |
  | 到货时间 | 1-2 天 | 数周 |
  | 价格 | NZ$119 | 更贵 |
  | 品控 | 到货前逐件检查 | 无 |

### ⑤ 信任信号带

- **组件**：PageFly "Icon List"（4-5 个图标一行）
- 📦 Ships from Auckland — no wait
- ↩️ 14-day returns（unopened）
- 🛡️ 12-month warranty
- 🚚 Free NZ shipping over NZ$110
- ✅ Hand-picked, quality-checked

### ⑥ 社会证明

- **组件**：PageFly "Quote / Testimonial Block"
- **文案**（斜体，Noto Serif）：
  ```
  "Same chair. Same price. 30 already sold via Facebook
  Marketplace to Auckland buyers — now on the storefront
  so you can check out with Apple Pay."
  ```

### ⑦ FAQ

- **组件**：PageFly "Accordion / FAQ"
- 6 条（跟 Shopify product description 里的保持一致，见 `docs/clients/magicpicks/2026-08-27-shopify-policies-draft.md`）：
  1. How fast does it ship? → Same day if ordered before 12pm Auckland time
  2. Do I need to assemble it? → ~15 min, one person, tools included
  3. What if I don't like it? → 14-day returns on unopened items
  4. What if something breaks? → 12-month warranty
  5. How do I pay? → Apple Pay / Google Pay / card / Shopify Pay Installments
  6. Do you deliver outside Auckland? → Yes, NZ-wide, free over NZ$110

### ⑧ 品牌收尾 + 最终 CTA

- **组件**：PageFly "Text Block"（普通 Noto Serif 正文，不用签名字体）
- **文案**：
  ```
  We only ship things we'd put in our own home.
  If it wouldn't hold up for our family, we don't stock it.
  This chair is one of them.
  ```
- **最终 CTA**：大按钮 `Add to Cart`（Warm Clay 背景）

---

## 施工后检查

- [ ] 手机预览（PageFly 编辑器右上角切 Mobile 视图）—— 首屏 3 秒内看到：图/视频 + 一句 promise + 一个 CTA
- [ ] Hero CTA 点击能加购物车
- [ ] 全部文案跟 Shopify product description 一致（不要两处文案打架）
- [ ] 颜色跟上面色表对照无跑偏
- [ ] Publish（PageFly 页面右上角有独立的 Publish 按钮，跟 Shopify 主题 Publish 是两回事）

---

## 后续

- 完成后回一句，我用 MCP 核实产品页 URL 渲染正常
- 若要给第二个 SKU（腰垫等）建同款 landing，PageFly 支持"Duplicate as Template"，不用重新施工
