import type { TemplateRecord } from '@/lib/factory/template-library/types'
import { AvailabilityMark } from './AvailabilityMark'
import { PreviewVideo } from './PreviewVideo'

function Fit({ template }: { template: TemplateRecord }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <p className="max-w-[36ch] text-[15px] leading-6"><span className="font-semibold">适合 </span>{template.goodFor}</p>
      <p className="max-w-[36ch] text-[15px] leading-6"><span className="font-semibold">先别用 </span>{template.skipWhen}</p>
    </div>
  )
}

function Clips({ template }: { template: TemplateRecord }) {
  if (!template.comparison && template.samples.length === 0) return null
  return (
    <div className="mt-5 space-y-5">
      {template.comparison ? <PreviewVideo clip={template.comparison} /> : null}
      {template.samples.length > 0 ? (
        <div className="flex flex-wrap gap-4">
          {template.samples.map((clip) => <PreviewVideo key={clip.src} clip={clip} />)}
        </div>
      ) : null}
    </div>
  )
}

/** One layout: sentence, still, then any playable preview. */
export function TemplateBand({ template }: { template: TemplateRecord }) {
  return (
    <article className="border-t border-me-stone pt-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="font-display text-[1.65rem] font-bold leading-tight">{template.name}</h3>
        <AvailabilityMark availability={template.availability} />
      </div>
      <p className="mt-3 max-w-[68ch] text-[17px] leading-7">{template.blurb}</p>
      <Fit template={template} />
      <img
        src={template.poster}
        alt={template.posterLabel}
        className={template.posterShape === 'portrait' ? 'mt-5 w-full max-w-[280px] bg-me-stone' : 'mt-5 w-full bg-me-stone'}
      />
      <Clips template={template} />
    </article>
  )
}
