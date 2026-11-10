import type { LibraryView } from '@/lib/factory/template-library/present'
import { BrandGroupBlock } from './BrandGroups'
import { PreviewVideo } from './PreviewVideo'
import { StyleFamilyBlock } from './StyleBlocks'
import { TemplateBand } from './TemplateBand'

const LINKS = [
  ['#platform', '平台通用'],
  ['#industry', '行业'],
  ['#brand', '企业品牌'],
] as const

function JumpLinks() {
  return (
    <nav aria-label="模板库分类" className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
      {LINKS.map(([href, label]) => (
        <a
          key={href}
          href={href}
          className="text-[15px] font-semibold text-me-charcoal underline decoration-me-ochre/70 underline-offset-4 hover:decoration-me-ochre focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-me-ochre"
        >
          {label}
        </a>
      ))}
    </nav>
  )
}

function Opening({ view }: { view: LibraryView }) {
  return (
    <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_280px]">
      <PreviewVideo clip={view.styleReel} />
      <img src={view.styleOverview} alt="每种剪法中间一帧排在一起" className="w-full bg-me-stone" />
    </div>
  )
}

/** Read-only library. Three jumps, then the pictures. No settings form. */
export function LibraryPage({ view }: { view: LibraryView }) {
  return (
    <div className="mx-auto max-w-[1080px] px-5 py-8 text-me-charcoal selection:bg-me-gold selection:text-me-charcoal md:px-8 md:py-10">
      <h1 className="font-display text-[2.4rem] font-bold leading-none">模板库</h1>
      <p className="mt-4 max-w-[68ch] text-[17px] leading-7">{view.notice}</p>
      <JumpLinks />
      <Opening view={view} />
      <section id="platform" className="mt-14 scroll-mt-16">
        <h2 className="font-display text-[1.85rem] font-bold">平台通用</h2>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-me-charcoal/80">版式谁都能用。下面两种剪法也不绑行业。换客户、换行业，版式不用改。</p>
        {view.templates.map((template) => <TemplateBand key={template.id} template={template} />)}
        {view.platformFamilies.map((block) => <StyleFamilyBlock key={block.family.id} block={block} />)}
      </section>
      <section id="industry" className="mt-16 scroll-mt-16">
        <h2 className="font-display text-[1.85rem] font-bold">行业</h2>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-me-charcoal/80">版式还是上面那些。这里换的是转场、文字怎么出来、多久切一刀、字放在哪。</p>
        {view.industryFamilies.map((block) => <StyleFamilyBlock key={block.family.id} block={block} />)}
      </section>
      <section id="brand" className="mt-16 scroll-mt-16">
        <h2 className="font-display text-[1.85rem] font-bold">企业品牌</h2>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-me-charcoal/80">这不是第七种剪法。选定上面任意一种之后，可以换上这家的颜色、标志和字体。下面是「示例客户 A」和「示例客户 B」，剪法不动。</p>
        {view.brands.map((group) => <BrandGroupBlock key={group.packName} group={group} />)}
      </section>
    </div>
  )
}
