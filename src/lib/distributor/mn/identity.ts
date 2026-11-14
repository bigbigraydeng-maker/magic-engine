import type { IdentityPolicy, MnIdentity } from './policy'

export interface IdentityFacts {
  joined: boolean
  cumulativeValidMuCents: number
  joinedDirects: number
  directsWithQualifiedNonSelfSale: number
  personalMuCents: number
  directLineMuCents: readonly number[]
  /** Qualifying team MU of earlier months, oldest first, not including the current month. */
  priorQualifyingTeamMuCents: readonly number[]
  heldNode: boolean
  heldNexus: boolean
  invitedCore: boolean
}

export interface IdentityDecision {
  identity: MnIdentity | 'unset'
  node: boolean
  nexus: boolean
  core: boolean
}

/** Personal sales and each direct line count at most `cap` toward the Nexus test. Bonus math does not use this. */
export function qualifyingTeamMu(personalMuCents: number, directLineMuCents: readonly number[], cap: number | null): number {
  if (cap === null) return personalMuCents + directLineMuCents.reduce((sum, line) => sum + line, 0)
  const lines = directLineMuCents.reduce((sum, line) => sum + Math.min(line, cap), 0)
  return Math.min(personalMuCents, cap) + lines
}

function meetsNode(facts: IdentityFacts, policy: IdentityPolicy): boolean {
  const directs = policy.node.directsNeedQualifiedNonSelfSale
    ? facts.directsWithQualifiedNonSelfSale
    : facts.joinedDirects
  return facts.cumulativeValidMuCents >= policy.node.cumulativeValidMuCents && directs >= policy.node.minDirects
}

function meetsNexus(facts: IdentityFacts, policy: IdentityPolicy, isNode: boolean): boolean {
  if (policy.nexus.requireNode && !isNode) return false
  const current = qualifyingTeamMu(facts.personalMuCents, facts.directLineMuCents, policy.nexus.lineCapMuCents)
  if (policy.nexus.retention === 'monthly') return current >= policy.nexus.teamMuCents
  if (policy.nexus.retention === 'lifetime') return facts.heldNexus || current >= policy.nexus.teamMuCents
  const recent = [...facts.priorQualifyingTeamMuCents, current].slice(-3)
  return recent.some((month) => month >= policy.nexus.teamMuCents)
}

/** Highest identity the facts support. Core is never reached without an invite, and only while Nexus holds. */
export function evaluateIdentity(facts: IdentityFacts, policy: IdentityPolicy): IdentityDecision {
  if (!facts.joined || !policy.linkOnJoin) return { identity: 'unset', node: false, nexus: false, core: false }
  const node = (policy.node.sticky && facts.heldNode) || meetsNode(facts, policy)
  const nexus = meetsNexus(facts, policy, node)
  const core = facts.invitedCore && (!policy.core.requiresNexus || nexus)
  const identity: MnIdentity = core ? 'Core' : nexus ? 'Nexus' : node ? 'Node' : 'Link'
  return { identity, node, nexus, core }
}
