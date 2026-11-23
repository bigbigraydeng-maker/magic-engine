/**
 * Read-only shell for the unit-system page. It reuses the partner account tree and
 * does not read or write the MU tables (those migrations are not applied here).
 * Amounts stay at zero until a later switchover. Old NZD statements are untouched.
 */
import { selectAll } from '../store'
import { MAGIC_LAB_CARD } from './catalog'
import { buildNetworkView, type NetworkPerson, type NetworkView } from './view'

interface Row {
  id: string
  parent_id: string | null
  display_name: string
  status: string
  referral_code: string | null
}

const VISIBLE = new Set(['approved', 'suspended'])

export async function loadNetworkShell(distributorId: string, origin: string): Promise<NetworkView> {
  const rows = await selectAll<Row>('distributors', 'id, parent_id, display_name, status, referral_code')
  const me = rows.find((row) => row.id === distributorId)
  if (!me) throw new Error('distributor not found')
  const people: NetworkPerson[] = rows
    .filter((row) => row.id === distributorId || VISIBLE.has(row.status))
    .map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      displayName: row.display_name,
      identity: 'unset',
      status: row.status,
    }))
  return buildNetworkView({
    viewerId: distributorId,
    people,
    referralCode: me.status === 'approved' ? me.referral_code : null,
    origin,
    month: null,
    pendingMuCents: 0,
    statement: null,
    settlements: [],
    products: [{ productId: MAGIC_LAB_CARD.productId, name: MAGIC_LAB_CARD.name }],
    fx: null,
    ready: false,
    notices: [
      '单位制账本还没启用，所以这里没有金额。上一页的月结仍按原来的纽币规则。',
      'Link、Node、Nexus 怎么从旧等级过渡还没定，这里不替你换算身份。',
      '本月汇率还没锁定，不显示兑成当地货币的金额。',
    ],
  })
}
