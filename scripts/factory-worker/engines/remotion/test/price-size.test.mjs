import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceFontSizeFor } from '../src/priceSize.ts'

test('legacy (non-fit) sizing is unchanged: 9 chars or fewer keep the base size', () => {
  assert.equal(priceFontSizeFor('AB$', 3480, false), 170)
  assert.equal(priceFontSizeFor('$', 4999, false), 170)
  assert.equal(priceFontSizeFor('AB$', 10899, false), 146)
  assert.equal(priceFontSizeFor('AB$', 1234567, false), Math.floor(146 * (9 / 12)))
})

test('fit sizing shrinks 8-character prices so the box stays inside the safe width', () => {
  assert.equal(priceFontSizeFor('AB$', 3480, true), Math.floor(170 * (7.5 / 8)))
  assert.ok(priceFontSizeFor('AB$', 2699, true) < 170)
  assert.equal(priceFontSizeFor('$', 999, true), 170)
})
