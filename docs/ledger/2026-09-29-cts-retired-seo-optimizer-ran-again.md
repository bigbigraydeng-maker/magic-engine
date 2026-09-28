---
id: 2026-09-29-cts-retired-seo-optimizer-ran-again
title: CTS 官网 9-28 又被自动改错 3 个标题——元凶是没删干净的旧定时任务，已让它失效，官网撤回待合
status: done
owner: agent
decided_on: 2026-09-29
source: session:22017dd9
verify_by: 2026-10-05
verify_how: ①chinatravel#216 合并部署后 curl 3 页，标题/描述与 seo_meta_log 的 old_title/old_desc 一致，且 3 行 reverted_at 已填；②10-05 周循环跑完后查 cron_run_logs：没有 cts-seo-optimizer 成功运行，周循环 step4 改动的页面逐条人工看一遍新文字不跑题。
done_on: 2026-09-29
done_ref: pr:2200
---
9-28 05:31 UTC 的 3 个错改（chinatravel#213）来自已退役的 cts-seo-optimizer，不是 Inngest 周循环（pr:2172 修的是后者，它台账卡里的根因不适用于这次）。
原因：0e0b0f619 把 Render 定时改成一次性「9-28 跑」，6d9ff7707 只从 render.yaml 删掉；Render 不会因此删服务，957cca364 又给这条无闸门路径加了自动合并。
pr:2200 让旧入口只记失败、返回 410；回放测试证明 #2172 后的闸门拦下全部 3 条（缺口：checkTitleOnTopic 单独拦不住 Forbidden City）。
未完成：Render 后台那条定时服务本身还没删（本会话无权限）；3 行 seo_meta_log 的 reverted_at 等撤回上线后再写。
