'use client'

/** 抽屉第一页「信的内容」：标题、预览行、正文（长了先收起，点「展开全文」看全部）。 */

import { useState, type ReactNode } from 'react'
import type { BodyBlock, LetterContent } from '@/lib/crm/auto-send/types'
import { splitBodyPreview } from '@/lib/crm/auto-send/view'

const PREVIEW_BLOCKS = 10
const PLACEHOLDER_RE = /\{[a-z_]+\}/gi

type Group =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }

/** 连着的几条要点并成一个列表，其余一块一段。 */
function groupBlocks(blocks: readonly BodyBlock[]): Group[] {
  const groups: Group[] = []
  for (const block of blocks) {
    const last = groups[groups.length - 1]
    if (block.kind === 'heading') {
      groups.push({ kind: 'heading', text: block.text })
    } else if (block.kind === 'paragraph') {
      groups.push({ kind: 'paragraph', text: block.text })
    } else if (last !== undefined && last.kind === 'bullets') {
      last.items.push(block.text)
    } else {
      groups.push({ kind: 'bullets', items: [block.text] })
    }
  }
  return groups
}

function findPlaceholders(blocks: readonly BodyBlock[]): string[] {
  const found = new Set<string>()
  for (const block of blocks) {
    for (const match of block.text.matchAll(PLACEHOLDER_RE)) found.add(match[0])
  }
  return Array.from(found)
}

/** 正文旁边那行灰色说明：名字已经换成示例名字，或者原样显示的占位符会换成每位客人自己的资料。 */
function bodyHint(sampleFirstName: string | null | undefined, placeholders: readonly string[]): string | undefined {
  if (sampleFirstName) return `正文里的名字（${sampleFirstName}）只是示例，每位客人收到的是自己的名字`
  if (placeholders.length > 0) return `${placeholders.join('、')} 会换成每位客人自己的资料（例如名字）`
  return undefined
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-xs font-bold text-me-charcoal/70">{label}</p>
      {hint && <p className="text-[11px] text-me-charcoal/55">{hint}</p>}
      {children}
    </div>
  )
}

function BodyView({ blocks }: { blocks: readonly BodyBlock[] }): JSX.Element {
  return (
    <div className="space-y-2.5 text-sm leading-[22px] text-me-charcoal">
      {groupBlocks(blocks).map((group, index) => {
        if (group.kind === 'heading') {
          return (
            <p key={index} className="font-bold">
              {group.text}
            </p>
          )
        }
        if (group.kind === 'paragraph') {
          return (
            <p key={index} className="whitespace-pre-line">
              {group.text}
            </p>
          )
        }
        return (
          <ul key={index} className="list-disc space-y-1 pl-5">
            {group.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        )
      })}
    </div>
  )
}

export function LetterContentTab({
  content,
  fallbackTitle,
}: {
  content: LetterContent | null
  fallbackTitle: string | null
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  if (content === null) {
    return (
      <p className="text-sm text-me-charcoal/70" data-testid="letter-content-missing">
        这封信的内容还没有写好（或者还没登记到 ME 里），写好以后会显示在这里。
      </p>
    )
  }

  const { shown, hiddenCount } = splitBodyPreview(content.body, PREVIEW_BLOCKS)
  const blocks = expanded ? content.body : shown
  const placeholders = findPlaceholders(content.body)

  return (
    <div className="space-y-5">
      <Field label="标题" hint="客人收件箱里看到的第一行">
        <p className="text-sm font-medium text-me-charcoal">{content.title ?? fallbackTitle ?? '（还没写）'}</p>
      </Field>
      <Field label="预览行" hint="标题下面那行灰色小字">
        <p className="text-[13px] text-me-charcoal/70">{content.previewText ?? '—'}</p>
      </Field>
      <Field
        label="正文"
        hint={bodyHint(content.sampleFirstName, placeholders)}
      >
        <div className="rounded-xl border border-black/10 bg-me-ivory p-5">
          {content.body.length === 0 ? (
            <p className="text-sm text-me-charcoal/70">（正文还没写）</p>
          ) : (
            <BodyView blocks={blocks} />
          )}
          {hiddenCount > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="mt-3 text-xs text-me-ochre underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-me-charcoal/40"
            >
              {expanded ? '收起 ▴' : `展开全文（后面还有 ${hiddenCount} 段）▾`}
            </button>
          )}
        </div>
      </Field>
    </div>
  )
}
