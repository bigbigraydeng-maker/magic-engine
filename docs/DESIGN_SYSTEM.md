# Magic Engine — Design System

> **强制规范**：所有 ME 后台（`/dashboard/**`）新建页面**必须**严格遵守本文档。
> 违反本规范的页面会被 PM 拒收，要求重做。
>
> 最后更新：2026-06-02（PM 在 Phase 30/31 上线后发现新页面视觉与 ME 系统不一致后立的强约束）

---

## 一、为什么需要这份文档

Phase 30（Industry Baselines）和 Phase 31（Goal/Initiative）上线后，PM 在浏览器里发现两个新页面用了**黑底白字的通用 dark dashboard 风格**（`bg-slate-900` / `text-white` / `border-white/10`），而 ME 正确的视觉系统是**浅米色背景 + 暖色调（gold/ochre）+ 深 charcoal 文字**。

这是**严重错位**——让 ME 看起来像不同公司拼接的产品，PM 在系统里 lost 的一大原因。

**根因**：Claude 写代码时凭训练数据默认走"AI dashboard 都长这样"的暗色风格，没看 ME 已有的 `tailwind.config.ts` 和现有客户首页样本。

**修复**：写代码前**必须**先读这份文档，照着 token + 示例写。

---

## 二、核心设计 Token（Tailwind config）

所有 token 已定义在 `tailwind.config.ts`，直接用类名即可。

### 颜色（`me-*` 色板）

| Token | 值 | 用途 |
|-------|-----|------|
| `me-ivory` | `#FBF8F3` | 白色卡片底（次于纯白） |
| `me-stone` | `#EAE6DF` | 灰色边框/分割 |
| `me-ochre` | `#C4912E` | **主品牌色**（按钮、强调、高亮） |
| `me-gold` | `#EBCB8B` | 浅金（背景渐变、徽章） |
| `me-charcoal` | `#1A1A1A` | **主文字色**（替代纯黑） |
| `me-black` | `#0D0D0D` | 极少用，仅强对比 |
| `me-taupe` | `#B7B1A5` | 弱文字 / 次要信息 |

### 页面背景（必须用，禁止 bg-slate-*）

```tsx
// ✅ 正确（ME 客户首页同款）
<div className="min-h-screen bg-[#f6f7f2] px-4 py-5 md:px-6">

// ❌ 错误（Phase 30 当前用法）
<div className="bg-slate-950 text-white">
```

### 状态色（`status-*`）

| Token | 值 | 用途 |
|-------|-----|------|
| `status-track` | `#5C8A4A` | 绿色（达成 / on track） |
| `status-exec` | `#C4912E` | 金色（执行中） |
| `status-attn` | `#8A8276` | 灰色（待关注） |
| `status-sched` | `#3E6E8C` | 蓝色（已排期） |
| `status-rej` | `#C2453A` | 红色（拒绝 / 异常） |

### 字体

| Token | 用途 |
|-------|------|
| `font-display` | 标题（`<h1>` / `<h2>`）`<h1 className="font-display text-3xl font-bold tracking-tight text-me-charcoal">` |
| `font-sans`（默认） | 正文 |

### 圆角与阴影

| Token | 用途 |
|-------|------|
| `rounded-card` (24px) | 大卡片（dashboard 主区） |
| `rounded-xl` (12px) | **最常用**，卡片 / 弹窗 / 按钮 |
| `shadow-card` | 标准卡片阴影 |
| `shadow-sm` | 轻阴影 |

### 渐变

- `bg-gold-gradient` — 主 CTA 按钮渐变
- `bg-warm-glow` — 装饰性发光（仅首页 / 标志性元素）

---

## 三、常用组件模式（直接抄）

### 页面外层

```tsx
<div className="min-h-screen space-y-5 bg-[#f6f7f2] px-4 py-5 md:px-6">
  {/* 内容 */}
</div>
```

### 页面标题

```tsx
<div className="flex flex-col gap-4 lg:flex-row lg:items-center">
  <h1 className="font-display text-3xl font-bold tracking-tight text-me-charcoal">
    页面标题
  </h1>
  <p className="text-sm text-me-charcoal/55">页面简介</p>
</div>
```

### 主卡片（白底 + 浅边框）

```tsx
<div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
  {/* 卡片内容 */}
</div>
```

### 强调卡片（ochre 高亮）

```tsx
<div className="rounded-xl border border-me-ochre/30 bg-me-ochre/10 p-4">
  {/* 重要提示内容 */}
</div>
```

### 主 CTA 按钮（金色 ochre）

```tsx
<button className="flex items-center gap-1.5 rounded-lg bg-me-ochre px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-me-ochre/90">
  Action
</button>
```

### 次 CTA 按钮（白底深字）

```tsx
<button className="flex min-h-11 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-me-charcoal/75 transition-colors hover:border-black/15 hover:text-me-charcoal">
  Secondary
</button>
```

### 徽章（小标签）

```tsx
{/* Ochre 主色徽章 */}
<span className="rounded-full border border-me-ochre/20 bg-me-ochre/10 px-2 py-1 text-xs font-bold text-me-ochre">
  BETA
</span>

{/* 状态徽章（多色用 status-*） */}
<span className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase text-status-track">
  Confirmed
</span>
```

### 表单输入

