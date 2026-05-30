import Link from 'next/link'
import RegisterForm from './register-form'

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
      M
    </div>
  )
}

const benefits = [
  {
    label: 'Free tokens',
    body: 'Start with 500 MTC — enough to generate blog posts, social content, and SEO reports.',
  },
  {
    label: 'Self-serve tools',
    body: 'Blog drafts, social posts, keyword reports and more — all at your pace.',
  },
  {
    label: 'Upgrade any time',
    body: 'Ready for fully managed execution? Talk to us to upgrade to the FDE programme.',
  },
]

export default function RegisterPage() {
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
            Sign in
          </Link>
        </header>

        <div className="relative z-10 grid gap-10 px-5 pb-12 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:items-start lg:pb-20 lg:pt-16">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
              Self-serve — free to start
            </p>
            <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[1.04] tracking-normal max-sm:text-4xl">
              Create your account and get 500 MTC free.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              Magic Token Coins power every content, SEO, and AI visibility action on the platform.
              Start free, top up when you need more.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {benefits.map(item => (
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
                Create account
              </p>
              <h2 className="mt-2 text-2xl font-black">Start for free</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Already have an account?{' '}
                <Link href="/portal/login" className="font-bold text-slate-950 underline underline-offset-4">
                  Sign in
                </Link>
              </p>
            </div>

            <RegisterForm />

            <p className="mt-6 text-center text-xs leading-5 text-slate-500">
              Magic Lab. Powered by Magic Engine.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
