/**
 * Kernel 审批应用层 —— 判定与编排。
 *
 * 🔴 **这一层只审批，不执行。**
 *
 *    批准的终点是 `authorized`：一条已经签好人签放行、但**还没有人去跑**的动作。
 *    真正把它跑掉（领执行权 → 调 capability → 落步骤 → 回执）是 WP07 的事。
 *    所以本文件只 import 授权段的 `approveRun` / `rejectRun`，
 *    **绝不 import** `approveAndRun` / `rejectPendingRun` / `executeAuthorizedRun` /
 *    `@/lib/capabilities` / `@/lib/kernel` 门面 —— 有架构测试盯着这条边界，
 *    也有行为测试盯着「批准之后一步都没跑」。
 *
 * 🔴 **身份一律来自服务端。** 操作者邮箱来自登录会话，客户归属来自
 *    `run.client_id`（从库里读出来的），动作的授权门槛来自 `ACTION_REGISTRY`。
 *    请求体里能带的只有三样：approve/reject、看到的那份审批请求的 id、原因。
 *    多一个字段就当伪造拒掉。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccessTier } from '@/lib/auth/access-types'
import type { ActionDefinition, ActionRun } from '@/lib/kernel/types'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { approveRun, rejectRun } from '@/lib/kernel/authorize'
import { KernelError } from '@/lib/kernel/errors'
import { createKernelDeps, type KernelDeps } from '@/lib/kernel/deps'
import { ApprovalError } from './errors'
import {
  getDecisionForApproval,
  getDecisionsByIds,
  getRunForApproval,
  listPendingRunsForClient,
} from './queries'
import type {
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  PendingApprovalDetail,
  PendingApprovalSummary,
} from './types'

// ── Capability tier 闸 ────────────────────────────────────────────────────────

/**
 * 这个档次的人能不能授权门槛为 `required` 的动作。
 *
 * 🔴 **冻结判定，白名单式，认不出一律 false。**
 *    · `admin`       —— 内部人员，可以授权任何动作；
 *    · `paid_client` —— 付费客户 / 代其操作的 FDE，可以授权门槛**不是 admin** 的动作；
 *    · `self_serve`  —— 自助免费档，一律不许授权（它连付费功能都进不去）；
 *    · `portal_only` —— 老门户，一律不许；
 *    · 认不出的档次 —— 一律不许（新加一档如果忘了在这里分类，默认是「不许」，
 *      不是「放行」。反过来写的话，加一个枚举值就等于悄悄开一道门）。
 *
 * 🔴 这道闸**必须自己站得住**，不能靠「反正 requirePaidClientAccess 已经把
 *    self_serve 挡掉了」。前面那道闸是按客户归属判的，将来它一放宽，
 *    这里就成了唯一一道 —— 所以它有自己的直测用例，不靠前一道闸遮着。
 */
export function canAuthorizeAction(actorTier: string, requiredTier: string): boolean {
  if (actorTier === 'admin') return true
  if (actorTier === 'paid_client') return requiredTier !== 'admin'
  return false
}

/**
 * 找出这条 run 对应的动作定义。
 *
 * 🔴 注册表认不出 = **不许授权**，不是「先批了再说」。
 *    认不出就说明没有人给它定过风险、副作用和授权门槛 ——
 *    那么「谁有资格点这个头」这个问题在系统里根本没有答案，只能 fail closed。
 */
function definitionFor(run: ActionRun): ActionDefinition | null {
  return ACTION_REGISTRY.get(run.action_key)
}

