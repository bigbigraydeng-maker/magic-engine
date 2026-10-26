'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {init, allowed} = require('../tracking.js');

function fakeEnv(opts = {}) {
  const scripts = [], listeners = {}, cardListeners = {}, formListeners = {};
  const doc = {
    head: {appendChild: s => scripts.push(s.src)},
    createElement: () => ({}),
    addEventListener: (t, fn) => { listeners[t] = fn; },
    getElementById: id => id === 'details-form' && opts.form ? {addEventListener: (t, fn) => { formListeners[t] = fn; }} : id === 'city' ? {value: 'sydney'} : null,
    querySelector: sel => sel === '.form-card' && opts.card ? {addEventListener: (t, fn) => { cardListeners[t] = fn; }} : sel.startsWith('[data-service]') ? {getAttribute: () => 'lcl'} : null
  };
  const win = {navigator: {doNotTrack: opts.dnt || null}, location: {pathname: opts.path || '/'}};
  return {win, doc, scripts, listeners, cardListeners, formListeners};
}
const calls = win => ({fbq: (win.fbq && win.fbq.queue || []).map(a => [...a]), gtag: (win.dataLayer || []).map(a => [...a])});

test('IDs left null: nothing is loaded, nothing is sent', () => {
  const e = fakeEnv(); const s = init(e.win, e.doc, {metaPixelId: null, ga4MeasurementId: null});
  assert.equal(s.enabled, false); assert.deepEqual(e.scripts, []); assert.equal(e.win.fbq, undefined); assert.equal(e.win.gtag, undefined);
});
test('malformed IDs are ignored (no guessing)', () => {
  const e = fakeEnv(); const s = init(e.win, e.doc, {metaPixelId: 'abc', ga4MeasurementId: 'UA-1'});
  assert.equal(s.enabled, false); assert.deepEqual(e.scripts, []);
});
test('Do Not Track switches everything off even with valid IDs', () => {
  const e = fakeEnv({dnt: '1'}); const s = init(e.win, e.doc, {metaPixelId: '1234567890123', ga4MeasurementId: 'G-ABCDEF1234'});
  assert.equal(allowed(e.win), false); assert.equal(s.enabled, false); assert.deepEqual(e.scripts, []);
});
test('valid IDs load both tools with those IDs and fire PageView', () => {
  const e = fakeEnv(); const s = init(e.win, e.doc, {metaPixelId: '1234567890123', ga4MeasurementId: 'G-ABCDEF1234'});
  assert.equal(s.enabled, true);
  assert.ok(e.scripts.includes('https://connect.facebook.net/en_US/fbevents.js'));
  assert.ok(e.scripts.includes('https://www.googletagmanager.com/gtag/js?id=G-ABCDEF1234'));
  const c = calls(e.win);
  assert.deepEqual(c.fbq[0], ['init', '1234567890123']); assert.deepEqual(c.fbq[1], ['track', 'PageView']);
  assert.deepEqual(c.gtag[1].slice(0, 2), ['config', 'G-ABCDEF1234']);
});
test('only the configured tool loads', () => {
  const e = fakeEnv(); init(e.win, e.doc, {metaPixelId: null, ga4MeasurementId: 'G-ABCDEF1234'});
  assert.equal(e.win.fbq, undefined); assert.equal(e.scripts.length, 1);
});
test('mailto click -> quote_email_click (GA) and Contact (Meta), with page path only', () => {
  const e = fakeEnv({path: '/eastinter-pricing-calculator'}); init(e.win, e.doc, {metaPixelId: '1234567890123', ga4MeasurementId: 'G-ABCDEF1234'});
  e.listeners.click({target: {closest: () => ({getAttribute: () => 'mailto:info@eastinter.com.au'})}});
  const c = calls(e.win);
  assert.deepEqual(c.gtag.at(-1), ['event', 'quote_email_click', {location: '/eastinter-pricing-calculator'}]);
  assert.deepEqual(c.fbq.at(-1), ['track', 'Contact', {location: '/eastinter-pricing-calculator'}]);
});
test('home page quote form submit -> quote_email_prepared, no form content in the event', () => {
  const e = fakeEnv({form: true}); init(e.win, e.doc, {metaPixelId: null, ga4MeasurementId: 'G-ABCDEF1234'});
  e.formListeners.submit({});
  assert.deepEqual(calls(e.win).gtag.at(-1), ['event', 'quote_email_prepared', {location: '/'}]);
});
test('calculator: only the first trusted interaction fires calculator_estimate, with service and city only', () => {
  const e = fakeEnv({card: true, path: '/eastinter-pricing-calculator'}); init(e.win, e.doc, {metaPixelId: '1234567890123', ga4MeasurementId: 'G-ABCDEF1234'});
  e.cardListeners.input({isTrusted: false}); assert.equal(calls(e.win).gtag.filter(a => a[1] === 'calculator_estimate').length, 0);
  e.cardListeners.input({isTrusted: true}); e.cardListeners.change({isTrusted: true});
  const ev = calls(e.win).gtag.filter(a => a[1] === 'calculator_estimate');
  assert.equal(ev.length, 1); assert.deepEqual(ev[0][2], {service: 'lcl', city: 'sydney'});
  assert.deepEqual(calls(e.win).fbq.at(-1), ['track', 'ViewContent', {service: 'lcl', city: 'sydney'}]);
});
test('link to the calculator from another page -> calculator_cta_click', () => {
  const e = fakeEnv(); init(e.win, e.doc, {metaPixelId: null, ga4MeasurementId: 'G-ABCDEF1234'});
  e.listeners.click({target: {closest: () => ({getAttribute: () => '/eastinter-pricing-calculator?service=lcl'})}});
  assert.equal(calls(e.win).gtag.at(-1)[1], 'calculator_cta_click');
});
