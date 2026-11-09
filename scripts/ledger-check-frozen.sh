#!/usr/bin/env bash
# 台账冻结字段检查（CI）。
#
# 调用 frozen.ts 做冻结字段比对。bash 只是入口，解析逻辑全在 TypeScript。
set -euo pipefail
: "${BASE_SHA:?BASE_SHA is required}"
: "${HEAD_SHA:?HEAD_SHA is required}"
npx tsx scripts/ledger-check-frozen-runner.ts