/** 档次不够就抛 403。够就安静返回。 */
export function assertActorMayAuthorize(run: ActionRun, actorTier: AccessTier): void {
  const definition = definitionFor(run)
  if (!definition) {
    throw new ApprovalError(
      'forbidden_tier',
      `系统认不出「${run.action_key}」这个动作 —— 没有人给它定过谁有资格授权它，` +
        '所以现在谁也批不了。这条已经安全停住，不会自动执行',
      { runId: run.id, actionKey: run.action_key, reason: 'unknown_action' },
    )
  }
  if (!canAuthorizeAction(actorTier, definition.requiredCapabilityTier)) {
    throw new ApprovalError(
      'forbidden_tier',
      `「${definition.title}」需要更高的权限才能批准 —— 你的账号档次不够。请让有权限的同事来点`,
      {
        runId: run.id,
        actionKey: run.action_key,
        actorTier,
        requiredTier: definition.requiredCapabilityTier,
      },
    )
  }
}

// ── 读 ────────────────────────────────────────────────────────────────────────

function toSummary(run: ActionRun, expectedDecisionId: string): PendingApprovalSummary {
  const definition = definitionFor(run)
  return {
    runId: run.id,
    clientId: run.client_id,
    expectedDecisionId,
    actionKey: run.action_key,
    actionVersion: run.action_version,
    purpose: run.purpose,
    goalId: run.goal_id,
    // 🔴 注册表认不出就是 null —— 不拿 action_key 当标题糊弄过去
    title: definition?.title ?? null,
    risk: definition?.risk ?? null,
    sideEffect: definition?.sideEffect ?? null,
    requiredCapabilityTier: definition?.requiredCapabilityTier ?? null,
    costEstimateUsd: run.cost_estimate_usd,
    costCapUsd: run.cost_cap_usd,
    rationale: run.rationale,
    requestedAt: run.updated_at,
  }
}

/**
 * 这个客户当前等人点头的动作。
 *
 * 🔴 指针为空、或指着的那份审批请求读不回来的 run **不进列表**：
 *    没有 `expectedDecisionId` 就没法安全地提交决定（人点头点的是哪一份说不清），
 *    而随便给一个 id 让人点，比不显示危险得多。这类数据不一致会被记进
 *    `skipped`，由调用方决定要不要报出去 —— 但绝不会被悄悄当成「正常的一条」。
 */
