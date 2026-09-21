import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe,expect,it } from 'vitest'

function websiteFile(path:string) {
  return readFileSync(join(process.cwd(),'website/cn/meta-ads-ai',path),'utf8')
}

describe('Meta Ads AI public Chinese copy',()=>{
  it('keeps the invited-customer journey to the same three steps as the product page',()=>{
    const landing=websiteFile('index.html')
    expect(landing).toContain('连接 Facebook → 选择广告账户 → 生成中文报告')
    expect(landing).toContain('生成近 7 天分析')
    expect(landing).toContain('分析费用由 Magic Engine 承担')
    expect(landing).not.toMatch(/MCP|Bearer|HTTPS|Codex|AI 客户端/)
  })

  it('discloses hosted analysis data handling before customers connect',()=>{
    const privacy=websiteFile('privacy/index.html')
    expect(privacy).toContain('最小广告汇总数据发送给托管 AI 模型')
    expect(privacy).toContain('不会收到你的 Facebook 密码、登录凭据或 Meta access token')
    expect(privacy).toContain('此前生成的报告')
  })
})
