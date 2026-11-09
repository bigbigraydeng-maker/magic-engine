# ME 后台左栏重排方案 — 待 PM 点头，未动代码

依据：origin/main `src/app/dashboard/dashboard-shell.tsx` 的 `ADMIN_SECTIONS`（管理员视角）。风险级：C（只改分组与折叠，不改网址、不改权限；客户视角与单客户管理员视角的栏不动）。

## 现状
管理员左栏 27 项，只有 3 个分组：顶部 3 项，「Create」1 项，「Operate」**22 项平铺**，没有折叠。高频与低频混排；中英文标签混用（Analytics / Reports / Billing Monitor 与「电话」「转化」并列）。

## 方案：5 组，低频折叠
（「每天用 / 低频」是我按页面职责的判断，未查生产使用数据，请 PM 改。）

| 组 | 放什么 | 折叠 |
|---|---|---|
| **每天** | 总览 · 今日待办 · 客户列表 · 等你点头的广告 · 等你点头的动作 | 不折叠 |
| **创作与发布** | 视频工厂 · Launch Hub（待删，暂放这里最后一项，PM 说删再处理） | 不折叠 |
| **广告与客人** | 广告引擎 · 转化 · 电话 | 不折叠 |
| **看数据** | 月报（Reports） · Analytics · Industry Baselines | 折叠 |
| **系统与管理** | 自动任务健康 · Cron Health · Flywheel · AI Gateway · Billing Monitor · MTC Overview · User Console · MCP Keys · Prospecting · Viral References · 选品工作台 · 团队工作记忆 · ME2 产品地图 | 折叠 |

顶部露出的从 27 项降到约 10 项；其余一次点击展开。

## 同时统一
- 标签全改中文（Reports→月报，Billing Monitor→费用监控，User Console→用户管理 等，具体字由 118 号按页面标题定）。
- 两处疑似重复，**未验证**，由 118 号读页面后给结论、不擅自合并：`Cron Health`（admin/cron-health）与「自动任务健康」（workflows-health）；「等你点头的广告」与「等你点头的动作」是否能合成一个「待你点头」页。

## 不做
不改网址、不删页面、不动权限判断；不加红点计数（那要读数据，另案）。

## 分工
118 号（它已熟悉 dashboard-shell.tsx）。先等 118 号当前两步做完，避免同一个文件两边改。
