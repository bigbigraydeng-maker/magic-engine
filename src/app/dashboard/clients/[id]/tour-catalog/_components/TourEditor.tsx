'use client'

import { useEffect, useState } from 'react'
import type { CatalogTourView } from './types'
import type { TourSavedResponse } from '@/lib/tour-catalog/api-contract'
import { savedAsDraftText } from './catalog-format'
import { BRAND_BUTTON_CLASS, FEEDBACK_MAILTO } from './catalog-brand'
import { useCatalogUi } from './catalog-context'
import { errorSummaryText, useJumpToFirstError } from './useErrorJump'
import { DANGER, EditorGroup, SUCCESS, type FieldErrors } from './editor-parts'
import {
  buildPatch,
  groupsOf,
  initialForm,
  parseFieldErrors,
  serverErrorMessage,
  type FormState,
  type GroupId,
} from './tour-editor-form'
import { TourBasicsFields, TourInclusionsFields, type FieldsProps, type UpdateField } from './TourBasicsFields'
import { TourItineraryField } from './TourItineraryField'
import { TourImagesField } from './TourImagesField'
import { TourFaqsField } from './TourFaqsField'
import { TourSearchFields } from './TourSearchFields'
import { TourReviewFields } from './TourReviewFields'

/** Asked before the "manages departures" switch is saved. Unconnected: promise nothing about channels. */
function managesChangeText(turningOn: boolean, connected: boolean): string {
  if (connected) {
    return turningOn
      ? '打开后，如果这个团没有可订的未来班期，它会被当成不可售，网站和广告都不再推。确定吗？'
      : '关闭后，这个团不再按班期判断是否可售，即使全部满团也会继续对外显示。确定吗？'
  }
  return turningOn
    ? '打开后，如果这个团没有可订的未来班期，它在上架后的目录里会标为不可售。确定吗？'
    : '关闭后，这个团不再按班期判断是否可售，即使全部满团，在上架后的目录里也仍算可售。确定吗？'
}

export const SITE_FIELDS_BY_ME_TEXT =
  '搜索设置、标签、常见问题和评价由 Magic Engine 团队维护；需要调整请告诉我们。'

/** The form key `days` is saved (and tracked) as the `itinerary` field. */
function touchedKey(key: keyof FormState): string {
  return key === 'days' ? 'itinerary' : key
}

interface EditorForm {
  form: FormState
  patch: Record<string, unknown>
  update: UpdateField
}

function useEditorForm(tour: CatalogTourView): EditorForm {
  const [form, setForm] = useState<FormState>(() => initialForm(tour))
  const [touched, setTouched] = useState<Set<string>>(() => new Set())

  const update: UpdateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setTouched((prev) => (prev.has(touchedKey(key)) ? prev : new Set(prev).add(touchedKey(key))))
  }

  return { form, patch: buildPatch(form, tour, touched), update }
}

interface SaveState {
  saving: boolean
  status: string | null
  statusColor: string
  fieldErrors: FieldErrors
  /** Goes up once per save refused for field errors. */
  errorTick: number
  save: (patch: Record<string, unknown>) => Promise<void>
}

function useTourSave(
  clientId: string,
  tour: CatalogTourView,
  connected: boolean,
  onSaved: (tour: CatalogTourView) => void,
): SaveState {
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [statusColor, setStatusColor] = useState<string>(SUCCESS)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [errorTick, setErrorTick] = useState(0)

  const say = (text: string | null, color: string) => {
    setStatus(text)
    setStatusColor(color)
  }
  async function refused(res: Response): Promise<void> {
    const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: unknown }
    const code = typeof body.error === 'string' ? body.error : 'save_failed'
    if (code === 'invalid_fields' && res.status !== 403) {
      setFieldErrors(parseFieldErrors(body.fields))
      setErrorTick((n) => n + 1)
    }
    say(serverErrorMessage(code, res.status), DANGER)
  }

  async function save(patch: Record<string, unknown>): Promise<void> {
    setFieldErrors({})
    if (Object.keys(patch).length === 0) return say('没有改动', SUCCESS)
    say(null, SUCCESS)
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/tours/${tour.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: tour.updatedAt, patch }),
      })
      if (!res.ok) return await refused(res)
      const data = (await res.json()) as TourSavedResponse
      say(savedAsDraftText(connected), SUCCESS)
      onSaved(data.tour)
    } catch {
      say(serverErrorMessage('save_failed'), DANGER)
    } finally {
      setSaving(false)
    }
  }

  return { saving, status, statusColor, fieldErrors, errorTick, save }
}

