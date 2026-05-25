import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const pillars = [
  {
    n: '01',
    title: 'Diagnose',
    body: 'Score search, AI visibility, social, ads, reputation, and competitors without exposing supplier names.',
  },
  {
    n: '02',
    title: 'Execute',
    body: 'Turn priority findings into content, website fixes, social assets, and ad decisions customers can approve.',
  },
  {
    n: '03',
    title: 'Prove',
    body: 'Bring outcomes back into the same portal customers use for approvals, reports, and next-step decisions.',
  },
]

const outcomes = [
  { label: 'Visibility actions shipped', value: '15' },
  { label: 'Approval items waiting', value: '3' },
  { label: 'Active execution loops', value: '4' },
]

const loops = [
  { label: 'Diagnose', progress: 100 },
  { label: 'Prioritise', progress: 86 },
  { label: 'Execute', progress: 64 },
  { label: 'Measure', progress: 38 },
]

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
      M
    </div>
  )
}

function ProductPreview() {
  return (
    <div className="w-[680px] rounded-xl border border-white/10 bg-white/10 p-4 shadow-2xl backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-sm font-black text-white">
            M
          </div>
          <div>
            <p className="text-sm font-bold text-white">CTS Tours NZ</p>
            <p className="text-[11px] text-slate-300">Client operating cockpit</p>
          </div>
        </div>
        <span className="rounded-lg bg-emerald-300/15 px-3 py-1.5 text-xs font-bold text-emerald-200">
          +23% AI visibility
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {outcomes.map(item => (
          <div key={item.label} className="rounded-lg border border-white/10 bg-white/[0.08] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              {item.label}
            </p>
            <p className="mt-6 text-3xl font-black text-white">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.08] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-bold text-white">Execution flywheel</p>
          <p className="text-xs font-semibold text-cyan-200">4 active loops</p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {loops.map(item => (
            <div key={item.label} className="rounded-lg bg-slate-950/60 p-3">
              <p className="mb-6 text-xs font-bold text-white">{item.label}</p>
              <div className="h-1.5 rounded-full bg-white/10">
                <div className="h-1.5 rounded-full bg-cyan-300" style={{ width: `${item.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MobileProductPreview() {
  return (
    <div className="mt-10 rounded-xl border border-white/10 bg-white/[0.08] p-4 md:hidden">
      <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <p className="text-sm font-bold text-white">Client cockpit</p>
          <p className="text-[11px] text-slate-300">Outcome view</p>
        </div>
        <span className="rounded-lg bg-emerald-300/15 px-3 py-1.5 text-xs font-bold text-emerald-200">
          +23%
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {outcomes.map(item => (
          <div key={item.label} className="rounded-lg bg-slate-950/60 p-3">
            <p className="text-2xl font-black text-white">{item.value}</p>
            <p className="mt-1 text-[10px] leading-4 text-slate-400">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default async function HomePage() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) redirect('/dashboard')
  }

  return (
    <main className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <section className="relative min-h-[660px] overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 hidden opacity-70 md:block">
          <div className="absolute left-[54%] top-20">
            <ProductPreview />
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/90 to-slate-950/20" />
        </div>

        <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark />
            <span className="text-sm font-bold">Magic Engine</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-300 md:flex">
            <a href="#product">Product</a>
            <a href="#outcomes">Outcomes</a>
            <Link href="/portal/login">Portal</Link>
          </nav>
          <Link
            href="/discover"
            className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-950"
          >
            Start diagnosis
          </Link>
        </header>

        <div className="relative z-10 px-5 pb-14 pt-20 sm:px-8 sm:pt-24">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
            AI execution engine for AU/NZ growth teams
          </p>
          <h1 className="mt-4 max-w-3xl text-6xl font-black leading-[1.02] tracking-normal max-sm:text-5xl">
            Magic Engine
          </h1>
          <p className="mt-5 max-w-2xl text-3xl font-black leading-tight text-slate-100 max-sm:text-2xl">
            Turns diagnosis into visible execution.
          </p>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
            Discover opportunities, execute the work, and show customers what changed across search,
            AI visibility, social, ads, reputation, and competitor signals.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/discover"
              className="flex h-12 items-center rounded-lg bg-white px-5 text-sm font-bold text-slate-950"
            >
              Get free diagnosis
            </Link>
            <Link
              href="/portal/login"
              className="flex h-12 items-center rounded-lg border border-white/20 px-5 text-sm font-bold text-white"
            >
              View client portal
            </Link>
          </div>
          <MobileProductPreview />
        </div>
      </section>

      <section id="product" className="grid gap-5 px-5 py-8 sm:px-8 lg:grid-cols-3">
        {pillars.map(item => (
          <article key={item.title} className="rounded-lg border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{item.n}</p>
            <h2 className="mt-2 text-2xl font-black">{item.title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{item.body}</p>
          </article>
        ))}
      </section>

      <section id="outcomes" className="grid gap-5 px-5 pb-10 sm:px-8 lg:grid-cols-[1fr_380px]">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Product promise
          </p>
          <h2 className="mt-2 max-w-2xl text-3xl font-black leading-tight">
            Not another dashboard. A managed execution system.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
            Magic Engine starts with diagnosis, but the product is the execution loop after that:
            prioritised work, customer approvals, shipped actions, and monthly proof.
          </p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Customer experience
          </p>
          <p className="mt-3 text-3xl font-black leading-tight text-emerald-950">
            Website promise, portal proof.
          </p>
          <p className="mt-3 text-sm leading-6 text-emerald-900">
            Prospects see the operating model before they buy. Clients later see the same language:
            opportunity, execution, approval, result.
          </p>
        </div>
      </section>
    </main>
  )
}
