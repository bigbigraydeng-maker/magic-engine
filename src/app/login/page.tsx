import Link from 'next/link'
import LoginForm from './login-form'

interface Props {
  searchParams: { next?: string; error?: string }
}

const adminLoops = [
  { label: 'Diagnose', body: 'Read signals across search, AI visibility, content, and paid channels.' },
  { label: 'Execute', body: 'Move priority work through approvals, production, and publishing.' },
  { label: 'Prove', body: 'Keep outcomes connected to the work that caused them.' },
]

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
      M
    </div>
  )
}

export default function LoginPage({ searchParams }: Props) {
  const next = searchParams.next ?? '/dashboard'
  const hasError = searchParams.error === 'auth_failed'

  return (
    <main className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <section className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
        <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark />
            <span className="text-sm font-bold">Magic Engine</span>
          </Link>
          <Link
            href="/portal/login"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-bold text-white"
          >
            Client portal
          </Link>
        </header>

        <div className="relative z-10 grid gap-10 px-5 pb-12 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:items-start lg:pb-20 lg:pt-16">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
              Admin cockpit
            </p>
            <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[1.04] tracking-normal max-sm:text-4xl">
              Operate the execution engine.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              Internal teams use this dashboard to turn diagnostics into approved work, shipped
              content, and measurable outcomes for every client.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {adminLoops.map(item => (
                <div key={item.label} className="rounded-lg border border-white/10 bg-white/[0.08] p-4">
                  <p className="text-sm font-black text-white">{item.label}</p>
                  <p className="mt-5 text-xs leading-5 text-slate-300">{item.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#f6f7f2] p-5 text-slate-950 shadow-2xl sm:p-6">
            <div className="mb-5 border-b border-slate-200 pb-5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                Internal access
              </p>
              <h2 className="mt-2 text-2xl font-black">Sign in to dashboard</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Use your approved admin account or request a secure magic link.
              </p>
            </div>

            <LoginForm next={next} authFailed={hasError} />

            <p className="mt-6 text-center text-xs leading-5 text-slate-500">
              Magic Lab. Admin access only.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
