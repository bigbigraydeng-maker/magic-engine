# A-3 三类入口到写入函数（2026-11-08）

只读代码，对照已合并的确认卡改动。没有调用 Meta，没有改预算卡、源锁、暂停卡、赢家执行器。

代码基线：fetch 后的 `origin/main` `15cc1d71a`（2026-11-09 08:28 +1300）。Google / TikTok 的同类旧入口不在本批三类路径里，整包因此也不能标完成。

## 只出建议，不写

| 入口 | 调用 | 实际函数 |
|---|---|---|
| 定时 `GET /api/cron/winner-reel-sync-daily`（Render 调度；GitHub 工作流只剩手动再打同一个地址） | `syncWinnerReels` | `collectWinnerSuggestions` 只读；`proposeWinnerBatch` 只出卡 |
| 补素材 `POST /api/clients/[id]/ad-health/execute-prescription`，`kind=refresh_creatives` | 同上，并跳过疲劳暂停 | 同上。别的 kind 直接 422 |
| `src/lib/winner-reel-sync/propose.ts` | `issueConfirmationCard` | 不调用建广告、暂停、打开 |

负向：`entry-write-boundary.test.ts` 确认这四个文件正文没有 `createAdFromPost`、`pauseAd(`、`activateAd`、`setCampaignStatus`。配置串客户的拒绝仍在 `config-ownership.test.ts`，扫描不建广告。

## 点了确认卡之后才写

| 入口 | 调用 | 实际写入 |
|---|---|---|
| `POST /api/clients/[id]/meta-ads/winner-reel-cards/[runId]` | `confirmWinnerFromSession` → `confirmWinnerCard` | 默认端口：`createAdFromPost`（写死暂停）、`activateAd`、以及暂停卡的 `issuePauseOrder` / `submitPauseCard` |

源码顺序：先按客户查台账，点「不做」会返回，决定之后才写。台账查询对别的客户返回空，有单独测试。回读不一致的那段只调用一次创建，并写着不再改第二次。这些是源码和查询测试，不是把执行器跑起来。

## 加载就会断，不是明确关掉

`winner-reel-execute.ts` 仍引入已删除的 `src/lib/ads-pause-card/flow.ts`（`issuePauseOrder`、`submitPauseCard`）和 `src/lib/ads-pause-card/meta.ts`（`metaPauseRuntime`）。两处都在 `afc48738c` 删掉。确认路由一加载就断，所以上面的「点卡才写」在当前主干上跑不起来。`winner-reel-confirm.test.ts` 因此整文件收集失败，里面的回读、过期之外的假依赖用例现在也跑不到。本批不补这两个文件，避免把确认写入重新接上。

暂停建议的源码在同一次请求里自己把暂停卡点成确认。真模块已经不在，所以这条自动点头现在碰不到。接回现有的广告组暂停卡时，不能靠函数名就算过了源锁和第二次点头。

## 仍可旁路

`POST /api/clients/[id]/meta-ads/execute`

- `ads.pause_campaign`：登录的付费客户，加上系列属于该客户的登记账户之后，直接 `setCampaignStatus(..., 'PAUSED')`。没有确认卡。旧页面 `AdsFixDrawer` 会打这个地址。
- `ads.reactivate_campaign`：先查花钱批准名单并写下回执，然后直接 `setCampaignStatus(..., 'ACTIVE')`。没有确认卡。旧页面 `AdsAuditSection` 用它做撤销。回执写不进则不调 Meta。
- `ads.adjust_bid` 只接受下调，先排队再由后台任务写，不在这个路由里直接改。本批不把它算成已收进确认卡。

`GET /api/clients/[id]/meta-ads/actions` 只读历史，自己不写。

缺的守卫：暂停和恢复在调用 Meta 之前没有「这张卡是这个客户、没过期、有人点了确认」。最小修法是这两步改走已有确认卡，路由里不再直接改状态。权限会变（现在付费客户就能暂停），本批不改。

## 过期来源仍会写（旁路）

确认卡过了 30 分钟时，`decideConfirmationCard` 把卡作废并返回「已过期」，不抛错。`confirmWinnerCard` 不看这个结果，接着占住台账并调用 `writeOnce`。触发：对一张仍挂着、但已过 30 分钟的赢家卡点确认。缺的守卫：返回值不是「已确认」就不得写入。最小修法：在占住台账之前看卡的状态，过期就停。本批不改执行器。源码扫描能看见「决定」和「写入」之间没有读卡的状态；执行器加载失败，所以这条还没有假依赖跑通。

## 本批没有覆盖

同一广告账户被两家客户共用时，账户级归属对不上广告组归属。Google、TikTok 的旧执行路由。止损是否仍走内核。这些都不在本批三类路径的回归里，不能用来把 A-3 整包标完成。
