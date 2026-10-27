import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUDIO_KBPS_ALLOWANCE,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_KBPS,
  MIN_VIDEO_KBPS,
  STORAGE_TARGET_BYTES,
  encodingCapFor,
  oversizeUploadMessage,
} from '../encode-cap.mjs'

const estimatedBytes = (videoKbps, durationSec) =>
  (videoKbps + AUDIO_KBPS_ALLOWANCE) * 1000 * durationSec / 8

test('a short reel hits the 10 Mbps ceiling', () => {
  const cap = encodingCapFor(18)
  assert.equal(cap.videoKbps, 10_000)
  assert.equal(cap.encodingMaxRate, '10000k')
  assert.equal(cap.encodingBufferSize, '10000k')
})

test('a 90 second reel stays inside 45 MB at about 3.3 Mbps', () => {
  const cap = encodingCapFor(90)
  assert.equal(cap.videoKbps, 3_312)
  assert.equal(cap.encodingMaxRate, '3312k')
  assert.equal(cap.encodingBufferSize, '3312k')
  assert.ok(estimatedBytes(cap.videoKbps, 90) <= STORAGE_TARGET_BYTES)
})

test('every duration from 3s to 90s fits 45 MB and stays inside the ceiling and floor', () => {
  for (let durationSec = 3; durationSec <= 90; durationSec += 1) {
    const cap = encodingCapFor(durationSec)
    // Slack is taken after audio is reserved, so the file estimate (not the undone slack) is the limit.
    const budgetKbps = Math.floor(
      ((STORAGE_TARGET_BYTES * 8) / durationSec / 1000 - AUDIO_KBPS_ALLOWANCE) * 0.9,
    )
    const expected = Math.max(MIN_VIDEO_KBPS, Math.min(MAX_VIDEO_KBPS, budgetKbps))
    assert.equal(cap.videoKbps, expected, `${durationSec}s`)
    assert.equal(cap.encodingMaxRate, `${expected}k`)
    assert.equal(cap.encodingBufferSize, `${expected}k`)
    assert.ok(
      estimatedBytes(cap.videoKbps, durationSec) <= STORAGE_TARGET_BYTES,
      `${durationSec}s is ${estimatedBytes(cap.videoKbps, durationSec)} bytes`,
    )
  }
})

test('zero, NaN, and negative durations throw', () => {
  for (const durationSec of [0, Number.NaN, -1, -0.5]) {
    assert.throws(() => encodingCapFor(durationSec), /bad duration/)
  }
})

test('the upload gate sits at 48 MB, under the 50 MB object limit', () => {
  assert.equal(MAX_UPLOAD_BYTES, 48_000_000)
  assert.ok(MAX_UPLOAD_BYTES < 50_000_000)
  assert.ok(MAX_UPLOAD_BYTES > STORAGE_TARGET_BYTES)
})

test('the refusal names the file and the same 48 MB cap', () => {
  assert.equal(
    oversizeUploadMessage(48_000_001),
    '成片体检没过：成片 48.0 MB，超过存储上限（48 MB）。请缩短时长或换更静的镜头后重出',
  )
  assert.match(oversizeUploadMessage(48_000_001, '16:9 成片'), /16:9 成片 48\.0 MB/)
})

test('upload-size-gate re-exports the one ceiling', async () => {
  const gate = await import('../upload-size-gate.mjs')
  assert.equal(gate.MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES)
  assert.equal(gate.oversizeUploadMessage, oversizeUploadMessage)
})
