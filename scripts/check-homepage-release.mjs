import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../website/', import.meta.url));
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const script = readFileSync(resolve(root, 'homepage.js'), 'utf8');
assert(!/noindex|HOMEPAGE CONCEPT|Preview form|review-dialog|Client portal/.test(html));
assert(html.includes('href="/waitlist/#apply"'));
assert(html.includes('id="founder"'));
assert(html.includes('facebook-domain-verification'));
assert(html.includes('rel="canonical"'));
assert(html.indexOf('/google-tag.js') < html.indexOf('/meta-pixel.js'));
for (const match of html.matchAll(/(?:src|href)="(\/[^"#?]*)(?:\?[^"#]*)?"/g)) {
  if (/\.(svg|png|jpg|css|js)$/.test(match[1])) {
    assert(existsSync(resolve(root, '.' + match[1])), match[1]);
  }
}
for (const name of ['google', 'facebook', 'instagram', 'chatgpt', 'googleads']) {
  assert(existsSync(resolve(root, 'assets/ecosystem', name + '.svg')));
}
assert(existsSync(resolve(root, 'BingSiteAuth.xml')));
const login = readFileSync(resolve(root, 'login.html'), 'utf8');
assert(login.includes('noindex,nofollow'));
assert(login.includes('https://app.magicengine.com.au/portal/login'));
assert(!/fetch\(|localStorage|sessionStorage/.test(script));

// Exercise the display-only examples without network or production data.
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {
    textContent: '', innerHTML: '', dataset: {},
    addEventListener() {}, setAttribute() {}, insertAdjacentHTML() {},
  });
  return nodes.get(id);
}
const context = vm.createContext({ document: {
  querySelectorAll: () => [], querySelector: node, getElementById: node,
} });
vm.runInContext(script, context);
const evaluate = code => vm.runInContext(code, context);
assert(evaluate('website()').includes('PROPOSED DESIGN'));
evaluate('websiteAfter = false');
assert(evaluate('website()').includes('BEFORE'));
for (let i = 0; i < 3; i++) {
  evaluate('slide = ' + i);
  assert(evaluate('social()').includes('0' + (i + 1) + ' / 03'));
}
evaluate('ad = 0');
assert(evaluate('advertising()').includes('China Small-Group Tours'));
evaluate('ad = 1');
assert(evaluate('advertising()').includes('Your First Trip to China'));
assert(evaluate('advertising()').includes('Serving <b>Off</b>'));
console.log('PASS: release metadata, assets, waitlist route, login, XML and 7 visual states');
