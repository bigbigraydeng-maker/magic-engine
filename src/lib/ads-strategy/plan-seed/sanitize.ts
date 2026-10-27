/** 清洗原因字符串，抹掉可能泄露的 token / 长串。 */
export function sanitizeReason(reason: string): string {
  return reason
    .replace(/access_token=[^&\s]+/gi, 'access_token=***')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer ***')
    .replace(/[A-Za-z0-9_-]{20,}/g, '***')
}
