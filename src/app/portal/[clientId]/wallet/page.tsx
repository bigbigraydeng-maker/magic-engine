import { getMtcBalance } from '@/lib/mtc/balance'
import { MTC_PACKAGES } from '@/lib/mtc/types'
import { MePanel } from '@/components/ui/me-primitives'
import WalletPurchase from './_components/WalletPurchase'

interface Props {
  params: { clientId: string }
  searchParams: { [key: string]: string | string[] | undefined }
}

function formatExpiry(iso: string) {
  return new Date(iso).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'Pacific/Auckland',
  })
}

const TOKEN_COSTS = [
  { label: 'SEO blog post',                cost: 40 },
  { label: 'Dual-signal blog (SEO + AI)',  cost: 60 },
  { label: 'Single AI image',              cost: 10 },
  { label: 'Image pack (4)',               cost: 30 },
  { label: 'Image pack (12)',              cost: 70 },
  { label: 'Reels — 480p, 6 sec',          cost: 20 },
  { label: 'Reels — 720p, 6 sec',          cost: 30 },
  { label: 'Reels — 720p, 10 sec',         cost: 50 },
  { label: 'Reels — 720p, 15 sec',         cost: 80 },
  { label: 'Social post',                  cost: 5 },
  { label: 'Social series (5 posts)',      cost: 20 },
  { label: 'Social calendar (month)',      cost: 30 },
  { label: 'Keyword report',               cost: 30 },
  { label: 'GEO directive',                cost: 20 },
  { label: 'AI tracker report',            cost: 40 },
  { label: 'Competitor report',            cost: 40 },
]

export default async function WalletPage({ params, searchParams }: Props) {
  const { clientId } = params
  const balance = await getMtcBalance(clientId)

  const isWelcome   = searchParams.welcome === '1'
  const isSuccess   = searchParams.success === '1'
  const isCancelled = searchParams.cancelled === '1'
  const purchasedKey = typeof searchParams.package === 'string' ? searchParams.package : undefined
  const purchasedPackage = isSuccess && purchasedKey
    ? MTC_PACKAGES.find(p => p.key === purchasedKey)
    : null

  return (
    <div className="space-y-6 font-sans">
      {/* Flash banners */}
      {isWelcome && (
        <div className="rounded-2xl border border-[#5C8A4A]/30 bg-[#5C8A4A]/10 px-5 py-4">
          <p className="font-display text-sm font-bold text-[#3F6C30]">Welcome to Magic Engine!</p>
          <p className="mt-1 text-sm text-[#3F6C30]/85">
            We have added <strong>500 MTC</strong> to your wallet as a welcome bonus.
            Use them to generate content, reports, and more.
          </p>
        </div>
      )}
      {isSuccess && purchasedPackage && (
        <div className="rounded-2xl border border-[#5C8A4A]/30 bg-[#5C8A4A]/10 px-5 py-4">
          <p className="font-display text-sm font-bold text-[#3F6C30]">Payment successful</p>
          <p className="mt-1 text-sm text-[#3F6C30]/85">
            <strong>{purchasedPackage.mtcAmount.toLocaleString()} MTC</strong> have been added to your wallet.
          </p>
        </div>
      )}
      {isCancelled && (
        <div className="rounded-2xl border border-[#C4912E]/30 bg-[#C4912E]/10 px-5 py-4">
          <p className="text-sm font-semibold text-[#8A6420]">
            Payment cancelled — no charge was made.
          </p>
        </div>
      )}

      {/* Balance hero — deep black surface with gold accent */}
      <section className="rounded-[24px] bg-me-black p-6 text-white shadow-card sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-me-gold">MTC Wallet</p>
            <p
              className="mt-4 font-display text-7xl font-bold tabular-nums leading-none"
              style={{
                backgroundImage: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {balance.balance.toLocaleString()}
            </p>
            <p className="mt-2 text-sm font-semibold text-white/60">
              available Magic Token Coins
            </p>
          </div>

          {balance.batches.length > 0 && (
            <div className="rounded-xl border border-white/[.08] bg-white/[.06] p-4 lg:min-w-[220px]">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-white/45">
                Active batches
              </p>
              <ul className="space-y-2">
                {balance.batches.map(b => (
                  <li key={b.purchaseId} className="flex items-center justify-between gap-4 text-xs">
                    <span className="font-display font-bold text-white">{b.remaining.toLocaleString()} MTC</span>
                    <span className="text-white/45">expires {formatExpiry(b.expiresAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Package cards */}
      <MePanel>
        <div className="mb-5 border-b border-black/10 pb-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-me-charcoal/50">Top up your wallet</p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-me-charcoal">MTC packages</h2>
          <p className="mt-1 text-sm text-me-charcoal/55">
            One-time purchase. Tokens valid for 12 months from purchase date.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {MTC_PACKAGES.map(pkg => {
            const [tierLabel] = pkg.label.split(' — ')
            const centsPerTen = ((pkg.amountNzd / pkg.mtcAmount) * 10).toFixed(1)
            return (
              <div key={pkg.key} className="rounded-2xl border border-black/10 bg-me-ivory p-5 transition hover:border-me-ochre/40">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-me-charcoal/50">
                  {tierLabel}
                </p>
                <p className="mt-3 font-display text-4xl font-bold tabular-nums text-me-charcoal">
                  ${pkg.amountNzd}{' '}
                  <span className="text-base font-semibold text-me-charcoal/40">NZD</span>
                </p>
                <p className="mt-1 text-sm font-bold text-me-charcoal/80">
                  {pkg.mtcAmount.toLocaleString()} MTC
                </p>
                <p className="mt-0.5 text-xs text-me-charcoal/40">{centsPerTen}¢ per 10 MTC</p>
                <WalletPurchase clientId={clientId} packageKey={pkg.key} />
              </div>
            )
          })}
        </div>

        <p className="mt-5 text-xs text-me-charcoal/40">
          Secured by Stripe. MTC are non-refundable after use. Unused tokens expire 12 months from purchase.
        </p>
      </MePanel>

      {/* What MTC can buy */}
      <MePanel>
        <div className="mb-4 border-b border-black/10 pb-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-me-charcoal/50">Token costs</p>
          <h2 className="mt-2 font-display text-xl font-bold tracking-tight text-me-charcoal">What you can do with MTC</h2>
        </div>
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {TOKEN_COSTS.map(item => (
            <div key={item.label} className="flex items-center justify-between border-b border-black/[.06] py-2 last:border-0">
              <span className="text-sm text-me-charcoal/75">{item.label}</span>
              <span className="font-display text-sm font-bold tabular-nums text-me-charcoal">
                {item.cost} <span className="text-xs font-semibold text-me-charcoal/45">MTC</span>
              </span>
            </div>
          ))}
        </div>
      </MePanel>
    </div>
  )
}
