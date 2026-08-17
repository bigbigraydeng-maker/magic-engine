/**
 * 审批层的失败词汇表 —— 每一个码对应**一件不同的事**，不许合并。
 *
 * 🔴 为什么要一套单独的码：审批界面对这几种情况的反应完全不同 ——
 *    「刷新一下重来」「这条已经有结论了」「你没权限」「系统还没启用」
 *    是四种话。合成一个 400 或者一句 "failed"，界面就只能一律显示
 *    「操作失败」，而人根本不知道下一步该干嘛。
 */

export type ApprovalErrorCode =
  /**
   * 🔴 Kernel 的表 / RPC 在这个环境里**根本不存在**（迁移没 apply）。
   *
   *    这一条必须跟「有表但没有等审批的动作」严格分开。返回 `200 []` 的话，
   *    界面会显示「没有待办，一切正常」—— 而真相是这套东西整个没启用，
   *    任何等人点头的动作都**永远不会出现在这里**。
   *    静默的空列表比报错危险得多：它长得跟正常一模一样。
   */
  | 'kernel_not_provisioned'
  /** 没登录。 */
  | 'unauthorized'
  /** 登录了，但这个人不属于这条动作所属的客户（或不是付费轨）。 */
  | 'forbidden_client'
  /** 属于这个客户，但他的权限档次不够授权**这一类**动作。 */
  | 'forbidden_tier'
  /** 这条 run 不存在。 */
  | 'not_found'
  /**
   * 这条 run 已经不在等审批了（已批 / 已拒 / 在跑 / 已结束）。
   *
   * 🔴 **这是个终态码。** 调用方看到它就该把这条待办从管道里划掉 ——
   *    所以只有「真的有结论了」才准用它，见 `pending_inconsistent`。
   */
  | 'not_pending'
  /**
   * 🔴 run **还停在** `pending_approval`，但它指着的那份审批请求缺失 / 对不上。
   *
   *    跟 `not_pending` 分开是必须的：那个码的含义是「这件事已经有结论了」，
   *    调用方据此把待办划掉 —— 而这条 run **一个结论都没有**，它还活着，
   *    只是库里状态不一致。用终态码报它，等于让一条**永远不会被处理**的待办
   *    从管道里消失，而界面上看起来一切正常。这正是铁律里「发现不许死在日志里」
   *    的那种烂尾：没有人再看得见它，也没有人会去修它。
   *
   *    锁内的写路径对同一类「没写成任何东西的不一致」已经报 `stale_decision`
   *    （非终态、提示刷新重试）。读路径必须跟它同向 —— 一个说「重排」、
   *    一个说「已结束」，是两套相反的语义。
   *
   *    🔴 收到它时**什么都没被改动**。正确处置是重新排一次，不是划掉。
   */
  | 'pending_inconsistent'
  /** 审批人手里那份审批请求已经不是当前那一份了 —— 刷新重来，**什么都没被改动**。 */
  | 'stale_decision'
  /** 请求体本身不成立（缺字段 / 类型不对 / 拒绝没写原因）。 */
  | 'invalid_request'

/** 码 → HTTP 状态。**唯一一处映射**，路由不许自己再写一份。 */
export const APPROVAL_HTTP_STATUS: Readonly<Record<ApprovalErrorCode, number>> = {
  kernel_not_provisioned: 503,
  unauthorized: 401,
  forbidden_client: 403,
  forbidden_tier: 403,
  not_found: 404,
  not_pending: 409,
  pending_inconsistent: 409,
  stale_decision: 409,
  invalid_request: 400,
}

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode
  /** 给人看的一句话。会原样进接口返回体，所以必须是人话。 */
  readonly humanReason: string
  readonly detail: Record<string, unknown>

  constructor(
    code: ApprovalErrorCode,
    humanReason: string,
    detail: Record<string, unknown> = {},
  ) {
    super(`[${code}] ${humanReason}`)
    this.name = 'ApprovalError'
    this.code = code
    this.humanReason = humanReason
    this.detail = detail
  }

  get status(): number {
    return APPROVAL_HTTP_STATUS[this.code]
  }
}

/**
 * Kernel 的表 / 函数**不存在**吗。
 *
 * 🔴 判据必须是**这一类**错误，不能是「查询出错了」。把任意查询失败都当成
 *    「没启用」，一次数据库抖动就会被答成 503「系统还没启用」——
 *    那是另一件事，处置也完全不同（一个等运维 apply，一个等它恢复）。
 *
 * PostgREST 对这两种情况的回法：
 *   · 表不存在      → PG `42P01`，或 PostgREST 的 schema cache 码 `PGRST205`
 *   · 函数不存在    → PG `42883`，或 PostgREST 的 `PGRST202`
 * 文案兜底只认「schema cache 里找不到」和「relation/function … does not exist」
 * 这两种明确说法，不做模糊匹配。
 */
const NOT_PROVISIONED_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205'])

/**
 * 🔴 中间那一段必须允许空格 —— PostgreSQL 报缺函数时带的是**完整签名**：
 *      function public.kernel_resolve_pending_approval(uuid, uuid, text) does not exist
 *    用 `\S+` 只能匹配缺表那一种（`relation "public.action_runs" does not exist`），
 *    缺函数的那一半会静静地漏过去 —— 而 RPC 不存在正是「没 apply」最典型的样子。
 *    限长 + 不跨行，避免把一整段无关文案吞进来。
 */
const NOT_PROVISIONED_MESSAGE =
  /(?:relation|function|table)\s+[^\n]{1,200}?\s+does not exist|could not find the (?:table|function)\b[^]{0,200}?\bschema cache/i

export function isKernelNotProvisioned(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && NOT_PROVISIONED_CODES.has(code)) return true
  const message = (error as { message?: unknown }).message
  if (typeof message !== 'string') return false
  return NOT_PROVISIONED_MESSAGE.test(message)
}

/**
 * 把一次 Supabase 查询错误翻成审批层的失败。
 *
 * 🔴 认不出来的**一律抛原样错误**（→ 路由答 500），绝不降级成
 *    `kernel_not_provisioned`，也绝不吞成空结果。
 */
export function translateQueryError(op: string, error: { message?: string } | null): never {
  if (isKernelNotProvisioned(error)) {
    throw new ApprovalError(
      'kernel_not_provisioned',
      '执行内核在这个环境里还没启用（数据库那几张表还没建）——' +
        '所以现在既没有待审批的动作，也没法处理审批。这不是「没有待办」，是这套东西还没打开',
      { op, dbMessage: error?.message ?? null },
    )
  }
  throw new Error(`[kernel-approval] ${op} 失败：${error?.message ?? '未知错误'}`)
}
