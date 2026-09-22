/**
 * Client Knowledge Base — customer-side confirmer registry (design doc §9.14
 * E.2 step 2: "新增'客户确认人登记'：只有全局管理员能登记，留审计；确认人
 * 必须在草稿批准前登记；登记人 ≠ 批草稿的人").
 *
 * Without this table, `read.ts`'s dual-sign gate only checks "confirmer ≠
 * approver" and "confirmer is not a global admin" — any other email could
 * be written into `client_confirmed_by_email` and pass. This closes that
 * gap: a confirmation only counts if the confirmer's email was registered
 * for that client (by a global admin) BEFORE the confirmation was recorded.
 */

import { KnowledgeReadError } from './errors'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { ACCESS_TYPES_CUSTOMER_ONLY } from '@/lib/auth/access-types'

interface ConfirmerRow {
  confirmer_email: string
}

/**
 * The minimal query surface `getRegisteredConfirmerEmails` actually needs.
 *
 * 🔴 Declared here rather than reusing `KnowledgeSupabaseClient` (the read
 * client) because issue #1646's confirmation-link write path has to consult
 * the SAME registry through the write client. Typing the parameter as the
 * narrow read client would have forced that caller into a double type
 * assertion — i.e. the compiler would stop checking the one call that decides
 * whether a customer's signature counts. Both `db-client.ts`'s read client
 * and `write-client.ts`'s write client satisfy this interface structurally,
 * with no type assertion on either side (verified by `npm run type-check`
 * passing with both call sites present).
 */
export interface ConfirmerRegistryResult {
  data: unknown
  error: { message?: string } | null
}
export interface ConfirmerRegistryFilter extends PromiseLike<ConfirmerRegistryResult> {
  eq(column: string, value: unknown): ConfirmerRegistryFilter
  is(column: string, value: null): ConfirmerRegistryFilter
}
export interface ConfirmerRegistryClient {
  from(table: string): { select(columns: string): ConfirmerRegistryFilter }
}

/** Case/whitespace-insensitive equality — the one true comparison standard for every email field in this module, aligned with read.ts and whitelist.ts. */
function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Registered, non-revoked confirmer emails for `clientId`, lower-cased.
 *
 * 🔴 Fail-closed: a DB error throws (never resolves to "no registered
 * confirmers", which would silently make every customer_reply dual-sign
 * check fail — indistinguishable from "legitimately nobody registered yet"
 * only from the caller's point of view, but the two must not be conflated
 * with an actual read failure).
 */
export async function getRegisteredConfirmerEmails(
  clientId: string,
  sb: ConfirmerRegistryClient,
): Promise<Set<string>> {
  const { data, error } = await sb
    .from('client_knowledge_confirmers')
    .select('confirmer_email')
    .eq('client_id', clientId)
    .is('revoked_at', null)

  if (error) throw new KnowledgeReadError('读取客户知识库确认人登记（client_knowledge_confirmers）', error)

  // 桥接 unknown：同 entitlement.ts / read.ts 的 defaultSupabase() 深层泛型限制
  // （supabase-js 泛型链过深，tsc 结构比对 "excessively deep"）。实测：本机 PG
  // 沙盘对着真实 client_knowledge_confirmers 表跑过同样的 select，列名
  // confirmer_email 跟 ConfirmerRow 逐一核对一致。
  const rows = (data ?? []) as unknown as ConfirmerRow[]
  // 🔴 魏征复审（2026-09-14）：跟 read.ts 的比较标准对齐——必须 trim 再
  // lower-case，否则登记时留了尾随空格的邮箱会跟 read.ts 里 trim 过的确认人
  // 邮箱对不上，登记形同没登记。
  return new Set(rows.map((r) => r.confirmer_email.trim().toLowerCase()))
}

// ── 登记 / 撤销（issue #1669）───────────────────────────────────────────
//
// client_knowledge_confirmers 的 RLS 只挡到"必须用 service_role 连接"这一
// 层——"只有全局管理员能登记"这条业务规则数据库层面强制不了（判断谁是
// 全局管理员是 env 驱动的判断，见 whitelist.ts），只能在这两个函数里做。
// 任何调用方（API 路由）必须把真实登录邮箱传进 actorEmail，不能自己旁路
// 直接操作这张表。