export async function listPendingApprovals(
  sb: SupabaseClient,
  clientId: string,
): Promise<{ items: PendingApprovalSummary[]; skippedRunIds: string[] }> {
  const runs = await listPendingRunsForClient(sb, clientId)
  if (runs.length === 0) return { items: [], skippedRunIds: [] }

  const decisionIds = runs
    .map((run) => run.authorization_decision_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const decisions = await getDecisionsByIds(sb, decisionIds)

  const items: PendingApprovalSummary[] = []
  const skippedRunIds: string[] = []
  for (const run of runs) {
    const decisionId = run.authorization_decision_id
    const decision = decisionId ? decisions.get(decisionId) : undefined
    if (!decisionId || !decision || decision.verdict !== 'require_approval') {
      skippedRunIds.push(run.id)
      continue
    }
    items.push(toSummary(run, decisionId))
  }
  return { items, skippedRunIds }
}

/**
 * 按 runId 读一条 run —— **鉴权之前**要用它把 `client_id` 读出来。
 *
 * 🔴 客户归属只能这么来。调用方声称的 clientId 一个字都不信。
 */
export async function loadRunForApproval(
  sb: SupabaseClient,
  runId: string,
): Promise<ActionRun> {
  const run = await getRunForApproval(sb, runId)
  if (!run) {
    throw new ApprovalError('not_found', '找不到这条动作 —— 它可能从来没存在过，或者已经被清理掉了', {
      runId,
    })
  }
  return run
}

/** 详情。run 必须已经过客户归属与档次校验。 */
export async function buildApprovalDetail(
  sb: SupabaseClient,
  run: ActionRun,
): Promise<PendingApprovalDetail> {
  if (run.status !== 'pending_approval') {
    throw new ApprovalError(
      'not_pending',
      `这条动作现在的状态是「${run.status}」，已经不在等人点头了 —— 它已经有结论了，刷新看看`,
      { runId: run.id, status: run.status },
    )
  }
  const decisionId = run.authorization_decision_id
  const decision = decisionId ? await getDecisionForApproval(sb, decisionId) : null
  if (!decisionId || !decision || decision.verdict !== 'require_approval') {
    // 🔴 不编一份审批请求出来。没有锚就没法安全地点头（Kernel 那边也会拒）。
    throw new ApprovalError(
      'not_pending',
      '这条动作标着「等人点头」，但当初那份审批请求找不到了 —— 库里状态不一致，先别点，请重新排一次',
      { runId: run.id, decisionId },
    )
  }
  return {
    ...toSummary(run, decisionId),
    input: run.input,
    evidence: run.evidence,
    status: run.status,
    decision: {
      id: decision.id,
      reason: decision.reason,
      policyId: decision.policy_id,
      policyVersion: decision.policy_version,
      createdAt: decision.created_at,
    },
  }
}

// ── 请求体 ────────────────────────────────────────────────────────────────────

/** 拒绝原因的长度上限。够写清楚为什么不做，又不至于让人往里塞一整篇东西。 */
export const MAX_REASON_LENGTH = 500

/** 请求体里**唯一**允许出现的三个字段。多一个就当伪造。 */
const ALLOWED_BODY_KEYS = new Set(['resolution', 'expectedDecisionId', 'reason'])

/**
 * 把请求体读成一个决定。
 *
 * 🔴 **严格模式：出现任何别的字段一律 400。**
 *    不是「读不到就忽略」—— 忽略的话，一个带着 `actorEmail` / `clientId` /
 *    `requiredCapabilityTier` 的请求会**安静地成功**，提交的人以为自己那些字段
 *    起作用了，而将来某个人顺手加一句 `body.actorEmail ??` 就把身份闸拆了。
 *    当场拒掉，这条路从一开始就走不通。
 */
export function parseDecisionInput(body: unknown): ApprovalDecisionInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApprovalError('invalid_request', '请求内容不对：需要一个 JSON 对象')
  }
  const record = body as Record<string, unknown>

  const unexpected = Object.keys(record).filter((key) => !ALLOWED_BODY_KEYS.has(key))
  if (unexpected.length > 0) {
    throw new ApprovalError(
      'invalid_request',
      `请求里带了不该有的字段（${unexpected.join('、')}）—— 操作者身份、客户、动作、` +
        '权限档次一律由服务端从登录会话和库里取，请求体说了不算',
      { unexpected },
    )
  }

  const resolution = record.resolution
  if (resolution !== 'approve' && resolution !== 'reject') {
    throw new ApprovalError('invalid_request', 'resolution 只能是 approve 或 reject')
  }

  const expectedDecisionId = record.expectedDecisionId
  if (typeof expectedDecisionId !== 'string' || expectedDecisionId.trim().length === 0) {
    throw new ApprovalError(
      'invalid_request',
      '缺少 expectedDecisionId —— 必须带上你页面上看到的那份审批请求的 id，' +
        '否则没法确认你批的是不是你看见的那一件事',
    )
  }

  const rawReason = record.reason
  if (rawReason !== undefined && typeof rawReason !== 'string') {
    throw new ApprovalError('invalid_request', 'reason 必须是一段文字')
  }
  const reason = rawReason?.trim() ?? ''

  // 🔴 拒绝必须说明原因：被拒的那条会进「可恢复」判定和今日待办，
  //    没有原因的话，下一个看到它的人不知道是「这次不合适」还是「永远别做」。
  if (resolution === 'reject' && reason.length === 0) {
    throw new ApprovalError('invalid_request', '点「不做」必须写一句为什么 —— 不然下一个人看不懂这条为什么被挡下来')
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new ApprovalError(
      'invalid_request',
      `原因太长了（${reason.length} 字，最多 ${MAX_REASON_LENGTH} 字）`,
    )
  }

  return {
    resolution,
    expectedDecisionId: expectedDecisionId.trim(),
    ...(reason.length > 0 ? { reason } : {}),
  }
}