/** Which groups are unfolded. A refused save unfolds every group that holds a red message. */
function useOpenGroups(errorGroups: Set<GroupId>, errorTick: number) {
  const [open, setOpen] = useState<Set<GroupId>>(() => new Set<GroupId>(['basics']))

  useEffect(() => {
    if (errorTick === 0) return
    setOpen((prev) => new Set([...prev, ...errorGroups]))
    // Only a new refusal unfolds; folding a group again afterwards is the person's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorTick])

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      const group = id as GroupId
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })

  return { open, toggle }
}

interface GroupsProps extends FieldsProps {
  tourName: string
  canEditSite: boolean
  connected: boolean
  dirtyGroups: Set<GroupId>
  errorGroups: Set<GroupId>
  open: Set<GroupId>
  onToggle: (id: string) => void
}

function groupProps(props: GroupsProps, id: GroupId, title: string) {
  return {
    id,
    title,
    open: props.open.has(id),
    onToggle: props.onToggle,
    dirty: props.dirtyGroups.has(id),
    hasError: props.errorGroups.has(id),
  }
}

/** Groups every editor sees. */
function ContentGroups(props: GroupsProps): JSX.Element {
  const { form, errors, update, canEditSite } = props
  const ui = useCatalogUi()
  return (
    <>
      <EditorGroup {...groupProps(props, 'basics', '基本信息')}>
        <TourBasicsFields form={form} errors={errors} update={update} connected={props.connected} />
      </EditorGroup>
      <EditorGroup {...groupProps(props, 'images', '图片')}>
        <TourImagesField
          tourName={props.tourName}
          heroImage={form.heroImage}
          gallery={form.gallery}
          pool={ui.imagePool ?? []}
          domain={ui.siteDomain ?? null}
          canAddUrl={canEditSite}
          errors={errors}
          onHeroChange={(next) => update('heroImage', next)}
          onGalleryChange={(next) => update('gallery', next)}
        />
      </EditorGroup>
      <EditorGroup {...groupProps(props, 'itinerary', '行程')}>
        <TourItineraryField days={form.days} errors={errors} onChange={(next) => update('days', next)} />
      </EditorGroup>
      <EditorGroup {...groupProps(props, 'inclusions', '包含与不含')}>
        <TourInclusionsFields form={form} errors={errors} update={update} />
      </EditorGroup>
    </>
  )
}

/** Groups only a Magic Engine admin sees; the server refuses these fields from anyone else. */
function SiteGroups(props: GroupsProps): JSX.Element {
  const { form, errors, update } = props
  return (
    <>
      <EditorGroup {...groupProps(props, 'faqs', '常见问题')}>
        <TourFaqsField faqs={form.faqs} errors={errors} onChange={(next) => update('faqs', next)} />
      </EditorGroup>
      <EditorGroup {...groupProps(props, 'search', '搜索与标签')}>
        <TourSearchFields
          metaTitle={form.metaTitle}
          metaDescription={form.metaDescription}
          quickAnswer={form.quickAnswer}
          tags={form.tags}
          errors={errors}
          onMetaTitle={(next) => update('metaTitle', next)}
          onMetaDescription={(next) => update('metaDescription', next)}
          onQuickAnswer={(next) => update('quickAnswer', next)}
          onTags={(next) => update('tags', next)}
        />
      </EditorGroup>
      <EditorGroup {...groupProps(props, 'reviews', '评价')}>
        <TourReviewFields
          rating={form.rating}
          reviewCount={form.reviewCount}
          reviewSummary={form.reviewSummary}
          errors={errors}
          onRating={(next) => update('rating', next)}
          onReviewCount={(next) => update('reviewCount', next)}
          onReviewSummary={(next) => update('reviewSummary', next)}
        />
      </EditorGroup>
    </>
  )
}

