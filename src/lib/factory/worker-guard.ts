// P21.J M2 — worker 收权三件套(spec §6.1,魏征 F9 修订)
// 纯函数,零 DB 依赖:①专用 token 鉴权 ②client 白名单 ③上传路径前缀强校验 + 红线复扫。
// 这是审核流/素材库注入面的正门 —— 任意外部 URL 一律拒,fail-closed。

import { timingSafeEqual } from 'crypto'

import { normalizeAngle } from './strategist'

export const FACTORY_BUCKET = 'content-factory'

/** Bearer FACTORY_WORKER_TOKEN(不复用 INTERNAL_API_KEY:本地 Mac 泄露面大,专 token 独立轮换) */
export function isWorkerAuthorized(authHeader: string | null): boolean {
  const token = process.env.FACTORY_WORKER_TOKEN
  // fail-closed:env 未配置一律拒
  if (!token || !authHeader) return false
  const expected = Buffer.from(`Bearer ${token}`)
  const got = Buffer.from(authHeader)
  return expected.length === got.length && timingSafeEqual(expected, got)
}

/**
 * worker_id 归属校验(魏征 M2-P1-1):body.worker_id 必须与工单 claimed_by 一致。
 * 场景:Mac 合盖超时 → sweeper 收回 → 另一 worker 重新 claim → 旧 worker 醒来
 * 调 complete/fail/heartbeat 不得碰新一轮生产中的工单。
 */
export function workerIdFromBody(body: Record<string, unknown>): string | null {
  const v = body['worker_id']
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

/**
 * client 白名单(v1 = CTS only)。env FACTORY_WORKER_CLIENT_IDS 逗号分隔 uuid。
 * fail-closed:env 未配置返回 null(调用方拒绝 claim),绝不放行全客户。
 */
export function workerClientWhitelist(): string[] | null {
  const raw = process.env.FACTORY_WORKER_CLIENT_IDS
  if (!raw) return null
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
  return ids.length > 0 ? ids : null
}

/** track 值 → bucket 目录名(spec §6.1 路径用连字符,DB track 用下划线) */
export function trackFolder(track: string): string | null {
  if (track === 'a_real') return 'a-real'
  if (track === 'b_generated') return 'b-generated'
  return null
}

/** 去掉可选的 bucket 名前缀,统一成 bucket 相对路径;完整 http(s) URL 一律拒(返回 null) */
function toBucketRelative(path: string): string | null {
  if (typeof path !== 'string' || path.length === 0) return null
  if (/^[a-z]+:\/\//i.test(path)) return null // 外部 URL 正门拒收
  if (path.includes('..')) return null // 路径穿越
  const p = path.startsWith(`${FACTORY_BUCKET}/`) ? path.slice(FACTORY_BUCKET.length + 1) : path
  return p.startsWith('/') ? null : p
}

/** 成片三件套路径:必须前缀 renders/{client_id}/{work_order_id}/ */
export function validateRenderPath(
  path: string,
  clientId: string,
  workOrderId: string,
): string | null {
  const p = toBucketRelative(path)
  if (!p) return null
  const prefix = `renders/${clientId}/${workOrderId}/`
  return p.startsWith(prefix) && p.length > prefix.length ? p : null
}

/** 新 clip 路径:必须前缀 clips/{a-real|b-generated}/{client_id}/ 且与 track 一致 */
export function validateClipPath(path: string, clientId: string, track: string): string | null {
  const folder = trackFolder(track)
  if (!folder) return null
  const p = toBucketRelative(path)
  if (!p) return null
  const prefix = `clips/${folder}/${clientId}/`
  return p.startsWith(prefix) && p.length > prefix.length ? p : null
}

/**
 * 成片级红线复扫(板桥 #7):闸 1 只扫过「角度」层,而「Auckland since 1928」这类
 * 真实红线恰恰是文案级措辞。命中不自动打回(避免误杀),写入 output.redline_hits,
 * 审核卡标红让人审有的放矢。大小写不敏感 substring(与 strategist containsPhrase 同口径)。
 */
export function scanRedlineHits(
  texts: Array<string | null | undefined>,
  redlinePhrases: string[],
  excludedTopics: string[],
): string[] {
  const surface = normalizeAngle(texts.filter((t): t is string => !!t && t.trim().length > 0).join(' | '))
  if (!surface) return []
  const hits: string[] = []
  for (const phrase of [...redlinePhrases, ...excludedTopics]) {
    if (!phrase) continue
    if (surface.includes(normalizeAngle(phrase)) && !hits.includes(phrase)) {
      hits.push(phrase)
    }
  }
  return hits
}
