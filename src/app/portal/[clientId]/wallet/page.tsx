import { getMtcBalance } from '@/lib/mtc/balance'
import LedgerSection from './_components/LedgerSection'

interface Props {
  params: { clientId: string }
}

export default async function PortalWalletPage({ params }: Props) {
  const { clientId } = params
  const balance = await getMtcBalance(clientId)

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      {/* Balance */}
      <section className="rounded-[24px] bg-slate-950 p-6 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-yellow-400/70">MTC Wallet</p>
        <p
          className="mt-4 font-display text-6xl font-bold tabular-nums leading-none"
          style={{
            backgroundImage: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {balance.balance.toLocaleString()}
        </p>
        <p className="mt-2 text-sm font-semibold text-white/50">available Magic Token Coins</p>
      </section>

      {/* Ledger */}
      <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <LedgerSection clientId={clientId} />
      </div>
    </div>
  )
}
