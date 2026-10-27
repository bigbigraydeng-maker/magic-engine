import type { FamilyBlock } from '@/lib/factory/template-library/present'
import type { StylePackRecord } from '@/lib/factory/template-library/types'
import { AvailabilityMark } from './AvailabilityMark'
import { DifferenceList } from './DifferenceList'
import { PreviewVideo } from './PreviewVideo'

function StyleRow({ pack }: { pack: StylePackRecord }) {
  return (
    <div className="grid items-start gap-4 border-t border-me-stone/80 py-5 sm:grid-cols-[220px_1fr]">
      <PreviewVideo clip={pack.clip} />
      <div>
        <h4 className="font-display text-lg font-bold">{pack.name}</h4>
        <AvailabilityMark availability={pack.availability} />
        <DifferenceList difference={pack.difference} />
      </div>
    </div>
  )
}

/** A family, then each pack's own cut so two packs under one name do not look the same. */
export function StyleFamilyBlock({ block }: { block: FamilyBlock }) {
  return (
    <section className="mt-10">
      <h3 className="font-display text-2xl font-bold">{block.family.name}</h3>
      <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-me-charcoal/80">{block.family.summary}</p>
      <div className="mt-2">
        {block.packs.map((pack) => <StyleRow key={pack.id} pack={pack} />)}
      </div>
    </section>
  )
}
