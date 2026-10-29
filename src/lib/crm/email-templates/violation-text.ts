export interface ViolationLike {
  code: string
  detail: string
}

function hasNonAscii(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code !== undefined && code > 127) return true
  }
  return false
}

export function describeMissing(name: string): string {
  if (name === 'first_name') {
    return '客人的名字没有记录，称呼请在正文里手填。'
  }
  if (name === 'sender_name') {
    return '你的账号还没设置显示名，落款请在正文里手填（也可以请管理员在团队成员里补上显示名）。'
  }
  if (name === 'call_when') {
    return '「几时通的电话」没有自动填上：系统里没有这位客人的通话记录，你也没点「刚和他通过电话」。请回到上一步点那个按钮，或直接改掉正文里这句话。'
  }
  return `还缺：${name}`
}

export function describeBlock(violation: ViolationLike): string {
  switch (violation.code) {
    case 'placeholder_left':
      return `还有没填完的地方：「${violation.detail}」。请填完，或连同括号一起去掉。`
    case 'link_host_not_allowed':
      return hasNonAscii(violation.detail)
        ? `链接指向的网站不在允许范围内：${violation.detail}。如果链接后面紧跟着文字，请先空一格。`
        : `链接指向的网站不在允许范围内：${violation.detail}。`
    case 'link_not_https':
      return `链接要用 https 开头：${violation.detail}`
    case 'link_userinfo':
      return `链接里不能带用户名或密码：${violation.detail}`
    default:
      return violation.detail
  }
}

export function describeWarning(violation: ViolationLike): string {
  switch (violation.code) {
    case 'amount_not_in_catalog':
      return `金额 ${violation.detail} 在已发布的目录里找不到，请核对是不是写错了。`
    default:
      return violation.detail
  }
}