function SiteFieldsNote(): JSX.Element {
  return (
    <p data-testid="site-fields-note" className="text-xs text-me-charcoal/70">
      {SITE_FIELDS_BY_ME_TEXT}{' '}
      <a href={FEEDBACK_MAILTO} className="underline">
        发邮件给我们
      </a>
    </p>
  )
}

interface SaveBarProps {
  saving: boolean
  errorCount: number
  status: string | null
  statusColor: string
  onSave: () => void
  onCancel: () => void
}

/** Sticks to the bottom of the screen: the form is long and 保存 must stay reachable. */
function SaveBar(props: SaveBarProps): JSX.Element {
  const { saving, errorCount, status, statusColor, onSave, onCancel } = props
  return (
    <div className="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center gap-3 border-t border-black/10 bg-white/90 px-2 py-3 backdrop-blur">
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${BRAND_BUTTON_CLASS}`}
      >
        {saving ? '正在保存…' : '保存'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold text-me-charcoal"
      >
        取消
      </button>
      {errorCount > 0 ? (
        <p role="alert" className="min-w-0 text-sm font-semibold" style={{ color: DANGER }}>
          {errorSummaryText(errorCount)}
        </p>
      ) : status ? (
        <p className="min-w-0 text-sm font-semibold" style={{ color: statusColor }}>
          {status}
        </p>
      ) : null}
    </div>
  )
}

interface TourEditorProps {
  clientId: string
  tour: CatalogTourView
  onSaved: (tour: CatalogTourView) => void
  onCancel: () => void
  /** Told whenever the form starts / stops holding edits that are not saved yet. */
  onDirtyChange?: (dirty: boolean) => void
}

function useDirtyNotice(dirty: boolean, onDirtyChange?: (dirty: boolean) => void): void {
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])
}

export function TourEditor({ clientId, tour, onSaved, onCancel, onDirtyChange }: TourEditorProps) {
  const ui = useCatalogUi()
  const connected = ui.channelsConnected
  const canEditSite = ui.canEditSite === true
  const { form, patch, update } = useEditorForm(tour)
  const saver = useTourSave(clientId, tour, connected, onSaved)
  const errorGroups = groupsOf(Object.keys(saver.fieldErrors))
  const { open, toggle } = useOpenGroups(errorGroups, saver.errorTick)
  const rootRef = useJumpToFirstError<HTMLDivElement>(saver.errorTick)

  const dirty = Object.keys(patch).length > 0
  useDirtyNotice(dirty, onDirtyChange)

  function handleSave() {
    const managesChanged = 'managesDepartures' in patch
    if (managesChanged && !window.confirm(managesChangeText(form.managesDepartures, connected))) return
    void saver.save(patch)
  }

  function handleCancel() {
    if (dirty && !window.confirm('放弃这次没保存的修改吗？')) return
    onCancel()
  }

  const groups: GroupsProps = {
    form,
    errors: saver.fieldErrors,
    update,
    tourName: tour.name,
    canEditSite,
    connected,
    dirtyGroups: groupsOf(Object.keys(patch)),
    errorGroups,
    open,
    onToggle: toggle,
  }

  return (
    <div ref={rootRef} className="space-y-3">
      <ContentGroups {...groups} />
      {canEditSite ? <SiteGroups {...groups} /> : <SiteFieldsNote />}
      <SaveBar
        saving={saver.saving}
        errorCount={Object.keys(saver.fieldErrors).length}
        status={saver.status}
        statusColor={saver.statusColor}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </div>
  )
}
