# 已退役的 cts-seo-optimizer 在 Render 上仍活着，9/28 改错 CTS 三页标题

> 台账卡：docs/ledger/2026-10-04-cts-retired-seo-optimizer-zombie-run.md。真正的修复在 chinatravel 仓库的 PR #219（回滚 #213）。
## 发生了什么

`cts-seo-optimizer` 于 2026-09-20 宣布退役（render.yaml 删除条目、`src/lib/cron/registry.ts` 标注退役、roster.ts 注释写明「两条流程绝不可能同时被排程」）。**实际上 Render 后台的 cron 服务从未被删除或暂停**，schedule 被改成 `30 5 28 9 *`（每年 9 月 28 日 05:30 UTC），因此 9/21 没响、**9/28 05:31:03 UTC 又跑了一次**，自己开 PR #213 并自动合并上线。

该旧流程没有任何闸门（不校验页面主题、不做事实核对、不读 `meta_cycle_brand_voice`），改坏 3 页并在客户站上挂了 6 天：

| 页面 | 被改成 | 问题 |
|---|---|---|
| `blogs-liziba-monorail-guide.ts` | `How Many Days in Chongqing \| CTS Tours` | 张冠李戴（该页是李子坝穿楼单轨指南） |
| `blogs-phase3-line-c.ts`（重庆夜景） | `The Forbidden City & China's Best Cities \| CTS` | 张冠李戴 + 品牌尾巴与站点模板叠成两遍 |
| `seo-pages.ts`（china-tours-from-new-zealand） | description 删掉 4 条线路名与全部价格 | 询盘主入口页，原本列出 4 团及 NZD $3,399–7,999 |

同一个早上接替它的新流程（Inngest `cloud-seo-meta-cycle-fanout`，05:31:44 起）表现正确：只改 1 页（PR #214，北京→西安高铁，正确），另 2 页主动拦下——`best-time-to-visit-china` 被 AI 判官拦（0.51 ≥ 0.5），`leshan-giant-buddha-day-trip` 被「不许丢掉原文具体数字」硬规则拦（报「丢了 90 years、凭空加了 NZ」）。2026-09-23 那轮三项修复确认真的在生效。

## 已做的处置（2026-10-04，PM 口头 `修`）

1. chinatravel PR #219 回滚 #213（纯 revert，#213 之后无人碰过那 3 个文件），已合并；Render 自动重新部署。
2. Render 服务 `crn-d9mle96417fc73blovh0` 已 suspend（API 读回确认 `suspended`），非删除，可回滚。
3. `seo_meta_log` 里 9/28 05:31:18.668 那 3 行已置 `reverted_at`。**副作用**：这 3 页因此脱离 30 天冷却，下一个周一会重新进新流程的候选池——新流程闸门已验证有效，接受。

## 教训（已另记记忆）

退役一条定时任务，**改 render.yaml / 代码注释 / registry 都不算退役**——Render 后台的服务对象不会因为 render.yaml 删了条目而消失。退役必须以「Render API 读回 suspended 或服务不存在」为完成判据。这正是记忆 `feedback-inngest-migration-must-retire-old-path`（迁移必须收编旧路由，不能留平行系统）所警告的情形，这次是同一个坑的第二次。

## 未查

9/28–10/4 这 6 天三页错标题对点击与询盘的实际影响没查（GSC / 询盘数据未拉）。
