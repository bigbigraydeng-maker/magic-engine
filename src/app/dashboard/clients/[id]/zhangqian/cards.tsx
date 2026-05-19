'use client'

/**
 * 张骞发现页面 — 诊断报告卡片组件
 * 独立文件以保持主 page.tsx < 800 行
 */

import type {
  ClientDiscoveryRow,
  DiscoveredKeyword,
  DiscoveredCompetitor,
  DiscoveredSocial,
  DiscoveredAiQuestion,
  KeywordType,
  CompetitorRelevance,
  AiQuestionCategory,
  SocialPlatform,
  DiagnosisBlock,
  AiVisibilityResult,
  SemrushSnapshot,
  DiscoveredReviewPlatform,
  DiscoveredRegistration,
  DiscoveredMetaAds,
  DiscoveredSerpResult,
  GscSearchData,
  DiscoveredGoogleAdsData,
  AdvancedFacebookProfile,
} from '@/lib/zhangqian/types'
import { useState } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

export const KEYWORD_TYPE_STYLES: Record<KeywordType, string> = {
  brand:         'bg-purple-100 text-purple-700',
  category:      'bg-blue-100 text-blue-700',
  long_tail:     'bg-green-100 text-green-700',
  local:         'bg-orange-100 text-orange-700',
  transactional: 'bg-red-100 text-red-700',
}

export const KEYWORD_TYPE_LABELS: Record<KeywordType, string> = {
  brand:         '品牌',
  category:      '类目',
  long_tail:     '长尾',
  local:         '本地',
  transactional: '购买意图',
}

export const RELEVANCE_STYLES: Record<CompetitorRelevance, string> = {
  direct:       'bg-red-100 text-red-700',
  adjacent:     'bg-yellow-100 text-yellow-700',
  aspirational: 'bg-blue-100 text-blue-700',
}

export const RELEVANCE_LABELS: Record<CompetitorRelevance, string> = {
  direct:       '直接竞品',
  adjacent:     '相邻竞品',
  aspirational: '标杆',
}

export const AI_CATEGORY_STYLES: Record<AiQuestionCategory, string> = {
  brand:      'bg-purple-100 text-purple-700',
  category:   'bg-blue-100 text-blue-700',
  comparison: 'bg-amber-100 text-amber-700',
  local:      'bg-orange-100 text-orange-700',
}

export const AI_CATEGORY_LABELS: Record<AiQuestionCategory, string> = {
  brand:      '品牌',
  category:   '类目',
  comparison: '对比',
  local:      '本地',
}

export const PLATFORM_ICONS: Record<SocialPlatform, string> = {
  instagram: '📸',
  facebook:  '👤',
  linkedin:  '💼',
  youtube:   '▶️',
  tiktok:    '🎵',
  twitter:   '🐦',
  pinterest: '📌',
}

// ─── Shared primitives ────────────────────────────────────────────────────────

export function ConfigureCTA({
  clientId,
  anchor,
  label = '立即配置 →',
}: {
  clientId: string
  anchor: string
  label?: string
}) {
  if (!clientId) return null
  return (
    <a
      href={`/dashboard/clients/${clientId}/connectors#${anchor}`}
      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
    >
      {label}
    </a>
  )
}

function EmptyWithCTA({
  text,
  clientId,
  anchor,
  ctaLabel,
}: {
  text: string
  clientId?: string
  anchor: string
  ctaLabel?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-2">
      <p className="text-sm text-gray-400">{text}</p>
      {clientId && <ConfigureCTA clientId={clientId} anchor={anchor} label={ctaLabel} />}
    </div>
  )
}

export function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

export function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  )
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  )
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color =
    score >= 70 ? 'bg-green-500' :
    score >= 40 ? 'bg-yellow-400' :
    'bg-red-400'
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-700 w-8 text-right">{score}</span>
    </div>
  )
}

// ─── DiagnosisCard ────────────────────────────────────────────────────────────

