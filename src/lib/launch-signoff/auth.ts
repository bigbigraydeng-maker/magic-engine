/**
 * 上线签字 —— 谁在调用。
 *
 *  · 执行方 / 复核方窗口：各用一把**不同**的钥匙（请求头 x-launch-signoff-key），角色由钥匙决定，
 *    调用方不能自称角色 —— 所以“复核人 ≠ 执行人”由服务端强制，不靠口头约定。
 *  · 真人：登录会话 + 全局管理员（不含受限的演示管理员）。
 *  · 能签字 / 撤销：必须是真人会话，且邮箱在 LAUNCH_SIGNOFF_SIGNERS 白名单里；
 *    白名单没配 = 谁都不能签（fail-closed）。服务钥匙一律不能签。
 */

import { timingSafeEqual } from 'node:crypto'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { LaunchSignoffError } from './errors'
import type { ActorRole } from './types'

export interface Actor {
  /** 写进事件的 actor 字段：真人=邮箱；钥匙=key:executor / key:reviewer */
  readonly id: string
  readonly role: ActorRole
  readonly isHuman: boolean
  /** 真人且在签字白名单里 */
  readonly isSigner: boolean
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function signerEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.LAUNCH_SIGNOFF_SIGNERS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
}

export async function authenticate(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Actor> {
  const presented = req.headers.get('x-launch-signoff-key')
  if (presented) {
    const executor = env.LAUNCH_SIGNOFF_EXECUTOR_KEY
    const reviewer = env.LAUNCH_SIGNOFF_REVIEWER_KEY
    // 窗口自报的编号只作审计标签（不参与任何授权判断）
    const label = (req.headers.get('x-launch-signoff-window') ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20)
    const tag = label ? `(${label})` : ''
    if (executor && sameSecret(presented, executor)) {
      return { id: `key:executor${tag}`, role: 'executor', isHuman: false, isSigner: false }
    }
    if (reviewer && sameSecret(presented, reviewer)) {
      return { id: `key:reviewer${tag}`, role: 'reviewer', isHuman: false, isSigner: false }
    }
    throw new LaunchSignoffError('bad_key', 401, '钥匙不对')
  }
  // 走登录 cookie 的写请求：必须同源（挡跨站伪造点击）。GET 不查。
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const site = req.headers.get('sec-fetch-site')
    const origin = req.headers.get('origin')
    const host = req.headers.get('host')
    const sameSite = site === 'same-origin' || site === 'none'
    let sameOrigin = false
    try {
      sameOrigin = origin !== null && host !== null && new URL(origin).host === host
    } catch {
      sameOrigin = false // Origin: "null" 等：当作跨站拒绝，而不是 500
    }
    if (!sameSite && !sameOrigin) {
      throw new LaunchSignoffError('cross_site', 403, '只接受本站页面发出的请求')
    }
  }
  const admin = await requireGlobalAdmin()
  if (!admin.ok) {
    throw new LaunchSignoffError('unauthorized', admin.status, admin.status === 401 ? '请先登录' : '没有权限')
  }
  const email = (admin.user.email ?? '').toLowerCase()
  if (!email) throw new LaunchSignoffError('no_email', 403, '账号没有邮箱')
  return { id: email, role: 'human', isHuman: true, isSigner: signerEmails(env).includes(email) }
}
