# Oztop Reel 1 — Seedance Video Generation Prompt (AI + 实拍 mix 修订版)

> **Reel 主题**：$35.50/m² Elegant Walnut 价格攻击
> **生成日期**：2026-06-09（v1 纯 AI）→ 2026-06-09（v2 AI + 实拍 mix · 当前）
> **目标平台**：Facebook + Instagram Reels（9:16 vertical, 15s）
> **生产路线**：
> - **A 路（AI 素材）**：ChatGPT Image 2.0 生成图卡 + Seedance 2.0 I2V 驱动动画
> - **B 路（客户实拍）**：客户用手机/工地相机拍摄 → 上传 Google Drive → PM 下载 → CapCut/Premiere 剪辑
> - **C 合成（PM 操作）**：A 路 graphic card + B 路实拍片段，按下方分镜表交叉剪辑
> **来源**：`clients/oztop/Oztop_Wave1_Content.md` REEL 1 段（PM 2026-06-09 确认对齐 Goal O1 + O5）

---

## v1 → v2 改动概要（PM 关心的差异）

| 维度 | v1（纯 AI） | v2（AI + 实拍 mix · 当前） |
|---|---|---|
| 视觉来源 | 9 格全 AI（Seedance I2V） | 5 格实拍（客户提供）+ 4 格 AI 字卡/品牌 |
| 真实感 | 中（AI 木纹易塑料感） | 高（真实工地 + 真实仓库）|
| 视觉冲击 | 一致但可能"假" | 实拍接地气 + AI 字卡冲击 |
| 工期 | Seedance 1 次出片 | 客户拍摄 + PM 剪辑 |
| 风险 | AI 渲染失真 | 客户拍摄延迟 / 画质不够 |
| 兜底 | — | 24h 内素材没到 → 回退纯 AI（见 publer-schedule.md）|

---

## 9 格分镜表（AI vs 实拍 标注 · 这是核心交付）

| # | 镜头主题 | 来源 | 时长 | 内容 |
|---|---|---|---|---|
| **1** | Sample Drop（产品样品放置）| 🎥 **客户实拍** | 1.5s | 手放下 Elegant Walnut 样品到展厅台面，木纹特写 |
| **2** | Installed Room Overview（完工房间俯视）| 🎥 **客户实拍** | 1.5s | 真实完工 Brisbane 家庭客厅俯视，木地板满铺 |
| **3** | Grain Detail（木纹特写）| 🤖 **AI 生成**（或客户实拍二选一）| 1s | 木纹超近拍，年轮细节 |
| **4** | Barefoot Warmth（光脚踩地板）| 🎥 **客户实拍** | 1s | 光脚（脚踝以下）踩在木地板上 |
| **5** | **HERO — Price Comparison Card** | 🤖 **AI 字卡**（Canva / ChatGPT Image）| 2s | 左 `$55–70/m²` 右 `$35.50/m²` 对比 |
| **6** | Warehouse Supply Chain（仓库供应链）| 🎥 **客户实拍** | 1.5s | Oztop 真实仓库内景，货架 + 产品包装堆叠 |
| **7** | Professional Install（专业安装）| 🎥 **客户实拍** | 1.5s | 工人手部（无正脸）测量/安装地板 |
| **8** | Clearance Deadline Card（截止字卡）| 🤖 **AI 字卡** | 1s | `2,000m² · Ends 30 June · DM for quote` |
| **9** | Brand End Card（品牌结尾）| 🤖 **AI 字卡** | 3s | Big Panda + Oztop + Licensed & Insured + 07 3416 6458 |

**实拍占比**：5/9 镜头（约 6.5s 实拍 + 6s AI 字卡/动画 + 3s 品牌静帧 = 15.5s 微调至 15s）

---

## A 路 — AI 字卡生成（Scene 5 / 8 / 9 + 备选 Scene 3）

### 工具
- **ChatGPT Image 2.0** 生成静态字卡（最快 · 推荐）
- **Canva 模板** 也行（PM 更熟）
- **Seedance 2.0 I2V** 仅用于 Scene 3 木纹特写（如果客户拍不到合格的）

### A1. Scene 5 — HERO 价格对比字卡 提示词

```
Create a single 9:16 vertical graphic card for a social media Reels video.

CANVAS: 1080×1920 pixels, solid dark charcoal background (#1a1a1a).

LAYOUT:
- Top third: small white sans-serif text "Same product. Different supply chain."
- Middle (centered, dominant):
  - Left column header: "Retail Chains" in white sans-serif
  - Left column price: "$55–70/m²" in white, large bold sans-serif
  - Vertical thin green divider (#2d7a3a) in middle
  - Right column header: "Oztop Big Panda" in white sans-serif
  - Right column price: "$35.50/m²" in bold green (#2d7a3a), even larger than left price
- Bottom third: small white sans-serif text "Elegant Walnut 15mm engineered timber"

TYPOGRAPHY: Clean modern sans-serif (Inter / Helvetica). No serifs. No decorative fonts.
NO PHOTOGRAPHY. NO ILLUSTRATIONS. Pure typographic card.
NO Chinese characters. English only.
Output: 9:16 vertical, high resolution PNG.
```

### A2. Scene 8 — 截止日期字卡 提示词

```
Create a single 9:16 vertical graphic card for a social media Reels video.

CANVAS: 1080×1920 pixels, solid dark charcoal background (#1a1a1a).

LAYOUT (top to bottom, centered):
- Large white sans-serif: "2,000m²"
- Below in bold green (#2d7a3a): "Ends 30 June"
- Smaller white sans-serif below: "DM for same-day quote"

TYPOGRAPHY: Clean modern sans-serif. Tight line spacing. High contrast.
NO PHOTOGRAPHY. Pure typographic card.
NO Chinese characters. English only.
Output: 9:16 vertical, high resolution PNG.
```

