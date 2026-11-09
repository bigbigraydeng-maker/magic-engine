'use client'

import { AMBER, FieldError, Label, inputClass, type FieldErrors } from './editor-parts'

export const REVIEWS_WARNING = '这些数字会原样显示在官网团卡片上，请只填有来源的真实数字。'

interface NumberBoxProps {
  label: string
  /** Accessible name of the box. */
  name: string
  value: string
  step: number
  max?: number
  error?: string
  onChange: (next: string) => void
}

function NumberBox({ label, name, value, step, max, error, onChange }: NumberBoxProps) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type="number"
        min={0}
        max={max}
        step={step}
        aria-label={name}
        className={inputClass}
        placeholder="留空表示不显示"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldError message={error} />
    </div>
  )
}

export function TourReviewFields(props: {
  rating: string
  reviewCount: string
  reviewSummary: string
  errors: FieldErrors
  onRating: (next: string) => void
  onReviewCount: (next: string) => void
  onReviewSummary: (next: string) => void
}): JSX.Element {
  const { rating, reviewCount, reviewSummary, errors, onRating, onReviewCount, onReviewSummary } = props
  return (
    <div className="space-y-4">
      <p
        data-testid="reviews-warning"
        className="rounded-lg px-3 py-2 text-xs font-semibold"
        style={{ color: AMBER, backgroundColor: 'rgba(183,121,31,0.1)' }}
      >
        {REVIEWS_WARNING}
      </p>
      <NumberBox
        label="评分（0 到 5，最多一位小数）"
        name="评分"
        value={rating}
        step={0.1}
        max={5}
        error={errors.rating}
        onChange={onRating}
      />
      <NumberBox label="评价数" name="评价数" value={reviewCount} step={1} error={errors.reviewCount} onChange={onReviewCount} />
      <div>
        <Label>评价摘要</Label>
        <input
          aria-label="评价摘要"
          className={inputClass}
          value={reviewSummary}
          onChange={(e) => onReviewSummary(e.target.value)}
        />
        <FieldError message={errors.reviewSummary} />
      </div>
    </div>
  )
}
