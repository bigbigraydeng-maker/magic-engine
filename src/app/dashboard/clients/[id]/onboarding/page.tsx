'use client'

/**
 * /dashboard/clients/[id]/onboarding — $990 self-serve onboarding wizard.
 *
 * Client-facing (a self_serve business owner completes it), so the copy is
 * plain English, no jargon. Resumable soft-guide: every step can be skipped or
 * done later; progress is inferred server-side from real fields
 * (GET onboarding/status). Each step has an "I can't do this — sort it on your
 * visit" escape that records a help request handed to the FDE at submit.
 *
 * Hard rules from the four-reviewer pass (板桥):
 *  - GA4/GSC (2026-08-11: now a real "Connect with Google" button, PM ask —
 *    see spec below) always sits next to the "sort it on the visit" skip
 *    link on the SAME screen, never gated behind a failed attempt first —
 *    owners with neither account just tap skip, no dead end.
 *  - Meta is "enter your ad account number / we set it up on the visit", never
 *    "authorize Meta in one click" (no real OAuth exists for it — PM decision
 *    2026-08-11, Meta App Review timeline is out of our control).
 *  - Skipping is never silent: it becomes a help request for the kickoff visit.
 *
 * Spec: docs/superpowers/specs/2026-07-08-990-self-serve-onboarding-wizard-v0.1.md
 *       docs/specs/2026-08-11-onboarding-integrations-unify-v1.md (GSC/GA4 real-OAuth revision)
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────
interface StatusResponse {
  steps: {
    profile: boolean
    website: boolean
    connectors: Record<string, boolean>
    assets: boolean
  }
  completed: boolean
}

type HelpKey = 'profile' | 'gbp' | 'ga4gsc' | 'meta' | 'website' | 'assets'

// ── Small UI helpers ────────────────────────────────────────────────────────────
const CARD = 'rounded-2xl border border-me-stone bg-white p-6'
const INPUT = 'mt-1.5 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 py-2.5 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]'
const LABEL = 'text-xs font-bold uppercase tracking-[0.1em] text-me-charcoal/55'
const BTN = 'inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold text-[#2A2008] transition active:translate-y-px disabled:opacity-50'
const BTN_STYLE = { background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }

function StepShell({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className={CARD}>
      <div className="mb-4 flex items-center gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? 'bg-[#5C8A4A] text-white' : 'bg-me-stone text-me-charcoal/55'}`}>
          {done ? '✓' : n}
        </span>
        <h2 className="font-display text-lg font-bold text-me-charcoal">{title}</h2>
        {done && <span className="ml-auto text-xs font-semibold text-[#5C8A4A]">Done</span>}
      </div>
      {children}
    </section>
  )
}

function HelpLink({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-3 text-left text-xs font-semibold underline-offset-2 hover:underline ${active ? 'text-[#5C8A4A]' : 'text-me-ochre'}`}
    >
      {active ? "✓ We'll sort this on your visit" : `👉 ${label}`}
    </button>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function OnboardingWizardPage() {
  const params = useParams<{ id: string }>()
  const clientId = params.id
  // ?welcome=1 is set once, by resolveSelfServeLanding right after OTP
  // verification (the register form promises "500 MTC welcome bonus" — 板桥
  // PR6 复审: the wizard never confirmed it landed, so the promise looked
  // broken even though the credit was applied).
  const welcome = useSearchParams().get('welcome') === '1'

  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [help, setHelp] = useState<Record<HelpKey, boolean>>({ profile: false, gbp: false, ga4gsc: false, meta: false, website: false, assets: false })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/clients/${clientId}/onboarding/status`)
      const j = await r.json()
      if (r.ok) { setStatus(j); if (j.completed) setSubmitted(true) }
    } catch { /* keep last known */ }
  }, [clientId])

  useEffect(() => { void refresh() }, [refresh])

  const toggleHelp = (k: HelpKey) => setHelp(h => ({ ...h, [k]: !h[k] }))
  const setHelpOn = (k: HelpKey) => setHelp(h => ({ ...h, [k]: true }))

  const s = status?.steps
  const doneCount = [s?.profile, s?.website, (s?.connectors.gbp || s?.connectors.gsc || s?.connectors.ga4), s?.assets].filter(Boolean).length

  async function submit() {
    setSubmitting(true)
    const helpRequests = (Object.keys(help) as HelpKey[])
      .filter(k => help[k])
      .map(k => HELP_LABELS[k])
    try {
      const r = await fetch(`/api/clients/${clientId}/onboarding/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpRequests }),
      })
      if (r.ok) { setSubmitted(true); void refresh() }
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16 text-center">
        <div className="text-5xl">🎉</div>
        <h1 className="mt-4 font-display text-2xl font-bold text-me-charcoal">You&apos;re all set</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-me-charcoal/65">
          Thanks — we&apos;ve got what we need to get started. We&apos;re running your first health check now,
          and we&apos;ll be in touch to book your visit. Anything you couldn&apos;t finish, we&apos;ll sort together then.
        </p>
        <a href={`/dashboard/clients/${clientId}`} className={`${BTN} mt-6`} style={BTN_STYLE}>
          Go to your dashboard →
        </a>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      {welcome && (
        <div className="mb-4 rounded-xl border border-[#5C8A4A]/25 bg-[#5C8A4A]/8 px-4 py-3 text-sm font-semibold text-[#3F6134]">
          🎉 Welcome! We&apos;ve added 500 MTC to your account to get you started.
        </div>
      )}
      <div className="mb-2">
        <h1 className="font-display text-2xl font-bold text-me-charcoal">Let&apos;s get you set up</h1>
        <p className="mt-1 text-sm text-me-charcoal/60">
          A few quick things so we can start growing your business. Do what you can — anything you&apos;re
          not sure about, tap &ldquo;sort it on the visit&rdquo; and we&apos;ll handle it in person. You can stop and come back anytime.
        </p>
      </div>

      {/* Progress */}
      <div className="mb-6 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-me-stone">
          <div className="h-full rounded-full transition-all" style={{ width: `${(doneCount / 4) * 100}%`, background: 'linear-gradient(90deg,#EBCB8B,#C4912E)' }} />
        </div>
        <span className="text-xs font-bold text-me-charcoal/55">{doneCount}/4</span>
      </div>

      <div className="space-y-5">
        <ProfileStep clientId={clientId} done={Boolean(s?.profile)} onSaved={refresh} help={help.profile} onHelp={() => toggleHelp('profile')} />
        <WebsiteStep clientId={clientId} done={Boolean(s?.website)} onSaved={refresh} help={help.website} onHelp={() => toggleHelp('website')} />
        <ConnectStep clientId={clientId} connectors={s?.connectors ?? {}} help={help} onHelp={toggleHelp} onHelpOn={setHelpOn} onSaved={refresh} />
        <AssetsStep clientId={clientId} done={Boolean(s?.assets)} onSaved={refresh} help={help.assets} onHelp={() => toggleHelp('assets')} />

        {/* Submit */}
        <section className={CARD}>
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-me-ochre text-sm font-bold text-white">5</span>
            <h2 className="font-display text-lg font-bold text-me-charcoal">Finish up</h2>
          </div>
          <p className="text-sm leading-relaxed text-me-charcoal/65">
            Happy with what you&apos;ve done? Hit finish and we&apos;ll take it from here — we&apos;ll run your first
            report and get in touch to book your visit.
          </p>
          <button onClick={submit} disabled={submitting} className={`${BTN} mt-4 w-full`} style={BTN_STYLE}>
            {submitting ? 'Finishing…' : 'Finish setup →'}
          </button>
        </section>
      </div>
    </main>
  )
}

const HELP_LABELS: Record<HelpKey, string> = {
  profile: 'Business details — sort on visit',
  gbp: 'Google Business Profile — connect on visit',
  ga4gsc: 'Website analytics — set up on visit',
  meta: 'Facebook/Instagram ads — set up on visit',
  website: 'Website — sort on visit',
  assets: 'Photos — bring on visit',
}

// ── Step 1: Business profile ────────────────────────────────────────────────────
function ProfileStep({ clientId, done, onSaved, help, onHelp }: { clientId: string; done: boolean; onSaved: () => Promise<void>; help: boolean; onHelp: () => void }) {
  const [f, setF] = useState({ company_name: '', industry: '', target_audience: '', core_differentiator: '', brand_voice: '' })
  const [keywords, setKeywords] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // 板桥 PR6 复审: a client who saves Step 1 and comes back later (new day,
  // new OTP login) saw the green "Done" checkmark but every field blank —
  // the data was fine, it just was never fetched back into the form.
  useEffect(() => {
    void (async () => {
      try {
        const [briefRes, kwRes] = await Promise.all([
          fetch(`/api/clients/${clientId}/light-brief`),
          fetch(`/api/clients/${clientId}/primary-keywords`),
        ])
        const briefJson = await briefRes.json().catch(() => ({}))
        if (briefJson.brief_fields) setF((prev) => ({ ...prev, ...briefJson.brief_fields }))
        const kwJson = await kwRes.json().catch(() => ({}))
        if (Array.isArray(kwJson.keywords) && kwJson.keywords.length > 0) setKeywords(kwJson.keywords.join(', '))
      } catch { /* leave blank — worst case they re-type, save still works */ }
    })()
  }, [clientId])

  async function save() {
    setSaving(true); setMsg('')
    try {
      const r = await fetch(`/api/clients/${clientId}/light-brief`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j.error ?? 'Please fill in all fields.'); return }
      const kws = keywords.split(',').map(k => k.trim()).filter(Boolean)
      if (kws.length) {
        await fetch(`/api/clients/${clientId}/primary-keywords`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: kws }),
        }).catch(() => {})
      }
      setMsg('Saved ✓'); await onSaved()
    } finally { setSaving(false) }
  }

  return (
    <StepShell n={1} title="About your business" done={done}>
      <div className="space-y-3">
        <div><label className={LABEL}>Business name</label><input className={INPUT} value={f.company_name} onChange={e => setF({ ...f, company_name: e.target.value })} placeholder="e.g. Kingsland Plumbing" /></div>
        <div><label className={LABEL}>What you do</label><input className={INPUT} value={f.industry} onChange={e => setF({ ...f, industry: e.target.value })} placeholder="e.g. Plumber" /></div>
        <div><label className={LABEL}>Who your customers are</label><input className={INPUT} value={f.target_audience} onChange={e => setF({ ...f, target_audience: e.target.value })} placeholder="e.g. Homeowners in West Auckland" /></div>
        <div><label className={LABEL}>What makes you different</label><input className={INPUT} value={f.core_differentiator} onChange={e => setF({ ...f, core_differentiator: e.target.value })} placeholder="e.g. Same-day service, 20 years local" /></div>
        <div><label className={LABEL}>How you like to sound</label><input className={INPUT} value={f.brand_voice} onChange={e => setF({ ...f, brand_voice: e.target.value })} placeholder="e.g. Friendly and straight-up" /></div>
        <div><label className={LABEL}>Services you want to be found for <span className="font-medium text-me-charcoal/40">(separate each with a comma)</span></label><input className={INPUT} value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="blocked drains, hot water, gas fitting" /></div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className={BTN} style={BTN_STYLE}>{saving ? 'Saving…' : 'Save'}</button>
        {msg && <span className="text-xs font-semibold text-me-charcoal/60">{msg}</span>}
      </div>
      <HelpLink label={HELP_LABELS.profile} active={help} onClick={onHelp} />
    </StepShell>
  )
}

// ── Step 2: Website ────────────────────────────────────────────────────────────
function WebsiteStep({ clientId, done, onSaved, help, onHelp }: { clientId: string; done: boolean; onSaved: () => Promise<void>; help: boolean; onHelp: () => void }) {
  const [domain, setDomain] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Same resumability gap as Step 1 — prefill from whatever domain is
  // already on the client record instead of showing an empty box next to
  // a green "Done" checkmark.
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/clients/${clientId}`)
        const j = await r.json().catch(() => ({}))
        if (j.client?.domain) setDomain(j.client.domain)
      } catch { /* leave blank — worst case they re-type, save still works */ }
    })()
  }, [clientId])

  async function save() {
    setSaving(true); setMsg('')
    try {
      const r = await fetch(`/api/clients/${clientId}/domain`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(j.error ?? 'Enter a valid website address.'); return }
      setMsg('Saved ✓'); await onSaved()
    } finally { setSaving(false) }
  }

  return (
    <StepShell n={2} title="Your website" done={done}>
      <div><label className={LABEL}>Website address</label><input className={INPUT} value={domain} onChange={e => setDomain(e.target.value)} placeholder="yourbusiness.co.nz or .com.au" /></div>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className={BTN} style={BTN_STYLE}>{saving ? 'Saving…' : 'Save'}</button>
        {msg && <span className="text-xs font-semibold text-me-charcoal/60">{msg}</span>}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-me-charcoal/50">
        No website yet? No problem — we&apos;ll build you a simple one-page site on your own domain (we&apos;ll have
        covered the details when you signed up).
      </p>
      <HelpLink label={HELP_LABELS.website} active={help} onClick={onHelp} />
    </StepShell>
  )
}

