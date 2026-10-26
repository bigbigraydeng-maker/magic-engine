'use client'

import type { FaqDraft } from './tour-editor-form'
import { FAQ_MAX } from './tour-editor-form'
import { DANGER, FieldError, HelpText, inputClass, smallButtonClass, type FieldErrors } from './editor-parts'

export const FAQ_FULL_TEXT = '常见问题最多 12 条，已经到上限'

interface FaqCardProps {
  faq: FaqDraft
  index: number
  total: number
  errors: FieldErrors
  onChange: (next: FaqDraft[]) => void
  faqs: FaqDraft[]
}

function updateFaq(faqs: FaqDraft[], index: number, patch: Partial<FaqDraft>): FaqDraft[] {
  return faqs.map((faq, i) => (i === index ? { ...faq, ...patch } : faq))
}

function moveFaq(faqs: FaqDraft[], from: number, to: number): FaqDraft[] {
  const next = faqs.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function removeFaq(faqs: FaqDraft[], index: number): FaqDraft[] {
  return faqs.filter((_, i) => i !== index)
}

function FaqCardHeader(props: {
  n: number
  index: number
  total: number
  faqs: FaqDraft[]
  onChange: (next: FaqDraft[]) => void
}) {
  const { n, index, total, faqs, onChange } = props
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold text-me-charcoal">第 {n} 条</span>
      <div className="flex gap-1">
        <button
          type="button"
          aria-label={`上移第 ${n} 条`}
          className={smallButtonClass}
          disabled={index === 0}
          onClick={() => onChange(moveFaq(faqs, index, index - 1))}
        >
          上移
        </button>
        <button
          type="button"
          aria-label={`下移第 ${n} 条`}
          className={smallButtonClass}
          disabled={index === total - 1}
          onClick={() => onChange(moveFaq(faqs, index, index + 1))}
        >
          下移
        </button>
        <button
          type="button"
          aria-label={`删除第 ${n} 条`}
          className={smallButtonClass}
          style={{ color: DANGER }}
          onClick={() => onChange(removeFaq(faqs, index))}
        >
          删除
        </button>
      </div>
    </div>
  )
}

/** One single-line box of a FAQ with its red message right under it. */
function FaqLine(props: {
  name: string
  placeholder: string
  value: string
  error?: string
  onChange: (next: string) => void
}) {
  return (
    <div>
      <input
        aria-label={props.name}
        className={inputClass}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <FieldError message={props.error} />
    </div>
  )
}

function FaqCard(props: FaqCardProps) {
  const { faq, index, total, errors, onChange, faqs } = props
  const n = index + 1
  const at = `faqs[${index}]`
  const set = (patch: Partial<FaqDraft>) => onChange(updateFaq(faqs, index, patch))
  return (
    <div data-testid="faq-item" className="space-y-2 rounded-xl border border-black/10 bg-me-ivory p-3">
      <FaqCardHeader n={n} index={index} total={total} faqs={faqs} onChange={onChange} />
      <FaqLine
        name={`问题 ${n}`}
        placeholder="问题"
        value={faq.question}
        error={errors[`${at}.question`]}
        onChange={(question) => set({ question })}
      />
      <div>
        <textarea
          aria-label={`回答 ${n}`}
          rows={3}
          className={inputClass}
          placeholder="回答"
          value={faq.answer}
          onChange={(e) => set({ answer: e.target.value })}
        />
        <FieldError message={errors[`${at}.answer`]} />
      </div>
      <FaqLine
        name={`链接 ${n}`}
        placeholder="选填：站内路径，例如 /tours/china-highlights"
        value={faq.href}
        error={errors[`${at}.link.href`]}
        onChange={(href) => set({ href })}
      />
      <FaqLine
        name={`链接文字 ${n}`}
        placeholder="选填：链接上显示的文字"
        value={faq.label}
        error={errors[`${at}.link.label`]}
        onChange={(label) => set({ label })}
      />
      <FieldError message={errors[at]} />
      <FieldError message={errors[`${at}.link`]} />
    </div>
  )
}

export function TourFaqsField(props: {
  faqs: FaqDraft[]
  errors: FieldErrors
  onChange: (next: FaqDraft[]) => void
}): JSX.Element {
  const { faqs, errors, onChange } = props
  const full = faqs.length >= FAQ_MAX
  return (
    <div className="space-y-3">
      {faqs.length === 0 ? <p className="text-sm text-me-charcoal/60">还没有常见问题。</p> : null}
      {faqs.map((faq, index) => (
        <FaqCard
          key={index}
          faq={faq}
          index={index}
          total={faqs.length}
          errors={errors}
          onChange={onChange}
          faqs={faqs}
        />
      ))}
      <div>
        <button
          type="button"
          className={smallButtonClass}
          disabled={full}
          onClick={() => onChange([...faqs, { question: '', answer: '', href: '', label: '' }])}
        >
          加一条问题
        </button>
        {full ? <HelpText>{FAQ_FULL_TEXT}</HelpText> : null}
      </div>
      <FieldError message={errors.faqs} />
    </div>
  )
}
