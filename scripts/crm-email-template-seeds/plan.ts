/**
 * 种子模板脚本的纯逻辑（可测试）：参数解析 + 干跑检查。
 * 干跑**不连数据库**；写库（--apply）要同时带 --client 和 --pm-approved，缺一个就拒绝。
 */

import { checkTemplateForSave, parseTemplateWrite } from '@/lib/crm/email-templates/template-input'
import type { EmailSettings } from '@/lib/crm/email-templates/types'
import { CTS_GUARDRAIL_REFERENCE, CTS_SEED_TEMPLATES, type SeedTemplate } from './cts'

export const SEED_SETS: Record<string, readonly SeedTemplate[]> = { cts: CTS_SEED_TEMPLATES }
export const SEED_GUARDRAILS: Record<string, Pick<EmailSettings, 'guardrails'>> = {
  cts: { guardrails: { allowedLinkHosts: CTS_GUARDRAIL_REFERENCE.allowedLinkHosts, rules: CTS_GUARDRAIL_REFERENCE.rules.map((r) => ({ ...r, phrases: [...r.phrases] })) } },
}

export type SeedArgs =
  | { ok: true; seed: string; apply: boolean; clientId: string | null }
  | { ok: false; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KNOWN_FLAGS = new Set(['--seed', '--client', '--apply', '--pm-approved'])

function valueOf(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  for (const token of argv) {
    if (token.startsWith('--') && !KNOWN_FLAGS.has(token)) return { ok: false, error: `不认识的参数：${token}` }
  }
  const seed = valueOf(argv, '--seed')
  if (seed === undefined || !(seed in SEED_SETS)) return { ok: false, error: `要用 --seed 指定种子，目前有：${Object.keys(SEED_SETS).join('、')}` }
  const clientId = valueOf(argv, '--client') ?? null
  if (clientId !== null && !UUID_RE.test(clientId)) return { ok: false, error: '--client 要写客户的 UUID' }
  const apply = argv.includes('--apply')
  if (apply) {
    if (clientId === null) return { ok: false, error: '写库必须明确写 --client <客户 UUID>，不会默认挑一个客户' }
    if (!argv.includes('--pm-approved')) return { ok: false, error: '写库 = 写生产数据，需要 PM 单独点头；确认后再加 --pm-approved' }
  }
  return { ok: true, seed, apply, clientId }
}

export interface SeedCheck {
  templateKey: string
  ok: boolean
  errors: string[]
  notices: string[]
}

/** 每份种子都走和接口完全一样的解析与保存前检查（占位符合法、不踩红线），并必须是停用状态。 */
export function checkSeeds(seed: string): SeedCheck[] {
  const templates = SEED_SETS[seed] ?? []
  const guard = SEED_GUARDRAILS[seed] ?? null
  return templates.map((t) => {
    const parsed = parseTemplateWrite({ templateKey: t.templateKey, ...t.fields }, 'create')
    if (!parsed.ok) return { templateKey: t.templateKey, ok: false, errors: [parsed.error], notices: [] }
    const check = checkTemplateForSave(parsed.fields, guard)
    const errors = [...check.errors]
    if (parsed.fields.status !== 'disabled') errors.push('种子模板必须以停用状态写入')
    return { templateKey: t.templateKey, ok: errors.length === 0, errors, notices: check.notices }
  })
}
