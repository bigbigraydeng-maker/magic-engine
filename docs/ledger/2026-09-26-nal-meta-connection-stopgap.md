---
id: 2026-09-26-nal-meta-connection-stopgap
title: 止血：把 NAL 那条已死的 Meta 存储令牌标成 error，想让表单留资退回公用令牌恢复——验过，没恢复
status: failed
owner: pm
decided_on: 2026-09-26
source: session:5b9407a2
done_on: 2026-09-26
done_ref: doc:docs/ledger/evidence/2026-09-26-nal-meta-connection-stopgap--2026-09-27.md
verified_ref: doc:docs/ledger/2026-09-26-nal-meta-connection-stopgap.md
last_checked: 2026-09-27
check_note: 改动生效但目的没达到；撞上我们自己的 AD-SEC-4 闸，还差员工点一次「重新核实」
verify_by: 2026-09-29
verify_how: 有人在 NAL 设置抽屉的 Facebook 主页卡片点过「重新核实」之后，下一个整点再跑一次单客户留资同步，leadsIngested 大于 0 才算成
---
PM 2026-09-27 批准，改生产库一行：NAL 那条 Meta 连接 status 由 active 改为 error（那把存储令牌 Graph 两条路径都报 190，记录却写着正常）。改动本身按预期生效，返回 1 行。
但当场试跑：单客户留资同步读到 0 条、写入 0 条，被我们自己的闸拦住（page-sync-authorization 第 108 行：公用令牌不许读没有员工核实记录的主页）。改前我只验了「Meta 会放行」，没验「我们自己的代码会放行」——中间还隔着一道闸，这是我的验证漏项。
不撤回：error 是真话（令牌确实死了），而且改完 NAL 被路由到了正确那张卡（「点重新核实」，员工侧可完成，不用等客户）。撤回语句仍可用。
下一步一步：NAL 设置抽屉 → Facebook 主页 → 点「重新核实」。私信仍要客户主页管理员重新授权，另在 9-29 日历。
