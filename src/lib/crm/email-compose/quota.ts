import type { EmailComposeLimits } from './config';

export interface EmailUsage {
  userLastHour: number;
  userLastDay: number;
  mailboxLastDay: number;
}

export type QuotaVerdict =
  | { ok: true }
  | { ok: false; which: 'user_hour' | 'user_day' | 'mailbox_day' };

function normalizeCount(value: number): number {
  if (typeof value !== 'number') {
    return 0;
  }
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return value;
}

export function evaluateQuota(
  usage: EmailUsage,
  limits: EmailComposeLimits,
): QuotaVerdict {
  const userLastHour = normalizeCount(usage.userLastHour);
  const userLastDay = normalizeCount(usage.userLastDay);
  const mailboxLastDay = normalizeCount(usage.mailboxLastDay);

  if (userLastHour >= limits.perUserPerHour) {
    return { ok: false, which: 'user_hour' };
  }
  if (userLastDay >= limits.perUserPerDay) {
    return { ok: false, which: 'user_day' };
  }
  if (mailboxLastDay >= limits.perMailboxPerDay) {
    return { ok: false, which: 'mailbox_day' };
  }
  return { ok: true };
}

export function quotaMessage(
  which: 'user_hour' | 'user_day' | 'mailbox_day',
): string {
  switch (which) {
    case 'user_hour':
      return '你这一小时发的邮件已达上限，请稍后再试。';
    case 'user_day':
      return '你今天发的邮件已达上限，明天再发。';
    case 'mailbox_day':
      return '这个邮箱今天发出的邮件已达上限，明天再发。';
  }
}
