'use client'

/**
 * Outreach review queue — Phase 35 P35.6 human-in-the-loop UI.
 *
 * Design intent: the reviewer sees exactly the email the owner will
 * receive (real email-client framing, signature included), with the
 * evidence that backs every claim sitting right beside it — so approving
 * takes ten seconds of reading, not a leap of faith in the AI.
 */

import { useState, useEffect, useCallback } from 'react'

interface PillarScore { score: number; summary: string }
interface QueueCard {
  id: string
  business_name: string
  industry: string
  city: string
  domain: string | null
  email: string | null
  phone: string | null
  rating: number | null
  review_count: number | null
  prospect_score: number | null
  ai_report: {
    segment?: string
    owner_name?: string | null
    top_problems?: string[]
    pillars?: Record<string, PillarScore>
    geo_probe?: { mentioned: boolean; competitors_mentioned: string[] } | null
    social_activity?: { platform: string; posts_last_30d: number } | null
  } | null
  outreach_email: { subject: string; body: string; angle: string; edited?: boolean } | null
}

const PILLAR_LABELS: Record<string, string> = {
  seo: 'SEO', geo: 'AI 可见度', social: '社媒', gbp: 'Google 档案',
}

const ANGLE_NOTES: Record<string, { label: string; note: string }> = {
  core_target: { label: '核心靶', note: '以口碑开场，点出「生意很好、门面拖后腿」的差距' },
  blind_flyer: { label: '盲飞型', note: '以「看不见数据」开场，主打追踪安装而不是改版' },
  social_gap:  { label: '社媒空窗', note: '以社媒沉寂开场——客户打电话前会先看你的主页' },
  general:     { label: '通用', note: '以免费体检报告开场，轻量不施压' },
}

function pillarTone(score: number): string {
  if (score >= 70) return 'bg-[#5C8A4A]'
  if (score >= 40) return 'bg-me-ochre'
  return 'bg-[#C2453A]'
}

function PillarBar({ label, pillar }: { label: string; pillar: PillarScore }) {
  return (
    <div title={pillar.summary}>
      <div className="flex justify-between text-xs text-me-charcoal/60">
        <span>{label}</span><span className="font-medium">{pillar.score}</span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-full bg-me-charcoal/10">
        <div className={`h-1.5 rounded-full ${pillarTone(pillar.score)}`}
          style={{ width: `${Math.max(4, pillar.score)}%` }} />
      </div>
    </div>
  )
}

