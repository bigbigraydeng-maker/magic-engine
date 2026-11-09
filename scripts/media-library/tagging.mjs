// Intake observations never grant location, rights or production approval.
export function intakeTags(metadata) {
  const tags = metadata.tags;
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) throw new Error('Intake tags required');
  const list = (value, name) => {
    if (!Array.isArray(value) || !value.length || value.length > 30 ||
      value.some(x => typeof x !== 'string' || !x.trim() || x.length > 120)) {
      throw new Error(`Invalid or missing ${name}`);
    }
    return [...new Set(value.map(x => x.trim()))];
  };
  const subject = list(tags.subject, 'subject tags');
  if (subject.some(x => /^REQUIRED|^unknown$/i.test(x))) throw new Error('Observed subject required; template placeholders refused');
  const required = ['shot_type', 'action', 'season', 'people_present'];
  for (const key of required) {
    const value = tags[key];
    if (key === 'people_present' && typeof value === 'boolean') continue;
    if (typeof value !== 'string' || !value.trim() || value.length > 120) {
      throw new Error(`Missing ${key}: use explicit unknown when unverified`);
    }
  }
  if (![true, false, 'unknown'].includes(tags.people_present)) throw new Error('Invalid people_present');
  const channels = list(metadata.channels ?? metadata.channels_suggested, 'channels');
  if (channels.some(x => !['youtube', 'tiktok', 'facebook_reels'].includes(x))) throw new Error('Invalid channel');
  if (typeof metadata.tagging_evidence !== 'string' || !metadata.tagging_evidence.trim()) throw new Error('Tagging evidence required');
  return {
    tags: { subject, ...Object.fromEntries(required.map(k => [k, tags[k]])) }, channels,
    tagging_evidence: metadata.tagging_evidence,
    tagging_status: required.some(k => tags[k] === 'unknown') ? 'needs_enrichment' : 'observed',
    analysis_status: 'tagged_pending_review', eligible_for_automatic_selection: false,
  };
}
