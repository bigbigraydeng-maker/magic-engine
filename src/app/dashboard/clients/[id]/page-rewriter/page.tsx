'use client'

/**
 * Page Rewriter — UI for rewriting an EXISTING WordPress page or post.
 *
 * 4-phase state machine:
 *   lookup  → enter URL / post-ID, fetch current state from WP
 *   edit    → left column "current" (read-only) vs right column "target" (editable)
 *   confirm → diff list of changed fields + Submit button
 *   done    → success with "Open in WP" + "Rewrite another" actions
 *
 * Calls:
 *   POST /api/clients/[id]/cms/wordpress/lookup-post    (M3)
 *   POST /api/clients/[id]/cms/wordpress/update-post    (M2)
 *
 * Phase 12.R.M3
 */

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { parsePageUpgradeDraft } from '@/lib/page-rewriter/upgrade-draft'

// ─── Types ────────────────────────────────────────────────────────────────────

type WpPostType = 'post' | 'page'

interface ExistingPost {
  postId:          number
  postType:        WpPostType
  title:           string
  slug:            string
  excerpt:         string
  content:         string
  status:          string
  link:            string
  modified:        string
  seoTitle?:       string
  seoDescription?: string
  focusKeyphrase?: string
}

interface TargetFields {
  title:           string
  slug:            string
  excerpt:         string
  seoTitle:        string
  seoDescription:  string
  focusKeyphrase:  string
  contentHtml:     string
  contentDirty:    boolean   // explicit flag so untouched content isn't sent
}

type Phase =
  | { kind: 'lookup' }
  | { kind: 'edit';    current: ExistingPost; target: TargetFields; sameHost: boolean }
  | { kind: 'confirm'; current: ExistingPost; target: TargetFields; diff: DiffEntry[] }
  | { kind: 'done';    updatedUrl: string; updatedFields: string[] }

