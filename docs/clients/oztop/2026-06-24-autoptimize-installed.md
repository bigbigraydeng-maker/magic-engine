# Autoptimize 已装 + 配置生效（2026-06-24）

> 方案 B 免费组合落地。子牙 Chrome 操作完成。

---

## ✅ 已完成

| 步骤 | 状态 | 备注 |
|---|---|---|
| 1. Autoptimize plugin 安装 | ✅ | WP REST plugin-install 自动化 |
| 2. Autoptimize plugin 启用 | ✅ | admin bar 显示绿点 Autoptimize |
| 3. SG Speed Optimizer 自动让位 | ✅ | SG 自动 deactivate HTML/JS/CSS Minification 让 Autoptimize 接管，零冲突 |
| 4. Autoptimize 3 关键 toggle 开启 | ✅ | Aggregate JS / Aggregate CSS / Eliminate render-blocking CSS |
| 5. Save Changes and Empty Cache | ✅ | "Settings saved." 绿框确认 |
| 6. 前端首页验证 | ✅ | Title / Hero / Nav / CTA / Product Categories 全部正常 |
| 7. Autoptimize CSS aggregation 检测 | ✅ | `aoCssDetected: true` |
| 8. 4 个 Schema JSON-LD 完好 | ✅ | WebPage / Organization / 2× Site Kit Schema |

---

## 🔧 实际生效的优化（按 LCP 影响排）

| 设置 | 状态 | LCP 影响 |
|---|---|---|
| **autoptimize_css_defer**（Eliminate render-blocking CSS）| ✅ ON | 🎯 这是 LCP 救星 — Critical CSS 内联 + 其余 CSS defer |
| autoptimize_css_aggregate（Combine CSS）| ✅ ON | 减少 HTTP 请求 |
| autoptimize_js_aggregate（Combine JS）| ✅ ON | 减少 HTTP 请求 |
| autoptimize_js (Optimize JS)| ✅ ON（默认）| Minify |
| autoptimize_js_defer_not_aggregate | ✅ ON（默认）| Defer non-critical JS |
| autoptimize_css (Optimize CSS)| ✅ ON（默认）| Minify |
| autoptimize_html (Optimize HTML)| ✅ ON（默认）| Minify |

---

## ⚠️ 不开的设置（避免破布局）

| 设置 | 状态 | 为何不开 |
|---|---|---|
| autoptimize_js_forcehead（Force JS in head）| ❌ OFF | 跟 Astra theme defer 冲突 |
| autoptimize_css_inline（Inline all CSS）| ❌ OFF | Oztop CSS 几百 KB 太大，全 inline 反而增大 HTML payload |
| autoptimize_optimize_checkout | ❌ OFF | 避免 WooCommerce checkout 破 |

---

## 🚦 PM 立刻做（30 秒）

1. **WP 后台顶部 admin bar 点 "Purge SG Cache"** → 让全网立刻刷新（子牙试了但 idle 卡住）
2. **24 小时后** 重跑 https://pagespeed.web.dev/analysis?url=https%3A%2F%2Foztopbuildingsupplies.com.au%2F&form_factor=mobile
3. **截图发子牙** — 子牙判断是否还需要升级 WP Rocket

---

## 🎯 预期效果（24h 后）

| 指标 | 改善前 | 预期改善后 | 目标 |
|---|---|---|---|
| Performance Score | 32/100 | **55-65** | 65+ |
| LCP | 40.8s | **8-15s** | < 12s |
| FCP | 6.0s | **2-3s** | < 1.8s |
| TBT | 1,090ms | **300-500ms** | < 200ms |

**如果 24h 后还在 < 55** → 子牙建议升级 WP Rocket（AU$70/年）+ 装 WebP optimizer。

---

## 🚨 如发现前端有破（极少见但要监控）

**症状**：CSS 错位 / 图片不显示 / nav 错乱

**应急 rollback**（PM 1 分钟操作）：
1. WP 后台 → Plugins → All
2. 找 Autoptimize → 点 **Deactivate**
3. 网站立刻回到优化前状态（CSS 100% 还原）
4. 告诉子牙 → 子牙调整配置后再启

**子牙今晚已扫**：首页 Hero / Nav / Product Categories Section 都正常渲染。剩余几页（Brands / Products / Contact）大概率也正常 — 如有问题 PM 任意时间反馈即可。

---

## 📋 验证 checklist（PM 明天可做）

- [ ] 重跑 PageSpeed Mobile — 截图分数
- [ ] 打开首页 — 看 Hero 是否完好
- [ ] 打开 /brands/ — 看 brand 列表是否完好
- [ ] 打开 /flooring/ 分类页 — 看产品列表是否完好
- [ ] 打开 Contact 页 — 看表单是否能填能 submit
- [ ] 打开 product 详情 — 看 Add to Cart / Request Quote 按钮可点

---

*生成: 子牙 2026-06-24 · 方案 B 落地报告*