type ConfirmerQueryResult = PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>

/**
 * `eq`/`is` 可以链多次，构建器本身随时可以直接 await（真实 supabase-js
 * 的查询构建器在每一步都是 thenable，不是只有终点方法才能 await）。
 *
 * 🔴 子牙+魏征联合复审（2026-09-14）实测发现并已修：原来这里收尾用的是
 * `.ilike(column, value)` 当"精确匹配（只是忽略大小写）"用——但 Postgres
 * 的 ILIKE 是通配符匹配，`_` 匹配任意单个字符、`%` 匹配任意长度，而邮箱
 * 本名部分带下划线（如 `john_doe@x.com`）是完全合法的真实格式，不是刁钻
 * 输入。魏征实测跑通 `registerConfirmer()` 证明：客户名下真实账号是
 * `johnadoe@ctstours.co.nz`，管理员想登记的是完全不同的人
 * `john_doe@ctstours.co.nz`，`ilike` 的通配符语义让后者的账号核实"误判
 * 通过"——这条本该卡死"确认人必须是客户名下真实账号"（issue #1646）的
 * 检查被实质性架空。修法：不再用 ilike 做匹配，改成整表取回该
 * client_id 范围内的行，在应用层用 `sameEmail()`（trim+lower-case 精确
 * 比较）过滤——跟 `getRegisteredConfirmerEmails` 已经验证过的做法完全
 * 一致，不再各写一套。
 */
export interface KnowledgeConfirmerFilterBuilder extends ConfirmerQueryResult {
  eq(column: string, value: unknown): KnowledgeConfirmerFilterBuilder
  is(column: string, value: null): KnowledgeConfirmerFilterBuilder
}

/** 真实 supabase-js 客户端的最小写入面，跟 read.ts 的窄只读接口（db-client.ts）分开——那个接口被大量只读调用方共用，直接加 insert/update 会让它们在类型层面被动获得写权限，违反最小权限。 */
export interface KnowledgeConfirmerWriteClient {
  from(table: string): {
    select(columns: string): KnowledgeConfirmerFilterBuilder
    insert(row: Record<string, unknown>): { select(columns: string): ConfirmerQueryResult }
    update(fields: Record<string, unknown>): {
      eq(column: string, value: unknown): ConfirmerQueryResult
    }
  }
}

export class KnowledgeConfirmerAuthorizationError extends Error {
  constructor(actorEmail: string, action: string) {
    super(`[knowledge] ${actorEmail} 不是全局管理员，无权${action}客户确认人`)
    this.name = 'KnowledgeConfirmerAuthorizationError'
  }
}

/** DB/infra 故障——网络、权限、字段类型等"我们这边坏了"的信号。跟下面的纯校验性 Error（邮箱不合法/不是客户账号）分开成不同的类，好让路由层能分别映射到 500 vs 400，不把真故障误判成调用方传参错误（子牙复审 2026-09-14）。 */
export class KnowledgeConfirmerWriteError extends Error {
  constructor(op: string, cause: { message?: string } | null) {
    super(`[knowledge] ${op} 失败：${cause?.message ?? '未知错误'}`)
    this.name = 'KnowledgeConfirmerWriteError'
  }
}

export interface RegisterConfirmerResult {
  id: string
  alreadyActive: boolean
}

/**
 * 桥接 unknown 说明（本文件多处用到，集中写在这里）：register/revoke 两个
 * 函数的查询结果都是 `Record<string, unknown>` 的列表，tsc 结构比对拒绝
 * 直接转成具体行类型。实测：本机 PG 沙盘对着真实 client_knowledge_
 * confirmers / client_portal_users 两张表跑过同样形状的 select，列名在
 * 两张表里都存在且类型对得上，跟这里的用法逐一核对一致，不是凭空猜的
 * 形状。
 */
function asRows<T>(data: unknown): T[] {
  return (data ?? []) as unknown as T[]
}

interface AccountRow {
  id: string
  email: string
  access_type: string
}
interface ConfirmerIdRow {
  id: string
  confirmer_email: string
}

/** Postgres 唯一约束冲突（`uq_client_knowledge_confirmers_active`）的标准错误码。 */
const POSTGRES_UNIQUE_VIOLATION = '23505'

