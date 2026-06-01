'use client'

import type {
  MasterBrief,
  ContentPillar,
  BrandVoice,
  TargetAudience,
  VIColors,
} from '@/types/magic-engine'

// ── Inline types for SEMrush snapshot ────────────────────────────────────────

interface SemrushKeyword {
  keyword: string
  volume: number
  kd: number
  cpc: number
  intent: string
}

interface SemrushSnapshot {
  top_keywords: SemrushKeyword[]
  competitor_domains: string[]
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  brief: MasterBrief
}

// ── Entry point ────────────────────────────────────────────────────────────────

export function BriefDocument({ brief }: Props) {
  const semrush = parseSemrushSnapshot(brief.semrush_snapshot)

  return (
    <div className="brief-document max-w-4xl mx-auto print:max-w-none">
      {/* ── Document Header ── */}
      <div className="mb-8 pb-6 border-b-2 border-black/10 print:pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-me-charcoal/90 print:text-2xl">
              {brief.brand_name ?? 'Master Brief'}
            </h1>
            {brief.core_proposition && (
              <p className="mt-2 text-base text-me-charcoal/60 max-w-2xl leading-relaxed">
                {brief.core_proposition}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0 ml-6">
            <StatusBadge status={brief.status} />
            <span className="text-xs text-me-charcoal/45">Version {brief.version}</span>
            {brief.created_at && (
              <span className="text-xs text-me-charcoal/45">
                {new Date(brief.created_at).toLocaleDateString('en-AU', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Sections ── */}
      <div className="space-y-8 print:space-y-6">

        {/* §1 Brand Voice */}
        {brief.brand_voice && (
          <Section number="§1" title="Brand Voice">
            <VoiceSection voice={brief.brand_voice as BrandVoice} />
          </Section>
        )}

        {/* §2 Target Audience */}
        {brief.target_audience && (
          <Section number="§2" title="Target Audience">
            <AudienceSection audience={brief.target_audience as TargetAudience} />
          </Section>
        )}

        {/* §3 Content Pillars & Platforms */}
        {(brief.content_pillars?.length || brief.platform_strategy) && (
          <Section number="§3" title="Content Pillars & Platform Strategy">
            {brief.content_pillars?.length ? (
              <PillarsSection pillars={brief.content_pillars as ContentPillar[]} />
            ) : null}
            {brief.platform_strategy && (
              <PlatformSection strategy={brief.platform_strategy as Record<string, PlatformConfig>} />
            )}
          </Section>
        )}

        {/* §4 Keywords & Competitors */}
        {(brief.keyword_seeds?.length || brief.competitor_domains?.length) && (
          <Section number="§4" title="Keywords & Competitors">
            <KeywordsSection
              seeds={brief.keyword_seeds ?? []}
              competitors={brief.competitor_domains ?? []}
            />
          </Section>
        )}

        {/* §5 SEMrush Data */}
        {semrush && (semrush.top_keywords.length > 0 || semrush.competitor_domains.length > 0) && (
          <Section number="§5" title="Keyword Intelligence Data">
            <SemrushSection snapshot={semrush} />
          </Section>
        )}

        {/* §6 Visual Identity */}
        {(brief.vi_colors || brief.vi_style_keywords?.length || brief.vi_dos?.length) && (
          <Section number="§6" title="Visual Identity">
            <VisualSection
              colors={brief.vi_colors as VIColors | null}
              styleKeywords={brief.vi_style_keywords ?? []}
              dos={brief.vi_dos ?? []}
              donts={brief.vi_donts ?? []}
            />
          </Section>
        )}

        {/* §7 Brand Story */}
        {brief.brand_story_md && (
          <Section number="§7" title="Brand Story">
            <MarkdownBlock content={brief.brand_story_md} />
          </Section>
        )}

        {/* §8 Style Guide */}
        {brief.style_guide_md && (
          <Section number="§8" title="Writing Style Guide">
            <MarkdownBlock content={brief.style_guide_md} />
          </Section>
        )}

        {/* §9 Competitive Notes */}
        {brief.competitive_notes_md && (
          <Section number="§9" title="Competitive Landscape">
            <MarkdownBlock content={brief.competitive_notes_md} />
          </Section>
        )}

        {/* §10 Data Sources */}
        {(brief.source_website_urls?.length || brief.source_file_urls?.length) && (
          <Section number="§10" title="Source Materials">
            <SourcesSection
              websiteUrls={brief.source_website_urls ?? []}
              fileUrls={brief.source_file_urls ?? []}
              model={brief.model_used}
              tokens={brief.input_tokens}
            />
          </Section>
        )}
      </div>
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({
  number,
  title,
  children,
}: {
  number: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="print:break-inside-avoid">
      <div className="flex items-baseline gap-3 mb-4 pb-2 border-b border-black/10">
        <span className="text-xs font-mono text-me-charcoal/45 select-none">{number}</span>
        <h2 className="text-base font-bold text-me-charcoal/90 uppercase tracking-wide">{title}</h2>
      </div>
      <div className="pl-6 print:pl-4">{children}</div>
    </div>
  )
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wider mb-1.5">{children}</p>
  )
}

function Chip({ label, variant = 'gray' }: { label: string; variant?: 'gray' | 'indigo' | 'green' | 'red' | 'amber' }) {
  const cls = {
    gray:   'bg-me-ivory text-me-charcoal/75',
    indigo: 'bg-me-ochre/10 text-me-ochre',
    green:  'bg-[#5C8A4A]/10 text-[#5C8A4A]',
    red:    'bg-[#C2453A]/10 text-[#C2453A]',
    amber:  'bg-me-ochre/10 text-me-ochre',
  }[variant]
  return (
    <span className={`inline-block text-xs px-2.5 py-1 rounded-full font-medium ${cls}`}>{label}</span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'active'
    ? 'bg-[#5C8A4A]/12 text-[#5C8A4A] border border-[#5C8A4A]/30'
    : status === 'draft'
      ? 'bg-me-ochre/15 text-me-ochre border border-me-ochre/30'
      : 'bg-me-ivory text-me-charcoal/60 border border-black/10'
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${cls}`}>
      {status === 'active' ? '✓ Active' : status === 'draft' ? '⏳ Draft' : status}
    </span>
  )
}

// ── §1 Brand Voice ────────────────────────────────────────────────────────────

interface BrandVoiceProps {
  voice: BrandVoice
}

function VoiceSection({ voice }: BrandVoiceProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4 text-sm">
        {voice.formality && (
          <div>
            <FieldLabel>Formality</FieldLabel>
            <Chip label={voice.formality} variant="gray" />
          </div>
        )}
        {voice.emoji_usage && (
          <div>
            <FieldLabel>Emoji Usage</FieldLabel>
            <Chip label={voice.emoji_usage} variant="gray" />
          </div>
        )}
        {voice.language_mix && (
          <div>
            <FieldLabel>Language</FieldLabel>
            <Chip label={voice.language_mix} variant="gray" />
          </div>
        )}
      </div>
      {voice.tone_keywords?.length > 0 && (
        <div>
          <FieldLabel>Tone Keywords</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {voice.tone_keywords.map(k => <Chip key={k} label={k} variant="indigo" />)}
          </div>
        </div>
      )}
      {voice.avoid_keywords?.length > 0 && (
        <div>
          <FieldLabel>Words to Avoid</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {voice.avoid_keywords.map(k => <Chip key={k} label={k} variant="red" />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── §2 Target Audience ────────────────────────────────────────────────────────

function AudienceSection({ audience }: { audience: TargetAudience }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4 text-sm">
        {audience.age_range && (
          <div>
            <FieldLabel>Age Range</FieldLabel>
            <p className="text-me-charcoal/75 font-medium">{audience.age_range}</p>
          </div>
        )}
        {audience.location && (
          <div>
            <FieldLabel>Primary Location</FieldLabel>
            <p className="text-me-charcoal/75 font-medium">{audience.location}</p>
          </div>
        )}
        {audience.gender && (
          <div>
            <FieldLabel>Gender</FieldLabel>
            <p className="text-me-charcoal/75 font-medium">{audience.gender}</p>
          </div>
        )}
      </div>
      {audience.interests?.length > 0 && (
        <div>
          <FieldLabel>Interests</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {audience.interests.map(i => <Chip key={i} label={i} variant="indigo" />)}
          </div>
        </div>
      )}
      {audience.pain_points?.length > 0 && (
        <div>
          <FieldLabel>Pain Points</FieldLabel>
          <ul className="space-y-1.5">
            {audience.pain_points.map(p => (
              <li key={p} className="text-sm text-me-charcoal/75 flex items-start gap-2">
                <span className="text-me-ochre mt-0.5 shrink-0">▸</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {audience.platforms?.length > 0 && (
        <div>
          <FieldLabel>Active Platforms</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {audience.platforms.map(p => <Chip key={p} label={p} variant="gray" />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── §3 Content Pillars ────────────────────────────────────────────────────────

function PillarsSection({ pillars }: { pillars: ContentPillar[] }) {
  return (
    <div className="mb-6">
      <FieldLabel>Content Pillars</FieldLabel>
      <div className="space-y-3">
        {pillars.map(p => {
          const pct = Math.round((p.post_ratio ?? 0) * 100)
          return (
            <div key={p.id} className="border border-black/[.06] rounded-xl p-4 bg-me-ivory">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-me-charcoal/75 text-sm">{p.name}</span>
                <span className="text-sm font-bold text-me-ochre">{pct}%</span>
              </div>
              {/* Ratio bar */}
              <div className="w-full h-1 bg-me-stone rounded-full mb-2">
                <div
                  className="h-1 bg-me-ochre/80 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {p.description && (
                <p className="text-xs text-me-charcoal/55 mb-2 leading-relaxed">{p.description}</p>
              )}
              <div className="flex flex-wrap gap-1 mb-2">
                {p.content_types?.map(t => <Chip key={t} label={t} variant="indigo" />)}
              </div>
              {(p.example_topics?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs text-me-charcoal/45 mb-1">Example topics:</p>
                  <ul className="text-xs text-me-charcoal/60 space-y-0.5">
                    {(p.example_topics ?? []).map(t => (
                      <li key={t} className="flex items-start gap-1.5">
                        <span className="text-me-charcoal/35 shrink-0">–</span>{t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface PlatformConfig {
  enabled: boolean
  post_frequency: string
  primary_content_type: string
}

function PlatformSection({ strategy }: { strategy: Record<string, PlatformConfig> }) {
  const active = Object.entries(strategy).filter(([, v]) => v.enabled)
  if (!active.length) return null
  return (
    <div>
      <FieldLabel>Platform Strategy</FieldLabel>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {active.map(([platform, cfg]) => (
          <div key={platform} className="border border-black/[.06] rounded-lg p-3 bg-white">
            <p className="text-sm font-semibold text-me-charcoal/75 capitalize mb-0.5">{platform}</p>
            <p className="text-xs text-me-charcoal/55">{cfg.post_frequency}</p>
            {cfg.primary_content_type && (
              <p className="text-xs text-me-charcoal/45 mt-0.5">{cfg.primary_content_type}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── §4 Keywords & Competitors ─────────────────────────────────────────────────

function KeywordsSection({ seeds, competitors }: { seeds: string[]; competitors: string[] }) {
  return (
    <div className="space-y-4">
      {seeds.length > 0 && (
        <div>
          <FieldLabel>Seed Keywords ({seeds.length})</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {seeds.map(k => <Chip key={k} label={k} variant="indigo" />)}
          </div>
        </div>
      )}
      {competitors.length > 0 && (
        <div>
          <FieldLabel>Competitor Domains</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {competitors.map(d => (
              <span key={d} className="text-xs font-mono px-2.5 py-1 bg-me-ivory text-me-charcoal/60 rounded-lg">
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── §5 SEMrush Data ───────────────────────────────────────────────────────────

const INTENT_COLORS: Record<string, string> = {
  informational:  'text-blue-600 bg-blue-50',
  commercial:     'text-purple-600 bg-purple-50',
  transactional:  'text-[#5C8A4A] bg-[#5C8A4A]/10',
  navigational:   'text-me-charcoal/60 bg-me-ivory',
}

function SemrushSection({ snapshot }: { snapshot: SemrushSnapshot }) {
  return (
    <div className="space-y-5">
      {snapshot.top_keywords.length > 0 && (
        <div>
          <FieldLabel>Top Organic Keywords — from Keyword Intelligence</FieldLabel>
          <div className="overflow-x-auto rounded-xl border border-black/10">
            <table className="w-full text-xs">
              <thead className="bg-me-ivory border-b border-black/10">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold text-me-charcoal/60">Keyword</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-me-charcoal/60">Volume</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-me-charcoal/60">KD</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-me-charcoal/60">CPC</th>
                  <th className="px-3 py-2.5 text-center font-semibold text-me-charcoal/60">Intent</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.top_keywords.map((kw, i) => (
                  <tr key={kw.keyword} className={i % 2 === 0 ? 'bg-white' : 'bg-me-ivory/50'}>
                    <td className="px-3 py-2 font-medium text-me-charcoal/90">{kw.keyword}</td>
                    <td className="px-3 py-2 text-right text-me-charcoal/60 tabular-nums">
                      {kw.volume.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <KdBadge kd={kw.kd} />
                    </td>
                    <td className="px-3 py-2 text-right text-me-charcoal/60 tabular-nums">
                      ${kw.cpc.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${INTENT_COLORS[kw.intent] ?? 'text-me-charcoal/60 bg-me-ivory'}`}>
                        {kw.intent}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {snapshot.competitor_domains.length > 0 && (
        <div>
          <FieldLabel>Organic Search Competitors — from Keyword Intelligence</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {snapshot.competitor_domains.map(d => (
              <span key={d} className="text-xs font-mono px-2.5 py-1 bg-me-ivory text-me-charcoal/60 rounded-lg">
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KdBadge({ kd }: { kd: number }) {
  const color = kd <= 30
    ? 'text-[#5C8A4A]'
    : kd <= 60
      ? 'text-me-ochre'
      : 'text-[#C2453A]'
  return <span className={`font-semibold ${color}`}>{kd}</span>
}

// ── §6 Visual Identity ────────────────────────────────────────────────────────

function VisualSection({
  colors, styleKeywords, dos, donts,
}: {
  colors: VIColors | null
  styleKeywords: string[]
  dos: string[]
  donts: string[]
}) {
  return (
    <div className="space-y-4">
      {colors && Object.values(colors).some(Boolean) && (
        <div>
          <FieldLabel>Brand Colors</FieldLabel>
          <div className="flex flex-wrap gap-4">
            {Object.entries(colors).map(([name, hex]) =>
              hex ? (
                <div key={name} className="text-center">
                  <div
                    className="w-12 h-12 rounded-xl border border-black/10 shadow-sm mb-1"
                    style={{ backgroundColor: hex }}
                  />
                  <p className="text-xs text-me-charcoal/55 capitalize">{name}</p>
                  <p className="text-xs font-mono text-me-charcoal/45">{hex}</p>
                </div>
              ) : null
            )}
          </div>
        </div>
      )}
      {styleKeywords.length > 0 && (
        <div>
          <FieldLabel>Visual Style</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {styleKeywords.map(k => <Chip key={k} label={k} variant="gray" />)}
          </div>
        </div>
      )}
      {(dos.length > 0 || donts.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {dos.length > 0 && (
            <div>
              <FieldLabel>Visual DOs</FieldLabel>
              <ul className="space-y-1.5">
                {dos.map(d => (
                  <li key={d} className="text-sm text-[#5C8A4A] flex items-start gap-2">
                    <span className="shrink-0 font-bold">✓</span><span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {donts.length > 0 && (
            <div>
              <FieldLabel>Visual DON&apos;Ts</FieldLabel>
              <ul className="space-y-1.5">
                {donts.map(d => (
                  <li key={d} className="text-sm text-[#C2453A] flex items-start gap-2">
                    <span className="shrink-0 font-bold">✕</span><span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── §7-9 Markdown renderer ────────────────────────────────────────────────────

function MarkdownBlock({ content }: { content: string }) {
  const blocks = content.trim().split(/\n{2,}/)

  return (
    <div className="space-y-2 text-sm text-me-charcoal/75 leading-relaxed">
      {blocks.map((block, i) => {
        if (block.startsWith('### ')) {
          return (
            <h3 key={i} className="font-semibold text-me-charcoal/75 text-sm mt-3">
              {block.slice(4)}
            </h3>
          )
        }
        if (block.startsWith('## ')) {
          return (
            <h2 key={i} className="font-bold text-me-charcoal/90 text-base mt-4">
              {block.slice(3)}
            </h2>
          )
        }
        if (block.startsWith('# ')) {
          return (
            <h1 key={i} className="font-bold text-me-charcoal/90 text-lg mt-4">
              {block.slice(2)}
            </h1>
          )
        }
        // Bullet list block
        const lines = block.split('\n')
        const isList = lines.some(l => /^\s*[-*]\s/.test(l))
        if (isList) {
          const items = lines.filter(l => /^\s*[-*]\s/.test(l))
          const nonItems = lines.filter(l => !/^\s*[-*]\s/.test(l) && l.trim())
          return (
            <div key={i}>
              {nonItems.length > 0 && (
                <p className="mb-1">{applyInline(nonItems.join(' '))}</p>
              )}
              <ul className="list-disc list-inside space-y-1 pl-1">
                {items.map((item, j) => (
                  <li key={j}>{applyInline(item.replace(/^\s*[-*]\s/, ''))}</li>
                ))}
              </ul>
            </div>
          )
        }
        // Plain paragraph
        return <p key={i}>{applyInline(block)}</p>
      })}
    </div>
  )
}

function applyInline(text: string): React.ReactNode {
  // Handle **bold** inline
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  if (parts.length === 1) return text
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-me-charcoal/90">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        )
      )}
    </>
  )
}

// ── §10 Sources ───────────────────────────────────────────────────────────────

function SourcesSection({
  websiteUrls,
  fileUrls,
  model,
  tokens,
}: {
  websiteUrls: string[]
  fileUrls: string[]
  model?: string | null
  tokens?: number | null
}) {
  return (
    <div className="space-y-3 text-sm">
      {websiteUrls.length > 0 && (
        <div>
          <FieldLabel>Website URLs</FieldLabel>
          <ul className="space-y-0.5">
            {websiteUrls.map(u => (
              <li key={u}>
                <a
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="text-me-ochre hover:underline text-xs font-mono"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {fileUrls.length > 0 && (
        <div>
          <FieldLabel>Uploaded Files</FieldLabel>
          <ul className="space-y-0.5">
            {fileUrls.map(f => (
              <li key={f} className="text-xs font-mono text-me-charcoal/55">
                {f.split('/').pop() ?? f}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-4 text-xs text-me-charcoal/45 pt-1">
        {model && <span>Model: {model}</span>}
        {tokens && <span>Tokens: {tokens.toLocaleString()}</span>}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSemrushSnapshot(raw: Record<string, unknown> | null | undefined): SemrushSnapshot | null {
  if (!raw) return null
  const keywords = raw.top_keywords
  const domains = raw.competitor_domains
  if (!Array.isArray(keywords)) return null
  return {
    top_keywords: keywords as SemrushKeyword[],
    competitor_domains: Array.isArray(domains) ? (domains as string[]) : [],
  }
}
