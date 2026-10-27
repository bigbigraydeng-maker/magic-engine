import { resolveDocRef } from './load'
import type { DocKind } from './types'

export const AGENTS_BASE = '/dashboard/admin/agents'
export const GITHUB_BLOB = 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/'

export interface ResolvedLink { href: string; external: boolean }

function repoPath(from: DocKind, href: string): string | null {
  const stack = ['docs', from]
  for (const seg of href.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (stack.length === 0) return null
      stack.pop()
    } else stack.push(seg)
  }
  return stack.join('/')
}

export function resolveDocLink(href: string, from: DocKind, allowed: Set<string>): ResolvedLink {
  if (/^(https?:|mailto:)/i.test(href)) return { href, external: true }
  if (href.startsWith('#') || href === '') return { href, external: false }
  const [pathPart, anchor] = href.split('#')
  const repo = repoPath(from, pathPart)
  if (repo === null) return { href: '#', external: false }
  const ref = resolveDocRef(repo, () => false)
  const inApp = ref !== null && repo.split('/').length === 3 && allowed.has(`${ref.kind}/${ref.file}`)
  if (inApp && ref) {
    const target = `${AGENTS_BASE}/${ref.kind}/${encodeURIComponent(ref.file)}`
    return { href: anchor ? `${target}#${anchor}` : target, external: false }
  }
  return { href: `${GITHUB_BLOB}${repo}${anchor ? `#${anchor}` : ''}`, external: true }
}
