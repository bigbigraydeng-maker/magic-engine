import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { inspectTelegramUpdate, opcApproverFor } from '../ingress'
import { formatIssuedCard, formatMorningTodo } from '../messages'
import { notifyIssuedConfirmationCard, pushMorningTodo } from '../push'
import { POST } from '@/app/api/webhooks/telegram/route'
import type { TodoView } from '@/lib/pm-todo/daily-todo'

const SECRET = 'test-webhook-secret'
const OWNER = '1001'
const CHAT = '2002'
const EMAIL = 'ray@example.com'

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_OWNER_USER_ID: OWNER,
    TELEGRAM_OWNER_CHAT_ID: CHAT,
    TELEGRAM_OWNER_EMAIL: EMAIL,
    TELEGRAM_BOT_TOKEN: 'test-token',
    ...extra,
  }
}

function message(userId: number | string, chatId: number | string, text = '是') {
  return { update_id: 1, message: { message_id: 1, from: { id: userId }, chat: { id: chatId }, text } }
}

const view: TodoView = {
  sections: [
    {
      pm_kind: 'decide',
      emoji: '✋',
      title: '要你拍板的',
      rows: [
        {
          pm_kind: 'decide',
          kind: 'demo',
          client_id: 'c1',
          client_name: '示例客户',
          what: '看一眼这份草稿',
          how: '',
          href: 'https://app.magicengine.com.au/dashboard/clients/c1/blog',
          action_label: '去看',
          count: 1,
          samples: [],
        },
        {
          pm_kind: 'decide',
          kind: 'nolink',
          client_id: 'c1',
          client_name: '示例客户',
          what: '没有页面的提醒',
          how: '',
          href: '',
          action_label: '看',
          count: 1,
          samples: [],
        },
      ],
    },
  ],
  totalItems: 2,
  blindSpots: [],
  routedToDev: 0,
  routedToWeekly: 0,
  cronFailures24h: 0,
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('telegram ingress', () => {
  it('rejects when the webhook secret is missing', () => {
    const result = inspectTelegramUpdate({
      secretHeader: SECRET,
      rawBody: JSON.stringify(message(OWNER, CHAT)),
      env: { ...env(), TELEGRAM_WEBHOOK_SECRET: '' },
    })
    expect(result.status).toBe(503)
    expect(result.body.error).toBe('secret_not_configured')
  })

  it('rejects a wrong secret before reading who sent it', () => {
    const result = inspectTelegramUpdate({
      secretHeader: 'nope',
      rawBody: JSON.stringify(message(OWNER, CHAT)),
      env: env(),
    })
    expect(result.status).toBe(401)
    expect(result.body.error).toBe('bad_secret')
  })

  it('rejects a different user id and a different chat id', () => {
    const otherUser = inspectTelegramUpdate({
      secretHeader: SECRET,
      rawBody: JSON.stringify(message(9999, CHAT)),
      env: env(),
    })
    const otherChat = inspectTelegramUpdate({
      secretHeader: SECRET,
      rawBody: JSON.stringify(message(OWNER, 8888)),
      env: env(),
    })
    expect(otherUser.status).toBe(403)
    expect(otherChat.status).toBe(403)
    expect(otherUser.body.executed).toBe(false)
  })

  it('maps the owner to OPC and does not treat text or a button as approval', () => {
    const text = inspectTelegramUpdate({
      secretHeader: SECRET,
      rawBody: JSON.stringify(message(1001, 2002, '是')),
      env: env(),
    })
    const button = inspectTelegramUpdate({
      secretHeader: SECRET,
      rawBody: JSON.stringify({
        update_id: 2,
        callback_query: { id: 'cb', from: { id: 1001 }, message: { chat: { id: 2002 } }, data: 'yes' },
      }),
      env: env(),
    })
    expect(text.status).toBe(200)
    expect(text.body).toMatchObject({ executed: false, reason: 'text_is_not_approval', approver: 'opc' })
    expect(button.body).toMatchObject({ executed: false, reason: 'buttons_not_enabled', approver: 'opc' })
    const owner = { userId: OWNER, chatId: CHAT, email: EMAIL }
    expect(opcApproverFor({ userId: OWNER, chatId: CHAT, kind: 'message' }, owner)).toEqual({
      kind: 'opc',
      email: EMAIL,
    })
  })

  it('route returns the same rejection and does not send', async () => {
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET)
    vi.stubEnv('TELEGRAM_OWNER_USER_ID', OWNER)
    vi.stubEnv('TELEGRAM_OWNER_CHAT_ID', CHAT)
    vi.stubEnv('TELEGRAM_OWNER_EMAIL', EMAIL)
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const req = new NextRequest('https://app.example/api/webhooks/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      body: JSON.stringify(message(9999, 9999)),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('telegram copy', () => {
  it('lists every item link and says there is no button', () => {
    const [text] = formatMorningTodo({
      weekdayName: '周一',
      themeTitle: '周报日',
      themeHint: '读周报',
      dateLabel: '16 Nov',
      view,
    })
    expect(text).toContain('示例客户：看一眼这份草稿')
    expect(text).toContain('https://app.magicengine.com.au/dashboard/clients/c1/blog')
    expect(text).toContain('没有页面的提醒')
    expect(text).toContain('（这条没有链接）')
    expect(text).toContain('没有按钮')
    expect(text).not.toContain('reply_markup')
  })

  it('card reminder is text plus the page link', () => {
    const text = formatIssuedCard({
      clientId: 'c1',
      what: '暂停这个广告组',
      account: '广告账户',
      amount: '不变',
      date: '今天',
      scope: '一个广告组',
      expiresLabel: '请在页面时限前点。',
    })
    expect(text).toContain('没有按钮')
    expect(text).toContain('打字不算批准')
    expect(text).toContain('/dashboard/clients/c1/confirmation-cards')
  })
})

describe('telegram push flag', () => {
  const notice = {
    clientId: 'c1',
    what: '看一眼',
    account: '账户',
    amount: '0',
    date: '今天',
    scope: '一条',
    expiresLabel: '页面时限',
  }

  it('flag off does not send the morning summary or a card', async () => {
    const fetchImpl = vi.fn()
    const morning = await pushMorningTodo({
      weekday: 1,
      dateLabel: '16 Nov',
      view,
      env: env({ TELEGRAM_TODO_PUSH_ENABLED: 'false' }),
      fetchImpl,
    })
    const card = await notifyIssuedConfirmationCard({
      ...notice,
      env: env(),
      fetchImpl,
    })
    expect(morning).toBe('skipped')
    expect(card).toBe('skipped')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('flag on sends text only, never setWebhook', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const result = await notifyIssuedConfirmationCard({
      ...notice,
      env: env({ TELEGRAM_TODO_PUSH_ENABLED: 'true' }),
      fetchImpl,
    })
    expect(result).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage')
    expect(url).not.toContain('setWebhook')
    const body = JSON.parse(String(init.body)) as { text: string; reply_markup?: unknown }
    expect(body.reply_markup).toBeUndefined()
    expect(body.text).toContain('没有按钮')
  })
})
