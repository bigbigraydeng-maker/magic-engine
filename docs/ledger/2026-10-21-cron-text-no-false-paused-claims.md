---
id: 2026-10-21-cron-text-no-false-paused-claims
title: 登记表白名单和接口注释里的说法与服务器现实对不上：5 条写「暂停」的白名单原因改成只写仓库里查得到的事实，6 个接口文件头注释里的旧运行频率改对
status: decided
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_by: 2026-10-28
verify_how: 主干上核对：src/lib/cron/registry.ts 白名单里 email-reply-digest、factory-stock-refill、execution-auto-run、job-boards-weekly、team-memory-sweeper 五条原因都写「仓库里……已注释（2026-10-21 核）」并指向台账卡 2026-10-21-render-orphan-cron-services-9，不再单独断言 Render 已暂停，registry.ts 里 4 行「🔴 仓库里已暂停」注释同样限定；ad-entity-snapshot、goal-current-value-refresh、google-data-pullback-daily、meta-leads-sync、prospecting-sweep、social-comment-autoreply 六个接口文件头注释里的运行频率与 render.yaml 一致；registry.test.ts 全绿。PM 同意在 Render 上暂停那 9 个之后，白名单原因再改成「已于某日在 Render 暂停」（见那张卡）。
---
统管 18 号转述子牙对 PR 3000 的审查：白名单里写「暂停」的 5 个任务，服务器上其实还在跑（子牙与统管都用运行记录核过），原因文字不该断言 Render 已暂停；接口文件头注释里还有写着旧频率的。这两项没赶上 PR 3000 就合并了，所以单开。
只改字符串和注释，不改调度、不改逻辑。这些文件在生产定时任务路由和登记表下，机器判 A，走草稿等 PM 回「合 N」。
