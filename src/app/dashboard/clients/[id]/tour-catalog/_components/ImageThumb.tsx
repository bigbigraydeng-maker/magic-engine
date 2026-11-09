'use client'

import { useState } from 'react'

/** Turn a stored image path into a loadable URL, or null when it is not allowed. */
export function resolveImageUrl(src: string, domain: string | null | undefined): string | null {
  if (src.startsWith('https://')) return src
  if (!src.startsWith('/images/')) return null
  const cleanDomain = cleanDomainName(domain)
  if (!cleanDomain) return null
  return `https://${cleanDomain}${src}`
}

function cleanDomainName(domain: string | null | undefined): string | null {
  if (typeof domain !== 'string') return null
  let value = domain.trim().toLowerCase()
  if (value.startsWith('https://')) value = value.slice('https://'.length)
  else if (value.startsWith('http://')) value = value.slice('http://'.length)
  const slash = value.indexOf('/')
  if (slash !== -1) value = value.slice(0, slash)
  if (value.length === 0) return null
  return /^[a-z0-9.-]+$/.test(value) ? value : null
}

const SIZES = {
  sm: { width: 96, height: 72, className: 'h-[72px] w-24' },
  lg: { width: 160, height: 120, className: 'h-[120px] w-40' },
} as const

export function ImagePlaceholder(props: { text: string; size?: 'sm' | 'lg' }): JSX.Element {
  const { text, size = 'sm' } = props
  const dims = SIZES[size]
  return (
    <div
      data-testid="image-placeholder"
      style={{ width: dims.width, height: dims.height }}
      className={`flex shrink-0 items-center justify-center rounded-lg border border-dashed border-black/10 bg-black/5 px-1 text-center text-xs text-me-charcoal/60 ${dims.className}`}
    >
      {text}
    </div>
  )
}

export function ImageThumb(props: {
  src: string
  alt: string
  domain?: string | null
  size?: 'sm' | 'lg'
}): JSX.Element {
  const { src, alt, domain, size = 'sm' } = props
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = resolveImageUrl(src, domain)
  const dims = SIZES[size]

  if (url === null) {
    return <ImagePlaceholder text={src.startsWith('/images/') ? '站内图片' : '地址不合规'} size={size} />
  }
  if (failedUrl === url) {
    return <ImagePlaceholder text="图片打不开" size={size} />
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- plain img is required: no image proxy, no referrer.
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      width={dims.width}
      height={dims.height}
      className={`shrink-0 rounded-lg object-cover bg-black/5 ${dims.className}`}
      onError={() => setFailedUrl(url)}
    />
  )
}