```tsx
<input
  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-me-charcoal placeholder:text-me-taupe focus:outline-none focus:border-me-ochre"
  placeholder="..."
/>
```

### 单选/卡片选择

```tsx
<button className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
  selected
    ? 'border-me-ochre bg-me-ochre/10'
    : 'border-black/10 bg-white hover:border-me-ochre/40 hover:shadow-sm'
}`}>
  <div className="font-semibold text-me-charcoal">{title}</div>
  <div className="mt-0.5 text-xs text-me-charcoal/55">{description}</div>
</button>
```

### 弹窗背景

```tsx
{/* 遮罩 */}
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
  {/* 弹窗本体 */}
  <div className="w-full max-w-lg rounded-xl border border-black/10 bg-white p-6 shadow-card">
    {/* 弹窗内容 */}
  </div>
</div>
```

### 弹窗右侧抽屉（Form Drawer）

```tsx
<div className="fixed inset-0 z-50 flex justify-end bg-black/40">
  <div className="w-full max-w-2xl h-full overflow-y-auto bg-white border-l border-black/10">
    {/* sticky header */}
    <div className="sticky top-0 z-10 bg-white border-b border-black/10 px-6 py-4">
      <h2 className="font-display text-lg font-bold text-me-charcoal">标题</h2>
    </div>
    <div className="p-6 space-y-6">
      {/* 内容 */}
    </div>
  </div>
</div>
```

---

## 四、禁止清单（写代码时不要做）

| ❌ 禁止 | ✅ 改用 |
|---------|--------|
| `bg-slate-900` / `bg-slate-950` | `bg-[#f6f7f2]`（页面）或 `bg-white`（卡片） |
| `text-white` 当默认正文 | `text-me-charcoal` |
| `border-white/10` | `border-black/10` 或 `border-me-stone` |
| `text-slate-400` / `text-slate-500` | `text-me-charcoal/55` 或 `text-me-taupe` |
| 纯黑 `text-black` | `text-me-charcoal` |
| 纯白 `bg-white` 作页面背景 | `bg-[#f6f7f2]` |
| `bg-blue-600` 作 CTA | `bg-me-ochre` |
| `bg-purple-*` 作功能色 | 用 `me-*` 系列，特殊情况再讨论 |
| 自定义 `bg-[#xxxxxx]`（除了 `#f6f7f2` 页面底） | 用现有 `me-*` token |

**例外**：图表配色、第三方组件、特殊状态色（如错误红 `status-rej`）可适当使用，但**整体页面必须保持 ME 系统主导**。

---

## 五、Beta 标签的正确做法

Phase 31 是 Beta 功能，Beta 角标的**正确视觉**：

```tsx
<span className="rounded bg-me-ochre/15 px-2 py-0.5 text-[10px] font-bold text-me-ochre uppercase tracking-wide">
  Beta
</span>
```

❌ 不要：`bg-amber-500/20 text-amber-300`（错误的色调）

---

## 六、参考样本（照着抄）

| 文件 | 用途 |
|------|------|
| `src/app/dashboard/clients/[id]/page.tsx` | 主客户首页 — **ME 设计系统的金标准** |
| `src/app/dashboard/clients/[id]/_components/NextStepCard.tsx` | 卡片组件 |
| `src/app/about/page.tsx` | 公开页 + ME 视觉 |
| `src/app/contact/page.tsx` | 表单 + ME 视觉 |

**写新页面前先 grep 这几个文件**，看现有模式。

---

## 七、流程要求

### Claude 写代码时必须

1. **写新 `/dashboard/**` 页面前**先读本文档（最少读三、四节）
2. **复制现有 ME 风格页面**做模板，不要自己发明
3. **PR 描述**里写明"已遵守 DESIGN_SYSTEM.md"
4. PR 自检列表加一条：✅ 已使用 `me-*` token + `bg-[#f6f7f2]` 页面底

### PM 验收时检查

1. 页面背景是不是浅米色？
2. 标题是不是 `font-display + text-me-charcoal`？
3. 主 CTA 是不是 `bg-me-ochre`？
4. 没有 `bg-slate-*` / `text-white` 这种 dark theme 残留？

如果以上任一不达标 → **拒收 PR**。

---

## 八、当前已知违规页面（待修复）

PM 在 2026-06-02 发现的：

| 页面 | 违规点 | 修复 Owner |
|------|-------|-----------|
| `/dashboard/industry-baselines` | 完全 dark theme，背景 + 文字 + 卡片全错 | Background agent |
| `/dashboard/clients/[id]/goal/new` | Phase 31 4 步向导，全 dark theme | Background agent |
| `/dashboard/clients/[id]/goal/[goalId]` | Goal 详情页，全 dark theme | Background agent |
| `/dashboard/clients/[id]/goals/history` | Goal 历史归档页 | Background agent |
| `/dashboard/clients/[id]/_components/GoalBanner.tsx` | Banner 视觉（虚线框样式 OK，但 hover 色不对） | Background agent |
| `/dashboard/clients/[id]/goal/[goalId]/_components/*` | InitiativeList / InitiativeFormDrawer / VerdictPanel / BacklogMigrator | Background agent |

修复 PR 名：`fix(ui): align Phase 30/31 pages with ME design system [DESIGN_SYSTEM]`
