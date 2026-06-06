# Codex 任务 — Initiative ↔ Campaign ↔ Marketing Plan 硬约束

> 派活日期：2026-06-07
> Owner：**Codex 独占**，期间 Claude Code 不会动以下文件
> Base commit：`4ced2a3` (origin/main HEAD)
> 工作分支：`fix/initiative-campaign-constraint`（你必须 `git checkout -b` 创建，**不要在 main 上改**）

---

## ⚠️ 重要 — 上次撒谎事故

2026-06-07 你提交过一份"工作总结"声称改了同样这 5 个文件 + 写了测试，子牙 grep 复核发现 **6/6 项全部为空**：

- `PlanGenerator` props 没有 `allowedCampaignIds` 字段（全仓 grep = 0 命中）
- `generate/route.ts` POST 没有任何 initiative 校验逻辑
- `task-dispatcher.ts` 完全没有 `initiative_id` 字符串
- `route.test.ts` 文件根本不存在
- 0 commit / 0 PR / 0 push

**这次必须给真实证据**：commit hash、PR 号、`git diff --stat`、完整 `npx vitest run` stdout。如果做不到、做不全、或中途卡住，请**直接说**，不要再编工作总结。

---

## 业务目标

把"Initiative 绑定的 Campaign 只能生成到它自己的 Marketing Plan 上"从口头约定升级成**前端限制 + 后端硬校验 + 任务继承**，防止结构性脏数据。

链路：
```
initiative (campaign_ids: [c1, c2]) 
   └─ marketing_plan (initiative_id=I, campaign_id ∈ [c1, c2])
        └─ execution_items (initiative_id=I, marketing_plan_id=P, campaign_id ∈ [c1, c2])
```

约束规则：

1. **Initiative 有 `campaign_ids`** → Plan 的 `campaign_id` **必须** ∈ `campaign_ids`
2. **Initiative 没有 `campaign_ids`** → 不允许传 `campaign_id`（只能做 DNA-only plan）
3. **Plan 没绑定 Initiative**（`initiative_id` 为 null）→ Campaign 选择不受约束（按现有逻辑：active campaigns）
4. **task-dispatcher** 派发时，`execution_items` 必须继承 `plan.initiative_id`

---

## 文件清单（绝对路径 + 行号范围）

### 改动 1 — `/api/clients/[id]/initiatives` GET 返回 `campaign_ids`

**文件**：`src/app/api/clients/[id]/initiatives/route.ts`
**位置**：行 35-41（map slim shape）
**当前代码**（行 35-41）：
```ts
const initiatives = rows.map(r => ({
  id:              r.id,
  title:           r.title,
  initiative_type: r.initiative_type,
  goal_id:         r.goal_id,
  goal_title:      r.goal_title,
}))
```
**目标**：追加 `campaign_ids: r.campaign_ids ?? []`。

**前置确认**：`listInitiativesForClient` 在 `src/lib/strategy/initiatives.ts:46` 已经返回 `campaign_ids`（行 226 是定义）—— 直接透传即可，不需要改 lib 层。

---

### 改动 2 — `task-dispatcher.ts` 让 `execution_items` 继承 `initiative_id`

**文件**：`src/lib/marketing-plan/task-dispatcher.ts`
**位置**：两处 `execution_items` insert payload

**位置 A**：行 146-155 — 维度聚合 insert（plan 批准后批量派发）
```ts
const inserts = Object.entries(grouped).map(([dim, itemIds]) => ({
  client_id:                   plan.client_id,
  ...
  marketing_plan_id:           plan.id,
  campaign_id:                 plan.campaign_id,
  ...
}))
```
**目标**：追加 `initiative_id: plan.initiative_id ?? null,`

**位置 B**：行 183-187 — 单条 task row insert（如果存在）
请 grep 文件里所有 `from('execution_items').insert(` 的位置，**全部**追加 `initiative_id`。

**确认 DB 字段存在**：执行 `grep -rn 'initiative_id' supabase/migrations/` 确认 `execution_items.initiative_id` 已经在 schema 里。如果没有，**停手**告诉子牙，需要先建 migration（用 service_role 模板，见 CLAUDE.md）。

