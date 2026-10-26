'use client'

import { useState } from 'react'
import { ImagePickerDialog } from './ImagePickerDialog'
import { ImagePlaceholder, ImageThumb } from './ImageThumb'
import { FieldErrorList, HelpText, Label, inputClass, smallButtonClass, type FieldErrors } from './editor-parts'
import { GALLERY_MAX } from './tour-editor-form'
import { FEEDBACK_MAILTO } from './catalog-brand'

export const STAFF_IMAGES_NOTICE =
  '现在还不能直接上传照片。可以在已有图片里挑选、调整顺序或移除；要换新照片，请把照片发给 Magic Engine 团队，放好后会出现在可选图片里。'
export const NEW_IMAGE_HELP =
  '站内图片写成 /images/…；外部图片须来自已允许的图片来源（在「设置」里管理）'
export const GALLERY_FULL_TEXT = '图集最多 30 张，已经到上限'

function unique(list: string[]): string[] {
  return Array.from(new Set(list))
}

function moveItem(list: string[], from: number, to: number): string[] {
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

interface TourImagesFieldProps {
  tourName: string
  heroImage: string | null
  gallery: string[]
  /** Every image already used in this client's catalog. */
  pool: string[]
  domain: string | null
  /** True for a Magic Engine admin: may type a new address. */
  canAddUrl: boolean
  errors: FieldErrors
  onHeroChange: (next: string | null) => void
  onGalleryChange: (next: string[]) => void
}

type PickerMode = 'hero' | 'gallery' | null

export function TourImagesField(props: TourImagesFieldProps): JSX.Element {
  const { tourName, heroImage, gallery, domain, canAddUrl, errors, onHeroChange, onGalleryChange } = props
  const [picker, setPicker] = useState<PickerMode>(null)
  return (
    <div className="space-y-4">
      {canAddUrl ? null : <StaffNotice />}
      <HeroBlock
        tourName={tourName}
        heroImage={heroImage}
        domain={domain}
        errors={errors}
        onOpenPicker={() => setPicker('hero')}
      />
      <GalleryBlock
        tourName={tourName}
        gallery={gallery}
        domain={domain}
        errors={errors}
        onGalleryChange={onGalleryChange}
        onOpenPicker={() => setPicker('gallery')}
      />
      {canAddUrl ? (
        <NewImageBlock gallery={gallery} onHeroChange={onHeroChange} onGalleryChange={onGalleryChange} />
      ) : null}
      <Pickers {...props} mode={picker} onClose={() => setPicker(null)} />
    </div>
  )
}

function Pickers(props: TourImagesFieldProps & { mode: PickerMode; onClose: () => void }): JSX.Element | null {
  const { mode, onClose, pool, heroImage, gallery, domain, onHeroChange, onGalleryChange } = props
  if (mode === 'hero') {
    const pickHero = (src: string) => {
      onHeroChange(src)
      onClose()
    }
    const images = unique(pool).filter((src) => src !== heroImage)
    return <ImagePickerDialog title="选主图" images={images} domain={domain} onPick={pickHero} onClose={onClose} />
  }
  if (mode === 'gallery') {
    // Stays open so several can be added; a picked image leaves the list on the next render.
    const pickForGallery = (src: string) => {
      if (gallery.length >= GALLERY_MAX) return
      onGalleryChange([...gallery, src])
      if (gallery.length + 1 >= GALLERY_MAX) onClose()
    }
    const images = unique(pool).filter((src) => !gallery.includes(src))
    return (
      <ImagePickerDialog title="选图加入图集" images={images} domain={domain} onPick={pickForGallery} onClose={onClose} />
    )
  }
  return null
}

function StaffNotice(): JSX.Element {
  return (
    <p
      data-testid="staff-images-notice"
      className="rounded-lg bg-black/5 px-3 py-2 text-xs text-me-charcoal/70"
    >
      {STAFF_IMAGES_NOTICE}{' '}
      <a href={FEEDBACK_MAILTO} className="underline">
        发邮件给我们
      </a>
    </p>
  )
}

function HeroBlock(props: {
  tourName: string
  heroImage: string | null
  domain: string | null
  errors: FieldErrors
  onOpenPicker: () => void
}): JSX.Element {
  const { tourName, heroImage, domain, errors, onOpenPicker } = props
  return (
    <div data-testid="hero-image" className="space-y-2">
      <Label>主图</Label>
      <div className="flex flex-wrap items-center gap-3">
        {heroImage ? (
          <ImageThumb size="lg" src={heroImage} alt={`${tourName} 主图`} domain={domain} />
        ) : (
          <ImagePlaceholder size="lg" text="还没有主图" />
        )}
        <button type="button" className={smallButtonClass} onClick={onOpenPicker}>
          从已有图片里选
        </button>
      </div>
      <FieldErrorList errors={errors} prefix="heroImage" />
    </div>
  )
}

function GalleryBlock(props: {
  tourName: string
  gallery: string[]
  domain: string | null
  errors: FieldErrors
  onGalleryChange: (next: string[]) => void
  onOpenPicker: () => void
}): JSX.Element {
  const { tourName, gallery, domain, errors, onGalleryChange, onOpenPicker } = props
  const full = gallery.length >= GALLERY_MAX
  return (
    <div data-testid="gallery" className="space-y-2">
      <Label>图集（{gallery.length} 张）</Label>
      <div className="flex flex-wrap gap-3">
        {gallery.map((src, index) => (
          <GalleryItem
            key={`${src}-${index}`}
            src={src}
            index={index}
            total={gallery.length}
            tourName={tourName}
            domain={domain}
            gallery={gallery}
            onGalleryChange={onGalleryChange}
          />
        ))}
      </div>
      <button type="button" className={smallButtonClass} disabled={full} onClick={onOpenPicker}>
        从已有图片里选
      </button>
      {full ? <HelpText>{GALLERY_FULL_TEXT}</HelpText> : null}
      <FieldErrorList errors={errors} prefix="gallery" />
    </div>
  )
}

function GalleryItem(props: {
  src: string
  index: number
  total: number
  tourName: string
  domain: string | null
  gallery: string[]
  onGalleryChange: (next: string[]) => void
}): JSX.Element {
  const { src, index, total, tourName, domain, gallery, onGalleryChange } = props
  const label = index + 1
  return (
    <div data-testid="gallery-item" className="space-y-1">
      <ImageThumb src={src} alt={`${tourName} 图片 ${label}`} domain={domain} />
      <div className="flex gap-1">
        <button
          type="button"
          className={smallButtonClass}
          aria-label={`前移第 ${label} 张`}
          disabled={index === 0}
          onClick={() => onGalleryChange(moveItem(gallery, index, index - 1))}
        >
          ←
        </button>
        <button
          type="button"
          className={smallButtonClass}
          aria-label={`后移第 ${label} 张`}
          disabled={index === total - 1}
          onClick={() => onGalleryChange(moveItem(gallery, index, index + 1))}
        >
          →
        </button>
        <button
          type="button"
          className={smallButtonClass}
          aria-label={`移除第 ${label} 张`}
          onClick={() => onGalleryChange(gallery.filter((_, i) => i !== index))}
        >
          移除
        </button>
      </div>
    </div>
  )
}

/** The typed address is plain text until 加入图集 / 设为主图 is pressed: never previewed while typing. */
function NewImageInput(props: { value: string; onChange: (value: string) => void }): JSX.Element {
  return (
    <>
      <Label htmlFor="tour-new-image-url">填入新的图片地址</Label>
      <input
        id="tour-new-image-url"
        aria-label="填入新的图片地址"
        className={inputClass}
        placeholder="/images/… 或 https://…"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </>
  )
}

function NewImageBlock(props: {
  gallery: string[]
  onHeroChange: (next: string | null) => void
  onGalleryChange: (next: string[]) => void
}): JSX.Element {
  const { gallery, onHeroChange, onGalleryChange } = props
  const [draft, setDraft] = useState('')
  const [duplicate, setDuplicate] = useState(false)
  const full = gallery.length >= GALLERY_MAX

  function addToGallery() {
    const value = draft.trim()
    if (value === '') return
    if (gallery.includes(value)) {
      setDuplicate(true)
      return
    }
    if (full) return
    onGalleryChange([...gallery, value])
    setDraft('')
    setDuplicate(false)
  }

  function setAsHero() {
    const value = draft.trim()
    if (value === '') return
    onHeroChange(value)
    setDraft('')
  }

  const typed = (value: string) => {
    setDraft(value)
    setDuplicate(false)
  }

  return (
    <div data-testid="new-image" className="space-y-2">
      <NewImageInput value={draft} onChange={typed} />
      <div className="flex gap-2">
        <button type="button" className={smallButtonClass} disabled={full} onClick={addToGallery}>
          加入图集
        </button>
        <button type="button" className={smallButtonClass} onClick={setAsHero}>
          设为主图
        </button>
      </div>
      {duplicate ? (
        <p className="text-xs" style={{ color: '#B7791F' }}>
          这张已经在图集里了
        </p>
      ) : null}
      <HelpText>{NEW_IMAGE_HELP}</HelpText>
    </div>
  )
}
