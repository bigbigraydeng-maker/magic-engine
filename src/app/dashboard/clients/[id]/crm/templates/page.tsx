/**
 * 邮件模板：看模板、改模板、（全局管理员）改发信设置、看最近发了什么。
 * 设计稿：docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §11
 *
 * 服务端页只做鉴权（付费客户员工能进来看；谁能改由各个接口自己把关），其余都在客户端组件里。
 * 发信设置那一块只有全局管理员才渲染——别人连那个入口都看不到。
 */

import Link from 'next/link'
import type { ReactNode } from 'react'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { canEditSettings } from '@/lib/crm/email-templates/settings-input'
import { EmailSettingsPanel } from '../_components/EmailSettingsPanel'
import { RecentSends } from '../_components/RecentSends'
import { TemplatesAdmin } from '../_components/TemplatesAdmin'

export const dynamic = 'force-dynamic'

const NO_ACCESS_TEXT = '你的账号没有查看这一页的权限。'
const UNAVAILABLE_TEXT = '这一页暂时打不开，请稍后再试；如果一直这样，请告诉 Magic Engine。'

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8">{children}</div>
}

function Notice({ text }: { text: string }): JSX.Element {
  return <p className="rounded border border-me-charcoal/20 bg-me-ivory p-4 text-sm text-me-charcoal">{text}</p>
}

export default async function EmailTemplatesPage({ params }: { params: { id: string } }): Promise<JSX.Element> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return (
      <Shell>
        <Notice text={access.status === 401 || access.status === 403 ? NO_ACCESS_TEXT : UNAVAILABLE_TEXT} />
      </Shell>
    )
  }
  const settingsAdmin = canEditSettings(access.user.email, access.allowedClientId)

  return (
    <Shell>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-me-charcoal">邮件模板</h1>
        <Link href={`/dashboard/clients/${params.id}/crm/all`} className="text-sm underline">
          回到全部客人
        </Link>
      </div>
      <p className="mb-2 text-sm text-me-charcoal/70">
        通话之后，在客人的资料页点「选模板」就能发跟进邮件。模板里的团、价格、班期永远来自已发布的团目录；每封信都由你点「发送」，系统不会自己发。
      </p>
      <TemplatesAdmin clientId={params.id} />
      <RecentSends clientId={params.id} />
      {settingsAdmin && (
        <section id="settings" className="mt-8 border-t border-me-charcoal/10 pt-6">
          <h2 className="mb-3 text-base font-semibold text-me-charcoal">发信设置（仅全局管理员）</h2>
          <EmailSettingsPanel clientId={params.id} />
        </section>
      )}
    </Shell>
  )
}
