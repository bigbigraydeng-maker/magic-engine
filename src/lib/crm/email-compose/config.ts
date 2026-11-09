export interface EmailComposeLimits {
  perUserPerHour: number;
  perUserPerDay: number;
  perMailboxPerDay: number;
}

export const DEFAULT_EMAIL_COMPOSE_LIMITS: EmailComposeLimits = {
  perUserPerHour: 30,
  perUserPerDay: 100,
  perMailboxPerDay: 200,
};

export interface EmailComposeConfig {
  enabled: boolean;
  sendMailbox: string | null;
  allowUnsolicited: boolean;
  footer: string | null;
  limits: EmailComposeLimits;
}

const MAX_LIMIT = 1000;
const MAX_FOOTER_LENGTH = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readSendMailbox(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0) {
    return null;
  }
  if (atIndex !== normalized.lastIndexOf('@')) {
    return null;
  }
  if (atIndex === normalized.length - 1) {
    return null;
  }
  return normalized;
}

function readFooter(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_FOOTER_LENGTH) {
    return null;
  }
  return trimmed;
}

function readLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number') {
    return fallback;
  }
  if (!Number.isInteger(value)) {
    return fallback;
  }
  if (value <= 0 || value > MAX_LIMIT) {
    return fallback;
  }
  return value;
}

function readLimits(value: unknown): EmailComposeLimits {
  if (!isPlainObject(value)) {
    return { ...DEFAULT_EMAIL_COMPOSE_LIMITS };
  }
  return {
    perUserPerHour: readLimit(
      value.per_user_per_hour,
      DEFAULT_EMAIL_COMPOSE_LIMITS.perUserPerHour,
    ),
    perUserPerDay: readLimit(
      value.per_user_per_day,
      DEFAULT_EMAIL_COMPOSE_LIMITS.perUserPerDay,
    ),
    perMailboxPerDay: readLimit(
      value.per_mailbox_per_day,
      DEFAULT_EMAIL_COMPOSE_LIMITS.perMailboxPerDay,
    ),
  };
}

export function readEmailComposeConfig(leadsConfig: unknown): EmailComposeConfig {
  const defaults: EmailComposeConfig = {
    enabled: false,
    sendMailbox: null,
    allowUnsolicited: false,
    footer: null,
    limits: { ...DEFAULT_EMAIL_COMPOSE_LIMITS },
  };

  if (!isPlainObject(leadsConfig)) {
    return defaults;
  }

  const raw = leadsConfig.email_compose;
  if (!isPlainObject(raw)) {
    return defaults;
  }

  return {
    enabled: readBoolean(raw.enabled),
    sendMailbox: readSendMailbox(raw.send_mailbox),
    allowUnsolicited: readBoolean(raw.allow_unsolicited),
    footer: readFooter(raw.footer),
    limits: readLimits(raw.limits),
  };
}
