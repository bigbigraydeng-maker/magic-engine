# ads-health B 级 UI（相对 Figma）

父窗口待建结构（本文件仅拆分建议，≤30 行）：

- `ads-health-header.tsx` — 标题、Figma 副文案、数据更新时间
- `ads-health-summary-stats.tsx` — 四格：现在怎么样 / 今天花了 / 今天留资 / 近 7 天
- `ads-health-confirm-cta.tsx` — 「现在请您」+ 跳转 `#confirmation-cards`
- `ads-health-confirm-section.tsx` — 虚线 ochre 容器 + `HeldCards`
- `ads-health-campaign-table.tsx` — 「每条广告」表格态（替换当前 grid 卡片）
- `ads-health-accordions.tsx` — 底部五段折叠（小时进线、自己比、成绩单…）
- `confirmation-card/ConfirmationCard.tsx` — 前后对比条；`budget-change-dialog` — Figma 确认弹层

已有文件先做 token 抛光；上列落地后对齐 figma-ads-health-*.png。
