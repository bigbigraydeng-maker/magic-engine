import { describe, expect, it } from 'vitest'
import { buildFieldView } from '../view'

const person = (o: Record<string, unknown>) => ({ contactId: 'c1', name: 'A', reason: 'r', phone: '+64210000000', ...o })

describe('buildFieldView', () => {
  it('只显示要人做的两层，先放着的只给人数', () => {
    const v = buildFieldView({
      buckets: [
        { layer: 'waiting', total: 1, people: [person({ contactId: 'w' })] },
        { layer: 'acted', total: 1, people: [person({ contactId: 'a' })] },
        { layer: 'queued', total: 7, people: [person({ contactId: 'q' })] },
      ],
    })
    expect(v.sections.map((s) => s.rows.map((r) => r.contactId))).toEqual([['w'], ['a']])
    expect(v.queuedCount).toBe(7)
  })

  it('别再联系的人不显示，说过不要电话的标明打不了', () => {
    const v = buildFieldView({
      buckets: [{ layer: 'waiting', total: 2, people: [person({ contactId: 'x', doNotContact: true }), person({ contactId: 'y', doNotCall: true })] }],
    })
    expect(v.sections[0].rows.map((r) => [r.contactId, r.callBlock])).toEqual([['y', 'do_not_call']])
  })

  it('没号码、号码打不通分开说明', () => {
    const v = buildFieldView({
      buckets: [{ layer: 'acted', total: 2, people: [person({ contactId: 'n', phone: null }), person({ contactId: 'b', phoneUnusable: true })] }],
    })
    expect(v.sections[1].rows.map((r) => r.callBlock)).toEqual(['no_phone', 'bad_phone'])
  })

  it('今天已处理的沉到本层最后，并显示处理原因', () => {
    const v = buildFieldView({
      buckets: [{ layer: 'waiting', total: 2, people: [person({ contactId: 'd', doneToday: true, handledWhy: '今天联系过了' }), person({ contactId: 'o' })] }],
    })
    expect(v.sections[0].rows.map((r) => r.contactId)).toEqual(['o', 'd'])
    expect(v.sections[0].rows[1].reason).toBe('今天联系过了')
  })

  it('返回形状不对时不崩，并标成无效（页面据此报错，不当成今天没人）', () => {
    expect(buildFieldView(null).valid).toBe(false)
    expect(buildFieldView({ buckets: 'x' }).valid).toBe(false)
    expect(buildFieldView({ buckets: [{ layer: 'something_new', total: 3, people: [] }] }).valid).toBe(false)
    expect(buildFieldView({ buckets: [{ layer: 'waiting', total: 0, people: [] }] }).valid).toBe(true)
  })

  it('标题人数不含被手机页丢掉的人', () => {
    const v = buildFieldView({ buckets: [{ layer: 'waiting', total: 3, people: [person({ contactId: 'a' }), person({ contactId: 'b' }), person({ contactId: 'x', doNotContact: true })] }] })
    expect(v.sections[0].total).toBe(2)
    expect(v.sections[0].rows).toHaveLength(2)
  })

  it('没有 contactId 的行丢掉，没名字的给占位', () => {
    const v = buildFieldView({ buckets: [{ layer: 'waiting', total: 2, people: [{ name: 'no id' }, { contactId: 'z' }] }] })
    expect(v.sections[0].rows).toHaveLength(1)
    expect(v.sections[0].rows[0].name).toBe('（没有名字）')
  })
})
