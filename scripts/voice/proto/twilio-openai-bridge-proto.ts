/**
 * 原型（第一阶段 · 步骤 0）：Twilio 外呼 → Media Streams 音频流 → OpenAI Realtime，只拨 PM 自己的测试手机。
 * 目的：验证声音、延迟、打断、挂断、成本，**不碰 CRM、不写生产库、不对真实客人说话**。
 *
 *   node --env-file=/Users/raydeng/Projects/magic-engine/.env.local --import tsx scripts/voice/proto/twilio-openai-bridge-proto.ts [--to=+64211761528] [--lang=en|zh]
 *
 * 做的事：本机起一个 ws 服务 → 用 cloudflared 临时隧道暴露（只暴露这个原型，通话结束就关）→ 用 Twilio 外呼接口打给测试手机
 * → 接通后 Twilio 把音频流连到本机 → 本机转给 OpenAI Realtime（g711 ulaw 直通，不转码）→ 回来的语音再放给手机。
 * 令牌只在终端隐藏输入（不落盘、不打印）；OpenAI 密钥从环境变量读（不打印）。
 *
 * 防护：只允许拨下面白名单里的两个号码；一次性 token 校验音频流入口；/twiml 校验 Twilio 签名；单通最长 5 分钟。
 * 这是原型：转接、「别再打」检测、按客户开关、预算上限、独立部署都还没做（见设计稿 v0.2 §4）。
 */

import { createServer, type IncomingMessage } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import readline from 'node:readline'
import { WebSocketServer, WebSocket } from 'ws'
import { verifyTwilioSignature } from '../../../src/lib/telephony/twilio/signature'
import { findCallerNumber } from '../../../src/lib/telephony/twilio/outbound'

const ACCOUNT_SID = 'AC7546dcc8cf3e8f05a85f7173ab482990'
const CONNECTION_ID = 'a427f082-6693-4e88-a7e2-229ddbcb8e8e'
/** 原型只许拨 PM 自己的两部手机。 */
const ALLOWED_TO = new Set(['+64211761528', '+64277520888'])
const PORT = 4177
const MAX_SECONDS = 300
const MODEL = process.env.VOICE_PROTO_MODEL ?? 'gpt-realtime-mini'
/** 单价（美元 / 百万 token），第三方文章数字，仅用来估算，**以真账单为准**。可用环境变量覆盖。 */
const RATE_AUDIO_IN = Number(process.env.RT_RATE_AUDIO_IN ?? 10)
const RATE_AUDIO_OUT = Number(process.env.RT_RATE_AUDIO_OUT ?? 20)
const RATE_TEXT_IN = Number(process.env.RT_RATE_TEXT_IN ?? 0.6)
const RATE_TEXT_OUT = Number(process.env.RT_RATE_TEXT_OUT ?? 2.4)

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const TO = arg('to') ?? '+64211761528'
const LANG = arg('lang') ?? 'en'
if (!ALLOWED_TO.has(TO)) {
  console.error('原型只允许拨 PM 自己的测试手机')
  process.exit(1)
}
if (!process.env.OPENAI_API_KEY) {
  console.error('没有 OPENAI_API_KEY（用 --env-file 载入）')
  process.exit(1)
}

const GREETING_EN =
  'Hello, this is the AI assistant from CTS Tours. This call may be recorded for quality purposes. Is now a good time for a quick chat about the China tour you enquired about?'
const GREETING_ZH = '您好，我是 CTS Tours 的 AI 助理，这通电话可能会被录音。请问您现在方便简单聊两分钟，聊聊您咨询过的中国旅行团吗？'

const INSTRUCTIONS = `You are an AI assistant calling on behalf of CTS Tours (a New Zealand travel agency) to follow up on a customer who asked about a China tour.
Rules (hard):
- You already told the customer you are an AI and that the call may be recorded. Never claim to be human. If asked, say you are an AI assistant.
- Speak the customer's language (English or Chinese); switch if they switch. Keep every turn short (1-2 sentences), friendly, no filler.
- Goal: ask if now is a good time; then find out ONLY: which tour or destination, travel window, number of travellers. Do not ask for budget or personal details.
- NEVER state prices, availability, discounts or promises. If asked, say a colleague will confirm and will call back.
- If the customer asks for a human, or is annoyed, say a colleague will call them back soon, thank them, and call end_call.
- If the customer says not to call again, apologise, confirm you will not call again, and call end_call.
- When the info is collected or the customer is done, thank them briefly and call end_call.`

