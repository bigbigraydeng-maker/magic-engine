# Magic Picks — PageFly 首页 施工清单

- **日期**：2026-08-30（v2：取消 "Jing's Pick" 人设，改 Magic Picks 品牌口吻）
- **owner**：Claude Code 起草施工清单 · PM/FDE 在 PageFly 拖拽编辑器里施工
- **目标页面**：Shopify **Home Page**（当前首页由 Craft 主题原生渲染，只有 hero + 产品网格 + newsletter + footer 5 段，PM 反馈"还是太简单"）
- **为什么手动**：PageFly 无对外 API/MCP，页面数据存在 PageFly 自己的系统里，只能在其编辑器内拖拽构建（跟椅子详情页同一套工具，见 [2026-08-28-pagefly-chair-landing-brief.md](2026-08-28-pagefly-chair-landing-brief.md)）
- **不改的部分**：Craft 主题的 hero banner + 产品网格已验证正常渲染，**不要删**，PageFly 只负责在下面加内容段

---

## 开工前

1. Shopify Admin → Apps → **PageFly** → 打开
2. 左侧找 **Home Page**（不是 Product Pages）→ **Edit with PageFly**
3. 若提示"当前首页由主题渲染，是否用 PageFly 接管"：选**接管并保留现有 hero + 产品网格**（PageFly 支持在已有内容基础上追加区块；若编辑器强制整页重建，则把下面①②两段也搭进去，内容与现状一致即可）

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
| 标题字体 | Noto Serif |
| 正文字体 | Noto Sans |
| 圆角 | 按钮/卡片用 12px，大容器用 20px |

---

## 施工清单（在现有 hero + 产品网格下方，按顺序拖）

### ① Hero（现状保留，不动）

现在已经是：标题 "Hand-picked, shipped from Auckland." + 副标题 "No dropship guesswork, no 30-day wait — just things worth having, sent fast from Mt Wellington." + CTA "Shop the collection"。**跳过，不重做。**

### ② 产品网格（现状保留，不动）

现有 "All Products" 系列网格已渲染 7 个真实产品（1 把椅子 + 6 个 DZ 精选品）。**跳过，不重做。**

### ③ 信任信号带

- **组件**：PageFly "Icon List" 一行 4-5 个
- 📦 Ships from Auckland — no wait
- ↩️ 14-day returns（unopened）
- 🛡️ 12-month warranty
- 🚚 Free NZ shipping over NZ$110
- ✅ Hand-picked, quality-checked

### ④ 品牌故事

- **组件**：PageFly "Image + Text"（图片暂用产品占位图或纯色 `#1F3B4D` 背景，等仓库实拍照片）
- **标题**（Noto Serif）：
  ```
  Every product in this store is tested and approved
  before it goes in the Mt Wellington warehouse.
  ```
- **正文**：
  ```
  No dropship guesswork — just things worth having, sent fast.
  This isn't a catalogue of everything on the internet. It's what
  we'd actually put in our own home.
  ```

### ⑤ 更多品类

- **组件**：PageFly "Collection List" 或 "Multi Column"，链接到 "All Products" 系列（handle `frontpage`）里的不同品类
- **标题**：`More than chairs`
- **说明**：从产品网格里挑 3-4 个非椅子品类做卡片（图用各产品已上传的主图），每张卡片点击跳产品详情页

### ⑥ FAQ

- **组件**：PageFly "Accordion / FAQ"
- 6 条（跟椅子详情页 FAQ 一致，见 [2026-08-28-pagefly-chair-landing-brief.md](2026-08-28-pagefly-chair-landing-brief.md) 第⑦段）：
  1. How fast does it ship? → Same day if ordered before 12pm Auckland time
  2. Do I need to assemble it? → Depends on the item — assembly instructions included where needed
  3. What if I don't like it? → 14-day returns on unopened items
  4. What if something breaks? → 12-month warranty
  5. How do I pay? → Apple Pay / Google Pay / card / Shopify Pay Installments
  6. Do you deliver outside Auckland? → Yes, NZ-wide, free over NZ$110

### ⑦ 品牌收尾

- **组件**：PageFly "Text Block"（普通 Noto Serif 正文，不用签名字体）
- **文案**：
  ```
  We only stock things we'd put in our own home.
  If it wouldn't hold up for our family, we don't sell it.
  ```

### ⑧ Newsletter（现状保留，不动）

现有 Craft footer 的 newsletter 段已经在跑（"Know when we've picked something new"）。**跳过，不重做。**

---

## 施工后检查

- [ ] 手机预览（PageFly 编辑器右上角切 Mobile 视图）
- [ ] hero + 产品网格没被误删或重复
- [ ] 全部文案跟椅子详情页/footer 已有文案一致，不要两处打架
- [ ] 颜色跟上面色表对照无跑偏
- [ ] 全文没有 "Jing" 字样残留（人设已取消，改 Magic Picks 品牌口吻）
- [ ] Publish（PageFly 页面右上角独立 Publish 按钮，跟 Shopify 主题 Publish 是两回事）

---

## 后续

- 完成后回一句，我用真实 curl（非登录预览）核实首页渲染正常
- 品牌故事段等仓库真实照片到位后替换占位图
