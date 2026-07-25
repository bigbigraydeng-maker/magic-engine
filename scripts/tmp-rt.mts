import { readFileSync } from 'node:fs'
for (const l of readFileSync('.env.local','utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const { transformStockImages } = await import('../src/lib/factory/stock-pipeline')
// 不传 look —— 调色交给装配层,改图只出中性写实底子
const r = await transformStockImages('c0000000-0000-0000-0000-000000000000', { max: 6 })
console.log('改图结果:', JSON.stringify(r))