---

### 改动 3 — `PlanGenerator` 接受 `allowedCampaignIds` props

**文件**：`src/app/dashboard/clients/[id]/marketing-plan/_components/PlanGenerator.tsx`
**位置**：行 35（Props 接口）+ 行 46（函数签名）+ Campaign 下拉的过滤逻辑

**当前 Props（行 35-44）**：
```ts
interface Props {
  clientId: string
  onGenerated: ...
  onCancel: ...
  initiativeId?: string
  defaultTitle?: string
}
```
**目标**：
1. 加 `allowedCampaignIds?: string[]` —— 解释：当 `initiativeId` 提供时，调用方传该 Initiative 的 `campaign_ids`。
2. Campaign 下拉过滤逻辑：
   - 如果 `allowedCampaignIds` 是 **undefined** → 现有逻辑不变（active campaigns）
   - 如果 `allowedCampaignIds` 是 **非空数组** → 只能从这些 ID 里选
   - 如果 `allowedCampaignIds` 是 **空数组**（initiative 没挂 campaign）→ 下拉禁用 + 显示"This Initiative has no campaigns yet — Plan will be DNA-only"

**关键**：状态管理上，如果用户切了 Initiative（虽然现在没这个 UI 路径），`campaign_id` 选择如果不在新的 `allowedCampaignIds` 里应该重置为空。

---

### 改动 4 — `InitiativeExecutionPanel` 把 `linkedCampaignIds` 传给 PlanGenerator

**文件**：`src/app/dashboard/clients/[id]/goal/[goalId]/_components/InitiativeExecutionPanel.tsx`
**位置**：行 79 已有 `const linkedCampaignIds = initiative.campaign_ids ?? []`；找 `<PlanGenerator` 渲染处

**目标**：渲染 `PlanGenerator` 的地方追加 `allowedCampaignIds={linkedCampaignIds}` prop。

---

### 改动 5 — `generate/route.ts` 后端硬校验

**文件**：`src/app/api/clients/[id]/marketing-plan/generate/route.ts`
**位置**：行 87-94 (`if (body.campaign_id)`) 之前 —— 也就是先校验 initiative-campaign 关系，再校验 campaign 归属客户。

**实施步骤**：

```ts
// ── 2a. 校验 initiative ↔ campaign 绑定关系 ────────────────────────────────
if (body.initiative_id) {
  const { data: initiative, error: initErr } = await supabaseAdmin
    .from('initiatives')
    .select('id, client_id, campaign_ids')
    .eq('id', body.initiative_id)
    .single()

  if (initErr || !initiative) {
    return NextResponse.json({
      success: false,
      error: 'Initiative not found.',
    }, { status: 400 })
  }

  // 跨客户防御
  if (initiative.client_id !== clientId) {
    return NextResponse.json({
      success: false,
      error: 'Initiative does not belong to this client.',
    }, { status: 403 })
  }

  const allowedCampaignIds: string[] = initiative.campaign_ids ?? []

  if (body.campaign_id) {
    // 规则 1：Initiative 有 campaign_ids → 必须 ∈
    if (allowedCampaignIds.length > 0 && !allowedCampaignIds.includes(body.campaign_id)) {
      return NextResponse.json({
        success: false,
        error: 'campaign_id is not linked to this Initiative.',
      }, { status: 400 })
    }
    // 规则 2：Initiative 没 campaign_ids → 不准带 campaign_id
    if (allowedCampaignIds.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Initiative has no campaigns; Plan must be DNA-only (do not pass campaign_id).',
      }, { status: 400 })
    }
  }
}
```

注意：原行 87 的 `getCampaignById` 校验保留，作为第二道闸（campaign 归属客户）。

---

### 改动 6 — 写测试

**新文件**：`src/app/api/clients/[id]/marketing-plan/generate/route.test.ts`

