# 验证记录：把 NAL 那条已死的 Meta 存储令牌标成 error，表单留资并没有恢复

- 验证时间：2026-09-27 约 01:00 NZDT（改动执行于 2026-09-26 13:00:58 UTC）
- 生产库：CrazyContent（`glbdnayojixmexgofbsd`）
- 结论：**失败**。改动本身按预期生效，但没达到目的——留资一条都没进来。

## 做了什么

PM 2026-09-27 批准后，执行一条 UPDATE：`platform_oauth_connections` 里 NAL 那条
Meta 连接（account_id `…5430100`）的 `status` 由 `active` 改为 `error`，并写入原因。
三重收口（row id + client_id + provider + 只在 status 仍是 active 时才改），
返回 1 行，`updated_at` 2026-09-26 13:00:58。

## 当场试跑（改完立刻）

调生产代码里同一个函数 `syncClientMetaLeads`（不是重写一遍逻辑），NAL 单客户跑一次：

```
BEFORE 表单留资触点=3 联系人=197 最新留资=2026-09-01T10:49:08+00:00
RESULT { forms: 0, leadsFetched: 0, leadsIngested: 0, newContacts: 0,
         skipped: "page_not_verified",
         error: "主页绑定没核实，线索同步已暂停（unverified_shared_token）" }
AFTER  表单留资触点=3 联系人=197 最新留资=2026-09-01T10:49:08+00:00
DELTA  留资 +0  联系人 +0
```

## 为什么失败

改动确实让 `loadStoredPageToken` 不再返回那把死令牌了。但同步并没有因此用上
env 共享令牌——它撞上了**我们自己的**一道闸（AD-SEC-4）：

`meta/page-sync-authorization.ts` 的 `evaluate()` 顺序是
存储令牌 → 员工核实记录 → 共享令牌。NAL 没有员工核实记录，于是走到第 108 行
`if (userToken.source === 'shared_fallback') return refuse('unverified_shared_token')`
——公用令牌不许去读一个没被员工核实过绑定的主页。

判定复核（只读跑 `assessConfiguredPage`）：`{"verified":false,"reason":"unverified_shared_token"}`

## 我的验证漏在哪

改之前我做过一次探针，证明 **Meta 那边会放行**：用 env 令牌换到 NAL 主页的
Page Token，`leadgen_forms` 读回 HTTP 200 有数据。那个结论是对的，但它只证明了
「Meta 允许」，**没有证明「我们自己的代码允许」**。中间还隔着一道我们自己的闸。
向 PM 要授权时我把前者当成了后者。

## 现在 NAL 会收到哪张待办卡（只读跑两个检测器实测）

- 主页绑定检测器 → 1 条，文案是「点『重新核实』」，链接直达 NAL 设置抽屉的
  Facebook 主页卡片。**这正是现在该做的那一步**，而且是员工侧就能完成的，
  不用等客户。
- 同步失败检测器 → 也出 1 条。这是暂时的：它读的是改动之前那几轮运行记录
  （还带着 code 190）。下一轮定时同步之后，NAL 的结果会带 `skipped:
  page_not_verified`，那个检测器会按设计跳过它，只剩主页绑定那一张卡。

## 为什么不撤回

1. `error` 是**真话** —— 那把令牌确实已经死了（Graph 两条路径都报 190）。
   原来的 `active` 是假的，撤回等于把假状态放回去。
2. 改完之后 NAL 被路由到了**正确的那张卡**（「点重新核实」，员工侧可完成），
   而不是原来那张「请客户主页管理员重新授权」。后者成本高得多。
3. 没有变坏：改前 0 条留资，改后 0 条留资。

撤回语句仍然有效、随时可用（见 session 5b9407a2 scratchpad 的快照文件）。

## 下一步（一步，员工侧）

打开 NAL 客户页的设置抽屉 →「Facebook 主页」卡片 →「重新核实」。
它会让 Meta 核实、查重复、写下核实记录；有了那条记录，`staffVerified` 成立，
共享令牌就被允许读这个主页，表单留资随下一个整点进来。

私信仍然进不来——那是另一回事（缺 `pages_messaging` / 该身份在这个主页没有
合适角色），只能 NAL 主页管理员重新授权，已在 9-29 日历提醒里。
