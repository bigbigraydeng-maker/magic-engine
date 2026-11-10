import type { BrandGroup } from '@/lib/factory/template-library/present'
import type { BrandExample } from '@/lib/factory/template-library/types'

function CustomerStills({ example }: { example: BrandExample }) {
  return (
    <div className="min-w-0">
      <h4 className="font-display text-lg font-bold">{example.customer}</h4>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {example.frames.map((frame) => (
          <figure key={frame.src} className="w-[148px] shrink-0">
            <img src={frame.src} alt={`${example.customer}，${example.packName}，${frame.label}`} className="aspect-[9/16] w-full bg-me-stone object-cover" />
            <figcaption className="mt-1.5 text-sm text-me-charcoal/75">{frame.label}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}

/** Two fictional businesses on the same edit. Colour, mark and type change; the cut does not. */
export function BrandGroupBlock({ group }: { group: BrandGroup }) {
  return (
    <section className="mt-8 border-t border-me-stone pt-6">
      <h3 className="font-display text-2xl font-bold">{group.packName}</h3>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        {group.customers.map((example) => <CustomerStills key={example.id} example={example} />)}
      </div>
    </section>
  )
}
