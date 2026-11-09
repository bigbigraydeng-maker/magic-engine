import type { EmailTemplateVersion } from './types'
import type { FactProvider, ProviderValue, RenderFacts } from './facts/types'
import {
  scanPlaceholders,
  substitute,
  hasUnresolvedBraces,
  type PlaceholderRef,
} from './placeholders'
import { resolveFirstName } from './first-name'
import { sanitizeBody } from '@/lib/crm/email-compose/validate'

export interface RenderContext {
  contactName: string | null
  senderDisplayName: string | null
  callWhen: 'today' | 'yesterday' | 'recently' | null
  inputs: Readonly<Record<string, string>>
  facts: RenderFacts | null
  provider: FactProvider | null
}

export interface RenderResult {
  subject: string
  body: string
  missing: string[]
  problems: string[]
  usedVariables: string[]
}

const MAX_SUBJECT_LENGTH = 200
const INPUT_PREFIX = 'input.'
const WHITESPACE_RUN_RE = /\s+/g

function missingValue(label: string): ProviderValue {
  return { ok: false, missing: label }
}

function resolveInput(name: string, ctx: RenderContext): ProviderValue {
  const key = name.slice(INPUT_PREFIX.length)
  const raw = ctx.inputs[key]
  if (typeof raw !== 'string') return missingValue(name)
  const trimmed = raw.trim()
  if (trimmed.length === 0) return missingValue(name)
  return { ok: true, value: trimmed }
}

function resolveProvider(
  name: string,
  count: number | null,
  ctx: RenderContext,
): ProviderValue {
  if (ctx.provider === null) return missingValue(name)
  if (!Object.prototype.hasOwnProperty.call(ctx.provider.variables, name)) {
    return missingValue(name)
  }
  if (ctx.facts === null) return missingValue(name)
  return ctx.provider.resolve(name, count, ctx.facts)
}

function resolvePlaceholder(ref: PlaceholderRef, ctx: RenderContext): ProviderValue {
  const name = ref.name
  if (name === 'first_name') {
    const value = resolveFirstName(ctx.contactName)
    return value === null ? missingValue('first_name') : { ok: true, value }
  }
  if (name === 'sender_name') {
    const value = resolveFirstName(ctx.senderDisplayName)
    return value === null ? missingValue('sender_name') : { ok: true, value }
  }
  if (name === 'call_when') {
    return ctx.callWhen === null ? missingValue('call_when') : { ok: true, value: ctx.callWhen }
  }
  if (name.startsWith(INPUT_PREFIX)) {
    return resolveInput(name, ctx)
  }
  return resolveProvider(name, ref.count, ctx)
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      out.push(value)
    }
  }
  return out
}

function collectUsedVariables(text: string): string[] {
  return scanPlaceholders(text).map((ref) => ref.name)
}

function normalizeSubject(raw: string): string {
  return raw.replace(WHITESPACE_RUN_RE, ' ').trim()
}

export function renderTemplate(
  template: Pick<EmailTemplateVersion, 'subject' | 'body' | 'pickMode'>,
  ctx: RenderContext,
): RenderResult {
  const resolve = (ref: PlaceholderRef): ProviderValue => resolvePlaceholder(ref, ctx)

  const subjectRender = substitute(template.subject, resolve)
  const bodyRender = substitute(template.body, resolve)

  const missing = uniqueInOrder([...subjectRender.missing, ...bodyRender.missing])
  const usedVariables = uniqueInOrder([
    ...collectUsedVariables(template.subject),
    ...collectUsedVariables(template.body),
  ])

  const problems: string[] = []

  const subject = normalizeSubject(subjectRender.text)
  if (subject.length === 0) {
    problems.push('subject_empty')
  } else if (subject.length > MAX_SUBJECT_LENGTH) {
    problems.push('subject_too_long')
  }

  const sanitizedBody = sanitizeBody(bodyRender.text)
  let body: string
  if (sanitizedBody !== null) {
    body = sanitizedBody
  } else {
    body = bodyRender.text
    problems.push('body_invalid')
  }

  if (missing.length === 0) {
    if (hasUnresolvedBraces(subjectRender.text) || hasUnresolvedBraces(bodyRender.text)) {
      problems.push('placeholder_left')
    }
  }

  return { subject, body, missing, problems, usedVariables }
}
