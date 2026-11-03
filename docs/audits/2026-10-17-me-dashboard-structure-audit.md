# ME 后台结构盘点（2026-10-17）

只读盘点，基于 `origin/main`。没有改任何代码。

## 数出来的数字

| 项 | 数 |
|---|---|
| 后台页面总数 | 97 |
| 其中客户工作台页面 | 59 |
| 最近 7 天（10-10 起）后台改动次数 | 145 |
| 全局页面在界面上没有入口（只能手打网址） | **5**（初稿写 20，错了，见更正） |

> **更正（2026-10-17）**：初稿说 20 个页面点不到，不准。左侧栏（`dashboard-shell.tsx`）早已挂了其中大部分（今日待办、授权审批、月报、管理员页等）。真正没入口的只有 5 个：电话、自动任务健康、转化、Flywheel、MCP Keys，外加 Analytics 当时标着「即将上线」。这 6 项已由 118 号补上。后面「20 个」的说法以此更正为准。

## 问题一（初稿，已更正）：页面点不到

这些页面存在、能打开，但整个后台没有任何一个链接指向它们。要用只能背网址。

**天天要用的也在里面**：
- `/dashboard/today` 今日待办
- `/dashboard/kernel-approvals` 授权审批
- `/dashboard/voice` 电话
- `/dashboard/workflows-health` 自动任务健康
- `/dashboard/reports` 月报

**偶尔要用**：`analytics`、`conversions`、`commerce`、`industry-baselines`、`team-memory`、`me2/product-map`

**管理员 9 个全部没入口**：`admin/` 下的 ai-gateway、billing-monitor、cron-health、flywheel、mcp-keys、mtc-overview、prospecting、users、viral-references

后台首页（`/dashboard`）只有两个去处：客户列表、Launch Hub。

## 问题二：客户工作台一页摆了 40 多张卡，同一件事有 6 个入口

客户总览页一屏甩出 40+ 张工具卡，没有分主次。同类重复：

**社媒这一件事，6 个入口**：社媒日常 / 每日计划（同一个页面，只差一个参数）/ 社媒矩阵 / 推广活动 / 推广计划 / Marketing Plan

**出片这一件事，6 个入口**：视频工厂 / 素材库 / Launch Hub / 内容生产包 / 内容工厂 / 生成单条内容

**客人这一件事，分散在 8 处**：CRM 管理、contacts、business-inbox、messenger，加 crm 下面的 decisions / payments / phone-review / unclaimed 四个子页

## 问题三：命名撞车

`ad-health`（单数）和 `ads-health`（复数）是两个不同目录。广告健康主页在复数那个，"自动暂停"子页却在单数那个。

## 这周新加的三个页面还没进总览分组

`sales-progress`（销售进度）、`business-calculator`（经营测算）、`promo-plan`（推广计划）都是这周加的，目前散挂在卡片堆里。

## 建议的收拾顺序

1. **先补入口**：后台首页加一个导航，把 20 个孤儿页面挂上去。这个最便宜、天天受益。
2. **再合并重复**：社媒 6 个入口收成 1 个、出片 6 个收成 1 个、客人相关收进 CRM 一个门。
3. **最后改命名**：`ad-health` 并进 `ads-health`。

前两步是 C 级（只动界面和链接），第三步要改路径、算 B 级。
