import { describe, it, expect } from 'vitest'
import { redact } from '../redact'

describe('redact — 密钥绝不能落库', () => {
  it('抹掉 Supabase / GBP 那类 JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4In0.abcdefghijklmnop'
    const r = redact(`SUPABASE_KEY 是 ${jwt} 记一下`)
    expect(r.text).not.toContain('eyJhbGciOi')
    expect(r.hits.length).toBeGreaterThan(0)
  })

  it('抹掉各家 API key 前缀', () => {
    expect(redact('sk-ant-api03-abcdefghijklmnop').text).not.toContain('sk-ant-api03')
    expect(redact('ghp_abcdefghijklmnopqrstuvwxyz01').text).not.toContain('ghp_abcdefg')
    expect(redact('EAAxxxxxxxxxxxxxxxxxxxxxxxxx').text).not.toContain('EAAxxxxxxxxxxxxxxxxxxxxxxxxx')
    expect(redact('AIzaSyAbcdefghijklmnopqrstuvwxyz').text).not.toContain('AIzaSyAbcdef')
  })

  it('抹掉 KEY=value 形式', () => {
    const r = redact('CRON_SECRET=phase3cron2026')
    expect(r.text).not.toContain('phase3cron2026')
  })

  it('抹掉 Authorization: Bearer', () => {
    const r = redact('curl -H "Authorization: Bearer abcdef1234567890"')
    expect(r.text).not.toContain('abcdef1234567890')
  })

  it('普通内容原样保留 —— 脱敏不能把有用信息也抹了', () => {
    const text = '改了 src/lib/team-memory/context.ts，跑了 npm run build'
    expect(redact(text).text).toBe(text)
    expect(redact(text).hits).toEqual([])
  })

  it('超长内容硬截断，防止把整个文件刷进库', () => {
    const r = redact('x'.repeat(5000))
    expect(r.text.length).toBeLessThan(700)
    expect(r.text).toContain('[截断]')
  })

  it('空值不炸', () => {
    expect(redact(null).text).toBe('')
    expect(redact(undefined).text).toBe('')
  })
})