### A3. Scene 9 — Brand End Card 提示词

```
Create a single 9:16 vertical brand end card for a social media Reels video.

CANVAS: 1080×1920 pixels, solid dark charcoal background (#1a1a1a).

LAYOUT (top to bottom, all centered):
- Simple white panda silhouette icon (minimal geometric, not photorealistic)
- Large white sans-serif: "BIG PANDA FLOORING"
- Smaller white text: "Oztop Building Supplies"
- Thin horizontal green divider line (#2d7a3a), narrow width
- White small text: "Licensed & Insured"
- Green (#2d7a3a) smaller text: "Own supply chain — no middleman markup"
- White smallest text at bottom: "Same-day quote · Brisbane + Gold Coast · 07 3416 6458"

TYPOGRAPHY: Clean modern sans-serif. Generous vertical spacing. Professional.
NO PHOTOGRAPHY. NO FACES. Pure typographic / iconographic card.
NO Chinese characters. English only.
Output: 9:16 vertical, high resolution PNG.
```

### A4.（备选）Scene 3 — 木纹特写 Seedance I2V 提示词（仅在客户拍不到时启用）

```
Animate a static macro photo of Elegant Walnut engineered timber surface into a 1-second 9:16 vertical clip.

ANIMATION: Ultra-slow horizontal glide across the wood grain, left to right.
DURATION: 1 second.
NO ZOOM. NO ROTATION. NO COLOR SHIFT.
PRESERVE: Original wood grain detail, warm amber tones, natural matte sheen.
NO TEXT OVERLAYS. NO WATERMARKS.
Output: 9:16 vertical MP4, highest resolution.
```

---

## B 路 — 客户实拍镜头清单

**详见 `client-shooting-list.md`** — 给客户的拍摄清单（机位 / 时长 / 光线 / 不可妥协项）。

PM 把 `client-shooting-list.md` 文件 PDF 化 / 截图后微信发给 Oztop 老板，让他按清单拍。

---

## C 合成 — PM 剪辑操作流程（CapCut / Premiere）

### 步骤

1. **下载素材**
   - A 路：从 ChatGPT Image 下载 3 张 PNG 字卡（Scene 5 / 8 / 9）
   - B 路：从 Google Drive 客户文件夹下载 5 个实拍视频片段（Scene 1 / 2 / 4 / 6 / 7）
   - 备选：A4 Seedance 木纹 MP4（仅 Scene 3）

2. **建工程**
   - CapCut/Premiere 新建 9:16 vertical 1080×1920 工程
   - 15 秒 timeline，30fps

3. **按分镜表排列**
   - 0.0–1.5s: Scene 1（实拍 sample drop）
   - 1.5–3.0s: Scene 2（实拍房间俯视）
   - 3.0–4.0s: Scene 3（实拍木纹特写 或 AI 备选）
   - 4.0–5.0s: Scene 4（实拍光脚）
   - 5.0–7.0s: Scene 5（**HERO 字卡** · 文字逐元素 fade in：左价 → 右价 → 底部说明）
   - 7.0–8.5s: Scene 6（实拍仓库）
   - 8.5–10.0s: Scene 7（实拍安装）
   - 10.0–11.0s: Scene 8（截止字卡 · 文字 snap in）
   - 11.0–14.0s: Scene 9（品牌字卡 · 静帧 3s）
   - 14.0–15.0s: 黑场淡出

4. **转场**
   - 全程 hard cut（无 dissolve）
   - 例外：Scene 4 → 5 用 wipe 强调"产品 → 价格逻辑"切换
   - Scene 8 → 9 用 slow fade

5. **调色**
   - 实拍镜头统一 warm amber LUT（CapCut 内置"温暖"或自定义 +5 暖色 +3 饱和度）
   - AI 字卡保持纯色不调
   - 实拍 vs AI 字卡之间不平滑过渡 — 这个对比本身就是 Brisbane trade honest 风格

6. **音乐**
   - 留白 OR 加 royalty-free upbeat trade track（CapCut "Renovation / Construction" 类目）
   - 音量低 -18dB，不喧宾夺主

7. **导出**
   - 文件名：`2026-06-09-reel1-walnut-price-attack-FINAL.mp4`
   - 编码：H.264 / 高比特率 / 30fps
   - 上传到 Publer（详见 `publer-schedule.md`）

---

## 不可妥协项（PM 出片前自检）

- [ ] **绝无人脸正面**（实拍镜头出现脸 → 剪掉或模糊）
- [ ] **Big Panda + Oztop logo 在 Scene 9 出现**
- [ ] **联系电话 07 3416 6458** 出现在 Scene 9
- [ ] **价格 $35.50/m² 数字精确**（Scene 5）
- [ ] **促销截止 "Ends 30 June"**（Scene 8）
- [ ] **2,000m² 库存数字**（Scene 8）
- [ ] **15 秒总时长**（不要 16s/30s）
- [ ] **9:16 vertical**（不要 1:1 / 16:9）
- [ ] **实拍镜头无 LOGO 水印** / 无第三方品牌（Bunnings 包装、其他厂牌产品）
- [ ] **实拍画面无客户私人信息**（孩子脸、地址、车牌）
- [ ] **音乐如有版权**（CapCut 自带的版权安全，自带库外的需确认）

---

## 备选方案：如果 24h 内客户素材没到

回退到 v1 **纯 AI 方案**（保留在 git 历史 `git log seedance-prompt.md` 可恢复）。流程在 `publer-schedule.md` 的 "素材 ETA & 兜底" 段落。
