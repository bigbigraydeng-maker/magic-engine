# 刀① 已批计划步骤一键起草 + 刀② 起草器挂受众 — 方案 v0.1（送 74 审，未动手）

- 作者：119 号窗口　日期：2026-10-26　风险级：刀①=A（钱/授权/新路由），刀②=A（改 Meta 回读闸门）
- 状态：**仅方案，等 74 回「按此做」再动手**。下面标【待核】的是我还没在代码里证实的假设，动手前先核。

## 0. 现状（已读代码）
- 现有起草 `POST /api/clients/[id]/marketing-plan/[planId]/promo/draft`：只收 `status='draft'` 的计划（否则 409），纯只读、只算建议，不落库（route.ts:60-66）。
- 建广告入口 `POST /api/clients/[id]/meta-ads/draft`（lead_form / video_thruplay / messenger）：建出来一律 PAUSED，进 `/dashboard/ad-approval` 等 PM 点开。
- 回读闸门 `meta-readback-adapter.ts`：`nameClaimsRetargeting` 按名字猜“是不是重定向”，猜中会多查 blocker（:97）。
- 3066（在飞，CRM 结果上下文）与 2822（在飞，结构化定向）都改 `promo/draft` 相关文件。

## 刀①：已批计划步骤 → 一键起草成 Meta 草稿（估 2–3 天，与魏征一致）
**目标**：计划已批准（approved）后，PM/员工在某个 `ads_campaign` 步骤上点一次，ME 生成一条 PAUSED 草稿并进审批页，不再手填参数。
1. 新路由（不改 `promo/draft`，避开 3066/2822 的文件）：`POST …/marketing-plan/[planId]/steps/[stepId]/draft-launch`。只收 **已批准**计划里的广告步骤；授权用 `requirePlanApproverAccess`。
2. 参数来源：账户/地区/年龄/日预算/天数全部从该步骤与 `ad_strategy_configs` 取；**起草支持从客户名下账户选账户**（沿用 `loadOwnedAccounts`，账户必须属于该客户，否则 400）。
3. 建前必调一次 `computeLaunchHeadroom`（launch-budget-headroom.ts）：超账户/客户日上限 → 409 + 人话原因，不建。
4. 账本：`DraftRecord` 增加 `plan_id` / `step_id`，并与 3010 v0.7 的计划指纹对齐（**指纹字段以 3010 v0.7 为准，我动手前先逐字读**）；**复用 2381 的意图行**（`action_runs` 幂等键），不另起新表。同一步骤重复点击 → 返回已有草稿（幂等），不重复建。
5. 审批页（/dashboard/ad-approval）每条显示：账户 / 地区 / 年龄 / 素材缩略图（含是不是视频）/ 日预算 / 来源计划与步骤。
6. 不做：处方→计划步骤自动生成（A 级，按 74 说先不做）。不自动点开；开仍只认 PM 在审批页点。
7. 测试：路由权限（非审批人 403/未批计划 409/他人账户 400）、幂等、headroom 超限拒、DraftRecord 带 plan/step、回归现有 meta-ads/draft。
8. 先对齐：3066 与 2822 的合并顺序；`DraftRecord` 位置【待核】（draft-and-gate.ts 附近）。
**风险**：A 级（碰钱与授权入口），按 A 级流程：草稿 PR + 子牙/魏征双审 + PM 本人「合」。当场试跑：用 $1 试跑那条链路（第 4 步）验证。

## 刀②：起草器挂自定义受众（含排除名单）（估 1 天）
**目标**：草稿可带 `custom_audiences`（包含）与 `excluded_custom_audiences`（排除），建时写进广告组 targeting。
1. `AdDraft` 增加可选 `audienceIds` / `excludedAudienceIds`；`validateDraft`：受众必须**属于该广告账户**（建前用 Graph 只读核对，读不到 → 拒，不放行）；总数设上限。
2. `ad-publisher.targetingFor`：写入 `custom_audiences` / `excluded_custom_audiences`（Meta 格式 `[{id}]`）；**不能与 `targeting_automation.advantage_audience` 冲突**【待核：开启受众时 Advantage 设置的行为，需用 $1 试跑实测】。
3. 回读闸门：给了受众 → 显式传 `isRetargeting`（来自草稿），**不再靠 `nameClaimsRetargeting` 猜名字**；`meta-readback-adapter.ts:97` 对“声明是重定向”会多查三条 blocker，需为这三条各补测试（受众为空、受众过小/未就绪、排除名单与包含名单重叠）。
4. 测试：属于账户/不属于账户、排除名单写入、blocker 三条各一、无受众时行为不变。
**风险**：A 级（改闸门与定向）；与刀①无文件冲突，可独立先后。

## 顺序与依赖
- 先做 第 3–5 步（74 已派），再等 74 对本文回复。建议顺序：刀② 先（小、独立、可被 $1 试跑顺带验证）→ 刀①（等 3066/2822 落地后）。
- 每刀单独 PR，A 级草稿，攒一次推。
