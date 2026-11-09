import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMAIL_COMPOSE_LIMITS,
  readEmailComposeConfig,
} from '../config';

describe('readEmailComposeConfig', () => {
  it('returns defaults for null', () => {
    expect(readEmailComposeConfig(null)).toEqual({
      enabled: false,
      sendMailbox: null,
      allowUnsolicited: false,
      footer: null,
      limits: { ...DEFAULT_EMAIL_COMPOSE_LIMITS },
    });
  });

  it('returns defaults for undefined', () => {
    expect(readEmailComposeConfig(undefined)).toEqual({
      enabled: false,
      sendMailbox: null,
      allowUnsolicited: false,
      footer: null,
      limits: { ...DEFAULT_EMAIL_COMPOSE_LIMITS },
    });
  });

  it('returns defaults for a string', () => {
    expect(readEmailComposeConfig('nope')).toEqual({
      enabled: false,
      sendMailbox: null,
      allowUnsolicited: false,
      footer: null,
      limits: { ...DEFAULT_EMAIL_COMPOSE_LIMITS },
    });
  });

  it('returns defaults for an array', () => {
    expect(readEmailComposeConfig([])).toEqual({
      enabled: false,
      sendMailbox: null,
      allowUnsolicited: false,
      footer: null,
      limits: { ...DEFAULT_EMAIL_COMPOSE_LIMITS },
    });
  });

  it('returns defaults for an empty object', () => {
    expect(readEmailComposeConfig({})).toEqual({
      enabled: false,
      sendMailbox: null,
      allowUnsolicited: false,
      footer: null,
      limits: { ...DEFAULT_EMAIL_COMPOSE_LIMITS },
    });
  });

  it('enables only for exact boolean true', () => {
    expect(
      readEmailComposeConfig({ email_compose: { enabled: true } }).enabled,
    ).toBe(true);
    expect(
      readEmailComposeConfig({ email_compose: { enabled: 'true' } }).enabled,
    ).toBe(false);
    expect(
      readEmailComposeConfig({ email_compose: { enabled: 1 } }).enabled,
    ).toBe(false);
    expect(
      readEmailComposeConfig({ email_compose: { enabled: 'yes' } }).enabled,
    ).toBe(false);
  });

  it('normalises sendMailbox', () => {
    expect(
      readEmailComposeConfig({
        email_compose: { send_mailbox: '  Sales@Example.COM  ' },
      }).sendMailbox,
    ).toBe('sales@example.com');
  });

  it('rejects invalid sendMailbox values', () => {
    expect(
      readEmailComposeConfig({ email_compose: { send_mailbox: 'a@' } })
        .sendMailbox,
    ).toBeNull();
    expect(
      readEmailComposeConfig({ email_compose: { send_mailbox: '@b' } })
        .sendMailbox,
    ).toBeNull();
    expect(
      readEmailComposeConfig({ email_compose: { send_mailbox: 'a@@b' } })
        .sendMailbox,
    ).toBeNull();
    expect(
      readEmailComposeConfig({ email_compose: { send_mailbox: 42 } })
        .sendMailbox,
    ).toBeNull();
  });

  it('allows unsolicited only for exact boolean true', () => {
    expect(
      readEmailComposeConfig({
        email_compose: { allow_unsolicited: true },
      }).allowUnsolicited,
    ).toBe(true);
    expect(
      readEmailComposeConfig({
        email_compose: { allow_unsolicited: 'true' },
      }).allowUnsolicited,
    ).toBe(false);
    expect(
      readEmailComposeConfig({
        email_compose: { allow_unsolicited: 1 },
      }).allowUnsolicited,
    ).toBe(false);
  });

  it('trims footer', () => {
    expect(
      readEmailComposeConfig({ email_compose: { footer: '  hello  ' } }).footer,
    ).toBe('hello');
  });

  it('rejects empty footer', () => {
    expect(
      readEmailComposeConfig({ email_compose: { footer: '   ' } }).footer,
    ).toBeNull();
  });

  it('rejects footer over 500 chars', () => {
    const long = 'a'.repeat(501);
    expect(
      readEmailComposeConfig({ email_compose: { footer: long } }).footer,
    ).toBeNull();
  });

  it('accepts footer of exactly 500 chars', () => {
    const exact = 'a'.repeat(500);
    expect(
      readEmailComposeConfig({ email_compose: { footer: exact } }).footer,
    ).toBe(exact);
  });

  it('reads valid limits', () => {
    const config = readEmailComposeConfig({
      email_compose: {
        limits: {
          per_user_per_hour: 5,
          per_user_per_day: 10,
          per_mailbox_per_day: 20,
        },
      },
    });
    expect(config.limits).toEqual({
      perUserPerHour: 5,
      perUserPerDay: 10,
      perMailboxPerDay: 20,
    });
  });

  it('falls back to defaults for invalid limits', () => {
    const invalidValues: unknown[] = [0, -1, 1.5, 1001, '5', Number.NaN];
    for (const value of invalidValues) {
      const config = readEmailComposeConfig({
        email_compose: {
          limits: {
            per_user_per_hour: value,
            per_user_per_day: value,
            per_mailbox_per_day: value,
          },
        },
      });
      expect(config.limits).toEqual({ ...DEFAULT_EMAIL_COMPOSE_LIMITS });
    }
  });

  it('never throws on weird email_compose values', () => {
    const weirdValues: unknown[] = [5, [], 'x', null, undefined, true];
    for (const value of weirdValues) {
      expect(() =>
        readEmailComposeConfig({ email_compose: value }),
      ).not.toThrow();
      expect(readEmailComposeConfig({ email_compose: value })).toEqual({
        enabled: false,
        sendMailbox: null,
        allowUnsolicited: false,
        footer: null,
        limits: { ...DEFAULT_EMAIL_COMPOSE_LIMITS },
      });
    }
  });
});
