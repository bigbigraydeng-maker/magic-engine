'use client'

import { useState } from 'react'
import {
  META_DESCRIPTION_MAX,
  META_TITLE_MAX,
  QUICK_ANSWER_MAX,
  TAG_MAX,
} from './tour-editor-form'
import {
  CharCount,
  FieldError,
  FieldErrorList,
  HelpText,
  Label,
  inputClass,
  smallButtonClass,
  type FieldErrors,
} from './editor-parts'

export const QUICK_ANSWER_HELP = '放在团页面顶部的一段简短回答，给搜索引擎和 AI 摘要用'
export const TAGS_FULL_TEXT = '标签最多 30 个，已经到上限'

interface TagsBlockProps {
  tags: string[]
  errors: FieldErrors
  onTags: (next: string[]) => void
}

function TagChip(props: { tag: string; onRemove: () => void }) {
  const { tag, onRemove } = props
  return (
    <span
      data-testid="tag-chip"
      className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-me-charcoal"
    >
      {tag}
      <button type="button" aria-label={`移除标签 ${tag}`} onClick={onRemove}>
        ×
      </button>
    </span>
  )
}

function TagsBlock(props: TagsBlockProps) {
  const { tags, errors, onTags } = props
  const [draft, setDraft] = useState('')
  const full = tags.length >= TAG_MAX

  const add = () => {
    const value = draft.trim()
    if (value === '' || tags.includes(value) || full) return
    onTags([...tags, value])
    setDraft('')
  }

  return (
    <div>
      <Label>标签（{tags.length} 个）</Label>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <TagChip key={tag} tag={tag} onRemove={() => onTags(tags.filter((t) => t !== tag))} />
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          aria-label="新标签"
          className={inputClass}
          placeholder="输入一个标签"
          value={draft}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className={smallButtonClass} disabled={full} onClick={add}>
          添加
        </button>
      </div>
      {full ? <HelpText>{TAGS_FULL_TEXT}</HelpText> : null}
      <FieldErrorList errors={errors} prefix="tags" />
    </div>
  )
}

interface CountedBoxProps {
  label: string
  value: string
  max: number
  /** Rows of a multi-line box; leave out for a single line. */
  rows?: number
  help?: string
  error?: string
  onChange: (next: string) => void
}

/** Label + box + "used/limit" counter + optional hint + red message. */
function CountedBox(props: CountedBoxProps) {
  const { label, value, max, rows, help, error, onChange } = props
  return (
    <div>
      <Label>{label}</Label>
      {rows ? (
        <textarea
          aria-label={label}
          rows={rows}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input aria-label={label} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      <CharCount length={value.length} max={max} />
      {help ? <HelpText>{help}</HelpText> : null}
      <FieldError message={error} />
    </div>
  )
}

export function TourSearchFields(props: {
  metaTitle: string
  metaDescription: string
  quickAnswer: string
  tags: string[]
  errors: FieldErrors
  onMetaTitle: (next: string) => void
  onMetaDescription: (next: string) => void
  onQuickAnswer: (next: string) => void
  onTags: (next: string[]) => void
}): JSX.Element {
  const { errors } = props
  return (
    <div className="space-y-4">
      <CountedBox
        label="搜索标题"
        value={props.metaTitle}
        max={META_TITLE_MAX}
        error={errors.metaTitle}
        onChange={props.onMetaTitle}
      />
      <CountedBox
        label="搜索描述"
        value={props.metaDescription}
        max={META_DESCRIPTION_MAX}
        rows={3}
        error={errors.metaDescription}
        onChange={props.onMetaDescription}
      />
      <CountedBox
        label="快速回答"
        value={props.quickAnswer}
        max={QUICK_ANSWER_MAX}
        rows={5}
        help={QUICK_ANSWER_HELP}
        error={errors.quickAnswer}
        onChange={props.onQuickAnswer}
      />
      <TagsBlock tags={props.tags} errors={errors} onTags={props.onTags} />
    </div>
  )
}