/**
 * 登记一个客户确认人。只有全局管理员（`isGlobalAdminEmail(actorEmail)`）能
 * 调用——公司域名账号不算全局管理员，必须精确命中 `ADMIN_EMAILS` 名单
 * （跟 read.ts 双签校验用的是同一条判据，见 whitelist.ts）。
 *
 * 🔴 §9.4 "登记人 ≠ 批草稿的人"：这里只能做到"登记人 ≠ 这条事实的批准人"
 * 这一半——批准人是事实层面的字段（`client_knowledge_facts.approved_by_
 * email`），跟"谁登记了确认人"完全是两个不同时间点的两件事，这个函数天
 * 生看不到"批准人是谁"，所以这条检查实际在 read.ts 的双签校验里已经做了
 * （`approver_confirmer_differ`）。这里额外加一条更弱但仍然有意义的检查：
 * 登记人不能把自己登记成确认人（防止全局管理员既当裁判又当运动员的最
 * 明显情形）。
 *
 * 🔴 issue #1646 "确认人必须是该客户名下的付费客户账号"：查
 * `client_portal_users`（不是 `client_knowledge_confirmers` 自己）核实这
 * 一点——两张表故意分开：一张管"谁是这个客户的真实联系人"（既有账号表），
 * 一张管"这个真实联系人有没有被明确授权确认知识库条目"（本表）。
 *
 * 🔴 2026-09-20 修复：这里原来写的是 `.eq('access_type', 'client')`，只认
 * 字面值 'client'，把 CTS 的两个真实联系人（access_type='both'）挡在门
 * 外。改成 `ACCESS_TYPES_CUSTOMER_ONLY`（`access-types.ts`）——注意不是
 * `tierForAccessType()==='paid_client'` / `ACCESS_TYPES_PAID`：那两个把
 * 'fde' 也算进付费客户档，但 'fde' 账号原本是"Magic Engine 内部 FDE 代客
 * 户操作"（见 `20260602000001_client_portal_users_add_fde.sql`），
 * `require-admin.ts` 也明确说它不能当身份证明用。这里要的是"确认人必须
 * 是客户公司自己的人，不能是 ME 任何人"，用 paid_client 档会让 'fde' 账
 * 号冒充客户签字，破坏双签分离——第一版修复曾经犯过这个错，子牙+魏征联
 * 合复审（2026-09-20）实测发现后改成这个更窄的白名单。
 *
 * 🔴 并发登记（子牙+魏征联合复审 2026-09-14）：两个并发请求都可能在"查
 * 当前有效登记"这一步都看到"还没有"，都往下 insert——数据库的局部唯一
 * 索引会拦住其中一个，但不能让调用方直接吃一个 Postgres 内部报错字符串
 * （之前的实现会）。命中 23505（唯一约束冲突）时，视同"对方刚刚抢先登记
 * 成功了"，回查一次返回 alreadyActive:true，而不是抛错——这才是"幂等"
 * 这个词该有的行为，不止串行调用时成立，并发调用时也成立。
 */
