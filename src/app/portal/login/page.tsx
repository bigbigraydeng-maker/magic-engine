import Link from 'next/link'
import PortalLoginForm from './portal-login-form'

interface Props {
  searchParams: { next?: string; error?: string }
}

const proofItems = [
  { label: 'Reports', body: 'Review the latest diagnostic and priority actions.' },
  { label: 'Content', body: 'See published search and social assets in one place.' },
  { label: 'Proof', body: 'Track shipped work through the Magic Engine loop.' },
]

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
      M
    </div>
  )
}

export default function PortalLoginPage({ searchParams }: Props) {
  const next = searchParams.next?.startsWith('/portal')
    ? searchParams.next
    : '/portal'
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
            href="/discover"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-bold text-white"
          >
            Start diagnosis
          </Link>
        </header>

        <div className="relative z-10 grid gap-10 px-5 pb-12 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:items-start lg:pb-20 lg:pt-16">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
              Client portal
            </p>
            <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[1.04] tracking-normal max-sm:text-4xl">
              Sign in to see what has shipped.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              Your client portal brings monthly reports, approved content, and execution proof
              into the same Magic Engine view.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {proofItems.map(item => (
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
                Secure access
              </p>
              <h2 className="mt-2 text-2xl font-black">Get your magic link</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Enter the email invited to your client portal. We will send a private login link.
              </p>
            </div>

            <PortalLoginForm next={next} authFailed={hasError} />

            <p className="mt-6 text-center text-xs leading-5 text-slate-500">
              Magic Lab. Powered by Magic Engine.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