interface RtUsage {
  input_token_details?: { audio_tokens?: number; text_tokens?: number; cached_tokens?: number }
  output_token_details?: { audio_tokens?: number; text_tokens?: number }
}
interface RtEvent {
  type: string
  delta?: string
  transcript?: string
  item?: { type?: string; name?: string }
  response?: { usage?: RtUsage }
  error?: unknown
}

interface Usage { audioIn: number; audioOut: number; textIn: number; textOut: number; cachedIn: number }
const usage: Usage = { audioIn: 0, audioOut: 0, textIn: 0, textOut: 0, cachedIn: 0 }
const latenciesMs: number[] = []
const transcript: string[] = []

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(question)
    }
    rl.question(question, (a) => {
      rl.close()
      process.stdout.write('\n')
      resolve(a.trim())
    })
  })
}

const callToken = randomBytes(18).toString('hex')
let twilioToken = ''
let publicBase = ''
let callSid = ''
let finished: () => void = () => undefined
const done = new Promise<void>((r) => (finished = r))

async function twilioApi(method: string, path: string, form?: URLSearchParams): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:${twilioToken}`).toString('base64')}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form?.toString(),
  })
  return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/twiml')) {
    const body = await readBody(req)
    const params = Object.fromEntries(new URLSearchParams(body))
    const ok = verifyTwilioSignature(twilioToken, `${publicBase}${req.url}`, params, String(req.headers['x-twilio-signature'] ?? ''))
    if (!ok) {
      res.writeHead(401).end('bad signature')
      return
    }
    const wss = publicBase.replace('https://', 'wss://')
    res.writeHead(200, { 'Content-Type': 'text/xml' }).end(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${wss}/stream"><Parameter name="token" value="${callToken}"/></Stream></Connect></Response>`,
    )
    return
  }
  res.writeHead(404).end()
})

const wss = new WebSocketServer({ server, path: '/stream' })

wss.on('connection', (twilio) => {
  let streamSid = ''
  let started = false
  let hangupTimer: NodeJS.Timeout | null = null
  let speechStoppedAt = 0
  let awaitingFirstAudio = false
  const openai = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } })
  const sendOpenAI = (m: unknown) => openai.readyState === WebSocket.OPEN && openai.send(JSON.stringify(m))
  const sendTwilio = (m: unknown) => twilio.readyState === WebSocket.OPEN && twilio.send(JSON.stringify(m))

  const endCall = async (why: string) => {
    console.log(`[挂断] ${why}`)
    if (callSid) await twilioApi('POST', `/Calls/${callSid}.json`, new URLSearchParams({ Status: 'completed' })).catch(() => undefined)
    openai.close()
    twilio.close()
    finished()
  }

  openai.on('open', () => {
    sendOpenAI({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: MODEL,
        instructions: INSTRUCTIONS,
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            transcription: { model: 'gpt-4o-mini-transcribe' },
            turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true },
          },
          output: { format: { type: 'audio/pcmu' }, voice: 'marin' },
        },
        tools: [{ type: 'function', name: 'end_call', description: 'Hang up the call politely after the closing sentence has been spoken.', parameters: { type: 'object', properties: {} } }],
      },
    })
  })

  openai.on('message', (raw) => {
    const m = JSON.parse(raw.toString()) as RtEvent
    switch (m.type) {
      case 'session.updated':
        // 开场白由我们固定下发（先自报 AI + 录音告知），不交给模型临场发挥。
        sendOpenAI({
          type: 'response.create',
          response: { instructions: `Say exactly this sentence and nothing else: "${LANG === 'zh' ? GREETING_ZH : GREETING_EN}"` },
        })
        break
      case 'response.output_audio.delta':
        if (awaitingFirstAudio && speechStoppedAt) {
          latenciesMs.push(Date.now() - speechStoppedAt)
          awaitingFirstAudio = false
        }
        sendTwilio({ event: 'media', streamSid, media: { payload: m.delta } })
        break
      case 'input_audio_buffer.speech_started':
        // 客人开口：清掉还没放完的语音（打断）。
        sendTwilio({ event: 'clear', streamSid })
        break
      case 'input_audio_buffer.speech_stopped':
        speechStoppedAt = Date.now()
        awaitingFirstAudio = true
        break
      case 'conversation.item.input_audio_transcription.completed':
        transcript.push(`客人: ${String(m.transcript ?? '').trim()}`)
        break
      case 'response.output_audio_transcript.done':
        transcript.push(`AI: ${String(m.transcript ?? '').trim()}`)
        break
      case 'response.output_item.done':
        if (m.item?.type === 'function_call' && m.item.name === 'end_call') {
          // 让最后一句说完再挂（约 4 秒）。
          if (!hangupTimer) hangupTimer = setTimeout(() => void endCall('AI 调用 end_call'), 4000)
        }
        break
      case 'response.done': {
        const u = m.response?.usage
        if (u) {
          const inD = u.input_token_details ?? {}
          const outD = u.output_token_details ?? {}
          usage.audioIn += inD.audio_tokens ?? 0
          usage.textIn += inD.text_tokens ?? 0
          usage.cachedIn += inD.cached_tokens ?? 0
          usage.audioOut += outD.audio_tokens ?? 0
          usage.textOut += outD.text_tokens ?? 0
        }
        break
      }
      case 'error':
        console.error('[OpenAI 错误]', JSON.stringify(m.error))
        break
      default:
    }
  })
  openai.on('close', () => twilio.close())
  openai.on('error', (e) => console.error('[OpenAI ws 错误]', e.message))

  twilio.on('message', (raw) => {
    const m = JSON.parse(raw.toString()) as { event: string; start?: { streamSid: string; customParameters?: Record<string, string> }; media?: { payload: string } }
    if (m.event === 'start' && m.start) {
      if (m.start.customParameters?.token !== callToken || started) {
        console.error('[拒绝] 音频流 token 不对或重复连接')
        twilio.close()
        openai.close()
        return
      }
      started = true
      streamSid = m.start.streamSid
      console.log('[音频流已连上]')
    } else if (m.event === 'media' && m.media && started) {
      sendOpenAI({ type: 'input_audio_buffer.append', audio: m.media.payload })
    } else if (m.event === 'stop') {
      console.log('[Twilio 音频流结束]')
      openai.close()
      finished()
    }
  })
})

