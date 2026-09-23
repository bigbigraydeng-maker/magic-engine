import { beforeEach,describe,expect,it,vi } from 'vitest'

const mocks=vi.hoisted(()=>({ from:vi.fn() }))
vi.mock('@/lib/supabase',()=>({ supabaseAdmin:{ from:mocks.from } }))

import { finishBindingAudit } from '@/lib/clients/binding-audit'
import { finishReadAudit } from '../audit'

function updateResult(data:unknown,error:unknown=null) {
  const result={ data,error }
  const chain:Record<string,unknown>={
    update:vi.fn(()=>chain),
    eq:vi.fn(()=>chain),
    select:vi.fn(()=>chain),
    then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result).then(resolve),
  }
  return chain
}

beforeEach(()=>{
  vi.clearAllMocks()
  vi.spyOn(console,'error').mockImplementation(()=>{})
})

describe('audit completion cardinality',()=>{
  it('accepts exactly the requested binding audit row',async()=>{
    mocks.from.mockReturnValue(updateResult([{ id:'audit-1' }]))
    await expect(finishBindingAudit('audit-1','applied')).resolves.toBe(true)
  })

  it.each<[unknown]>([[[]],[[{ id:'audit-1' },{ id:'audit-2' }]],[[{ id:'other' }]]])('refuses a binding audit update that did not affect exactly its row',async data=>{
    mocks.from.mockReturnValue(updateResult(data))
    await expect(finishBindingAudit('audit-1','applied')).resolves.toBe(false)
  })

  it('accepts exactly the requested read audit row',async()=>{
    mocks.from.mockReturnValue(updateResult([{ id:'read-1' }]))
    await expect(finishReadAudit('read-1',null,'act_1234567890')).resolves.toBeUndefined()
  })

  it.each<[unknown]>([[[]],[[{ id:'read-1' },{ id:'read-2' }]],[[{ id:'other' }]]])('fails closed when the read audit update did not affect exactly its row',async data=>{
    mocks.from.mockReturnValue(updateResult(data))
    await expect(finishReadAudit('read-1',null,'act_1234567890')).rejects.toThrow('audit_unavailable')
  })
})
