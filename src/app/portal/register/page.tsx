import Link from 'next/link'
import { MeMark, MeMarkDefs } from '@/components/ui/me-mark'
import RegisterForm from './register-form'
import { safeInternalPath } from '@/lib/auth/safe-internal-path'

const benefits = [
  {
    icon: '🎯',
    label: 'Free tokens included',
    body: 'Start with 500 MTC — enough to generate blog posts, social content, and SEO reports.',
  },
  {
    icon: '🔧',
    label: 'Self-serve tools',
    body: 'Blog drafts, social posts, keyword reports and more — all at your own pace.',
  },
  {
    icon: '📈',
    label: 'Upgrade any time',
    body: 'Ready for fully managed execution? Talk to us to upgrade to the FDE programme.',
  },
]

const zhBenefits = [
  {
    label: '2 分钟注册，不用信用卡',
    body: '填个邮箱就能开始，不需要绑定任何付款方式。',
  },
  {
    label: '只看不改，随时可以断开',
    body: '我们只读取广告数据做体检，不会改动你的广告，也不会替你花钱。',
  },
  {
    label: '中文报告，老板自己就能看懂',
    body: '哪条广告该留、哪条该停，用中文说清楚，不用翻译。',
  },
]

interface Props {
  searchParams: {
    next?: string
    tool?: string
    error?: string
  }
}

export default function RegisterPage({ searchParams }: Props) {
  const isAdsCheck = searchParams.tool === 'ads-check'
  const next = safeInternalPath(searchParams.next, isAdsCheck ? '/meta-ads-ai/mine' : '/dashboard')
  const fromProspect = next === '/prospect'
  const zh = next === '/meta-ads-ai/mine' || isAdsCheck
  const authFailed = searchParams.error === 'auth_failed'
  const signInHref = `/portal/login?next=${encodeURIComponent(next)}`

  return (
    <main className="flex min-h-screen">
      <MeMarkDefs />

      {/* ── Left dark panel ── */}
      <div className="hidden lg:flex lg:w-[44%] lg:flex-col lg:min-h-screen bg-me-black px-10 py-8">
        <Link
          href="https://magicengine.com.au"
          className="flex items-center gap-2.5 text-[#FBF8F3] no-underline"
        >
          <MeMark className="h-7 w-8 flex-none" />
          <span className="font-display text-sm font-bold">Magic Engine</span>
        </Link>

        <div className="mt-auto mb-10">
          <div className="mb-5 text-xs font-bold uppercase tracking-[0.16em] text-me-gold">
            {zh ? 'Magic Engine 工具实验室' : fromProspect ? 'Discovery to workspace' : 'Free to start'}
          </div>
          <h1 className="font-display text-[2.6rem] font-bold leading-[1.08] tracking-tight text-white">
            {zh ? (
              <>免费体检你的<br />Facebook 广告</>
            ) : fromProspect ? (
              <>Save your report.<br />Open your workspace.</>
            ) : (
              <>500 MTC.<br />On us.</>
            )}
          </h1>
          <p className="mt-4 text-sm leading-[1.75] text-white/60">
            {zh
              ? '连上广告账户，AI 用中文告诉你哪条广告该留、哪条该停。免费，只看不改。'
              : fromProspect
                ? 'We will carry your latest Discovery Report into a new workspace, then guide you through a short brand brief before you unlock the tools.'
                : 'Magic Token Coins power every content, SEO, and AI visibility action on the platform. Start free, top up when you need more.'}
          </p>

          <div className="mt-8 flex flex-col gap-3">
            {zh
              ? zhBenefits.map(item => (
                  <div
                    key={item.label}
                    className="rounded-xl border border-white/[.08] bg-white/[.055] p-4"
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <p className="text-sm font-bold text-white">{item.label}</p>
                    </div>
                    <p className="text-xs leading-[1.65] text-white/50">{item.body}</p>
                  </div>
                ))
              : benefits.map(item => (
                  <div
                    key={item.label}
                    className="rounded-xl border border-white/[.08] bg-white/[.055] p-4"
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-base">{item.icon}</span>
                      <p className="text-sm font-bold text-white">{item.label}</p>
                    </div>
                    <p className="text-xs leading-[1.65] text-white/50">{item.body}</p>
                  </div>
                ))}
          </div>
        </div>

        <Link
          href={zh ? 'https://magicengine.com.au/cn/lab/' : 'https://magicengine.com.au'}
          className="text-xs text-white/35 no-underline transition-colors hover:text-white/55"
        >
          {zh ? '← 回到 Magic Engine 工具实验室' : '← Back to magicengine.com.au'}
        </Link>
      </div>

      {/* ── Right paper panel ── */}
      <div className="flex flex-1 flex-col items-center justify-center min-h-screen bg-me-ivory px-6 py-12 font-sans">
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <MeMark className="h-6 w-7" />
          <span className="font-display text-sm font-bold text-me-charcoal">Magic Engine</span>
        </div>

        <div className="w-full max-w-[360px]">
          <div className="mb-7">
            <h2 className="font-display text-[2rem] font-bold leading-tight tracking-tight text-me-charcoal">
              {zh ? '免费注册，开始体检' : fromProspect ? 'Create your workspace.' : 'Create your account.'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
              {zh
                ? '不用信用卡，2 分钟完成。'
                : fromProspect
                  ? 'Verify your email, then we will take you from your Discovery Report into your workspace brief.'
                  : 'Free to start — no credit card required.'}
            </p>
          </div>

          <RegisterForm next={next} fromProspect={fromProspect} zh={zh} authFailed={authFailed} />

          <p className="mt-7 text-center text-xs text-me-charcoal/45">
            {zh ? (
              '已经注册过？照常填公司名和邮箱，我们会改发登录验证码给你'
            ) : (
              <>
                Already have an account?{' '}
                <Link href={signInHref} className="font-semibold text-me-ochre no-underline hover:underline">
                  Sign in →
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </main>
  )
}
