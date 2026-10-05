import { runFrozenFieldCheck } from '../src/lib/ledger/frozen-ci'

const base = process.env.BASE_SHA
const head = process.env.HEAD_SHA
if (!base || !head) {
  console.error('BASE_SHA and HEAD_SHA environment variables are required')
  process.exit(1)
}

const { errors, warnings } = runFrozenFieldCheck(base, head)

for (const w of warnings) console.log(`::warning::${w}`)
for (const e of errors) console.log(`::error::${e}`)

if (errors.length > 0) {
  process.exit(1)
}

if (errors.length === 0 && warnings.length === 0) {
  console.log('冻结字段检查通过')
}
