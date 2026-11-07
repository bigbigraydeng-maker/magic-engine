import type { MediaClip } from '@/lib/factory/template-library/types'

const SHAPE = {
  portrait: 'aspect-[9/16] w-full max-w-[220px]',
  wide: 'aspect-video w-full',
  stack: 'aspect-[27/32] w-full max-w-[480px]',
} as const

/** Native player. The poster is a real frame, so the tile is readable before play. */
export function PreviewVideo({ clip }: { clip: MediaClip }) {
  return (
    <figure className="min-w-0">
      <video
        controls
        playsInline
        preload="metadata"
        poster={clip.poster}
        aria-label={clip.label}
        className={`${SHAPE[clip.shape]} bg-me-black object-contain focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-ochre`}
      >
        <source src={clip.src} type="video/mp4" />
      </video>
      <figcaption className="mt-2 text-sm leading-5 text-me-charcoal/75">{clip.label}</figcaption>
    </figure>
  )
}