// ── Step 3: Connect accounts ─────────────────────────────────────────────────────
function ConnectStep({ clientId, connectors, help, onHelp, onHelpOn, onSaved }: { clientId: string; connectors: Record<string, boolean>; help: Record<HelpKey, boolean>; onHelp: (k: HelpKey) => void; onHelpOn: (k: HelpKey) => void; onSaved: () => Promise<void> }) {
  const [metaId, setMetaId] = useState('')
  const [metaMsg, setMetaMsg] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)

  async function saveMeta() {
    setSavingMeta(true); setMetaMsg('')
    try {
      // Owners paste the plain digits from Meta Business Suite; the API wants
      // the act_<digits> form, so normalise before sending.
      const digits = metaId.replace(/\D/g, '')
      const ad_account_id = digits ? `act_${digits}` : metaId.trim()
      const r = await fetch(`/api/clients/${clientId}/meta-ad-account`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ad_account_id }),
      })
      const j = await r.json().catch(() => ({}))
      // AD-SEC-3: owners can't bind an ad account themselves any more — the number
      // is recorded for the team to verify. Also tick "sort it on the visit" (set,
      // never toggle: toggling would un-tick it for an owner who already ticked it).
      if (r.status === 403 && j.reason === 'fde_verification_required') {
        onHelpOn('meta')
        setMetaMsg(j.request_recorded
          ? "Thanks — we've noted this number. Our team will check it and connect it for you."
          : "Thanks — we couldn't note the number just now, so we'll sort it out with you on the visit.")
        return
      }
      if (r.status === 400) {
        setMetaMsg("That doesn't look like an ad account number — it's usually 15–17 digits. Not sure? Tick \"sort it on the visit\" below.")
        return
      }
      if (!r.ok) { setMetaMsg(j.error ?? 'Could not save — check the number and try again.'); return }
      setMetaMsg('Saved ✓'); await onSaved()
    } finally { setSavingMeta(false) }
  }

  const gbpDone   = Boolean(connectors.gbp)
  const dataDone  = Boolean(connectors.gsc || connectors.ga4)
  const stepDone  = gbpDone || dataDone
  return (
    <StepShell n={3} title="Connect your accounts" done={stepDone}>
      {/* GBP — real OAuth */}
      <div className="rounded-xl bg-me-ivory p-4">
        <p className="text-sm font-semibold text-me-charcoal">Your Google Business Profile</p>
        <p className="mt-1 text-xs leading-relaxed text-me-charcoal/60">
          This is how you show up on Google Maps and Search. Connecting lets us keep it polished for you.
        </p>
        {gbpDone
          ? <p className="mt-2 text-xs font-semibold text-[#5C8A4A]">✓ Connected</p>
          : <a href={`/api/auth/google/gbp/start?clientId=${clientId}&flow=wizard`} className={`${BTN} mt-3`} style={BTN_STYLE}>Connect with Google</a>}
        <HelpLink label={HELP_LABELS.gbp} active={help.gbp} onClick={() => onHelp('gbp')} />
      </div>

      {/* GA4/GSC — real OAuth (one click covers both) */}
      <div className="mt-3 rounded-xl bg-me-ivory p-4">
        <p className="text-sm font-semibold text-me-charcoal">Website visitor data</p>
        <p className="mt-1 text-xs leading-relaxed text-me-charcoal/60">
          Already have Google Search Console or Analytics? Connect it here — one click covers both.
          You&apos;ll see a Google confirmation screen; if you don&apos;t have these yet, that&apos;s
          totally normal — just tap &ldquo;sort it on the visit&rdquo; below, it&apos;s one of the
          things included in your setup.
        </p>
        {dataDone
          ? <p className="mt-2 text-xs font-semibold text-[#5C8A4A]">✓ Connected</p>
          : <a href={`/api/auth/google/connect?client_id=${clientId}&flow=wizard`} className={`${BTN} mt-3`} style={BTN_STYLE}>Connect with Google</a>}
        <HelpLink label={HELP_LABELS.ga4gsc} active={help.ga4gsc} onClick={() => onHelp('ga4gsc')} />
      </div>

      {/* Meta — enter id / on visit (板桥 rule: never "authorize Meta") */}
      <div className="mt-3 rounded-xl bg-me-ivory p-4">
        <p className="text-sm font-semibold text-me-charcoal">Facebook / Instagram ads <span className="font-medium text-me-charcoal/45">(optional)</span></p>
        <p className="mt-1 text-xs leading-relaxed text-me-charcoal/60">
          Already run Facebook ads? Pop in your ad account number (a string of digits from Meta Business Suite).
          No idea what that is? Totally normal — we&apos;ll set it up on the visit.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input className={INPUT} value={metaId} onChange={e => setMetaId(e.target.value)} placeholder="e.g. 1234567890" />
          <button onClick={saveMeta} disabled={savingMeta || !metaId.trim()} className={BTN} style={BTN_STYLE}>Save</button>
        </div>
        {metaMsg && <span className="text-xs font-semibold text-me-charcoal/60">{metaMsg}</span>}
        <HelpLink label={HELP_LABELS.meta} active={help.meta} onClick={() => onHelp('meta')} />
      </div>
    </StepShell>
  )
}

