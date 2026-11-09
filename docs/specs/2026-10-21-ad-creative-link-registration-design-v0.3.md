# 广告 ↔ 成片 关联行补链设计 v0.3（增量稿）· 只设计，未写代码 · 119 号 · 2026-10-21

> 在 `…-design-v0.2.md` 之上的增量：**冲突处以本稿为准**，没提到的保持 v0.2。吸收子牙+魏征对 v0.2 的复审（「不可进实现，再修一轮」）与 74 号的两点决定（PM 签字可作绑定的根；强度 3 留作未来增强）。风险级 **A**。

## 1. 广告被换创意后，关联行会过期（两位都提）

- 事实：Meta 上广告可以换创意（仓库里 `ads.swap_creative`，登记在 `envelope-facts.ts:43`）。关联行是写一次不可改的 `ad_id → 工单`，换创意后它继续把归因记在旧工单上。
- 设计：关联行新增 `meta_creative_id`（建行时读到的创意编号）与两个**可变的标记列** `stale_at`、`stale_reason`。每日自动扫描对每条已有关联行读广告**当前**创意编号；对不上 → 只写 `stale_at/stale_reason`、出待办，**不改绑定列**、**不放行 observed_live**（台账 v0.7 observed_live 要求关联行「未 stale 且 `meta_creative_id` 等于当前创意」，请 122 在核验里加这两条）。触发器**只放行 `stale_at/stale_reason` 这两列的更新**（其余列的 UPDATE/DELETE/TRUNCATE 仍全拦）。
- 对 `stale` 行：想继续归因要走「新广告建新行」或带 PM 授权的回填路径，不原地改。

## 2. PM 签字（强度 2）作为绑定的根——必须满足的四条（含魏征补充）

74 号已定：可以作根；本稿把条件写死：
1. **独立按钮动作**：签字**不能搭在「批准素材」同一次点击上**（10-19 PM 把两个「我已核实」当成批准的事故）。页面单独一个按钮，文案固定：「我确认这条视频就是工单 XXXX 的成片」。批准素材与签字是两次独立点击、两条独立记录。
2. **页面要有系统自己算出来的证据，不能靠标题前缀**（标题谁都能改成带前 8 位）：
   - 并排展示：Meta 视频的预览、时长、上传时间；工单名/日期/文案；工单 `final.mp4` 的时长与首帧；
   - **时长差超过容差（±0.5 秒）→ 禁止签字**（机器判，不给「仍然签」的按钮）；首帧并排展示给 PM 看，不做自动相似度判断（本期不做）；
   - 页面显示的「视频=工单」不能全靠标题：必须有系统事实——工单 `final.mp4` 的 SHA-256 与时长在签字时由服务端从存储读出并记录（见第 3 条）；ME 上传记录属强度 3，本期没有（**未核实** `meta/asset-upload` 是否留存 `video_id`，本期不依赖）。
3. **签字记录钉死内容，写入要带签字记录 id**：新增小表 `creative_binding_attestations`（A 级迁移，RLS `FOR ALL TO service_role`，**追加式、不可改、不可删**，触发器同样拦 UPDATE/DELETE/TRUNCATE）：`id, client_id, video_id, work_order_id, final_mp4_sha256, final_mp4_duration_s, meta_video_length_s, signed_by, signed_at`；`video_id` 唯一（一个视频只能被签一次；换绑 → 409，要换走 PM 授权的回滚）。
   - 素材池条目的 `work_order_ref`、关联行的 `link_strength='pm_attested'` **必须带 `attestation_id`**，数据库触发器/CHECK 校验该记录存在且 `(video_id, work_order_id)` 对得上——**服务端任何代码都不能直接写 `pm_attested`**。
   - 工单被重渲后 `final.mp4` 哈希变了：绑定自动**失效**（关联行读时比对哈希，不一致 → 标 `stale`，不放行）。
