import type { ReactNode } from 'react'
import { resolveDocLink } from '@/lib/agent-docs/links'
import type { DocKind } from '@/lib/agent-docs/types'

interface Ctx { from: DocKind; allowed: Set<string> }

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g
const splitCells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isTableSep = (l: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const cellCls = 'border border-black/10 px-2 py-1'
const HEADING_CLASS = ['', 'text-2xl font-bold mt-6', 'text-xl font-bold mt-6', 'text-lg font-semibold mt-5', 'text-base font-semibold mt-4']
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const startsBlock = (l: string): boolean =>
  /^(#{1,6}\s|>|```|\s*([-*+]|\d+[.)])\s|\s*\|)/.test(l) || /^\s*(---+|\*\*\*+)\s*$/.test(l)

function renderInline(text: string, ctx: Ctx, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of Array.from(text.matchAll(INLINE_RE))) {
    const idx = m.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    const key = `${keyBase}-${i++}`
    const tok = m[0]
    if (m[1]) out.push(<code key={key} className="rounded bg-black/5 px-1 text-[0.9em]">{tok.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)
      const link = resolveDocLink(lm?.[2] ?? '', ctx.from, ctx.allowed)
      out.push(<a key={key} href={link.href} className="text-blue-700 underline" {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{lm?.[1]}</a>)
    }
    last = idx + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function renderTable(lines: string[], ctx: Ctx, key: string): ReactNode {
  const head = splitCells(lines[0])
  const body = lines.slice(2).map(splitCells)
  return (
    <div key={key} className="my-3 overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead><tr>{head.map((c, n) => <th key={n} className={`${cellCls} bg-black/5 text-left font-semibold`}>{renderInline(c, ctx, `${key}h${n}`)}</th>)}</tr></thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>{row.map((c, n) => <td key={n} className={`${cellCls} align-top`}>{renderInline(c, ctx, `${key}r${r}c${n}`)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderList(lines: string[], ctx: Ctx, key: string): ReactNode {
  return (
    <ul key={key} className="my-2 space-y-1">
      {lines.map((l, n) => {
        const m = LIST_RE.exec(l)
        const depth = Math.min(Math.floor((m?.[1].length ?? 0) / 2), 4)
        return (
          <li key={n} style={{ marginLeft: `${1 + depth * 1.25}rem` }} className="list-disc text-sm leading-relaxed">
            {renderInline(m?.[3] ?? l, ctx, `${key}l${n}`)}
          </li>
        )
      })}
    </ul>
  )
}

function takeWhile(lines: string[], start: number, pred: (l: string) => boolean): string[] {
  const out: string[] = []
  for (let i = start; i < lines.length && pred(lines[i]); i++) out.push(lines[i])
  return out
}

export function DocMarkdown({ text, from, allowed }: { text: string; from: DocKind; allowed: Set<string> }) {
  const ctx: Ctx = { from, allowed }
  const lines = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split(/\r?\n/)
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const key = `b${i}`
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (line.trim() === '') i++
    else if (line.startsWith('```')) {
      const code = takeWhile(lines, i + 1, (l) => !l.startsWith('```'))
      blocks.push(<pre key={key} className="my-3 overflow-x-auto rounded bg-black/5 p-3 text-xs">{code.join('\n')}</pre>)
      i += code.length + 2
    } else if (heading) {
      const level = heading[1].length
      blocks.push(<div key={key} role="heading" aria-level={level} className={HEADING_CLASS[Math.min(level, 4)]}>{renderInline(heading[2], ctx, key)}</div>)
      i++
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={key} className="my-4 border-black/10" />)
      i++
    } else if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const rows = takeWhile(lines, i, (l) => l.includes('|') && l.trim() !== '')
      blocks.push(renderTable(rows, ctx, key))
      i += rows.length
    } else if (line.startsWith('>')) {
      const quote = takeWhile(lines, i, (l) => l.startsWith('>')).map((l) => l.replace(/^>\s?/, ''))
      blocks.push(<blockquote key={key} className="my-3 border-l-4 border-black/10 pl-3 text-sm text-black/70">{quote.map((q, n) => <div key={n}>{renderInline(q, ctx, `${key}q${n}`)}</div>)}</blockquote>)
      i += quote.length
    } else if (LIST_RE.test(line)) {
      const items = takeWhile(lines, i, (l) => LIST_RE.test(l))
      blocks.push(renderList(items, ctx, key))
      i += items.length
    } else {
      const para = [line, ...takeWhile(lines, i + 1, (l) => l.trim() !== '' && !startsBlock(l))]
      blocks.push(<p key={key} className="my-2 text-sm leading-relaxed">{renderInline(para.join(' '), ctx, key)}</p>)
      i += para.length
    }
  }
  return <div className="doc-markdown">{blocks}</div>
}
