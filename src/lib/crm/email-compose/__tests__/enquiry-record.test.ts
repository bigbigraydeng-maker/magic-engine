import { describe, expect, it } from 'vitest';
import {
  ENQUIRY_INBOUND_SOURCES,
  hasEnquiryRecord,
  type TouchKind,
} from '../enquiry-record';

const inbound = (channel: string, source: string | null): TouchKind => ({
  channel,
  source,
  direction: 'inbound',
});

const outbound = (channel: string, source: string | null): TouchKind => ({
  channel,
  source,
  direction: 'outbound',
});

describe('hasEnquiryRecord', () => {
  it('returns true for each allowed inbound source', () => {
    for (const key of ENQUIRY_INBOUND_SOURCES) {
      const slash = key.indexOf('/');
      const channel = key.slice(0, slash);
      const source = key.slice(slash + 1);
      expect(hasEnquiryRecord([inbound(channel, source)])).toBe(true);
    }
  });

  it('returns false for the same sources when outbound', () => {
    for (const key of ENQUIRY_INBOUND_SOURCES) {
      const slash = key.indexOf('/');
      const channel = key.slice(0, slash);
      const source = key.slice(slash + 1);
      expect(hasEnquiryRecord([outbound(channel, source)])).toBe(false);
    }
  });

  it('ignores mailchimp inbound touches', () => {
    expect(hasEnquiryRecord([inbound('email', 'mailchimp')])).toBe(false);
  });

  it('ignores sheet followup outbound touches', () => {
    expect(hasEnquiryRecord([outbound('phone', 'sheet_followup')])).toBe(
      false,
    );
  });

  it('returns false for an empty list', () => {
    expect(hasEnquiryRecord([])).toBe(false);
  });

  it('returns true when a mailchimp touch is mixed with a messenger inbound', () => {
    expect(
      hasEnquiryRecord([
        inbound('email', 'mailchimp'),
        inbound('messenger', 'messenger'),
      ]),
    ).toBe(true);
  });

  it('returns false when the source is null', () => {
    expect(hasEnquiryRecord([inbound('messenger', null)])).toBe(false);
    expect(hasEnquiryRecord([inbound('email', null)])).toBe(false);
  });
});
