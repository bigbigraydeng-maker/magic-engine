#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const configPath = resolve(process.argv[2] ?? 'config/clients/cts/post-publish-watch.json')
const eventKey = process.env.INNGEST_EVENT_KEY
if (!eventKey) throw new Error('INNGEST_EVENT_KEY is required')
const data = JSON.parse(await readFile(configPath, 'utf8'))
if (!data || typeof data !== 'object' || !Array.isArray(data.pages) || data.pages.length === 0 || data.no_publish !== true) {
  throw new Error('invalid post-publish watch config')
}
const digest = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 24)
const response = await fetch(`https://inn.gs/e/${encodeURIComponent(eventKey)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: `seo-watch-bootstrap-${digest}`, name: 'seo/page-watch.started', data }),
})
if (!response.ok) throw new Error(`Inngest rejected event: ${response.status}`)
const body = await response.json()
console.log(JSON.stringify({ dispatched: true, event_ids: body.ids ?? body.event_ids ?? [], config: configPath }, null, 2))
