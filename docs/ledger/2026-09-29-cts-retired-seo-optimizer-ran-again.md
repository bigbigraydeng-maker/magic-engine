---
id: 2026-09-29-cts-retired-seo-optimizer-ran-again
title: CTS 官网 9-28 又被自动改错 3 个标题——元凶是没删干净的旧定时任务，已让它失效，官网撤回待合
status: done
owner: agent
decided_on: 2026-09-29
source: session:22017dd9
verify_by: 2026-10-12
verify_how: ①chinatravel#216 合并部署后 curl 3 页，标题/描述与 seo_meta_log 的 old_title/old_desc 一致，且 3 行 reverted_at 已填；②10-05 周循环跑完后（10-12 前核对）查 cron_run_logs：没有 cts-seo-optimizer 成功运行，周循环 step4 改动的页面逐条人工看一遍新文字不跑题；③Render 后台 cts-seo-optimizer 仍是「手动暂停」
done_on: 2026-09-29
done_ref: pr:2200
---
9-28 05:31 UTC 的 3 个错改（chinatravel#213）来自已退役的 cts-seo-optimizer，不是 Inngest 周循环（pr:2172 修的是后者，它台账卡里的根因不适用于这次）。
原因：0e0b0f619 把 Render 定时改成一次性「9-28 跑」，6d9ff7707 只从 render.yaml 删掉；Render 不会因此删服务，957cca364 又给这条无闸门路径加了自动合并。
pr:2200 让旧入口只记失败、返回 410；回放测试证明 #2172 后的闸门拦下全部 3 条（缺口：checkTitleOnTopic 单独拦不住 Forbidden City）。
Render 后台核查（2026-10-05，浏览器亲眼所见）：旧服务 `cts-seo-optimizer` 仍在，状态为「手动暂停」（1 天前被暂停），所以不会再触发；同样存在且已暂停的还有 `oztop-seo-optimizer`。是否彻底删除这两条服务是可选清理，不阻塞本 PR；在删除前保持暂停即可。
更正：本 PR 早先说"每日检查能看到被调用的失败记录"不准确——`cts-seo-optimizer` 不在健康检查登记表里（registry.ts 的"不排班"白名单），失败记录只会出现在每天的 daily-cron-digest 邮件里。旧服务的下一次排班是 2027-09-28，且现已暂停，所以这条提醒实际不会触发。
未完成：3 行 seo_meta_log 的 reverted_at 等撤回上线后再写。