export default function OutreachQueue() {
  const [cards, setCards] = useState<QueueCard[]>([])
  const [footer, setFooter] = useState('')       // template with {{business_name}}
  const [senderConfigured, setSenderConfigured] = useState(true)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')          // card id or 'draft'
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [contactedToday, setContactedToday] = useState(0)

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/prospecting?status=outreach_ready&full=1&limit=20')
      const data = await res.json() as { prospects?: QueueCard[]; total?: number; compliance_footer?: string; sender_configured?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error ?? '加载失败')
      setCards(data.prospects ?? [])
      setTotal(data.total ?? 0)
      setFooter(data.compliance_footer ?? '')
      setSenderConfigured(data.sender_configured ?? true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchQueue() }, [fetchQueue])

  async function draftBatch() {
    setBusy('draft'); setError(''); setMessage('')
    try {
      const res = await fetch('/api/admin/prospecting/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      })
      const data = await res.json() as { drafted?: number; skipped?: number; failed?: number; remaining?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? '生成失败')
      setMessage(`新草稿 ${data.drafted} 封（跳过 ${data.skipped}，失败 ${data.failed}），剩余已析待写 ${data.remaining}`)
      await fetchQueue()
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy('')
    }
  }

  /** Returns true on success — callers must not assume the write landed. */
  async function patch(id: string, payload: Record<string, unknown>, okMessage: string): Promise<boolean> {
    setBusy(id); setError('')
    try {
      const res = await fetch(`/api/admin/prospecting/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? '操作失败')
      setMessage(okMessage)
      await fetchQueue()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
      return false
    } finally {
      setBusy('')
    }
  }

  function footerFor(card: QueueCard): string {
    return footer.replace('{{business_name}}', card.business_name)
  }

  // Public report link for this prospect. Base is the report host — falls back
  // to the main site; set NEXT_PUBLIC_REPORT_BASE_URL to point cold-outreach
  // report links at a separate outreach domain.
  function reportUrlFor(card: QueueCard): string {
    const base = process.env.NEXT_PUBLIC_REPORT_BASE_URL
      || process.env.NEXT_PUBLIC_SITE_URL
      || 'https://magicengine.com.au'
    return `${base.replace(/\/$/, '')}/report/${card.id}`
  }

  async function copyAndMarkContacted(card: QueueCard) {
    if (!card.outreach_email) return
    // The compliance footer must be part of every copied email — refuse
    // rather than silently produce a footer-less (non-compliant) message.
    if (!footer) { setError('合规落款未加载，请刷新页面后再复制'); return }
    // Body → full report link → compliance footer. The link lets the reader
    // see every finding in the branded report without the email carrying an
    // attachment (which cold recipients won't open).
    const fullText = `Subject: ${card.outreach_email.subject}\n\n${card.outreach_email.body}\n\nSee the full breakdown here: ${reportUrlFor(card)}\n\n${footerFor(card)}`
    try {
      await navigator.clipboard.writeText(fullText)
    } catch {
      setError('复制失败——请手动选中邮件文本')
      return
    }
    const ok = await patch(card.id, { action: 'mark_contacted' }, '已复制全文 ✂️ 粘贴进邮箱发出即可（已标记为已联系）')
    if (ok) {
      setContactedToday(n => n + 1)
    } else {
      // The text IS on the clipboard — a second reviewer re-copying this card
      // would double-email the same business.
      setError('全文已复制，但标记失败——请勿重复发送，刷新确认这条的状态后再操作')
    }
  }

  function startEdit(card: QueueCard) {
    if (!card.outreach_email) return
    setEditingId(card.id)
    setEditSubject(card.outreach_email.subject)
    setEditBody(card.outreach_email.body)
  }

  async function saveEdit(id: string) {
    const ok = await patch(id, { action: 'edit_email', subject: editSubject, body: editBody }, '草稿已保存')
    // Keep the editor (and the reviewer's wording) open on failure.
    if (ok) setEditingId(null)
  }

  return (
    <div className="space-y-4">
      {/* Queue header */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-me-charcoal/10 bg-white p-4">
        <div className="mr-auto">
          <div className="text-sm font-medium text-me-charcoal">待审草稿 {total} 封{contactedToday > 0 && ` · 本次已复制 ${contactedToday} 封 ✂️`}</div>
          <div className="text-xs text-me-charcoal/50 mt-0.5">
            每封邮件的每个说法，左侧都放着依据 — 核对一眼，改一改，复制即发。发出的每一封都由你亲手把关。
          </div>
        </div>
        <button onClick={() => void draftBatch()} disabled={busy !== ''}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm text-white disabled:opacity-40">
          {busy === 'draft' ? '撰写中…' : '✍️ 生成邮件草稿 (5)'}
        </button>
        {message && <span className="w-full text-sm text-[#5C8A4A]">{message}</span>}
        {error && <span className="w-full text-sm text-[#C2453A]">{error}</span>}
      </div>

      {!senderConfigured && (
        <div className="rounded-xl border border-me-ochre/30 bg-me-ochre/8 px-4 py-3 text-xs text-me-charcoal/70">
          ⚠️ 尚未配置真人署名（环境变量 <code>OUTREACH_SENDER_NAME</code>）——当前落款是「The Magic Engine Team」。
          团队署名是冷邮件回复率杀手，建议配置后再发。
        </div>
      )}

      {loading && <div className="py-10 text-center text-sm text-me-charcoal/40">加载中…</div>}

      {!loading && cards.length === 0 && (
        <div className="rounded-xl border border-dashed border-me-charcoal/20 bg-white py-14 text-center">
          <div className="text-3xl">📮</div>
          <div className="mt-2 text-sm text-me-charcoal/60">队列空空如也</div>
          <div className="mt-1 text-xs text-me-charcoal/40">
            在「管线」页跑完 ③ AI 分析后，回来点「✍️ 生成邮件草稿」
          </div>
        </div>
      )}

      {cards.map(card => {
        const report = card.ai_report
        const email = card.outreach_email
        const angle = ANGLE_NOTES[email?.angle ?? ''] ?? ANGLE_NOTES.general
        const isEditing = editingId === card.id
        return (
          <div key={card.id} className="grid gap-0 overflow-hidden rounded-xl border border-me-charcoal/10 bg-white md:grid-cols-[280px_1fr]">
            {/* ── Evidence sidebar ── */}
            <div className="space-y-4 border-b border-me-charcoal/10 bg-me-ivory/40 p-4 md:border-b-0 md:border-r">
              <div>
                <div className="font-medium text-me-charcoal">{card.business_name}</div>
                <div className="text-xs text-me-charcoal/50">
                  {card.industry.replace(/_/g, ' ')} · {card.city.replace(/_/g, ' ')}
                  {card.rating != null && <> · ★{card.rating}（{card.review_count ?? 0} 评）</>}
                </div>
                {card.domain && (
                  <a href={`https://${card.domain}`} target="_blank" rel="noreferrer"
                    className="text-xs text-me-charcoal/50 underline">{card.domain}</a>
                )}
              </div>

              {report?.pillars && (
                <div className="space-y-2">
                  {Object.entries(PILLAR_LABELS).map(([k, label]) =>
                    report.pillars![k] ? <PillarBar key={k} label={label} pillar={report.pillars![k]} /> : null,
                  )}
                </div>
              )}

              <div className="rounded-lg bg-white px-3 py-2 text-xs">
                <span className="rounded-full bg-me-charcoal/8 px-2 py-0.5 font-medium text-me-charcoal/70">{angle.label}</span>
                <div className="mt-1.5 text-me-charcoal/60">{angle.note}</div>
              </div>

              {(report?.top_problems?.length ?? 0) > 0 && (
                <div className="text-xs text-me-charcoal/70">
                  <div className="mb-1 font-medium text-me-charcoal/50">✓ 正文依据（逐条可核）</div>
                  <ul className="list-disc space-y-1 pl-4">
                    {report!.top_problems!.map((p, i) => <li key={i}>{p}</li>)}
                    {report?.geo_probe && !report.geo_probe.mentioned && (
                      <li>AI 搜索中不出现{report.geo_probe.competitors_mentioned[0] && `（${report.geo_probe.competitors_mentioned[0]} 在场）`}</li>
                    )}
                    {report?.social_activity?.posts_last_30d === 0 && (
                      <li>{report.social_activity.platform === 'facebook' ? 'Facebook' : 'Instagram'} 近 30 天零发帖</li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* ── Email preview ── */}
            <div className="flex flex-col p-4">
              <div className="mb-3 flex items-center gap-2 text-xs text-me-charcoal/40">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-me-charcoal text-[10px] font-semibold text-white">ME</span>
                <div>
                  <div>收件人：{report?.owner_name ? `${report.owner_name} · ` : ''}{card.email ?? card.phone ?? '（无邮箱 — 电话跟进）'}</div>
                </div>
                {email?.edited && <span className="ml-auto rounded-full bg-me-ochre/10 px-2 py-0.5 text-me-ochre">已人工修改</span>}
              </div>

              {isEditing ? (
                <div className="flex-1 space-y-2">
                  <input value={editSubject} onChange={e => setEditSubject(e.target.value)}
                    className="w-full rounded-lg border border-me-charcoal/15 px-3 py-2 text-sm font-medium" />
                  <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={10}
                    className="w-full rounded-lg border border-me-charcoal/15 px-3 py-2 text-sm leading-relaxed" />
                </div>
              ) : (
                <div className="flex-1">
                  <div className="text-[15px] font-semibold text-me-charcoal">{email?.subject}</div>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-me-charcoal/85">{email?.body}</div>
                  <div className="mt-4 whitespace-pre-wrap border-t border-me-charcoal/8 pt-3 text-xs leading-relaxed text-me-charcoal/45">{footerFor(card)}</div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2 border-t border-me-charcoal/8 pt-3">
                {isEditing ? (
                  <>
                    <button onClick={() => void saveEdit(card.id)} disabled={busy !== ''}
                      className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs text-white disabled:opacity-40">保存修改</button>
                    <button onClick={() => setEditingId(null)}
                      className="rounded-lg border border-me-charcoal/15 px-3 py-1.5 text-xs text-me-charcoal/60">取消</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => void copyAndMarkContacted(card)} disabled={busy !== ''}
                      className="rounded-lg bg-[#5C8A4A] px-3 py-1.5 text-xs text-white disabled:opacity-40">
                      📋 复制全文 + 标记已联系
                    </button>
                    <button onClick={() => startEdit(card)} disabled={busy !== ''}
                      className="rounded-lg border border-me-charcoal/15 px-3 py-1.5 text-xs text-me-charcoal/70 disabled:opacity-40">✏️ 编辑</button>
                    <button onClick={() => void patch(card.id, { action: 'opt_out' }, '已标记拒收，永不再联系')} disabled={busy !== ''}
                      className="ml-auto rounded-lg border border-[#C2453A]/20 px-3 py-1.5 text-xs text-[#C2453A]/70 disabled:opacity-40">🚫 对方拒收</button>
                    <button onClick={() => void patch(card.id, { action: 'archive' }, '已归档')} disabled={busy !== ''}
                      className="rounded-lg border border-me-charcoal/10 px-3 py-1.5 text-xs text-me-charcoal/40 disabled:opacity-40">归档</button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
