import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const SOURCE = 'src/lib/security/safe-fetch.ts'
const TEST = 'src/lib/security/__tests__/safe-fetch.test.ts'

const mutations = [
  {
    name: 'CIDR classification bypass',
    find: "return ipaddr.process(stripIpv6Brackets(address)).range() === 'unicast'",
    replace: 'return true',
    test: 'rejects non-public IPv4 ranges and allows public unicast',
  },
  {
    name: 'validated address not passed to socket factory',
    find: 'const client = createBoundClient(parsed.origin, pinned, options)',
    replace: "const client = createBoundClient(parsed.origin, { address: parsed.hostname, family: pinned.family }, options)",
    test: 'resolves once and binds the exact validated address to the client',
  },
  {
    name: 'redirect target not used for the next validated hop',
    find: 'const { response, client } = await requestHop(parsed, options, resolveHost, createBoundClient)',
    replace: 'const { response, client } = await requestHop(parseHttpUrl(hop === 0 ? currentUrl : startUrl), options, resolveHost, createBoundClient)',
    test: 'resolves and binds each public redirect hop independently',
  },
]

function runTarget(testName) {
  return spawnSync('npx', ['vitest', 'run', TEST, '-t', testName], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
}

const original = readFileSync(SOURCE, 'utf8')
const results = []

try {
  for (const mutation of mutations) {
    if (!original.includes(mutation.find)) throw new Error(`mutation anchor missing: ${mutation.name}`)
    writeFileSync(SOURCE, original.replace(mutation.find, mutation.replace))
    const run = runTarget(mutation.test)
    results.push({ name: mutation.name, caught: run.status !== 0 })
    writeFileSync(SOURCE, original)
  }
} finally {
  writeFileSync(SOURCE, original)
}

for (const result of results) console.log(`${result.caught ? 'CAUGHT' : 'MISSED'} ${result.name}`)
if (results.length !== mutations.length || results.some(({ caught }) => !caught)) process.exit(1)
