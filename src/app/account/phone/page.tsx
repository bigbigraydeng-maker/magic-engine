import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { phoneLinkAccessForUser, phoneLinkWorkspaceForEmail } from '@/lib/auth/phone-link-access'
import { maskChinaPhone, normalizeChinaPhone } from '@/lib/auth/china-phone'
import { isChinaPhoneOtpEnabled } from '@/lib/auth/china-phone-otp'
import PhoneLinkForm from './phone-link-form'

export default async function PhoneAccountPage() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/portal/login?next=%2Faccount%2Fphone&emailCode=1')

  const access = await phoneLinkAccessForUser(user)
  if (access === 'denied') redirect('/unauthorized')
  const workspaceHref = access === 'allowed'
    ? await phoneLinkWorkspaceForEmail(user.email) ?? '/portal/login'
    : '/portal/login'

  const verifiedPhone = user.phone_confirmed_at ? normalizeChinaPhone(user.phone) : null
  const phoneOtpEnabled = isChinaPhoneOtpEnabled()
  return (
    <main className="min-h-screen bg-me-ivory px-5 py-12 md:px-10">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-me-ochre">账号设置</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-me-charcoal">绑定手机号</h1>
        <p className="mb-7 mt-3 text-sm leading-6 text-me-charcoal/60">
          先用当前账号验证手机号。完成后，以后可以直接用短信验证码登录，不会新建另一个客户账号。
        </p>
        {access === 'unavailable' ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700">
            暂时无法读取账号权限，请稍后重试。
          </p>
        ) : !phoneOtpEnabled ? (
          <p role="status" className="rounded-xl border border-me-charcoal/10 bg-white p-4 text-sm leading-6 text-me-charcoal/70">
            手机验证码登录还未开放。负责人完成短信服务配置和验收后，这里就可以绑定手机号。
          </p>
        ) : (
          <PhoneLinkForm
            isLinked={Boolean(verifiedPhone)}
            maskedPhone={verifiedPhone ? maskChinaPhone(verifiedPhone) : null}
          />
        )}
        <Link href={workspaceHref} className="mt-5 inline-flex text-sm font-semibold text-me-ochre hover:underline">
          {workspaceHref === '/portal/login' ? '返回登录页 →' : '返回工作区 →'}
        </Link>
      </div>
    </main>
  )
}
