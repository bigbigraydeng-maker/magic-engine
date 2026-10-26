import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/require-session'
import { phoneLinkAccessForUser } from '@/lib/auth/phone-link-access'
import { normalizeChinaPhone } from '@/lib/auth/china-phone'
import { supabaseAdmin } from '@/lib/supabase'
import { consumeQuota, dayStartUtc, QuotaUnavailable } from '@/lib/zhangqian/rate-limiter'
import { verifyChinaPhoneCode } from '@/lib/sms/aliyun-pnvs'
import { isChinaPhoneOtpEnabled, phoneQuotaKey } from '@/lib/auth/china-phone-otp'

export const runtime = 'nodejs'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
  const phone = normalizeChinaPhone(isRecord(body) ? body.phone : null)
  const code = isRecord(body) && typeof body.code === 'string' ? body.code.trim() : ''
  if (!phone || !/^\d{4,8}$/.test(code)) {
    return NextResponse.json({ error: '请输入手机号和短信验证码' }, { status: 400 })
  }

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
      'auth_phone_link_phone_verify',
      phoneQuotaKey(phone),
      dayStartUtc(),
      10,
    )
    if (!phoneAllowed) return NextResponse.json({ error: '此手机号今日验证次数已达上限' }, { status: 429 })

    const allowed = await consumeQuota(
      'auth_phone_link_verify',
      session.user.id,
      dayStartUtc(),
      10,
    )
    if (!allowed) return NextResponse.json({ error: '今日验证次数已达上限，请明天重试' }, { status: 429 })
  } catch {
    return NextResponse.json({ error: '验证服务暂时不可用，请稍后重试' }, { status: 503 })
  }

  let verified = false
  try {
    verified = await verifyChinaPhoneCode(phone, code)
  } catch {
    return NextResponse.json({ error: '验证码核验暂时不可用，请稍后重试' }, { status: 502 })
  }
  if (!verified) return NextResponse.json({ error: '验证码不正确或已过期，请重新发送' }, { status: 400 })

  // Atomic one-per-day claim prevents two concurrently verified phone numbers
  // from racing past the stale session snapshot below. A transient failure can
  // be retried on the next UTC day; an already-linked account is rejected above.
  try {
    const claimed = await consumeQuota(
      'auth_phone_link_complete',
      session.user.id,
      dayStartUtc(),
      1,
    )
    if (!claimed) return NextResponse.json({ error: '账号绑定正在处理，请稍后重试' }, { status: 409 })
  } catch {
    return NextResponse.json({ error: '绑定服务暂时不可用，请稍后重试' }, { status: 503 })
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(session.user.id, {
    phone,
    phone_confirm: true,
  })
  if (error) {
    return NextResponse.json({ error: '此手机号不能绑定到当前账号，请联系管理员' }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}
