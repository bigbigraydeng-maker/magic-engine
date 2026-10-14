
## 12. v3（按苏东坡/马良审改意见重做，111 号，2026-10-15）

- 工单 `bf7fe47c-cf8c-4a2d-965e-1789ab7a9263`（取代 `c716f7ee…`，旧单未动），出片机本机渲染，花费 0，status=`in_review`，7 项自动检查全 PASS，`redline_hits=[]`，16.6 秒。**没有调任何付费生成接口。**
- 逐条对应审改意见：
  1. 价格回执：线上计算器真实页面截图 `evidence/2026-10-15-live-calculator-sydney-{1,5,10}cbm.jpg`（1 m³ = A$378；5 m³ = A$378+4×215 = A$1,238；10 m³ = A$317+9×215 = A$2,252），回执路径也写进工单 `angle_source.price_receipts`。页面服务卡原文 `DOOR TO DOOR · CLEARANCE INCLUDED`，页脚原句 `Estimates are indicative. Final charges are subject to a binding quote.`
  2. 字幕序列按苏东坡给的：1 M³ ≈A$378 / CHINA / TO / SYDNEY / ≈A$378 / DOOR / TO / DOOR / CLEARANCE / INCLUDED / LIVE / PRICES / ONLINE / NO / SIGN-UP / CURRENT / RATES / ESTIMATES / ONLY（仅第一词合并了价格，让第 0 帧见价格；已删 30KM DELIVERY INCLUDED、CUSTOMS CLEARED、EXCL. GST & DUTY）。
  3. caption 用他给的原文（m³ 统一、去掉 customs broker fee/fumigation/AQIS、加 Please confirm taxes, duties and insurance…）。
  4. 封面第一帧见价格 + East Inter logo（`evidence/…-v3-cover-frame.jpg`）。**注意：模板规定第一个词必须以数字开头且 logo 只在最后 2 拍，所以首帧的 logo 是我做进「封面素材板」里的，不是模板自带。**
  5. 换掉：Port of Balt… 吊机航拍、TOP FRUITS 叉车、SYDNEY 处的快递分拣带；现用素材全是无品牌无地名的集装箱堆场俯拍、港口船、装卸口、仓库货架、手持扫描、气泡膜（见 `East_Inter/remotion-assets/clips/SOURCES.txt`）。
  6. ONLINE：稳态不裁边；模板每个词开头 3 帧（0.1 秒）有「砸入」放大动画（1.7 倍），宽词这 0.1 秒会超出画面边——这是模板行为，不改代码就没法消除；已把宽词旋转归 0。
  7. 结尾价格板 3.3 秒（CURRENT RATES ESTIMATES ONLY）：≈A$378 + 1 m³ · China → Sydney · current rates + Estimates only，logo 全程在（前段在板里，最后 2 拍由模板叠，位置对齐；模板叠加那一下有轻微抖动）。网址在首条评论。
  8. Story 首帧（与封面不同）：`evidence/…-v3-story-first-frame.jpg`（仓库货架底 +「Same price to Sydney · Melbourne · Brisbane / A$1,238 / 5 m³ by sea · door to door / Current rates · Estimates only」），原图在 `East_Inter/review-assets/`。5 m³ 到三城同价来自计算器引擎（Melbourne/Brisbane 5 m³ 也是 A$1,238，Brisbane 约 25 天）。这只是 Story 的首帧静图，不是 Story 成片。
- **分镜自检（9 宫格）**：`evidence/2026-10-15-v3-storyboard-9grid.jpg` + 结尾四帧 `evidence/2026-10-15-v3-endcard-frames.jpg`；逐格看过：无第三方品牌字样、无地名、无月份/倒计时/限时/最低价；价格在第 0 帧和第 4–6 拍都见到。**我看的是本机同参数预览，没能打开存储桶里出片机渲的那份。** 音乐 Horizon's Call 已由 PM 听过无人声。
- 没解决（模板限制）：首帧 logo 与第一词必须数字开头的规则；词「砸入」动画 0.1 秒超边；真人出镜/真实感/行业配方仍是缺口。
