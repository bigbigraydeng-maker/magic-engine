# 证据：私信广告类型 · 当场试跑阶段 A · 2026-10-04（NZ 时间）

对应台账卡：`2026-10-04-me-messenger-ad-trial-run-awaiting-pm`。PM 在对话里亲口回「试跑」后执行。
**阶段 A = 用 Meta 官方广告连接器，按设计稿 §3 的参数表在 CTS 个人广告账户（名为 Pengyu Deng）建一套暂停对象，读回，删除。它验的是「Meta 接受这组参数」，不是「ME 自己的代码」——阶段 B 还没做。**
对象 id 为避免与台账账号检查冲突只留后 8 位。

## 做了什么（真实写入，全部是新建的、名字带「ME-试跑-请删除」的对象）

| 步骤 | 对象 | 参数 | 结果 |
|---|---|---|---|
| 试跑前快照 | 账户内全部广告系列 | 只读 | 共 28 个；生效中 4 个（CTS ThruPlay、CTS 重定向、金色中国私信英文市场、CTS 留资） |
| 建广告系列 | …19360307 | 互动目标 `OUTCOME_ENGAGEMENT`，竞价，不设预算 | 建成，`PAUSED`；Meta 返回的可用优化目标含 `CONVERSATIONS` |
| 建广告组 | …21600307 | 对话优化 + 落点 `MESSENGER` + 主页 + 日预算 5 新西兰元 + 定向 NZ 25–65 且关优势受众 | 建成，`PAUSED` |
| 建广告（内联创意） | …22960307 | 视频(账户内已有、10 秒、`video_status: ready`) + 缩略图 hash + 按钮 `MESSAGE_PAGE` + `app_destination: MESSENGER`，**无 link、无欢迎语** | 建成，配置状态 `PAUSED` |
| 读回 | 三层 | 只读 | 见下 |
| 删除 | 广告 → 广告组 → 广告系列 | 状态改 `DELETED` | 三层读回均 `DELETED` |
| 试跑后快照 | 账户内全部广告系列 | 只读 | 仍是 28 个，4 个生效中的与试跑前完全一致，列表里没有试跑对象 |

全程**没有调用任何「开启」类工具**。

## 读回到的事实

- 广告系列：`status` = `PAUSED`，`effective_status` = `PAUSED`，目标 `OUTCOME_ENGAGEMENT`。
- 广告组：`status` = `PAUSED`，`effective_status` = `PAUSED`，`optimization_goal` = `CONVERSATIONS`，`destination_type` = `MESSENGER`，日预算 5 新西兰元。
- 广告：`status` = **`PAUSED`**，`effective_status` = **`IN_PROCESS`**（创建后的短暂处理态）。
- 创意：正文 / 标题 / 描述原样保留；`call_to_action_type` = **`MESSAGE_PAGE`**；读回里没有 `link_url`。

## 对设计稿 §3「猜的」三条的结论

| 猜测 | 结论 |
|---|---|
| ① 按钮 `MESSAGE_PAGE` + 接口建 + 无链接 | **被接受**（创意建成、读回按钮类型保持）。注意：这是官方连接器的建法；ME 自己走 Graph `/adcreatives` 的那一条还没验（阶段 B）|
| ② `OUTCOME_ENGAGEMENT + CONVERSATIONS + MESSENGER + 主页` 整组 | **被接受** |
| ③ 不传 `page_welcome_message` 能否过审 | **创意能建成**，没被拒；是否最终过审要等 Meta 审核，本次对象已删，**未验到审核结果** |

## 试跑带来的新发现（影响代码判断）

1. **`effective_status` 在创建后会短暂是 `IN_PROCESS`，不是 `PAUSED`。** ME 的「建成预期」检查读的是配置状态 `status`（读回为 `PAUSED`），所以不会被误判；如果当初检查的是 `effective_status`，每条新建广告都会被误拦。这个选择经实测是对的。
2. **视频状态结构与代码一致**：`status.video_status` = `ready`（`waitForVideoReady` 读的就是这个字段）。
3. **创意里的视频号被 Meta 换成了一个新的**（传入的是已有视频，读回的创意里是另一个新建的视频副本，标题取自广告标题，10 秒、`ready`）。ME 的回读目前不比对视频号，所以不会被误拦；但这意味着「回读到的视频号 ≠ 传入的视频号」是正常现象，以后若要加视频号比对必须考虑它。**这是官方连接器路径的行为，ME 走 Graph 时是否同样如此未验证。**

## 没验到的（不能说成验过）

- **Meta 自动问候语能否在回读里读到**：连接器读不了 `object_story_spec`，**阶段 A 验不了**，需阶段 B 用 ME 自己的回读。
- **ME 自己的代码**（`createDraftForApproval` 全链路、`waitForVideoReady` 对真实视频、补暂停、时间预算）：全部**未在真实账户跑过**。
- 广告最终是否过审：对象已删，未观察到审核结果。

## 残留（删不掉，已如实记录，均不在任何广告上、不花钱）

- 1 个创意 …41539552，状态 `IN_PROCESS`。连接器的「删创意」和「改创意」工具对该账户均报「暂未开放」，无法删除或改名。
- 1 个视频副本 …41641440，标题「Message us」，10 秒。连接器没有删视频的工具。
- 需要人在 Meta 后台（广告库 → 创意 / 视频）手动删除；或等连接器对该账户开放后由我补删。