// ── 写（就这一处） ────────────────────────────────────────────────────────────

/**
 * 审批接口专用的 Kernel 依赖包。
 *
 * 🔴 **`capabilities` 是空的 —— 这不是省事，是这一层的安全属性之一。**
 *
 *    审批接口的职责到「签一份授权」为止。万一将来有人在这条路上误接了
 *    执行入口，空的能力表会让它当场 `CAPABILITY_NOT_IMPLEMENTED` 失败，
 *    而不是安静地把客户的东西发出去。
 *    再加上本模块**根本不 import** capability 层（架构测试盯着），
 *    「审批接口能执行」这件事在依赖图上和运行时上各断了一次。
 */
export function createApprovalKernelDeps(sb: SupabaseClient): KernelDeps {
  return createKernelDeps({
    supabase: sb,
    registry: ACTION_REGISTRY,
    capabilities: {},
    workerId: `kernel-approval@${process.env.RENDER_INSTANCE_ID ?? 'local'}`,
  })
}

/**
 * Kernel 抛出来的错误 → 审批层的失败码。
 *
 * 🔴 认不出来的一律**原样抛**（→ 500）。把未知错误映射成某个「像是」的码，
 *    就是拿一句好听的话盖住一个还没被理解的失败。
 */
function translateKernelError(err: unknown): never {
  if (err instanceof KernelError) {
    if (err.code === 'STALE_DECISION') {
      throw new ApprovalError('stale_decision', err.humanReason, err.detail)
    }
    if (err.code === 'INVALID_STATE') {
      // Kernel 的 INVALID_STATE 涵盖「已经不在等审批了」和「刚被别人处理掉了」——
      // 两者对提交决定的人来说是同一件事：这条已经有结论了，刷新再看。
      throw new ApprovalError('not_pending', err.humanReason, err.detail)
    }
  }
  throw err
}

/**
 * 人点了同意 / 不做。
 *
 * 🔴 **这里只签授权，不跑任何东西。**
 *    · 同意 → `approveRun`  → run 停在 `authorized`
 *    · 不做 → `rejectRun`   → run 停在 `denied`
 *    两条路都只往 append-only 的决策表里加一条，谁批的、什么时候批的有据可查。
 *
 * @param run 已经过客户归属 + 档次校验的那一行（**必须**是服务端读出来的）
 * @param actorEmail 登录会话里的邮箱。**不许**来自请求体
 */
export async function decideApproval(
  deps: KernelDeps,
  args: {
    run: ActionRun
    actorEmail: string
    input: ApprovalDecisionInput
  },
): Promise<ApprovalDecisionResult> {
  const { run, actorEmail, input } = args

  try {
    if (input.resolution === 'reject') {
      const outcome = await rejectRun(deps, run.id, actorEmail, input.reason ?? '', {
        expectedDecisionId: input.expectedDecisionId,
      })
      return {
        runId: run.id,
        finalStatus: 'denied',
        decisionId: outcome.decision.id,
        decidedBy: actorEmail,
        reason: outcome.decision.reason,
      }
    }

    const outcome = await approveRun(deps, run.id, actorEmail, {
      expectedDecisionId: input.expectedDecisionId,
      reason: input.reason,
    })

    // 🔴 批准也可能被 fail closed 拒掉（挂起期间政策改了 / 契约升版 / 超预算）——
    //    那时 Kernel 落的是一条 deny，run 进 `denied`。如实照搬，不粉饰成成功。
    if (outcome.verdict !== 'allow') {
      return {
        runId: run.id,
        finalStatus: 'denied',
        decisionId: outcome.decision.id,
        decidedBy: actorEmail,
        reason: outcome.decision.reason,
      }
    }

    return {
      runId: run.id,
      finalStatus: 'authorized',
      decisionId: outcome.decision.id,
      decidedBy: actorEmail,
      reason: outcome.decision.reason,
    }
  } catch (err) {
    translateKernelError(err)
  }
}
