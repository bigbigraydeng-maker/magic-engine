'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { ScoreGauge } from './ScoreGauge'
import { getDimensionFormula, classifyTier } from '@/lib/diagnostic/score-formula-explainer'
import type { DiagnosticDimension } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BaselineInfo {
  p50: number | null
  p75: number | null
  p90: number | null
  source: string | null
}

export interface DimensionScoreCardProps {
  dimension: DiagnosticDimension
  dimensionLabel: string
  /** 0–100 number, or null when the dimension was skipped / unconfigured. */
  score: number | null
  loading?: boolean
  /** Industry baseline (P50/P75/P90) — null when no industry mapping or no row. */
  baseline?: BaselineInfo | null
  /** Settings deep-link path for the "立即配置" CTA when score is null. */
  configHref?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampPct(score: number): number {
  return Math.max(0, Math.min(100, score))
}

function baselineLabel(score: number, baseline: BaselineInfo): string {
  if (baseline.p90 != null && score >= baseline.p90) return '行业 Top 10%'
  if (baseline.p75 != null && score >= baseline.p75) return '行业 Top 25%'
  if (baseline.p50 != null && score >= baseline.p50) return '行业 Top 50%'
  return '低于行业中位'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DimensionScoreCard({
  dimension,
  dimensionLabel,
  score,
  loading = false,
  baseline = null,
  configHref,
}: DimensionScoreCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const formula = getDimensionFormula(dimension)
  const tier = classifyTier(score)
  const isUnknown = tier === 'unknown'

  return (
    <div
      className="flex flex-col gap-2"
      data-testid={`dimension-score-card-${dimension}`}
    >
      <ScoreGauge
        score={isUnknown ? null : (score as number)}
        dimension={dimensionLabel}
        loading={loading}
      />

      {/* S10: mini progress bar — visualises 0–100 scale with tier band markers
          so FDE can see "36 vs 31" at a glance even though both fall in red. */}
      {!loading && !isUnknown && (
        <div
          data-testid={`score-bar-${dimension}`}
          className="relative h-1.5 w-full rounded-full bg-gray-200 overflow-hidden"
          title="<40 危险 · 40–69 待改善 · ≥70 健康"
        >
          {/* tier band markers at amber (40) and green (70) thresholds */}
          <div className="absolute top-0 bottom-0 left-[40%] w-px bg-gray-400/40" aria-hidden />
          <div className="absolute top-0 bottom-0 left-[70%] w-px bg-gray-400/40" aria-hidden />
          <div
            className={
              tier === 'green'
                ? 'h-full bg-green-500'
                : tier === 'amber'
                  ? 'h-full bg-orange-500'
                  : 'h-full bg-red-500'
            }
            style={{ width: `${clampPct(score as number)}%` }}
          />
        </div>
      )}

      {/* S11: config CTA for unconfigured dimensions.
          Copy + tooltip both tell FDE where they're going so the link is
          self-explanatory before they click. */}
      {isUnknown && configHref && (
        <Link
          href={configHref}
          title="将打开 Settings → 关键词与竞品"
          className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline"
        >
          去 Settings 配置 →
        </Link>
      )}

      {/* S14: "Why is the score X?" expandable */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        data-testid={`explain-toggle-${dimension}`}
        className="text-[11px] text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline self-start"
      >
        {expanded ? '收起' : isUnknown ? '为什么"未配置"?' : `为什么是 ${score} 分?`}
      </button>

      {expanded && (
        <div
          data-testid={`explain-panel-${dimension}`}
          className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-700 space-y-1.5"
        >
          <div>
            <span className="font-semibold text-gray-900">公式：</span>
            <span>{formula.formula}</span>
          </div>
          <div>
            <span className="font-semibold text-gray-900">数据源：</span>
            <span>{formula.dataSource}</span>
          </div>
          {baseline && (baseline.p50 != null || baseline.p75 != null || baseline.p90 != null) ? (
            <div>
              <span className="font-semibold text-gray-900">行业基准：</span>
              <span>
                {baseline.p50 != null && `p50=${baseline.p50}`}
                {baseline.p75 != null && ` · p75=${baseline.p75}`}
                {baseline.p90 != null && ` · p90=${baseline.p90}`}
                {!isUnknown && (
                  <>
                    {' · '}
                    <span className="font-medium text-gray-900">
                      你 {score} → {baselineLabel(score as number, baseline)}
                    </span>
                  </>
                )}
                {baseline.source ? (
                  <span className="block text-gray-400 mt-0.5">来源：{baseline.source}</span>
                ) : null}
              </span>
            </div>
          ) : (
            <div className="text-gray-400">行业基准：暂无（该行业未灌入基准数据）</div>
          )}
          <div className="text-gray-500">
            <span className="font-semibold text-gray-900">阈值：</span>
            <span>{formula.tierHint}</span>
            <span className="text-gray-400">
              {' · 占综合得分权重 '}
              {Math.round(formula.weightInOverall * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
