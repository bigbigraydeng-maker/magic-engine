#!/usr/bin/env node
/**
 * 在 CTS 的 Twilio 账号里建一个「语音转写服务」（Intelligence Service），并拿 PM 自己的一通测试录音试转写一次。
 * 令牌只在你自己的终端里输入（隐藏输入），不写文件、不打印、不发给任何人。
 *
 *   node scripts/twilio-create-intelligence-service.mjs
 *
 * 做的事（都在 CTS 自己的 Twilio 账号内）：
 *   1) 看有没有名叫 cts-call-transcripts 的服务，没有就建一个（不自动转写、不保留数据用于训练）。
 *   2) 用 PM 的测试录音提交一次转写，等最多 3 分钟，打印状态、语言和前几句（这是 PM 自己的测试电话）。
 */

import readline from 'node:readline'

const ACCOUNT_SID = 'AC7546dcc8cf3e8f05a85f7173ab482990'
const SERVICE_NAME = 'cts-call-transcripts'
const TEST_RECORDING_SID = 'REe0296921feaa937fdaf14e46df5a0fc6'
const BASE = 'https://intelligence.twilio.com/v2'

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(question) }
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a.trim()) })
  })
}

const token = await ask('Twilio Auth Token（输入时不显示）: ')
if (!token) { console.error('没有输入令牌，退出'); process.exit(1) }
const auth = Buffer.from(`${ACCOUNT_SID}:${token}`).toString('base64')

async function call(method, url, form) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Basic ${auth}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* keep text */ }
  return { ok: res.ok, status: res.status, json, text }
}

const list = await call('GET', `${BASE}/Services`)
if (!list.ok) { console.error('读取服务失败', list.status, list.text.slice(0, 300)); process.exit(1) }
let svc = (list.json?.services ?? []).find((s) => s.unique_name === SERVICE_NAME)
if (svc) console.log('已有服务:', svc.sid)
else {
  const made = await call('POST', `${BASE}/Services`, { UniqueName: SERVICE_NAME, AutoTranscribe: 'false', DataLogging: 'false', LanguageCode: 'en-US' })
  if (!made.ok) { console.error('建服务失败', made.status, made.text.slice(0, 400)); process.exit(1) }
  svc = made.json
  console.log('新建服务:', svc.sid)
}
console.log('SERVICE_SID =', svc.sid, ' language_code =', svc.language_code, ' data_logging =', svc.data_logging)

const tr = await call('POST', `${BASE}/Transcripts`, {
  ServiceSid: svc.sid,
  Channel: JSON.stringify({ media_properties: { source_sid: TEST_RECORDING_SID } }),
})
if (!tr.ok) { console.error('提交转写失败', tr.status, tr.text.slice(0, 400)); process.exit(1) }
const sid = tr.json.sid
console.log('转写提交成功:', sid, tr.json.status)

for (let i = 0; i < 18; i++) {
  await new Promise((r) => setTimeout(r, 10_000))
  const g = await call('GET', `${BASE}/Transcripts/${sid}`)
  console.log('  状态:', g.json?.status, '时长(秒):', g.json?.duration, '语言:', g.json?.language_code)
  if (g.json?.status === 'completed') {
    const s = await call('GET', `${BASE}/Transcripts/${sid}/Sentences?PageSize=8`)
    for (const x of s.json?.sentences ?? []) console.log('  [', x.media_channel, ']', x.transcript)
    process.exit(0)
  }
  if (g.json?.status === 'failed' || g.json?.status === 'canceled') { console.error('转写失败'); process.exit(1) }
}
console.log('3 分钟内没转完，稍后用上面的 sid 再查')