export function DiagnosisCard({ diagnosis }: { diagnosis: DiagnosisBlock }) {
  const [moneyFlowOpen, setMoneyFlowOpen] = useState(false)
  const { scores, crisis_type, executive_summary, money_flow, key_finding } = diagnosis

  const crisisColors: Record<string, string> = {
    'TYPE_E': 'bg-red-100 text-red-700 border-red-200',
    'TYPE_D': 'bg-gray-100 text-gray-700 border-gray-200',
    'TYPE_B': 'bg-amber-100 text-amber-700 border-amber-200',
    'TYPE_A': 'bg-blue-100 text-blue-700 border-blue-200',
  }
  const crisisPrefix = crisis_type?.split(' ')[0] ?? ''
  const crisisStyle = crisisColors[crisisPrefix] ?? 'bg-gray-100 text-gray-600 border-gray-200'

  return (
    <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-indigo-800 uppercase tracking-wide">品牌健康诊断</h3>
        {crisis_type && (
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border ${crisisStyle}`}>
            {crisis_type}
          </span>
        )}
      </div>

      {/* Key finding */}
      <div className="rounded-lg bg-white border border-indigo-100 px-4 py-3">
        <p className="text-sm font-medium text-indigo-900 leading-relaxed">{key_finding}</p>
      </div>

      {/* Scores */}
      <div className="flex flex-col gap-2">
        <ScoreBar label="SEO" score={scores.seo} />
        <ScoreBar label="社交媒体" score={scores.social} />
        <ScoreBar label="品牌声誉" score={scores.reputation} />
        <ScoreBar label="AI 可见度" score={scores.ai_visibility} />
        <div className="border-t border-gray-100 pt-2 mt-1">
          <ScoreBar label="综合得分" score={scores.overall} />
        </div>
      </div>

      {/* Executive summary */}
      <p className="text-sm text-gray-700 leading-relaxed">{executive_summary}</p>

      {/* Money flow collapsible */}
      <div className="rounded-lg border border-amber-100 bg-amber-50">
        <button
          onClick={() => setMoneyFlowOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left"
        >
          <span className="text-xs font-semibold text-amber-800">钱去了哪里？</span>
          <span className="text-amber-500 text-xs">{moneyFlowOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        {moneyFlowOpen && (
          <p className="px-4 pb-3 text-xs text-amber-900 leading-relaxed">{money_flow}</p>
        )}
      </div>
    </div>
  )
}

// ─── ActionPlanCard ───────────────────────────────────────────────────────────

export function ActionPlanCard({ actions }: { actions: DiagnosisBlock['actions'] }) {
  // Defensive: diagnosis is a pass-through field in validators —
  // Claude may emit null arrays here. Normalise before rendering.
  const quickFix = actions?.quick_fix ?? []
  const important = actions?.important ?? []
  const talkToUs = actions?.talk_to_us ?? []
  return (
    <CardShell title="行动计划">
      {quickFix.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-green-700 mb-1.5">立即可做（客户自助）</p>
          <ul className="space-y-1.5">
            {quickFix.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                <span className="text-green-500 mt-0.5 shrink-0">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {important.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-amber-700 mb-1.5">重要建设（1-3个月）</p>
          <ul className="space-y-1.5">
            {important.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                <span className="text-amber-500 mt-0.5 shrink-0">◆</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {talkToUs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-indigo-700 mb-1.5">需要专业支持</p>
          <ul className="space-y-1.5">
            {talkToUs.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                <span className="text-indigo-400 mt-0.5 shrink-0">★</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </CardShell>
  )
}

// ─── KeywordsCard ─────────────────────────────────────────────────────────────

export function KeywordsCard({
  keywords,
  semrushSnapshot,
}: {
  keywords: DiscoveredKeyword[]
  semrushSnapshot?: SemrushSnapshot | null
}) {
  return (
    <CardShell title="关键词情报">
      {/* SEMrush snapshot metrics */}
      {semrushSnapshot && (
        <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 flex flex-wrap gap-4">
          {semrushSnapshot.monthly_traffic != null && (
            <div className="text-center">
              <p className="text-lg font-bold text-blue-700">{semrushSnapshot.monthly_traffic.toLocaleString()}</p>
              <p className="text-xs text-blue-500">月有机流量</p>
            </div>
          )}
          {semrushSnapshot.trust_score != null && (
            <div className="text-center">
              <p className="text-lg font-bold text-blue-700">{semrushSnapshot.trust_score}<span className="text-sm font-normal">/100</span></p>
              <p className="text-xs text-blue-500">权威分</p>
            </div>
          )}
          {semrushSnapshot.keyword_count != null && (
            <div className="text-center">
              <p className="text-lg font-bold text-blue-700">{semrushSnapshot.keyword_count.toLocaleString()}</p>
              <p className="text-xs text-blue-500">排名关键词</p>
            </div>
          )}
        </div>
      )}

      {/* Top keywords from SEMrush */}
      {semrushSnapshot && (semrushSnapshot.top_keywords ?? []).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">SEMrush 实时排名 TOP 词</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-1 pr-3 text-gray-500 font-medium">关键词</th>
                  <th className="text-right py-1 px-2 text-gray-500 font-medium">排名</th>
                  <th className="text-right py-1 pl-2 text-gray-500 font-medium">月搜索量</th>
                </tr>
              </thead>
              <tbody>
                {(semrushSnapshot.top_keywords ?? []).slice(0, 10).map((kw, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1 pr-3 text-gray-800">{kw.keyword}</td>
                    <td className="py-1 px-2 text-right">
                      <span className={`font-medium ${kw.position <= 3 ? 'text-green-600' : kw.position <= 10 ? 'text-blue-600' : 'text-gray-500'}`}>
                        #{kw.position}
                      </span>
                    </td>
                    <td className="py-1 pl-2 text-right text-gray-500">
                      {kw.volume != null ? kw.volume.toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Seed keywords section */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">种子关键词</p>
        <p className="text-xs text-gray-400 mb-2 leading-relaxed">
          以下关键词是张骞根据您的业务类型推荐的目标词，将作为后续 SEO 内容生产的基础。
        </p>
        <ul className="space-y-2">
          {keywords.map((kw, i) => (
            <li key={i} className="flex items-start gap-2">
              <Badge className={KEYWORD_TYPE_STYLES[kw.type]}>
                {KEYWORD_TYPE_LABELS[kw.type]}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{kw.keyword}</p>
                {kw.rationale && (
                  <p className="text-xs text-gray-400 leading-relaxed mt-0.5">{kw.rationale}</p>
                )}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {kw.semrush_volume != null && kw.semrush_volume > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      <span className="text-gray-400">搜索量</span>
                      <span className="font-medium">{kw.semrush_volume >= 1000 ? `${(kw.semrush_volume / 1000).toFixed(kw.semrush_volume >= 10000 ? 0 : 1)}K` : kw.semrush_volume}</span>
                    </span>
                  )}
                  {kw.semrush_kd != null && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      kw.semrush_kd < 30 ? 'bg-green-100 text-green-700' :
                      kw.semrush_kd < 50 ? 'bg-yellow-100 text-yellow-700' :
                      kw.semrush_kd < 70 ? 'bg-orange-100 text-orange-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      <span className="font-normal opacity-70">KD</span>
                      {kw.semrush_kd}
                    </span>
                  )}
                  {kw.semrush_cpc != null && kw.semrush_cpc > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
                      <span className="opacity-70">CPC</span>
                      <span className="font-medium">${kw.semrush_cpc.toFixed(2)}</span>
                    </span>
                  )}
                  {kw.semrush_rank != null && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                      <span className="opacity-70">排名</span>
                      <span className="font-medium">#{kw.semrush_rank}</span>
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </CardShell>
  )
}

// ─── AiVisibilityCard ─────────────────────────────────────────────────────────

export function AiVisibilityCard({
  questions,
  visibilityResults,
}: {
  questions: DiscoveredAiQuestion[]
  visibilityResults?: AiVisibilityResult[] | null
}) {
  return (
    <CardShell title="AI 可见度">
      {/* Explanation */}
      <p className="text-xs text-gray-500 leading-relaxed">
        当消费者向 ChatGPT / Perplexity 提问时，您的品牌是否出现在推荐中？以下是张骞对2个核心问句的实测结果。
      </p>

      {/* Tested results */}
      {visibilityResults && visibilityResults.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500">实测结果</p>
          {visibilityResults.map((result, i) => (
            <div key={i} className="rounded-lg border border-gray-100 p-3">
              <p className="text-xs text-gray-700 mb-2 font-medium">"{result.question}"</p>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {(result.top_brands ?? []).map((brand, j) => (
                  <span
                    key={j}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-600"
                  >
                    {brand}
                  </span>
                ))}
              </div>
              <div className={`flex items-center gap-1.5 text-xs font-medium ${result.client_mentioned ? 'text-green-600' : 'text-red-500'}`}>
                <span>{result.client_mentioned ? '✓ 品牌出现在结果中' : '✗ 品牌未出现'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tracking questions */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">持续追踪问句</p>
        <p className="text-xs text-gray-400 mb-2">以下问句将持续监测品牌在AI平台的可见度变化。</p>
        <ul className="space-y-2">
          {questions.map((q, i) => (
            <li key={i} className="flex items-start gap-2">
              <Badge className={AI_CATEGORY_STYLES[q.category]}>
                {AI_CATEGORY_LABELS[q.category]}
              </Badge>
              <p className="text-xs text-gray-700 flex-1 leading-relaxed">{q.question}</p>
            </li>
          ))}
        </ul>
      </div>
    </CardShell>
  )
}

// ─── CompetitorsCard ──────────────────────────────────────────────────────────

export function CompetitorsCard({ competitors }: { competitors: DiscoveredCompetitor[] }) {
  return (
    <CardShell title="竞争格局">
      <ul className="space-y-3">
        {competitors.map((c, i) => (
          <li key={i} className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                <Badge className={RELEVANCE_STYLES[c.relevance]}>
                  {RELEVANCE_LABELS[c.relevance]}
                </Badge>
              </div>
              <p className="text-xs text-gray-400 truncate">{c.domain}</p>
              {(c.monthly_traffic != null || c.keyword_count != null) && (
                <div className="flex gap-3 mt-0.5">
                  {c.monthly_traffic != null && (
                    <span className="text-xs text-blue-500">{c.monthly_traffic.toLocaleString()} 流量/月</span>
                  )}
                  {c.keyword_count != null && (
                    <span className="text-xs text-gray-400">{c.keyword_count.toLocaleString()} 关键词</span>
                  )}
                </div>
              )}
              {c.rationale && (
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{c.rationale}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  )
}

// ─── SocialCard ───────────────────────────────────────────────────────────────

export function SocialCard({ socials, clientId }: { socials: DiscoveredSocial[]; clientId?: string }) {
  if (socials.length === 0) {
    return (
      <CardShell title="社交媒体">
        <EmptyWithCTA
          text="未发现社媒账号"
          clientId={clientId}
          anchor="social"
          ctaLabel="授权客户社媒账号 →"
        />
      </CardShell>
    )
  }
  return (
    <CardShell title="社交媒体">
      <ul className="space-y-2">
        {socials.map((s, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="text-lg">{PLATFORM_ICONS[s.platform]}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 capitalize">{s.platform}</p>
              {s.handle && <p className="text-xs text-gray-400">{s.handle}</p>}
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-500 hover:underline truncate block"
              >
                {s.url}
              </a>
              {(s.followers_count != null || s.posts_last_30d != null || s.engagement_rate != null) && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {s.followers_count != null && (
                    <span className="text-xs text-gray-500">{s.followers_count.toLocaleString()} 粉丝</span>
                  )}
                  {s.posts_last_30d != null && (
                    <span className="text-xs text-gray-500">近30天 {s.posts_last_30d} 帖</span>
                  )}
                  {s.engagement_rate != null && (
                    <span className="text-xs text-gray-500">互动率 {(s.engagement_rate * 100).toFixed(1)}%</span>
                  )}
                </div>
              )}
            </div>
            <ConfidenceBar value={s.confidence} />
          </li>
        ))}
      </ul>
    </CardShell>
  )
}

// ─── GbpCard ──────────────────────────────────────────────────────────────────

export function GbpCard({
  gbp,
  clientId,
}: {
  gbp: ClientDiscoveryRow['payload']['gbp']
  clientId?: string
}) {
  if (!gbp) {
    return (
      <CardShell title="品牌档案（Google）">
        <EmptyWithCTA
          text="未发现 Google 商业档案"
          clientId={clientId}
          anchor="gbp"
          ctaLabel="接入 GBP →"
        />
      </CardShell>
    )
  }
  const stars = gbp.rating != null ? Math.round(gbp.rating) : 0
  return (
    <CardShell title="品牌档案（Google）">
      <p className="text-sm font-medium text-gray-900">{gbp.business_name}</p>
      <p className="text-xs text-gray-500">{gbp.address}</p>
      {gbp.rating != null && (
        <div className="flex items-center gap-2">
          <div className="flex text-yellow-400 text-sm">
            {'★'.repeat(stars)}{'☆'.repeat(5 - stars)}
          </div>
          <span className="text-xs text-gray-600">{gbp.rating.toFixed(1)}</span>
          {gbp.review_count != null && (
            <span className="text-xs text-gray-400">({gbp.review_count} 条评价)</span>
          )}
        </div>
      )}
      <ConfidenceBar value={gbp.confidence} />
      {gbp.google_maps_url && (
        <a
          href={gbp.google_maps_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-indigo-500 hover:underline"
        >
          在 Google Maps 查看 →
        </a>
      )}
    </CardShell>
  )
}

// ─── RegistrationBlock ────────────────────────────────────────────────────────

function RegistrationBlock({ registration }: { registration: DiscoveredRegistration }) {
  const statusStyle: Record<DiscoveredRegistration['status'], string> = {
    active:    'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
    unknown:   'bg-gray-100 text-gray-600',
  }
  const statusLabel: Record<DiscoveredRegistration['status'], string> = {
    active: '有效', cancelled: '已注销', unknown: '状态未知',
  }
  const years = registration.registered_since
    ? Math.floor((Date.now() - new Date(registration.registered_since).getTime()) / (365.25 * 864e5))
    : null
  return (
    <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-xs font-semibold text-emerald-800">工商注册（官方验证）</p>
        <Badge className={statusStyle[registration.status]}>{statusLabel[registration.status]}</Badge>
      </div>
      <div className="flex flex-col gap-0.5 text-xs text-emerald-900">
        <p><span className="text-emerald-500">{registration.identifier_type}：</span>{registration.identifier}</p>
        {registration.entity_name && (
          <p><span className="text-emerald-500">实体名：</span>{registration.entity_name}</p>
        )}
        {registration.entity_type && (
          <p><span className="text-emerald-500">实体类型：</span>{registration.entity_type}</p>
        )}
        {registration.registered_since && (
          <p>
            <span className="text-emerald-500">注册时间：</span>
            {registration.registered_since}
            {years != null && years > 0 && `（约 ${years} 年）`}
          </p>
        )}
        {registration.gst_registered != null && (
          <p><span className="text-emerald-500">GST：</span>{registration.gst_registered ? '已注册' : '未注册'}</p>
        )}
      </div>
    </div>
  )
}

// ─── BusinessCard ─────────────────────────────────────────────────────────────

export function BusinessCard({ discovery }: { discovery: ClientDiscoveryRow }) {
  const biz = discovery.payload.business
  return (
    <CardShell title="品牌概览">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900 text-base">{biz.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {[biz.location.city, biz.location.region, biz.location.country].filter(Boolean).join(', ')}
          </p>
        </div>
        <Badge className={biz.confidence >= 0.7 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
          置信度 {Math.round(biz.confidence * 100)}%
        </Badge>
      </div>
      <ConfidenceBar value={biz.confidence} />
      <div className="flex flex-wrap gap-1">
        {biz.industry.map(tag => (
          <Badge key={tag} className="bg-gray-100 text-gray-600">{tag}</Badge>
        ))}
      </div>
      <p className="text-xs text-gray-600 leading-relaxed">{biz.description}</p>
      {biz.unique_selling_points.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">核心卖点</p>
          <ul className="space-y-0.5">
            {biz.unique_selling_points.map((usp, i) => (
              <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                <span className="text-indigo-400 mt-0.5">•</span>{usp}
              </li>
            ))}
          </ul>
        </div>
      )}
      {biz.registration && <RegistrationBlock registration={biz.registration} />}
    </CardShell>
  )
}

// ─── NotesCard ────────────────────────────────────────────────────────────────

export function NotesCard({ notes }: { notes: string }) {
  if (!notes.trim()) return null
  return (
    <CardShell title="探索备注">
      <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{notes}</p>
    </CardShell>
  )
}

// ─── ReviewPlatformsCard ──────────────────────────────────────────────────────

const REVIEW_PLATFORM_LABELS: Record<DiscoveredReviewPlatform['platform'], string> = {
  google:        'Google',
  productreview: 'ProductReview',
  tripadvisor:   'Tripadvisor',
  trustpilot:    'Trustpilot',
  yelp:          'Yelp',
  facebook:      'Facebook',
  other:         '其他平台',
}

function RatingDistribution({ dist }: { dist: Record<'1' | '2' | '3' | '4' | '5', number> }) {
  const total = Object.values(dist).reduce((sum, n) => sum + n, 0)
  if (total === 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      {(['5', '4', '3', '2', '1'] as const).map(star => {
        const pct = Math.round((dist[star] / total) * 100)
        return (
          <div key={star} className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-400 w-6">{star}★</span>
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-gray-400 w-8 text-right">{dist[star]}</span>
          </div>
        )
      })}
    </div>
  )
}

function ReviewPlatformItem({ platform }: { platform: DiscoveredReviewPlatform }) {
  const negatives = platform.recent_negative_samples ?? []
  return (
    <li className="rounded-lg border border-gray-100 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <a
          href={platform.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-indigo-600 hover:underline"
        >
          {REVIEW_PLATFORM_LABELS[platform.platform]}
        </a>
        <div className="flex items-center gap-1.5 text-xs">
          {platform.rating != null && (
            <span className="font-semibold text-gray-800">{platform.rating.toFixed(1)} ★</span>
          )}
          {platform.review_count != null && (
            <span className="text-gray-400">({platform.review_count} 条)</span>
          )}
        </div>
      </div>
      {platform.response_rate != null && (
        <p className="text-xs text-gray-500">商家回复率：{Math.round(platform.response_rate * 100)}%</p>
      )}
      {platform.rating_distribution && <RatingDistribution dist={platform.rating_distribution} />}
      {negatives.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-red-600">近期负面评价样本</p>
          {negatives.map((r, i) => (
            <div key={i} className="rounded bg-red-50 border border-red-100 px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-red-500 font-medium">{r.rating}★</span>
                {r.author && <span className="text-gray-500">{r.author}</span>}
                {r.date && <span className="text-gray-400">· {r.date}</span>}
              </div>
              <p className="text-xs text-gray-700 mt-0.5 leading-relaxed">{r.text}</p>
            </div>
          ))}
        </div>
      )}
    </li>
  )
}

export function ReviewPlatformsCard({
  platforms,
  clientId,
}: {
  platforms: DiscoveredReviewPlatform[]
  clientId?: string
}) {
  if (!platforms || platforms.length === 0) {
    return (
      <CardShell title="评价平台">
        <EmptyWithCTA
          text="未发现第三方评价平台"
          clientId={clientId}
          anchor="reviews"
          ctaLabel="接入评价平台 →"
        />
      </CardShell>
    )
  }
  return (
    <CardShell title="评价平台">
      <ul className="space-y-2.5">
        {platforms.map((p, i) => <ReviewPlatformItem key={i} platform={p} />)}
      </ul>
    </CardShell>
  )
}

// ─── MetaAdsCard ──────────────────────────────────────────────────────────────

const SPEND_LABELS: Record<DiscoveredMetaAds['estimated_spend'], string> = {
  low:     '低',
  medium:  '中',
  high:    '高',
  unknown: '未知',
}

export function MetaAdsCard({
  ads,
  clientId,
}: {
  ads: DiscoveredMetaAds | null | undefined
  clientId?: string
}) {
  if (!ads) {
    return (
      <CardShell title="Meta 广告投放">
        <EmptyWithCTA
          text="Meta 广告库扫描属于 Advanced Discovery — 接入 Meta Ads 账户后单独补跑"
          clientId={clientId}
          anchor="meta-ads"
          ctaLabel="接入 Meta Ads 账户 →"
        />
      </CardShell>
    )
  }
  return (
    <CardShell title="Meta 广告投放">
      <div className="flex flex-wrap gap-4">
        <div className="text-center">
          <p className="text-lg font-bold text-indigo-700">{ads.active_ads_count}</p>
          <p className="text-xs text-gray-500">活跃广告</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-indigo-700">{SPEND_LABELS[ads.estimated_spend]}</p>
          <p className="text-xs text-gray-500">投放力度</p>
        </div>
      </div>
      {ads.ad_types.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ads.ad_types.map((t, i) => (
            <Badge key={i} className="bg-gray-100 text-gray-600">{t}</Badge>
          ))}
        </div>
      )}
      {ads.top_ad_copy.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1">广告文案样本</p>
          <ul className="space-y-1">
            {ads.top_ad_copy.map((copy, i) => (
              <li key={i} className="text-xs text-gray-700 leading-relaxed flex items-start gap-1">
                <span className="text-indigo-400 mt-0.5">•</span>{copy}
              </li>
            ))}
          </ul>
        </div>
      )}
    </CardShell>
  )
}

// ─── SerpResultsCard ──────────────────────────────────────────────────────────

function SerpResultItem({ serp }: { serp: DiscoveredSerpResult }) {
  return (
    <li className="rounded-lg border border-gray-100 p-3 flex flex-col gap-2">
      <p className="text-sm font-medium text-gray-800">&quot;{serp.query}&quot;</p>
      {serp.ai_overview_text && (
        <div className="rounded bg-violet-50 border border-violet-100 px-2.5 py-2">
          <p className="text-xs font-semibold text-violet-700 mb-0.5">Google AI 回答</p>
          <p className="text-xs text-violet-900 leading-relaxed">{serp.ai_overview_text}</p>
        </div>
      )}
      {serp.organic_results.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1">自然排名 TOP</p>
          <ul className="space-y-0.5">
            {serp.organic_results.slice(0, 5).map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                <span className="text-gray-400 w-5 shrink-0">#{r.position}</span>
                <span className="text-gray-700 truncate">{r.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {serp.paid_advertiser_domains.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-gray-500">投广告：</span>
          {serp.paid_advertiser_domains.map((d, i) => (
            <Badge key={i} className="bg-amber-100 text-amber-700">{d}</Badge>
          ))}
        </div>
      )}
    </li>
  )
}

export function SerpResultsCard({
  results,
  clientId,
}: {
  results: DiscoveredSerpResult[] | null | undefined
  clientId?: string
}) {
  if (!results || results.length === 0) {
    return (
      <CardShell title="Google 搜索结果">
        <EmptyWithCTA
          text="未抓取 Google 搜索结果"
          clientId={clientId}
          anchor="gsc"
          ctaLabel="接入 Google Search Console →"
        />
      </CardShell>
    )
  }
  return (
    <CardShell title="Google 搜索结果">
      <ul className="space-y-2.5">
        {results.map((s, i) => <SerpResultItem key={i} serp={s} />)}
      </ul>
    </CardShell>
  )
}

// ─── GscDataCard ──────────────────────────────────────────────────────────────

export function GscDataCard({ gscData }: { gscData: GscSearchData }) {
  const totalClicks = gscData.rows.reduce((s, r) => s + r.clicks, 0)
  const totalImpressions = gscData.rows.reduce((s, r) => s + r.impressions, 0)
  const displayed = gscData.rows.slice(0, 15)

  return (
    <CardShell title="GSC 搜索表现（真实数据）">
      {/* Summary metrics */}
      <div className="rounded-lg bg-green-50 border border-green-100 p-3 flex flex-wrap gap-4">
        <div className="text-center">
          <p className="text-lg font-bold text-green-700">{totalClicks.toLocaleString()}</p>
          <p className="text-xs text-green-600">总点击（{gscData.date_range_days}天）</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-green-700">{totalImpressions.toLocaleString()}</p>
          <p className="text-xs text-green-600">总展示</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-green-700">{gscData.rows.length}</p>
          <p className="text-xs text-green-600">查询词数</p>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        站点：<span className="text-gray-600">{gscData.site_url}</span>
      </p>

      {/* Query table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-1 pr-2 text-gray-500 font-medium">查询词</th>
              <th className="text-right py-1 px-2 text-gray-500 font-medium">点击</th>
              <th className="text-right py-1 px-2 text-gray-500 font-medium">展示</th>
              <th className="text-right py-1 px-2 text-gray-500 font-medium">CTR</th>
              <th className="text-right py-1 pl-2 text-gray-500 font-medium">排名</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((row, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-1 pr-2 text-gray-800 break-all">{row.query}</td>
                <td className="py-1 px-2 text-right font-medium text-gray-700">{row.clicks}</td>
                <td className="py-1 px-2 text-right text-gray-500">{row.impressions.toLocaleString()}</td>
                <td className="py-1 px-2 text-right text-gray-500">{(row.ctr * 100).toFixed(1)}%</td>
                <td className="py-1 pl-2 text-right">
                  <span className={`font-medium ${
                    row.position <= 3 ? 'text-green-600' :
                    row.position <= 10 ? 'text-blue-600' :
                    'text-gray-400'
                  }`}>
                    {row.position.toFixed(1)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gscData.rows.length > 15 && (
        <p className="text-xs text-gray-400 text-right">
          显示前 15 条，共 {gscData.rows.length} 条
        </p>
      )}
    </CardShell>
  )
}

// ─── GoogleAdsCard ────────────────────────────────────────────────────────────

export function GoogleAdsCard({ adsData }: { adsData: DiscoveredGoogleAdsData }) {
  return (
    <CardShell title="Google Ads 透明中心">
      <div className="flex flex-wrap gap-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-blue-600">{adsData.active_ads_count}</p>
          <p className="text-xs text-gray-500">活跃广告数</p>
        </div>
        {adsData.regions.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1.5">投放地区</p>
            <div className="flex flex-wrap gap-1">
              {adsData.regions.map((r, i) => (
                <Badge key={i} className="bg-blue-50 text-blue-700">{r}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>
      {adsData.ad_formats.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">广告格式</p>
          <div className="flex flex-wrap gap-1">
            {adsData.ad_formats.map((f, i) => (
              <Badge key={i} className="bg-gray-100 text-gray-600">{f}</Badge>
            ))}
          </div>
        </div>
      )}
      {adsData.top_ad_previews.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">广告文案预览</p>
          <ul className="space-y-1">
            {adsData.top_ad_previews.map((preview, i) => (
              <li key={i} className="text-xs text-gray-700 leading-relaxed flex items-start gap-1">
                <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                <span>{preview}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </CardShell>
  )
}

// ─── AdvancedFacebookCard ─────────────────────────────────────────────────────

export function AdvancedFacebookCard({ profiles }: { profiles: AdvancedFacebookProfile[] }) {
  if (profiles.length === 0) return null
  return (
    <CardShell title="Facebook 深度数据">
      <ul className="space-y-3">
        {profiles.map((p, i) => (
          <li key={i} className="rounded-lg border border-gray-100 p-3">
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-indigo-600 hover:underline block mb-2"
            >
              {p.page_name}
            </a>
            <div className="flex flex-wrap gap-4">
              <div className="text-center">
                <p className="text-base font-bold text-gray-700">{p.followers_count.toLocaleString()}</p>
                <p className="text-xs text-gray-400">粉丝</p>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-gray-700">{p.posts_last_30d}</p>
                <p className="text-xs text-gray-400">近30天帖文</p>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-gray-700">{(p.engagement_rate * 100).toFixed(2)}%</p>
                <p className="text-xs text-gray-400">互动率</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  )
}

// ─── TechStackCard ────────────────────────────────────────────────────────────

interface TechStackData {
  cms:               string | null
  ecommerce:         string | null
  analytics:         string[]
  crm_marketing:     string[]
  chat:              string | null
  domain_rank:       number | null
  phone_numbers:     string[]
  emails:            string[]
  social_graph_urls: string[]
}

export function TechStackCard({ data }: { data: TechStackData }) {
  const rows: Array<{ label: string; value: string | null }> = [
    { label: 'CMS',      value: data.cms },
    { label: '电商平台', value: data.ecommerce },
    { label: '聊天插件', value: data.chat },
  ]

  return (
    <CardShell title="技术栈">
      <div className="flex flex-col gap-2">
        {rows.map(r =>
          r.value ? (
            <div key={r.label} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-16 shrink-0">{r.label}</span>
              <Badge className="bg-indigo-50 text-indigo-700">{r.value}</Badge>
            </div>
          ) : null,
        )}

        {data.analytics.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-xs text-gray-500 w-16 shrink-0 mt-0.5">分析工具</span>
            <div className="flex flex-wrap gap-1">
              {data.analytics.map(a => (
                <Badge key={a} className="bg-blue-50 text-blue-700">{a}</Badge>
              ))}
            </div>
          </div>
        )}

        {data.crm_marketing.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-xs text-gray-500 w-16 shrink-0 mt-0.5">CRM/营销</span>
            <div className="flex flex-wrap gap-1">
              {data.crm_marketing.map(c => (
                <Badge key={c} className="bg-green-50 text-green-700">{c}</Badge>
              ))}
            </div>
          </div>
        )}

        {data.domain_rank !== null && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-16 shrink-0">域名权重</span>
            <span className="text-sm font-semibold text-gray-700">{data.domain_rank}</span>
          </div>
        )}

        {(data.phone_numbers.length > 0 || data.emails.length > 0) && (
          <div className="mt-1 pt-2 border-t border-gray-100 flex flex-col gap-1">
            {data.phone_numbers.map(p => (
              <p key={p} className="text-xs text-gray-600">📞 {p}</p>
            ))}
            {data.emails.map(e => (
              <p key={e} className="text-xs text-gray-600">✉️ {e}</p>
            ))}
          </div>
        )}
      </div>
    </CardShell>
  )
}

// ─── DomainWhoisCard ──────────────────────────────────────────────────────────

interface DomainWhoisData {
  registered_at:          string | null
  expires_at:             string | null
  registrar:              string | null
  domain_age_years:       number | null
  referring_domains:      number | null
  backlinks:              number | null
  organic_etv:            number | null
  organic_keywords_top10: number | null
}

export function DomainWhoisCard({ data }: { data: DomainWhoisData }) {
  const daysToExpiry = data.expires_at
    ? Math.floor((Date.parse(data.expires_at) - Date.now()) / (24 * 60 * 60 * 1000))
    : null
  const expiryWarning = daysToExpiry !== null && daysToExpiry < 90

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

  const formatNum = (n: number | null) =>
    n !== null ? n.toLocaleString() : '—'

  return (
    <CardShell title="域名健康">
      <div className="flex flex-col gap-2">
        {data.domain_age_years !== null && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-20 shrink-0">域名年龄</span>
            <span className="text-sm font-semibold text-gray-700">{data.domain_age_years} 年</span>
          </div>
        )}

        {data.expires_at && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-20 shrink-0">到期日期</span>
            <span className={`text-sm font-semibold ${expiryWarning ? 'text-red-600' : 'text-gray-700'}`}>
              {formatDate(data.expires_at)}
              {expiryWarning && (
                <span className="ml-1 text-xs font-medium text-red-600">⚠️ 即将到期</span>
              )}
            </span>
          </div>
        )}

        {data.registrar && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-20 shrink-0">注册商</span>
            <span className="text-xs text-gray-600 truncate max-w-[180px]" title={data.registrar}>
              {data.registrar}
            </span>
          </div>
        )}

        <div className="mt-1 pt-2 border-t border-gray-100 grid grid-cols-2 gap-2">
          <div>
            <p className="text-base font-bold text-gray-700">{formatNum(data.referring_domains)}</p>
            <p className="text-xs text-gray-400">外链域名数</p>
          </div>
          <div>
            <p className="text-base font-bold text-gray-700">{formatNum(data.backlinks)}</p>
            <p className="text-xs text-gray-400">反链总数</p>
          </div>
          <div>
            <p className="text-base font-bold text-gray-700">{formatNum(data.organic_etv)}</p>
            <p className="text-xs text-gray-400">月流量估算</p>
          </div>
          <div>
            <p className="text-base font-bold text-gray-700">{formatNum(data.organic_keywords_top10)}</p>
            <p className="text-xs text-gray-400">Top10 关键词数</p>
          </div>
        </div>
      </div>
    </CardShell>
  )
}

// ─── OnPageAuditCard ──────────────────────────────────────────────────────────

interface OnPageAuditData {
  status_code:     number | null
  title:           string | null
  description:     string | null
  canonical:       string | null
  h1:              string | null
  internal_links:  number | null
  external_links:  number | null
  images_no_alt:   number | null
  images_total:    number | null
  word_count:      number | null
  core_web_vitals: {
    lcp: number | null
    cls: number | null
    tbt: number | null
  } | null
  checks: {
    no_title:         boolean
    no_description:   boolean
    no_h1:            boolean
    missing_alt_text: boolean
    broken_links:     boolean
    redirect_chain:   boolean
    https:            boolean
  }
}

export function OnPageAuditCard({ data }: { data: OnPageAuditData }) {
  const issues = [
    data.checks.no_title        && '缺少 <title>',
    data.checks.no_description  && '缺少 meta description',
    data.checks.no_h1           && '缺少 H1',
    data.checks.missing_alt_text && `${data.images_no_alt ?? '?'} 张图片缺 alt`,
    data.checks.redirect_chain  && '存在重定向链',
    !data.checks.https          && '未启用 HTTPS',
    data.checks.broken_links    && '有断链',
  ].filter(Boolean) as string[]

  const formatMs = (ms: number | null) => (ms !== null ? `${ms.toFixed(0)} ms` : '—')
  const formatNum = (n: number | null) => (n !== null ? n.toLocaleString() : '—')

  return (
    <CardShell title="页面 SEO 审计">
      <div className="flex flex-col gap-3">

        {/* Pass/fail badges */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: 'HTTPS',       ok: data.checks.https },
            { label: 'Title',       ok: !data.checks.no_title },
            { label: 'Description', ok: !data.checks.no_description },
            { label: 'H1',          ok: !data.checks.no_h1 },
            { label: 'Alt Text',    ok: !data.checks.missing_alt_text },
          ].map(({ label, ok }) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                ok
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {ok ? '✓' : '✗'} {label}
            </span>
          ))}
        </div>

        {/* Issues list */}
        {issues.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <p className="text-xs font-semibold text-amber-700 mb-1">需修复 ({issues.length})</p>
            <ul className="space-y-0.5">
              {issues.map(issue => (
                <li key={issue} className="text-xs text-amber-800">• {issue}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Core Web Vitals */}
        {data.core_web_vitals && (
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Core Web Vitals</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'LCP', value: formatMs(data.core_web_vitals.lcp), warn: (data.core_web_vitals.lcp ?? 0) > 2500 },
                { label: 'TBT', value: formatMs(data.core_web_vitals.tbt), warn: (data.core_web_vitals.tbt ?? 0) > 200 },
                { label: 'CLS', value: data.core_web_vitals.cls !== null ? data.core_web_vitals.cls.toFixed(3) : '—', warn: (data.core_web_vitals.cls ?? 0) > 0.1 },
              ].map(({ label, value, warn }) => (
                <div key={label} className="text-center">
                  <p className={`text-sm font-bold ${warn ? 'text-amber-600' : 'text-gray-700'}`}>{value}</p>
                  <p className="text-xs text-gray-400">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Counts */}
        <div className="pt-2 border-t border-gray-100 grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="font-bold text-gray-700">{formatNum(data.internal_links)}</p>
            <p className="text-xs text-gray-400">内部链接</p>
          </div>
          <div>
            <p className="font-bold text-gray-700">{formatNum(data.external_links)}</p>
            <p className="text-xs text-gray-400">外部链接</p>
          </div>
          <div>
            <p className="font-bold text-gray-700">{formatNum(data.word_count)}</p>
            <p className="text-xs text-gray-400">字数</p>
          </div>
          <div>
            <p className="font-bold text-gray-700">{formatNum(data.images_total)}</p>
            <p className="text-xs text-gray-400">图片总数</p>
          </div>
        </div>

        {/* Title / H1 preview */}
        {(data.title || data.h1) && (
          <div className="pt-1 border-t border-gray-100 space-y-1">
            {data.title && (
              <p className="text-xs">
                <span className="text-gray-400">Title: </span>
                <span className="text-gray-700 truncate">{data.title}</span>
              </p>
            )}
            {data.h1 && (
              <p className="text-xs">
                <span className="text-gray-400">H1: </span>
                <span className="text-gray-700 truncate">{data.h1}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </CardShell>
  )
}
