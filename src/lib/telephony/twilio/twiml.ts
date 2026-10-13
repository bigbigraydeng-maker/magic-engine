/** 来电的 TwiML：先告知录音，再转给员工并录音（从接通起、双声道），员工那段结果回调到 dial 地址。 */

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 录音告知的默认文案；CTS 如要改，放进连接配置（本期未做）。 */
export const RECORDING_NOTICE = 'This call may be recorded for quality and training purposes.'

export function inboundForwardTwiml(args: {
  forwardTo: string
  dialActionUrl: string
  recordingCallbackUrl: string
  timeoutSeconds?: number
  /** 转给员工那一段显示的主叫号码：用我们自己的 Twilio 号码。不设的话会沿用来电者号码，运营商/Twilio 可能因「不是我们的号码」拒接（2026-10-12 首次试打：dial failed）。 */
  callerId?: string | null
}): string {
  const callerId = args.callerId && /^\+[1-9][0-9]{7,14}$/.test(args.callerId) ? ` callerId="${esc(args.callerId)}"` : ''
  return (
    '<?xml version="1.0" encoding="UTF-8"?><Response>' +
    `<Say language="en-AU">${esc(RECORDING_NOTICE)}</Say>` +
    `<Dial answerOnBridge="true" timeout="${args.timeoutSeconds ?? 25}"${callerId} record="record-from-answer-dual"` +
    ` action="${esc(args.dialActionUrl)}" recordingStatusCallback="${esc(args.recordingCallbackUrl)}"` +
    ' recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST">' +
    `<Number>${esc(args.forwardTo)}</Number></Dial></Response>`
  )
}

/** 连接没配好 / 校验没过时的安全回应：挂断，不转接、不录音。 */
export const HANGUP_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'
export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>'
