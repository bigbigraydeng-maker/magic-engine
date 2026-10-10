'use client'

import { useEffect, useState } from 'react'
import { ImageThumb } from './ImageThumb'
import { smallButtonClass } from './editor-parts'

export const PICKER_PAGE_SIZE = 48

export function ImagePickerDialog(props: {
  title: string
  images: string[]
  domain?: string | null
  onPick: (src: string) => void
  onClose: () => void
}): JSX.Element {
  const { title, images, domain, onPick, onClose } = props
  const [visible, setVisible] = useState(PICKER_PAGE_SIZE)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-black text-me-charcoal">{title}</h2>
          <button type="button" className={smallButtonClass} onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="overflow-y-auto">
          <PickerBody
            images={images}
            domain={domain}
            visible={visible}
            onPick={onPick}
            onMore={() => setVisible((v) => v + PICKER_PAGE_SIZE)}
          />
        </div>
      </div>
    </div>
  )
}

function PickerBody(props: {
  images: string[]
  domain?: string | null
  visible: number
  onPick: (src: string) => void
  onMore: () => void
}): JSX.Element {
  const { images, domain, visible, onPick, onMore } = props
  if (images.length === 0) {
    return <p className="py-8 text-center text-sm text-me-charcoal/60">还没有可选的图片。</p>
  }
  const shown = images.slice(0, visible)
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {shown.map((src, index) => (
          <button
            key={src}
            type="button"
            aria-label={`选这张图片 ${index + 1}`}
            title={src}
            className="rounded-lg border border-black/10 p-1 hover:border-[#B7791F]"
            onClick={() => onPick(src)}
          >
            <ImageThumb src={src} alt={`可选图片 ${index + 1}`} domain={domain} />
          </button>
        ))}
      </div>
      {images.length > visible ? (
        <div className="mt-3 flex flex-col items-center gap-1">
          <button type="button" className={smallButtonClass} onClick={onMore}>
            显示更多
          </button>
          <p className="text-xs text-me-charcoal/60">
            已显示 {visible} / {images.length} 张
          </p>
        </div>
      ) : null}
    </div>
  )
}