4. **照实记 `pm_attested`**，把它当「人认定」而不是「系统认定」：凡是拿它给学习/归因当强证据的地方**降一档**（不与 `post_id` 命中同权重）。

## 3. 升级路径与回滚路径不能给攻击者留口子（魏征）

- 升级限定：`unresolved/provisional → 内容绑定类` **只允许一次**，且若原行已有 `creative_ref`（provisional 带着工单），**升级后的 `creative_ref` 必须与原来一致**（不能先写一个临时工单、再升级成另一个）。
- **回滚不用会话变量开关**（那是后门）。回滚 = 一次**经 PM 授权的受审迁移文件**，在迁移事务里对表执行 `ALTER TABLE … DISABLE TRIGGER`、做按 `created_by` 过滤的修改、再 `ENABLE TRIGGER`；没有运行时旁路。每次回滚都是一个有 PR、有 PM「合 N」的迁移。
- **素材池条目删了再加同一个 `ref` 不能重置绑定**：绑定的权威是上面的 `creative_binding_attestations`（键是 `video_id`，不是素材池条目），条目被删除后重新添加，会自动重新关联到已有的签字记录，不能借此换绑。
- 强度 3（ME 从工单 `final.mp4` 上传）本期**撤出**设计范围：它要求上传接口保证「上传的文件就是该工单当前版本」（记 `final.mp4` 版本/哈希）、且要先核实 `meta/asset-upload` 是否留存 `video_id`；这些我现在没证据，写进「未来增强」，不在本期承诺。

## 4. 其它收口（魏征/子牙非阻塞项）

- **§4 与 §6 对「读 Meta 还是读快照」的矛盾**：统一为——**每日自动登记**用快照找出「没有关联行/需要复核」的广告清单，**判定本身必须读 Meta 实时创意**（取 `object_story_spec`、`effective_object_story_id`、`created_time`、创意编号）；快照里新增的 `creative_source_video_ids` 只用于推广期扫描等「只读快照」的场景，不用于登记判定。
- **路 0 只来自 4 条样本**：补**降级**——读不到 `object_story_spec`（用现成帖子建的广告、轮播/动态素材形态不同）→ 退回路 1（帖子 id）/别名兜底 → 仍不行 → `unresolved` 并写明原因；不因路 0 失败而猜。
- **`created_by` 封闭类型**补 `auto_register`（每日自动登记）；`link_strength` 词表与台账 v0.7 对齐：本稿用 `post_id`、`pm_attested`（`me_upload` 留给未来）；**台账里的 `asset_pool_title` 取消**（标题核验强度 1 只产生 `asset_binding_provisional`，不进 `link_strength`）。请 122 在台账迁移里同步词表。
- 实现时要同步改 `creative-link.test.ts:349` 里钉着 `boost_post_api` 的测试（该路径已退役）。

## 5. 对 v0.2 的撤销/改动清单
- v0.2 §2 强度表：强度 3 撤出本期；强度 2 按本稿 §2 加四条；强度 1 不变（仅 provisional）。
- v0.2 §5 触发器：加 `stale_at/stale_reason` 可变列、加升级约束、回滚方式改为迁移内 `DISABLE TRIGGER`。
- 迁移清单更新：`ad_created_at`、`registered_by`、`link_strength`、`meta_creative_id`、`stale_at`、`stale_reason`、`attestation_id` 列；`post_id` 改可空；新表 `creative_binding_attestations`；触发器；`created_by`/`link_method` 取值扩展。

## 6. 未核实 / 待决
- `final.mp4` 是否都能从存储读到（路径格式 `renders/<client>/<order>/final.mp4`，我读过工单 `output.video_path`，没验证存储对象可读）；时长容差 ±0.5 秒是我的取值，待 CTS 实际素材验证。
- 批准页要显示首帧：需要从 `final.mp4` 取首帧的方式（服务端 ffmpeg 还是预先生成的缩略图），实现设计里定。
- PM 签字页面的具体位置（广告健康页「可用于广告的视频」那一块）与 106/74 的素材流程衔接。