**最少 6 个 case**：
1. ✅ `initiative_id=null + campaign_id=valid` → 通过（不受约束）
2. ✅ `initiative_id=I, I.campaign_ids=[c1,c2], body.campaign_id=c1` → 通过
3. ❌ `initiative_id=I, I.campaign_ids=[c1,c2], body.campaign_id=c3` → 400 "not linked"
4. ❌ `initiative_id=I, I.campaign_ids=[], body.campaign_id=c1` → 400 "DNA-only"
5. ✅ `initiative_id=I, I.campaign_ids=[], body.campaign_id=null` → 通过（DNA-only plan）
6. ❌ `initiative_id=I 但 initiative.client_id != clientId` → 403 "does not belong"

**Mock 策略**：用 `vitest.mock('@/lib/supabase-admin', ...)` mock `supabaseAdmin`，参考仓里现有的 route test 风格（例如 `src/app/api/clients/[id]/initiatives/__tests__/` 或 `src/app/api/.../route.test.ts` 的 mock pattern）。

**变异防御**：测试 case 3 和 case 4 必须实测**返回 status === 400**且 body.error 包含关键字 —— 不要只断言 "success === false"（这种空架子断言会被子牙变异测试杀掉）。

---

## 验证清单（必须全部跑通并贴 stdout）

执行以下命令并把**完整 stdout** 贴回工作总结：

```bash
# 1. 新测试
npx vitest run src/app/api/clients/\[id\]/marketing-plan/generate/route.test.ts

# 2. 老测试（保证没回归）
npx vitest run src/lib/marketing-plan/__tests__/task-dispatcher.test.ts
npx vitest run src/lib/strategy/__tests__/execution-summary.test.ts

# 3. 类型检查
npx tsc --noEmit

# 4. 构建（最终关）
npm run build
```

**预期**：所有测试通过，`tsc` 无错误，`build` 成功。

---

## 交接证据要求（缺一即判定撒谎）

工作总结里**必须**包含：

1. ✅ **分支名**：`fix/initiative-campaign-constraint`
2. ✅ **每个 commit 的 hash**（`git log fix/initiative-campaign-constraint --oneline`）
3. ✅ **`git diff --stat main...HEAD` 完整输出**
4. ✅ **`git log main..HEAD --name-only` 完整输出** —— 让子牙看到改了哪些文件
5. ✅ **PR 号**（`gh pr create --base main --draft` 创建 draft PR，把 URL 贴回来）
6. ✅ **6 项验证清单的完整 stdout**（不要"省略前面"或"以下省略"）

---

## 子牙复审清单（你写完后他会跑）

- 真实性：每个声称的 commit hash 是否真的 `git cat-file -e <hash>` 存在
- 变异测试：把改动 5 里的 `!allowedCampaignIds.includes(body.campaign_id)` 改成 `allowedCampaignIds.includes(body.campaign_id)`（逻辑反转），test case 3 必须 fail —— 否则就是空架子测试
- 边界覆盖：6 个测试 case 全部存在
- 架构旁路：grep 整个仓里所有 `marketing_plans.insert(` —— 确认没有第二个写入路径绕过 generate/route.ts
- ROADMAP 登记：不需要新建 Phase，归入"Phase 33 strategy-execution bridge"

---

## 工作流要求

1. **不要在 main 上改** —— 必须 `git checkout -b fix/initiative-campaign-constraint`
2. **每个改动 1 个 commit**（建议 6 个 commit，对应 6 项改动）
3. **commit message 格式**：`fix(strategy): tighten initiative↔campaign↔plan constraint — <step name>`
4. **每个 commit 完成后立即 `git push origin fix/initiative-campaign-constraint`** —— 防止本地丢失
5. **最后 `gh pr create --base main --draft`** —— 子牙看到 draft PR 才会开始复审

---

## 如果中途卡住

直接说：
- "改动 X 我看不懂 Y" → 子牙会答
- "DB 没有 initiative_id 字段" → 停手等 migration
- "测试 mock 怎么写" → 子牙给样板
- "tsc 报错" → 贴报错给子牙

**不要硬编工作总结**。这次再编一遍，PM 会取消 Codex 派活资格。

---

子牙等你的 draft PR URL。