// ── Step 4: Upload assets ────────────────────────────────────────────────────────
function AssetsStep({ clientId, done, onSaved, help, onHelp }: { clientId: string; done: boolean; onSaved: () => Promise<void>; help: boolean; onHelp: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState('')

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true); setMsg('')
    try {
      const fd = new FormData()
      Array.from(files).slice(0, 10).forEach(f => fd.append('files', f))
      const r = await fetch(`/api/clients/${clientId}/assets`, { method: 'POST', body: fd })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j.error ?? 'Upload failed.'); return }
      setMsg('Uploaded ✓'); await onSaved()
    } finally { setUploading(false) }
  }

  return (
    <StepShell n={4} title="Your photos" done={done}>
      <p className="text-sm leading-relaxed text-me-charcoal/65">
        Upload a few photos of your work, your logo, or your team — we&apos;ll use them to make your marketing look great.
      </p>
      <label className="mt-3 flex cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-dashed border-me-charcoal/20 bg-me-ivory px-4 py-6 text-sm font-semibold text-me-charcoal/60 hover:border-me-ochre">
        {uploading ? 'Uploading…' : '📷 Choose photos'}
        <input type="file" accept="image/*" multiple className="hidden" onChange={e => void upload(e.target.files)} disabled={uploading} />
      </label>
      {msg && <p className="mt-2 text-xs font-semibold text-me-charcoal/60">{msg}</p>}
      <HelpLink label={HELP_LABELS.assets} active={help} onClick={onHelp} />
    </StepShell>
  )
}
