import { describe, expect, it } from 'vitest';
import type { EmailComposeLimits } from '../config';
import { evaluateQuota, quotaMessage } from '../quota';

const limits: EmailComposeLimits = {
  perUserPerHour: 30,
  perUserPerDay: 100,
  perMailboxPerDay: 200,
};

describe('evaluateQuota', () => {
  it('blocks at exactly the user_hour limit', () => {
    expect(
      evaluateQuota(
        { userLastHour: 30, userLastDay: 0, mailboxLastDay: 0 },
        limits,
      ),
    ).toEqual({ ok: false, which: 'user_hour' });
  });

  it('allows one below the user_hour limit', () => {
    expect(
      evaluateQuota(
        { userLastHour: 29, userLastDay: 0, mailboxLastDay: 0 },
        limits,
      ),
    ).toEqual({ ok: true });
  });

  it('blocks at exactly the user_day limit', () => {
    expect(
      evaluateQuota(
        { userLastHour: 0, userLastDay: 100, mailboxLastDay: 0 },
        limits,
      ),
    ).toEqual({ ok: false, which: 'user_day' });
  });

  it('allows one below the user_day limit', () => {
    expect(
      evaluateQuota(
        { userLastHour: 0, userLastDay: 99, mailboxLastDay: 0 },
        limits,
      ),
    ).toEqual({ ok: true });
  });

  it('blocks at exactly the mailbox_day limit', () => {
    expect(
      evaluateQuota(
        { userLastHour: 0, userLastDay: 0, mailboxLastDay: 200 },
        limits,
      ),
    ).toEqual({ ok: false, which: 'mailbox_day' });
  });

  it('allows one below the mailbox_day limit', () => {
    expect(
      evaluateQuota(
        { userLastHour: 0, userLastDay: 0, mailboxLastDay: 199 },
        limits,
      ),
    ).toEqual({ ok: true });
  });

  it('returns user_hour first when several block', () => {
    expect(
      evaluateQuota(
        { userLastHour: 30, userLastDay: 100, mailboxLastDay: 200 },
        limits,
      ),
    ).toEqual({ ok: false, which: 'user_hour' });
  });

  it('returns user_day before mailbox_day when both block', () => {
    expect(
      evaluateQuota(
        { userLastHour: 0, userLastDay: 100, mailboxLastDay: 200 },
        limits,
      ),
    ).toEqual({ ok: false, which: 'user_day' });
  });

  it('treats negative usage as 0', () => {
    expect(
      evaluateQuota(
        { userLastHour: -5, userLastDay: -1, mailboxLastDay: -100 },
        limits,
      ),
    ).toEqual({ ok: true });
  });

  it('treats NaN usage as 0', () => {
    expect(
      evaluateQuota(
        {
          userLastHour: Number.NaN,
          userLastDay: Number.NaN,
          mailboxLastDay: Number.NaN,
        },
        limits,
      ),
    ).toEqual({ ok: true });
  });
});

describe('quotaMessage', () => {
  it('returns the user_hour message', () => {
    expect(quotaMessage('user_hour')).toBe(
      '你这一小时发的邮件已达上限，请稍后再试。',
    );
  });

  it('returns the user_day message', () => {
    expect(quotaMessage('user_day')).toBe(
      '你今天发的邮件已达上限，明天再发。',
    );
  });

  it('returns the mailbox_day message', () => {
    expect(quotaMessage('mailbox_day')).toBe(
      '这个邮箱今天发出的邮件已达上限，明天再发。',
    );
  });
});
