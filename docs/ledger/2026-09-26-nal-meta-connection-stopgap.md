---
id: 2026-09-26-nal-meta-connection-stopgap
title: 止血：把 NAL 那条已死的 Meta 存储令牌标成 error，想让表单留资退回公用令牌恢复——验过，没恢复
status: failed
owner: pm
decided_on: 2026-09-26
source: session:5b9407a2
done_on: 2026-09-26
done_ref: pr:2081
verify_by: 2026-09-29
verify_how: 我自己那次试跑已经不成（leadsIngested=0，被 unverified_shared_token 拦住，证据见 evidence 文件）——按闸门规矩新卡不能一出生就 failed，所以先记 done。复核这样做：先确认有人在 NAL 设置抽屉的 Facebook 主页卡片点过「重新核实」；点过了就跑一次单客户留资同步，leadsIngested 大于 0 才翻 verified；还没人点、或点了仍为 0，翻 failed
last_checked: 2026-10-15
check_note: 到 10-15 08:25 UTC 为止最近 6 轮留资同步对 NAL 全是 page_not_verified（主页没核实），止血没让它恢复
verified_ref: doc:docs/ledger/evidence/2026-09-26-nal-meta-connection-stopgap--2026-10-15.md
---
⚠️ 状态写 done 不代表成了 —— 闸门不许新卡一出生就 failed（必须先 done、等夜巡或人核过再翻）。本卡的试跑结论是**没成**，细节在下面和 evidence 文件里。

PM 2026-09-27 批准，改生产库一行：NAL 那条 Meta 连接 status 由 active 改为 error（那把存储令牌 Graph 两条路径都报 190，记录却写着正常）。改动本身按预期生效，返回 1 行。
但当场试跑：单客户留资同步读到 0 条、写入 0 条，被我们自己的闸拦住（page-sync-authorization 第 108 行：公用令牌不许读没有员工核实记录的主页）。改前我只验了「Meta 会放行」，没验「我们自己的代码会放行」——中间还隔着一道闸，这是我的验证漏项。
不撤回：error 是真话（令牌确实死了），而且改完 NAL 被路由到了正确那张卡（「点重新核实」，员工侧可完成，不用等客户）。撤回语句仍可用。
下一步一步：NAL 设置抽屉 → Facebook 主页 → 点「重新核实」。私信仍要客户主页管理员重新授权，另在 9-29 日历。
