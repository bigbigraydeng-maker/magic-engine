import { getMtcBalance } from '@/lib/mtc/balance'
import { MTC_PACKAGES } from '@/lib/mtc/types'
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

export default async function WalletPage({ params, searchParams }: Props) {
  const { clientId } = params
  const balance = await getMtcBalance(clientId)

  const isWelcome = searchParams.welcome === '1'
  const isSuccess = searchParams.success === '1'
  const isCancelled = searchParams.cancelled === '1'
  const purchasedKey = typeof searchParams.package === 'string' ? searchParams.package : undefined
  const purchasedPackage = isSuccess && purchasedKey
    ? MTC_PACKAGES.find(p => p.key === purchasedKey)
    : null

  return (
    <div className="space-y-6">
      {/* Flash banners */}
      {isWelcome && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm font-black text-emerald-900">Welcome to Magic Engine!</p>
          <p className="mt-1 text-sm text-emerald-700">
            We have added <strong>500 MTC</strong> to your wallet as a welcome bonus.
            Use them to generate content, reports, and more.
          </p>
        </div>
      )}
      {isSuccess && purchasedPackage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm font-black text-emerald-900">Payment successful</p>
          <p className="mt-1 text-sm text-emerald-700">
            <strong>{purchasedPackage.mtcAmount.toLocaleString()} MTC</strong> have been added to your wallet.
          </p>
        </div>
      )}
      {isCancelled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-800">
            Payment cancelled — no charge was made.
          </p>
        </div>
      )}

      {/* Balance hero */}
      <section className="rounded-lg bg-slate-950 p-6 text-white sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">MTC Wallet</p>
            <p className="mt-4 text-7xl font-black tabular-nums text-white">
              {balance.balance.toLocaleString()}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-300">
              available Magic Token Coins
            </p>
          </div>

          {balance.batches.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4 lg:min-w-[220px]">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                Active batches
              </p>
              <ul className="space-y-2">
                {balance.batches.map(b => (
                  <li key={b.purchaseId} className="flex items-center justify-between gap-4 text-xs">
                    <span className="font-black text-white">{b.remaining.toLocaleString()} MTC</span>
                    <span className="text-slate-400">expires {formatExpiry(b.expiresAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Package cards */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 border-b border-slate-200 pb-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Top up your wallet</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">MTC packages</h2>
          <p className="mt-1 text-sm text-slate-500">
            One-time purchase. Tokens valid for 12 months from purchase date.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {MTC_PACKAGES.map(pkg => {
            const [tierLabel] = pkg.label.split(' — ')
            const centsPerTen = ((pkg.amountNzd / pkg.mtcAmount) * 10).toFixed(1)
            return (
              <div key={pkg.key} className="rounded-lg border border-slate-200 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  {tierLabel}
                </p>
                <p className="mt-3 text-4xl font-black tabular-nums text-slate-950">
                  ${pkg.amountNzd}{' '}
                  <span className="text-base font-semibold text-slate-400">NZD</span>
                </p>
                <p className="mt-1 text-sm font-bold text-slate-700">
                  {pkg.mtcAmount.toLocaleString()} MTC
                </p>
                <p className="mt-0.5 text-xs text-slate-400">{centsPerTen}¢ per 10 MTC</p>
                <WalletPurchase clientId={clientId} packageKey={pkg.key} />
              </div>
            )
          })}
        </div>

        <p className="mt-5 text-xs text-slate-400">
          Secured by Stripe. MTC are non-refundable after use. Unused tokens expire 12 months from purchase.
        </p>
      </section>

      {/* What MTC can buy */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 border-b border-slate-200 pb-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Token costs</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">What you can do with MTC</h2>
        </div>
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {[
            { label: 'SEO blog post', cost: 40 },
            { label: 'Dual-signal blog (SEO + AI)', cost: 60 },
            { label: 'Single AI image', cost: 10 },
            { label: 'Image pack (4)', cost: 30 },
            { label: 'Image pack (12)', cost: 70 },
            { label: 'Reels — 480p, 6 sec', cost: 20 },
            { label: 'Reels — 720p, 6 sec', cost: 30 },
            { label: 'Reels — 720p, 10 sec', cost: 50 },
            { label: 'Reels — 720p, 15 sec', cost: 80 },
            { label: 'Social post', cost: 5 },
            { label: 'Social series (5 posts)', cost: 20 },
            { label: 'Social calendar (month)', cost: 30 },
            { label: 'Keyword report', cost: 30 },
            { label: 'GEO directive', cost: 20 },
            { label: 'AI tracker report', cost: 40 },
            { label: 'Competitor report', cost: 40 },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
              <span className="text-sm text-slate-700">{item.label}</span>
              <span className="text-sm font-black tabular-nums text-slate-950">{item.cost} MTC</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
