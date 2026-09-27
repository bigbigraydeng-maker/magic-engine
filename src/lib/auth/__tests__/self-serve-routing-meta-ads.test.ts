import { describe,expect,it } from 'vitest'
import { normalizeSelfServeTarget } from '../self-serve-routing'

describe('normalizeSelfServeTarget — Magic Bridge 路径',()=>{
  it('保留本客户自己的 /meta-ads-ai/<id> 路径',()=>{
    expect(normalizeSelfServeTarget('client-a','/meta-ads-ai/client-a')).toBe('/meta-ads-ai/client-a')
  })

  it('其他客户的 /meta-ads-ai/<id> 一律回到本客户首页',()=>{
    expect(normalizeSelfServeTarget('client-a','/meta-ads-ai/client-b')).toBe('/dashboard/clients/client-a')
  })
})