interface DiffEntry {
  label:    string
  apiKey:   'title' | 'slug' | 'excerpt' | 'seo_title' | 'seo_description' | 'focus_keyphrase' | 'content_html'
  before:   string
  after:    string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function targetFromCurrent(p: ExistingPost): TargetFields {
  return {
    title:          p.title,
    slug:           p.slug,
    excerpt:        p.excerpt,
    seoTitle:       p.seoTitle       ?? '',
    seoDescription: p.seoDescription ?? '',
    focusKeyphrase: p.focusKeyphrase ?? '',
    contentHtml:    p.content,
    contentDirty:   false,
  }
}

function computeDiff(current: ExistingPost, target: TargetFields): DiffEntry[] {
  const rows: DiffEntry[] = []
  const maybe = (label: string, apiKey: DiffEntry['apiKey'], before: string, after: string): void => {
    if ((before ?? '') !== (after ?? '')) rows.push({ label, apiKey, before, after })
  }
  maybe('Title',           'title',           current.title,                   target.title)
  maybe('Slug',            'slug',            current.slug,                    target.slug)
  maybe('Excerpt',         'excerpt',         current.excerpt,                 target.excerpt)
  maybe('SEO title',       'seo_title',       current.seoTitle       ?? '',    target.seoTitle)
  maybe('Meta description','seo_description', current.seoDescription ?? '',    target.seoDescription)
  maybe('Focus keyphrase', 'focus_keyphrase', current.focusKeyphrase ?? '',    target.focusKeyphrase)
  if (target.contentDirty && current.content !== target.contentHtml) {
    rows.push({ label: 'Content (HTML)', apiKey: 'content_html', before: current.content, after: target.contentHtml })
  }
  return rows
}

function bodyForUpdate(diff: DiffEntry[], postType: WpPostType, postId: number, kanbanItemId: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = { remote_post_id: postId, target_type: postType }
  if (kanbanItemId) body.kanban_item_id = kanbanItemId
  for (const row of diff) body[row.apiKey] = row.after
  return body
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PageRewriterPage() {
  const params       = useParams<{ id: string }>()
  const search       = useSearchParams()
  const clientId     = params?.id ?? ''
  const kanbanItemId  = search?.get('kanban_item_id') ?? null
  const prefilledUrl  = search?.get('url') ?? ''
  const upgradeDraftKey = search?.get('upgrade_draft_key') ?? null

  const [phase,    setPhase]    = useState<Phase>({ kind: 'lookup' })
  const [busy,     setBusy]     = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [upgradeDraftMode, setUpgradeDraftMode] = useState<'none' | 'full' | 'metadata_only'>('none')

  // ── Phase: LOOKUP ───────────────────────────────────────────────────────────
  const [lookupUrl,    setLookupUrl]    = useState(prefilledUrl)
  const [lookupPostId, setLookupPostId] = useState('')
  const [lookupMode,   setLookupMode]   = useState<'url' | 'id'>('url')
  const [lookupTargetType, setLookupTargetType] = useState<WpPostType>('post')

  const onLookup = useCallback(async () => {
    setErrorMsg(null)
    setBusy(true)
    try {
      const body = lookupMode === 'url'
        ? { url: lookupUrl.trim() }
        : { post_id: Number(lookupPostId), target_type: lookupTargetType }
      const res = await fetch(`/api/clients/${clientId}/cms/wordpress/lookup-post`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json() as { success?: boolean; post?: ExistingPost; same_host?: boolean; error?: string; code?: string }
      if (!res.ok || !data.success || !data.post) {
        setErrorMsg(data.error ?? `Lookup failed (HTTP ${res.status})`)
        return
      }
      let target = targetFromCurrent(data.post)
      let draftMode: 'none' | 'full' | 'metadata_only' = 'none'

      if (upgradeDraftKey) {
        const draft = parsePageUpgradeDraft(
          window.sessionStorage.getItem(upgradeDraftKey),
          clientId,
          data.post.link,
        )
        if (draft) {
          const isElementorPage = /(?:elementor-|data-elementor)/i.test(data.post.content)
          target = {
            ...target,
            title:          draft.enhancedTitle,
            seoTitle:       draft.enhancedMetaTitle,
            seoDescription: draft.enhancedMetaDescription,
            contentHtml:    isElementorPage ? target.contentHtml : draft.enhancedHtmlBody,
            contentDirty:   !isElementorPage && data.post.content !== draft.enhancedHtmlBody,
          }
          draftMode = isElementorPage ? 'metadata_only' : 'full'
        } else {
          setErrorMsg('升级稿已过期，或与当前客户/页面不匹配。请返回页面升级后重新进入。')
        }
      }

      setUpgradeDraftMode(draftMode)
      setPhase({
        kind:     'edit',
        current:  data.post,
        target,
        sameHost: data.same_host ?? true,
      })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setBusy(false)
    }
  }, [clientId, lookupMode, lookupUrl, lookupPostId, lookupTargetType, upgradeDraftKey])

  // ── Phase transitions ───────────────────────────────────────────────────────
  const goConfirm = useCallback(() => {
    if (phase.kind !== 'edit') return
    const diff = computeDiff(phase.current, phase.target)
    if (diff.length === 0) {
      setErrorMsg('No changes to submit — edit at least one field')
      return
    }
    setErrorMsg(null)
    setPhase({ kind: 'confirm', current: phase.current, target: phase.target, diff })
  }, [phase])

  const goBackToEdit = useCallback(() => {
    if (phase.kind !== 'confirm') return
    setPhase({ kind: 'edit', current: phase.current, target: phase.target, sameHost: true })
  }, [phase])

  const onSubmit = useCallback(async () => {
    if (phase.kind !== 'confirm') return
    setErrorMsg(null)
    setBusy(true)
    try {
      const body = bodyForUpdate(phase.diff, phase.current.postType, phase.current.postId, kanbanItemId)
      const res = await fetch(`/api/clients/${clientId}/cms/wordpress/update-post`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json() as { success?: boolean; updated_url?: string; updated_fields?: string[]; error?: string }
      if (!res.ok || !data.success) {
        setErrorMsg(data.error ?? `Submit failed (HTTP ${res.status})`)
        return
      }
      if (upgradeDraftKey) window.sessionStorage.removeItem(upgradeDraftKey)
      setPhase({
        kind:          'done',
        updatedUrl:    data.updated_url ?? phase.current.link,
        updatedFields: data.updated_fields ?? phase.diff.map(d => d.apiKey),
      })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setBusy(false)
    }
  }, [phase, clientId, kanbanItemId, upgradeDraftKey])

  const onAnother = useCallback(() => {
    if (upgradeDraftKey) window.sessionStorage.removeItem(upgradeDraftKey)
    setLookupUrl('')
    setLookupPostId('')
    setErrorMsg(null)
    setUpgradeDraftMode('none')
    setPhase({ kind: 'lookup' })
  }, [upgradeDraftKey])

  // ── Phase rendering ─────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Header clientId={clientId} kanbanItemId={kanbanItemId} hasUpgradeDraft={Boolean(upgradeDraftKey)} />
      <Stepper phase={phase.kind} />

      {errorMsg && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {phase.kind === 'edit' && upgradeDraftMode !== 'none' && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <p className="font-semibold">AI 页面升级稿已载入，请核对下方逐项差异。</p>
          <p className="mt-1 text-xs text-indigo-700">
            {upgradeDraftMode === 'metadata_only'
              ? '检测到 Elementor 页面：为保护版式，仅带入标题和 SEO 元数据；正文请在 WordPress / Elementor 中处理。'
              : '系统刚刚重新读取了 WordPress 当前版本；只有你在确认页再次提交后，线上页面才会更新。'}
          </p>
        </div>
      )}

      {phase.kind === 'lookup' && (
        <LookupScreen
          mode={lookupMode}                setMode={setLookupMode}
          url={lookupUrl}                  setUrl={setLookupUrl}
          postId={lookupPostId}            setPostId={setLookupPostId}
          targetType={lookupTargetType}    setTargetType={setLookupTargetType}
          onLookup={onLookup}
          busy={busy}
        />
      )}

      {phase.kind === 'edit' && (
        <EditScreen
          current={phase.current}
          target={phase.target}
          setTarget={(t) => setPhase({ ...phase, target: t })}
          onContinue={goConfirm}
          busy={busy}
        />
      )}

      {phase.kind === 'confirm' && (
        <ConfirmScreen
          diff={phase.diff}
          postType={phase.current.postType}
          link={phase.current.link}
          onBack={goBackToEdit}
          onSubmit={onSubmit}
          busy={busy}
        />
      )}

      {phase.kind === 'done' && (
        <DoneScreen
          updatedUrl={phase.updatedUrl}
          updatedFields={phase.updatedFields}
          onAnother={onAnother}
        />
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Header({
  clientId,
  kanbanItemId,
  hasUpgradeDraft,
}: {
  clientId: string
  kanbanItemId: string | null
  hasUpgradeDraft: boolean
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Link href={`/dashboard/clients/${clientId}`} className="text-gray-400 hover:text-gray-600 text-sm">
        ← Client
      </Link>
      <span className="text-gray-300">/</span>
      <h1 className="text-lg font-semibold text-gray-900">Page Rewriter</h1>
      {kanbanItemId && (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
          Linked to Kanban card
        </span>
      )}
      {hasUpgradeDraft && (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
          AI upgrade draft
        </span>
      )}
    </div>
  )
}

function Stepper({ phase }: { phase: Phase['kind'] }) {
  const steps: Array<{ key: Phase['kind']; label: string }> = [
    { key: 'lookup',  label: '1 · Look up' },
    { key: 'edit',    label: '2 · Edit' },
    { key: 'confirm', label: '3 · Confirm' },
    { key: 'done',    label: '4 · Done' },
  ]
  const reached = (k: Phase['kind']): boolean => {
    const idx     = steps.findIndex(s => s.key === k)
    const phaseIx = steps.findIndex(s => s.key === phase)
    return idx <= phaseIx
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full border ${
            s.key === phase
              ? 'bg-indigo-600 text-white border-indigo-600'
              : reached(s.key)
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                : 'bg-gray-50 text-gray-400 border-gray-200'
          }`}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-gray-300">→</span>}
        </div>
      ))}
    </div>
  )
}

function LookupScreen(props: {
  mode:            'url' | 'id'
  setMode:         (m: 'url' | 'id') => void
  url:             string
  setUrl:          (s: string) => void
  postId:          string
  setPostId:       (s: string) => void
  targetType:      WpPostType
  setTargetType:   (t: WpPostType) => void
  onLookup:        () => void
  busy:            boolean
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <p className="text-sm text-gray-600">
        Paste the public URL of the WordPress page you want to rewrite, or use the WP post ID
        if you already know it. The current Yoast title / meta / content will be loaded for editing.
      </p>

      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-1 text-sm">
          <input
            type="radio" name="lookup-mode" value="url"
            checked={props.mode === 'url'}
            onChange={() => props.setMode('url')}
          />
          By URL
        </label>
        <label className="inline-flex items-center gap-1 text-sm">
          <input
            type="radio" name="lookup-mode" value="id"
            checked={props.mode === 'id'}
            onChange={() => props.setMode('id')}
          />
          By post ID
        </label>
      </div>

      {props.mode === 'url' ? (
        <input
          type="url"
          value={props.url}
          onChange={(e) => props.setUrl(e.target.value)}
          placeholder="https://example.com/tile-sizes-explained/"
          className="w-full px-3 py-2 border rounded-md text-sm"
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={props.postId}
            onChange={(e) => props.setPostId(e.target.value)}
            placeholder="e.g. 123"
            className="flex-1 px-3 py-2 border rounded-md text-sm"
            min={1}
          />
          <select
            value={props.targetType}
            onChange={(e) => props.setTargetType(e.target.value as WpPostType)}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="post">Post</option>
            <option value="page">Page</option>
          </select>
        </div>
      )}

      <button
        onClick={props.onLookup}
        disabled={props.busy}
        className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md disabled:opacity-50"
      >
        {props.busy ? 'Looking up…' : 'Look up'}
      </button>
    </div>
  )
}

function EditScreen({
  current, target, setTarget, onContinue, busy,
}: {
  current:     ExistingPost
  target:      TargetFields
  setTarget:   (t: TargetFields) => void
  onContinue:  () => void
  busy:        boolean
}) {
  const patch = (overrides: Partial<TargetFields>): void => {
    setTarget({ ...target, ...overrides })
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-5">
      <div className="text-xs text-gray-500">
        Editing <span className="font-mono">{current.postType}</span> #{current.postId} ·{' '}
        <a href={current.link} target="_blank" rel="noreferrer noopener" className="text-indigo-600 underline">
          {current.link}
        </a>
        {' '}· last modified {current.modified}
      </div>

      <FieldRow label="Title"            current={current.title}                       value={target.title}          onChange={(v) => patch({ title: v })} />
      <FieldRow label="Slug"             current={current.slug}                        value={target.slug}           onChange={(v) => patch({ slug: v })} />
      <FieldRow label="Excerpt"          current={current.excerpt}                     value={target.excerpt}        onChange={(v) => patch({ excerpt: v })} multiline />
      <FieldRow label="SEO title"        current={current.seoTitle       ?? ''}        value={target.seoTitle}       onChange={(v) => patch({ seoTitle: v })} />
      <FieldRow label="Meta description" current={current.seoDescription ?? ''}        value={target.seoDescription} onChange={(v) => patch({ seoDescription: v })} multiline />
      <FieldRow label="Focus keyphrase"  current={current.focusKeyphrase ?? ''}        value={target.focusKeyphrase} onChange={(v) => patch({ focusKeyphrase: v })} />

      <details className="border border-gray-200 rounded-md">
        <summary className="cursor-pointer px-3 py-2 text-sm text-gray-700 bg-gray-50">
          Edit body HTML (advanced — Elementor pages should be edited inside WP)
        </summary>
        <div className="p-3 space-y-2">
          <textarea
            value={target.contentHtml}
            onChange={(e) => patch({ contentHtml: e.target.value, contentDirty: true })}
            rows={12}
            className="w-full font-mono text-xs border rounded-md p-2"
          />
          {target.contentDirty && (
            <p className="text-[11px] text-amber-700">
              Content edits will overwrite the current body — verify the diff carefully in the next step.
            </p>
          )}
        </div>
      </details>

      <div className="flex justify-end">
        <button
          onClick={onContinue}
          disabled={busy}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

function FieldRow({
  label, current, value, onChange, multiline,
}: {
  label:     string
  current:   string
  value:     string
  onChange:  (v: string) => void
  multiline?: boolean
}) {
  const changed = current !== value
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Current — {label}</div>
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
          {current || <span className="text-gray-400">— empty —</span>}
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
          New — {label}
          {changed && <span className="ml-2 text-amber-700">● changed</span>}
        </div>
        {multiline ? (
          <textarea
            value={value} onChange={(e) => onChange(e.target.value)}
            rows={3}
            className={`w-full px-3 py-2 text-sm border rounded-md ${changed ? 'border-amber-400' : ''}`}
          />
        ) : (
          <input
            type="text"
            value={value} onChange={(e) => onChange(e.target.value)}
            className={`w-full px-3 py-2 text-sm border rounded-md ${changed ? 'border-amber-400' : ''}`}
          />
        )}
      </div>
    </div>
  )
}

function ConfirmScreen({
  diff, postType, link, onBack, onSubmit, busy,
}: {
  diff:      DiffEntry[]
  postType:  WpPostType
  link:      string
  onBack:    () => void
  onSubmit:  () => void
  busy:      boolean
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900">
        About to submit {diff.length} change{diff.length === 1 ? '' : 's'} to <span className="font-mono">{postType}</span>
        {' '}
        <a href={link} target="_blank" rel="noreferrer noopener" className="text-indigo-600 underline">{link}</a>
      </h2>
      <ul className="space-y-3">
        {diff.map((d) => (
          <li key={d.apiKey} className="border border-gray-200 rounded-md p-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{d.label}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 whitespace-pre-wrap line-through">
                {d.before || <span className="text-gray-400 italic">empty</span>}
              </div>
              <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 whitespace-pre-wrap">
                {d.after || <span className="text-gray-400 italic">empty</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <button
          onClick={onBack}
          disabled={busy}
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md disabled:opacity-50"
        >
          ← Back to edit
        </button>
        <button
          onClick={onSubmit}
          disabled={busy}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md disabled:opacity-50"
        >
          {busy ? 'Submitting…' : 'Submit rewrite'}
        </button>
      </div>
    </div>
  )
}

function DoneScreen({ updatedUrl, updatedFields, onAnother }: {
  updatedUrl:    string
  updatedFields: string[]
  onAnother:     () => void
}) {
  const gscUrl = useMemo(() => {
    try {
      const u = new URL(updatedUrl)
      // GSC URL inspection deep-link.
      return `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(u.origin + '/')}&id=${encodeURIComponent(updatedUrl)}`
    } catch {
      return null
    }
  }, [updatedUrl])

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-6 space-y-3">
      <div className="text-base font-semibold text-green-800">✓ Rewrite published</div>
      <div className="text-sm text-gray-700">Updated {updatedFields.length} field{updatedFields.length === 1 ? '' : 's'}:</div>
      <ul className="text-xs text-gray-600 list-disc list-inside">
        {updatedFields.map((f) => <li key={f}>{f}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2 pt-2">
        <a
          href={updatedUrl} target="_blank" rel="noreferrer noopener"
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md"
        >
          Open in WP
        </a>
        {gscUrl && (
          <a
            href={gscUrl} target="_blank" rel="noreferrer noopener"
            className="px-4 py-2 border border-indigo-300 text-indigo-700 text-sm rounded-md"
          >
            Verify in GSC
          </a>
        )}
        <button
          onClick={onAnother}
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md"
        >
          Rewrite another
        </button>
      </div>
    </div>
  )
}
