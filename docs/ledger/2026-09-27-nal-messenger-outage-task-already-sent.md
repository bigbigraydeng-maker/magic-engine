---
id: 2026-09-27-nal-messenger-outage-task-already-sent
title: NAL 私信断流 11 天——不能自动重连；人工任务早就在下发而且写得对；没人动是因为它埋在 166 件事里
status: decided
owner: pm
decided_on: 2026-09-27
source: session:5b9407a2
verify_by: 2026-10-01
verify_how: ① 跑一次私信同步、看 NAL 那条是不是还报 `page_not_verified`（有人点过「重新核实」就不报了）；② `select max(last_message_at) from conversations where client_id='4ae76381-...' and channel='messenger'` 应该追到近几天，而不是停在 2026-09-16；③ 看 PR #2065（今日待办砍到 5 类）合没合 —— 没合的话这张卡还是会继续埋在上百件里
---
小秘书 2026-09-27 让我查 NAL 私信断流：能自动修就修，必须人点就做成人工任务。**查完结论是：两件都不用做，因为人工任务早就在下发，而且写得对。** 没人动的原因在别处。

## ① 不能自动重连（已验）

私信同步每小时在跑（今天 06:10 还跑了，状态写 `completed`），但 NAL 那条固定报：
`page_not_verified: unverified_shared_token`

链路：NAL 那把存储令牌已经死了（Graph 两条路径都报 190，9-26 PM 批准把它标成 error）→ 退回公用令牌 → 而 `page-sync-authorization` 拒绝用公用令牌读**没有员工核实记录**的主页。**所以只有人点一次能解，代码解不了。**

## ② 人工任务早就在下发，三件套齐全（拿生产数据跑出来看的）

`page-binding-items.ts` 的 `facebook_page_binding_unverified` 这张卡，对生产跑一遍确实产出 NAL 那条：

- **什么事**：私信、表单线索、评论自动回复已暂停：Facebook 主页 `117747…`（NAL 绑定的那个，见 `clients.facebook_page_id`）的绑定没通过核实 —— 这期间客人的私信和留资不会进 CRM
- **怎么做**：点链接打开这个客户的设置抽屉，在「Facebook 主页」卡片里点「重新核实」…核实后看卡片上显示的主页名是不是这个客户自己的
- **链接**：`…/dashboard/clients/4ae76381-…?settings=platform`

**所以「做成人工任务」这件事不用做，它已经是了。**

## ③ 真正的原因：卡埋在 166 件事里

送卡的那封邮件 `pm-daily-todo` 排程是 `0 19 * * 0-4`（周日到周四）。**最近一次是 2026-09-24（周四）19:01，那一封里有 166 件事。** 周五周六按设计不跑；今天周日晚上才是下一封。

**卡生成了 ≠ 有人看见了。** 一张写得很好的卡，混在 166 件里等于没下发 —— 这正是 PM 2026-09-26 把今日待办砍到 5 类（166 → 25）要解决的事。

→ **所以这件事上最该做的不是再造一个提醒，是把 PR #2065 合掉。** 我这个窗口不合别人的 PR，转给小秘书。

## ④ 顺带查实的两件

**5 个客户每小时都在失败，而任务状态写的是 `completed`**（`failed_count=5`）：

| 客户 | 报错 | 谁能修 |
|---|---|---|
| NAL · NZCPE 2026 | `page_not_verified` | **员工点一次「重新核实」** |
| Magic Lab Class | code 190 权限被撤 | 客户主页管理员重新授权 |
| Roman HU · East International | code 200 角色不对 | 同上 |
| CTS | 正常（8 段对话 / 4 条消息） | — |

**两个检测器的覆盖是完整的**（逐条拿真实报错串试过）：`facebook-sync-items` 抓 190/200/10 那三家，`page-binding-items` 抓 `page_not_verified` 那两家。我 9-26 建的那个检测器**故意**不管 `page_not_verified`（注释里写了原因），分工是对的 —— 因为两种修法完全不同，合成一张卡就会给出错的指示。

两张卡在 PR #2065 里都分到了车道（`facebook_sync_failing` → 要人点一次；`facebook_page_binding_unverified` → 系统判不了真假），砍到 5 类之后不会消失。