function openTunnel(): Promise<{ url: string; stop: () => void }> {
  return new Promise((resolve, reject) => {
    const p = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`])
    const timer = setTimeout(() => reject(new Error('隧道 30 秒没起来')), 30_000)
    const onData = (d: Buffer) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(d.toString())
      if (m) {
        clearTimeout(timer)
        resolve({ url: m[0], stop: () => p.kill() })
      }
    }
    p.stdout.on('data', onData)
    p.stderr.on('data', onData)
    p.on('error', reject)
  })
}

function report() {
  const cost =
    (usage.audioIn * RATE_AUDIO_IN + usage.audioOut * RATE_AUDIO_OUT + usage.textIn * RATE_TEXT_IN + usage.textOut * RATE_TEXT_OUT) / 1_000_000
  const lat = [...latenciesMs].sort((a, b) => a - b)
  console.log('\n=== 原型通话结果 ===')
  console.log('对话：\n' + transcript.map((l) => '  ' + l).join('\n'))
  console.log(`轮数：${lat.length}；客人说完→AI 第一声（毫秒）：${lat.length ? `中位 ${lat[Math.floor(lat.length / 2)]}，最慢 ${lat[lat.length - 1]}` : '无数据'}`)
  console.log(`token：音频入 ${usage.audioIn} / 音频出 ${usage.audioOut} / 文字入 ${usage.textIn} / 文字出 ${usage.textOut} / 缓存入 ${usage.cachedIn}`)
  console.log(`OpenAI 费用估算：US$${cost.toFixed(4)}（用单价 ${RATE_AUDIO_IN}/${RATE_AUDIO_OUT} 美元每百万音频 token，**以 OpenAI 真账单为准**）`)
}

async function main() {
  twilioToken = await ask('Twilio Auth Token（输入时不显示）: ')
  if (!twilioToken) throw new Error('没有输入令牌')
  await new Promise<void>((r) => server.listen(PORT, r))
  const tunnel = await openTunnel()
  publicBase = tunnel.url
  console.log(`[隧道] ${publicBase}`)
  const from = await findCallerNumber({ accountSid: ACCOUNT_SID, authToken: twilioToken, connectionId: CONNECTION_ID })
  const r = await twilioApi(
    'POST',
    '/Calls.json',
    new URLSearchParams({
      To: TO,
      From: from,
      Url: `${publicBase}/twiml`,
      Method: 'POST',
      TimeLimit: String(MAX_SECONDS),
      Timeout: '30',
      Record: 'true',
      RecordingChannels: 'dual',
    }),
  )
  if (!r.ok) throw new Error(`外呼失败 ${r.status}`)
  callSid = String(r.json.sid ?? '')
  console.log(`[已发起] 拨给 ${TO}，请接听。通话结束后这里会打印结果。`)
  const guard = setTimeout(() => void finished(), (MAX_SECONDS + 30) * 1000)
  await done
  clearTimeout(guard)
  await new Promise((r2) => setTimeout(r2, 1500))
  report()
  tunnel.stop()
  server.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('失败：', e instanceof Error ? e.message : e)
  process.exit(1)
})
