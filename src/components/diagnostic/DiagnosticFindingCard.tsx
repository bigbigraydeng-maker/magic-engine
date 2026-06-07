'use client'

import React from 'react'
import Link from 'next/link'
import type { DiagnosticFinding, DiagnosticSeverity, FixType } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiagnosticFindingCardProps {
  finding: DiagnosticFinding
  onDismiss?: (id: string) => void
  /** Deeplink for the inline "立即修复 →" CTA on me_auto findings. */
  fixDeeplink?: string
  /**
   * S09: shortcut to Settings → relevant tab when the finding's dimension was
   * skipped (e.g. SEO finding "Target keywords not configured" gets a top-right
   * "立即配置 →" button so FDE never has to guess where to go).
   */
  configHref?: string
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<DiagnosticSeverity, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high:     'bg-orange-100 text-orange-700 border-orange-200',
  medium:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  low:      'bg-blue-100 text-blue-700 border-blue-200',
  info:     'bg-gray-100 text-gray-600 border-gray-200',
}

const SEVERITY_LABELS: Record<DiagnosticSeverity, string> = {
  critical: '严重',
  high:     '高',
  medium:   '中',
  low:      '低',
  info:     '信息',
}

const FIX_TYPE_STYLES: Record<FixType, string> = {
  me_auto:     'bg-blue-100 text-blue-700',
  fde_manual:  'bg-purple-100 text-purple-700',
  third_party: 'bg-gray-100 text-gray-600',
}

const FIX_TYPE_LABELS: Record<FixType, string> = {
  me_auto:     'ME 可修复',
  fde_manual:  'FDE 操作',
  third_party: '第三方工具',
}

const CARD_BORDER: Record<DiagnosticSeverity, string> = {
  critical: 'border-l-red-500',
  high:     'border-l-orange-400',
  medium:   'border-l-yellow-400',
  low:      'border-l-blue-400',
  info:     'border-l-gray-300',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DiagnosticFindingCard({
  finding,
  onDismiss,
  fixDeeplink,
  configHref,
}: DiagnosticFindingCardProps): React.ReactElement {
  const { id, severity, fix_type, title, description, recommendation } = finding

  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 border-l-4 ${CARD_BORDER[severity]} p-4 shadow-sm`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Severity badge */}
          <span
            data-testid="severity-badge"
            data-severity={severity}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border ${SEVERITY_STYLES[severity]}`}
          >
            {SEVERITY_LABELS[severity]}
          </span>

          {/* Fix type badge */}
          <span
            data-testid="fix-type-badge"
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${FIX_TYPE_STYLES[fix_type]}`}
          >
            {FIX_TYPE_LABELS[fix_type]}
          </span>
        </div>

        {/* Right-aligned action cluster: configHref CTA (S09) + dismiss */}
        <div className="flex items-center gap-2 shrink-0">
          {configHref && (
            <Link
              data-testid="config-cta"
              href={configHref}
              title="跳转到 Settings 完成该维度配置"
              className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              立即配置 →
            </Link>
          )}
          {onDismiss && (
            <button
              data-testid="dismiss-btn"
              onClick={() => onDismiss(id)}
              className="text-gray-300 hover:text-gray-500 transition-colors"
              aria-label="忽略"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className="mt-2 text-sm font-semibold text-gray-900">{title}</h3>

      {/* Description */}
      <p className="mt-1 text-xs text-gray-600 leading-relaxed">{description}</p>

      {/* Recommendation */}
      <div className="mt-3 rounded-md bg-gray-50 px-3 py-2">
        <p className="text-xs text-gray-700">
          <span className="font-medium">建议：</span>
          {recommendation}
        </p>
      </div>

      {/* Deeplink button — only for me_auto with link */}
      {fix_type === 'me_auto' && fixDeeplink && (
        <div className="mt-3">
          <a
            data-testid="fix-deeplink-btn"
            href={fixDeeplink}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
          >
            立即修复 →
          </a>
        </div>
      )}
    </div>
  )
}
