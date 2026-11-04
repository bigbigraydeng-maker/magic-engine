export interface TouchKind {
  channel: string;
  source: string | null;
  direction: 'inbound' | 'outbound';
}

export const ENQUIRY_INBOUND_SOURCES: ReadonlySet<string> = new Set([
  'meta_lead_form/meta_lead_form',
  'web_form/web_form',
  'messenger/messenger',
  'whatsapp/whatsapp',
  'email/microsoft_mail',
  'email/outlook',
  'email/outlook_info_scan',
  'phone/twilio',
  'phone/voipline',
]);

export function hasEnquiryRecord(touches: readonly TouchKind[]): boolean {
  for (const touch of touches) {
    if (touch.direction !== 'inbound') continue;
    const key = `${touch.channel}/${touch.source ?? ''}`;
    if (ENQUIRY_INBOUND_SOURCES.has(key)) {
      return true;
    }
  }
  return false;
}