export async function registerConfirmer(
  sb: KnowledgeConfirmerWriteClient,
  params: { clientId: string; confirmerEmail: string; actorEmail: string },
): Promise<RegisterConfirmerResult> {
  const { clientId, actorEmail } = params
  const confirmerEmail = params.confirmerEmail.trim()

  if (!isGlobalAdminEmail(actorEmail)) {
    throw new KnowledgeConfirmerAuthorizationError(actorEmail, '登记')
  }
  if (sameEmail(confirmerEmail, actorEmail)) {
    throw new Error('[knowledge] 登记人不能把自己登记成客户确认人')
  }
  if (isGlobalAdminEmail(confirmerEmail)) {
    throw new Error('[knowledge] 全局管理员账号不能被登记为客户确认人（不能代客户确认）')
  }

  const accountCheck = await sb.from('client_portal_users').select('id, email, access_type').eq('client_id', clientId)
  if (accountCheck.error) {
    throw new KnowledgeConfirmerWriteError('核实客户账号（client_portal_users）', accountCheck.error)
  }
  const hasAccount = asRows<AccountRow>(accountCheck.data).some(
    (row) =>
      sameEmail(row.email, confirmerEmail) &&
      (ACCESS_TYPES_CUSTOMER_ONLY as readonly string[]).includes(row.access_type),
  )
  if (!hasAccount) {
    throw new Error(
      `[knowledge] ${confirmerEmail} 不是客户 ${clientId} 名下的付费客户账号，不能登记为确认人`,
    )
  }

  const activeConfirmer = await findActiveConfirmer(sb, clientId, confirmerEmail)
  if (activeConfirmer.error) {
    throw new KnowledgeConfirmerWriteError('核对既有登记（client_knowledge_confirmers）', activeConfirmer.error)
  }
  if (activeConfirmer.row) {
    return { id: activeConfirmer.row.id, alreadyActive: true }
  }

  const insertResult = await sb
    .from('client_knowledge_confirmers')
    .insert({ client_id: clientId, confirmer_email: confirmerEmail, registered_by_email: actorEmail })
    .select('id')
  if (insertResult.error) {
    if (insertResult.error.code === POSTGRES_UNIQUE_VIOLATION) {
      const raceLoser = await findActiveConfirmer(sb, clientId, confirmerEmail)
      if (raceLoser.error) {
        throw new KnowledgeConfirmerWriteError('登记客户确认人（竞态回查）（client_knowledge_confirmers）', raceLoser.error)
      }
      if (raceLoser.row) return { id: raceLoser.row.id, alreadyActive: true }
    }
    throw new KnowledgeConfirmerWriteError('登记客户确认人（client_knowledge_confirmers）', insertResult.error)
  }
  const inserted = asRows<{ id: string }>(insertResult.data)
  return { id: inserted[0]?.id ?? '', alreadyActive: false }
}

/** 查这个客户当前（未撤销）针对这个邮箱的登记行，精确匹配（见文件头部说明为什么不用 ilike）。 */
async function findActiveConfirmer(
  sb: KnowledgeConfirmerWriteClient,
  clientId: string,
  confirmerEmail: string,
): Promise<{ row: ConfirmerIdRow | null; error: { message?: string; code?: string } | null }> {
  const result = await sb
    .from('client_knowledge_confirmers')
    .select('id, confirmer_email')
    .eq('client_id', clientId)
    .is('revoked_at', null)
  if (result.error) return { row: null, error: result.error }
  const matches = asRows<ConfirmerIdRow>(result.data).filter((row) => sameEmail(row.confirmer_email, confirmerEmail))
  // 局部唯一索引保证同一时刻同一邮箱最多一条有效登记，理论上 matches 不
  // 会超过一条；即便数据不干净出现多条，取第一条也不会误伤别的邮箱——
  // 上面的 filter 已经是精确匹配，不是通配符碰撞。
  return { row: matches[0] ?? null, error: null }
}

/**
 * 撤销一个客户确认人的登记。同样只有全局管理员能调用。撤销不是删除——
 * `revoked_at`/`revoked_by_email` 成对写入，留审计；局部唯一索引只约束
 * "未撤销"的行，撤销后同一个邮箱可以被重新登记。
 */
export async function revokeConfirmer(
  sb: KnowledgeConfirmerWriteClient,
  params: { clientId: string; confirmerEmail: string; actorEmail: string },
): Promise<void> {
  const { clientId, actorEmail } = params
  const confirmerEmail = params.confirmerEmail.trim()

  if (!isGlobalAdminEmail(actorEmail)) {
    throw new KnowledgeConfirmerAuthorizationError(actorEmail, '撤销')
  }

  const activeConfirmer = await findActiveConfirmer(sb, clientId, confirmerEmail)
  if (activeConfirmer.error) {
    throw new KnowledgeConfirmerWriteError('核对既有登记（client_knowledge_confirmers）', activeConfirmer.error)
  }
  if (!activeConfirmer.row) {
    throw new Error(`[knowledge] ${confirmerEmail} 目前不是客户 ${clientId} 的有效登记确认人，无需撤销`)
  }

  const updateResult = await sb
    .from('client_knowledge_confirmers')
    .update({ revoked_at: new Date().toISOString(), revoked_by_email: actorEmail })
    .eq('id', activeConfirmer.row.id)
  if (updateResult.error) {
    throw new KnowledgeConfirmerWriteError('撤销客户确认人登记（client_knowledge_confirmers）', updateResult.error)
  }
}
