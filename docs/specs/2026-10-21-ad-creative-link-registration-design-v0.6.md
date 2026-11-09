# 广告素材补链（ad_creative_links）· 设计 v0.6（定稿小修）· 只设计，未写代码 · 119 号 · 2026-10-21

> 在 v0.2–v0.5 之上：**冲突处以本稿为准**。吸收魏征对 v0.5 的 3 条意见。风险级 A。

## 1. 「有效签字」不再用部分唯一索引（改写 v0.5 §2）
部分索引条件只能引用本行固定值，查不了工单表里会变的「当前哈希」；且工单重渲回旧哈希 A 时旧签字会「复活」。改为两步：
- **写入时**：函数 `creative_binding_attest_v1` 在**同一事务内**读工单当前文件哈希，要求等于入参哈希才写；写之前先确认该工单没有「哈希相同且未被撤回」的签字（普通唯一键 `(work_order_id, final_mp4_sha256)` 保留，对旧哈希 A 重签 = 视为已存在，直接引用旧签字而非新增，不冲突）。
- **读取时**：「有效」= 签字哈希等于工单**此刻**文件哈希，**每次读取现场比对**，不靠索引或存储字段。工单重渲回 A，A 的签字重新有效是**预期且可追溯的**（文件内容确实与当初 PM 看过的一致）；关联行是否「采信」仍由关联行的 stale 标记与启用时实时读 Meta 决定。
- 触发器放行清单：`stale_at`/`stale_reason`（见 §3 追加式）的受审写入，**以及 `retracted_at/retracted_by/retract_reason` 的受审写入**（只经 `link_retract_v1`）；其余列一律拒。

## 2. 按写入者拆数据库角色（改写 v0.5 §1）
六个函数共用一个角色等于没拆权限（自动登记出 bug 就能调签字函数自己给自己签，绕开「生产方≠验收方」）。改为**每个写入者各一个数据库角色，只授各自函数的 EXECUTE**：

| 角色 | 可执行函数 | 对应写入方 |
|---|---|---|
| `ad_link_creation_rw` | `link_ad_at_creation_v1` | 建广告处（winner_reel_sync、publishDraftPaused 后的 linkAdToCreative） |
| `ad_link_registration_rw` | `link_ad_registration_v1` | 每日自动登记、补登路由 |
| `ad_link_attest_rw` | `creative_binding_attest_v1` | 管理员会话签字路由（唯一） |
| `ad_link_backfill_rw` | `link_ad_backfill_v1` | 回填（PM 授权批次） |
| `ad_link_retract_rw` | `link_retract_v1` | 撤回（PM 授权+理由） |
| `ad_link_stale_rw` | `link_mark_stale_v1` | stale 标记（swap_creative 意图、对账扫描） |

- 任何角色**对表无直接写权限**；PUBLIC 与 service_role 无 EXECUTE；常驻权限断言按此矩阵逐格检查（多出的授权 = 红）。
- **凭据落点：未核实**。需在实现设计第一节核清：各角色的连接凭据放在哪里（Render 环境变量按服务拆分？Supabase 角色密码如何轮换）、确认 Oztop 插件及任何客户站点读不到；核实前不假设可行。

## 3. 换创意的结果未知与 stale 原因追加（改写 v0.5 §3）
- 区分 **「明确失败」** 与 **「结果未知」**（超时、进程崩溃、网络断）。
- 顺序仍是：先写 `swap_pending` 意图 → 调 Meta。
  - 明确成功：补写新创意编号的新关联行，旧行 stale。
  - 明确失败（Meta 返回错误且确认未换）：清除意图前**先读 Meta 当前创意编号**，确认仍是旧创意，才清除（由 `link_mark_stale_v1` 的受审路径写「意图作废」，不是静默删）。
  - **结果未知：保持 `swap_pending`，不清除**；由**每日扫描自动对账**：读 Meta 该广告当前创意编号，等于旧 → 作废意图；等于新 → 补写新关联行、旧行 stale；两者都不是 → 出红色待办。**不依赖每次 PM 授权迁移**（Meta 失败很常见）。
- **stale 原因改为追加式**：`stale_at` 仍只能从空变有值（首次时间），原因另存**追加表** `link_stale_reasons(link_id, reason, at, by)`，后来发现别的问题可追加，不覆盖。
- 手在 Meta 后台/MCP 换创意仍不经本路径，兜底同 v0.5：启用/核验时实时读 + 每日扫描，窗口最长到下一次扫描。

## 4. 未核实
- 各角色凭据落点与轮换（§2）；追加原因表是否复用台账的回执机制（实现设计里定）。
