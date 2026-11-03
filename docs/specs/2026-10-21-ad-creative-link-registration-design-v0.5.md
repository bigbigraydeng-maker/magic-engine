# 广告素材补链（ad_creative_links）· 设计 v0.5（小修增量）· 只设计，未写代码 · 119 号 · 2026-10-21

> 在 v0.2–v0.4 之上：**冲突处以本稿为准**。吸收魏征 v0.4 验收意见 + 台账 v0.8 对齐项（122）。风险级 A。

## 1. 「受保护函数」的身份与出口
- **服务身份 = 独立的数据库角色 `ad_link_writer`**（不是 service_role）。凭据只存 ME 服务端运行环境，**不放进 Oztop 插件或任何客户站点能拿到的位置**。service_role 对两张表与这些函数一律无写权限/无 EXECUTE。
- 每个现有写入者对应**一个窄函数**，不开通用 upsert：`link_ad_at_creation_v1`（建广告处，winner_reel_sync / `publishDraftPaused` 后的 `linkAdToCreative`）、`link_ad_registration_v1`（每日自动登记 + 补登路由）、`link_ad_backfill_v1`（回填，需 PM 授权批次号）、`creative_binding_attest_v1`（签字）、`link_mark_stale_v1`（stale 标记，单独一个，只写 stale_at/stale_reason）、`link_retract_v1`（撤回，PM 授权+理由）。
- 台账 v0.8 对齐：已解析行 UPDATE/DELETE/TRUNCATE 全拦；`unresolved→已解析` 只能由上述 DEFINER 函数写（会话标志）；行上加 `link_source`（ad_creation_path / registration_entry / backfill_<批次>）、`created_by`、`retracted_at/by/reason`（只经 `link_retract_v1`）、`meta_created_time`（原 `ad_created_at` 改名，登记入口读 Meta 时写入）。
- **如实写残余风险**：`signed_by`、时长、文件哈希由路由在管理员会话里读出后传给函数；**数据库函数无法自验这些值，签字真伪的根仍是管理员会话，数据库层只防直写**。

## 2. 重签路径自洽
- 唯一键：**签字表 `(work_order_id, final_mp4_sha256)` 唯一**；撤销 v0.3 的 `video_id` 唯一与 v0.4 的 `work_order_id` 唯一（二者与重签矛盾）。
- 签字表追加式、**不加 stale 列**；「是否有效」由派生：**部分唯一索引「同一工单同一时刻只有一条有效签字」**，有效 = 该签字哈希等于工单**当前**文件哈希（每次读取现场比对）；工单重渲后旧签字自然失效，不必改签字行。
- 关联行 `attestation_id` 对已解析行**不可改**；重签后**广告走新关联行**（旧行经 `link_mark_stale_v1` 标 stale，新行指新签字，二者并存可追溯），不允许改 attestation_id。关联行触发器只放行 stale_at/stale_reason 两列的「空→有值」更新。

## 3. 换创意的顺序与兜底（不假装能同事务）
- Meta 调用是外部副作用，**无法与库同事务**。`ads.swap_creative` 顺序：①先经 `link_mark_stale_v1` 写「换创意中」意图（stale_reason='swap_pending'）→ ②调 Meta → ③成功：补写新创意编号的新关联行；失败：写失败回执并**由受审通道清除该意图**（PM 授权的迁移/函数，带理由），不是静默清。
- 失败/漏标兜底：台账核验与启用时**实时读 Meta 比对创意编号**；承认**在 Meta 后台或 MCP 手换创意的完全不经本路径**，只靠「启用/核验时实时读」+每日扫描兜底，**窗口最长到下一次每日扫描**。
- stale 清除的受审通道 = PM 授权的迁移（单向原则不变）。

## 4. 未核实
- `ad_link_writer` 角色在 Render/Supabase 上的凭据落点（实现设计里定，须避开任何插件可读位置）；各窄函数入参形状。
