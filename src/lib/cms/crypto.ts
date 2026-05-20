/**
 * AES-256-GCM encrypt / decrypt for CMS GitHub PATs.
 *
 * Storage format:  base64(iv) + '.' + base64(authTag) + '.' + base64(ciphertext)
 *
 * Requirements:
 *  - CMS_TOKEN_ENCRYPTION_KEY must be a 32-byte value encoded as a 64-char hex string.
 *  - A fresh random 12-byte IV is generated on every encrypt call.
 *  - The 16-byte GCM auth tag is verified on decrypt — ciphertext tampering throws.
 *
 * Security contract:
 *  - The key MUST NOT change after tokens are stored. If it does, existing tokens
 *    become permanently unreadable (crypto.createDecipheriv will throw).
 *  - This module MUST only be imported in server-side code (API routes, lib).
 *    Never import it from client components or shared UI modules.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM      = 'aes-256-gcm'
const IV_BYTES       = 12   // 96-bit IV recommended for GCM
const AUTH_TAG_BYTES = 16
const KEY_HEX_LEN    = 64   // 32 bytes expressed as hex

// ─── Key loading (lazy + cached) ─────────────────────────────────────────────

let _keyBuffer: Buffer | null = null

function loadKey(): Buffer {
  if (_keyBuffer) return _keyBuffer

  const hex = process.env.CMS_TOKEN_ENCRYPTION_KEY
  if (!hex) {
    throw new Error(
      'CMS_TOKEN_ENCRYPTION_KEY is not set. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    )
  }
  if (hex.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      `CMS_TOKEN_ENCRYPTION_KEY must be a ${KEY_HEX_LEN}-character hex string (32 bytes). ` +
      `Got length ${hex.length}.`
    )
  }

  _keyBuffer = Buffer.from(hex, 'hex')
  return _keyBuffer
}

// ─── encrypt ─────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string (e.g. a GitHub PAT).
 *
 * @returns  Dot-delimited base64 string: `iv.authTag.ciphertext`
 */
export function encryptToken(plaintext: string): string {
  const key        = loadKey()
  const iv         = randomBytes(IV_BYTES)
  const cipher     = createCipheriv(ALGORITHM, key, iv)
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag    = cipher.getAuthTag()

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.')
}

// ─── decrypt ─────────────────────────────────────────────────────────────────

/**
 * Decrypt a token previously encrypted by `encryptToken`.
 *
 * @throws  If the format is invalid, the key is wrong, or the ciphertext
 *          has been tampered with (GCM auth tag mismatch).
 */
export function decryptToken(stored: string): string {
  const parts = stored.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format: expected 3 dot-delimited segments.')
  }

  const [ivB64, authTagB64, ciphertextB64] = parts
  const key        = loadKey()
  const iv         = Buffer.from(ivB64,         'base64')
  const authTag    = Buffer.from(authTagB64,    'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')

  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES}, got ${iv.length}.`)
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_BYTES}, got ${authTag.length}.`)
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Return the last N characters of a token for safe display only. */
export function tokenLastFour(plaintext: string): string {
  return plaintext.slice(-4)
}

/** Reset the cached key (test-only — do not call in production). */
export function _resetKeyCache(): void {
  _keyBuffer = null
}
