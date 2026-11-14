import { buildCard, type ProductCard } from './template'

/** The one product whose cap is already decided: 60% total commission, all of it the distributor cap. */
export const MAGIC_LAB_CARD: ProductCard = buildCard({
  productId: 'magic-lab',
  name: 'Magic Lab AI 数字人管家',
  currency: 'NZD',
  totalCommissionBp: 6000,
  distributorCapBp: 6000,
})
