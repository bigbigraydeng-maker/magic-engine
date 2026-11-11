import { resolveDocRef } from './load'
import type { DocKind } from './types'

export const AGENTS_BASE = '/dashboard/admin/agents'
export const GITHUB_BLOB = 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/'

export interface ResolvedLink { href: string; external: boolean }

function repoPath(from: DocKind, href: string, fromFile = ''): string | null {
  const parent = fromFile.split('/').slice(0, -1).filter((part) => part !== '')
  const stack = ['docs', from, ...parent]
  for (const seg of href.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (stack.length === 0) return null
      stack.pop()
    } else stack.push(seg)
  }
  return stack.join('/')
}

function inAppHref(ref: { kind: DocKind; file: string }, anchor: string | undefined): string {
  const segments = [ref.kind, ...ref.file.split('/')].map((part) => encodeURIComponent(part))
  const target = `${AGENTS_BASE}/${segments.join('/')}`
  return anchor ? `${target}#${anchor}` : target
}

export function resolveDocLink(href: string, from: DocKind, allowed: Set<string>, fromFile = ''): ResolvedLink {
  if (/^(https?:|mailto:)/i.test(href)) return { href, external: true }
  if (href.startsWith('#') || href === '') return { href, external: false }
  const [pathPart, anchor] = href.split('#')
  const repo = repoPath(from, pathPart, fromFile)
  if (repo === null) return { href: '#', external: false }
  const ref = resolveDocRef(repo, () => false)
  if (ref && allowed.has(`${ref.kind}/${ref.file}`)) return { href: inAppHref(ref, anchor), external: false }
  return { href: `${GITHUB_BLOB}${repo}${anchor ? `#${anchor}` : ''}`, external: true }
}
