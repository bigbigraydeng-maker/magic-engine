import { Resend } from 'resend'
import { meMailFrom } from '@/lib/email/sender'

export interface BindMailer {
  send(input: { to: string; subject: string; text: string }): Promise<{ ok: boolean }>
}

export function defaultBindMailer(): BindMailer | null {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return null
  const resend = new Resend(apiKey)
  return {
    async send({ to, subject, text }) {
      const { error } = await resend.emails.send({
        from: meMailFrom('Magic Engine Telegram 绑定'),
        to: [to],
        subject,
        text,
      })
      return { ok: !error }
    },
  }
}

export async function sendTelegramBindCodeEmail(
  to: string,
  code: string,
  mailer: BindMailer | null = defaultBindMailer(),
): Promise<'sent' | 'no_api_key' | 'send_failed'> {
  if (!mailer) return 'no_api_key'
  const text = [
    '你在 Telegram 绑定 Magic Engine 广告预警通知。',
    `确认码：${code}`,
    '请在 15 分钟内在 ME 广告预警机器人对话里直接发送这 6 位数字（不要加 /start）。',
    '如果你没发起绑定，忽略这封邮件即可。',
  ].join('\n')
  const r = await mailer.send({
    to,
    subject: `ME 广告预警 Telegram 确认码 ${code}`,
    text,
  })
  return r.ok ? 'sent' : 'send_failed'
}