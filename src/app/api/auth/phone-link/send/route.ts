import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/require-session'
import { phoneLinkAccessForUser } from '@/lib/auth/phone-link-access'
import { normalizeChinaPhone } from '@/lib/auth/china-phone'
import { consumeQuota, dayStartUtc, QuotaUnavailable } from '@/lib/zhangqian/rate-limiter'
import { sendChinaVerificationCode } from '@/lib/sms/aliyun-pnvs'
import { isChinaPhoneOtpEnabled, phoneQuotaKey } from '@/lib/auth/china-phone-otp'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!isChinaPhoneOtpEnabled()) {
    return NextResponse.json({ error: '手机号验证码登录暂未开放' }, { status: 503 })
  }

  const session = await requireSession()
  if (!session.ok) return NextResponse.json({ error: '请先登录' }, { status: 401 })

  const access = await phoneLinkAccessForUser(session.user)
  if (access === 'denied') return NextResponse.json({ error: '当前账号不能绑定手机号' }, { status: 403 })
  if (access === 'unavailable') return NextResponse.json({ error: '暂时无法读取账号权限，请稍后重试' }, { status: 503 })

  const body: unknown = await request.json().catch(() => null)
  const phone = normalizeChinaPhone(
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).phone
      : null,
  )
  if (!phone) return NextResponse.json({ error: '请输入有效的中国大陆手机号' }, { status: 400 })

  const currentPhone = normalizeChinaPhone(session.user.phone)
  if (session.user.phone_confirmed_at) {
    return currentPhone === phone
      ? NextResponse.json({ ok: true, alreadyLinked: true })
      : NextResponse.json({ error: '当前账号已绑定其他手机号，请联系管理员处理' }, { status: 409 })
  }
  if (session.user.phone && currentPhone !== phone) {
    return NextResponse.json({ error: '当前账号已有待验证手机号，请稍后重试或联系管理员' }, { status: 409 })
  }

  try {
    const phoneAllowed = await consumeQuota(
      'auth_phone_link_phone_send',
      phoneQuotaKey(phone),
      dayStartUtc(),
      5,
    )
    if (!phoneAllowed) return NextResponse.json({ error: '此手机号今日验证码次数已达上限' }, { status: 429 })

    const allowed = await consumeQuota(
      'auth_phone_link_send',
      session.user.id,
      dayStartUtc(),
      5,
    )
    if (!allowed) return NextResponse.json({ error: '当前账号今日验证码次数已达上限' }, { status: 429 })
  } catch (error) {
    if (error instanceof QuotaUnavailable) {
      return NextResponse.json({ error: '验证码服务暂时不可用，请稍后重试' }, { status: 503 })
    }
    return NextResponse.json({ error: '验证码服务暂时不可用，请稍后重试' }, { status: 503 })
  }

  try {
    await sendChinaVerificationCode(phone, 'phone-link')
  } catch {
    return NextResponse.json({ error: '验证码发送失败，请稍后重试' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
