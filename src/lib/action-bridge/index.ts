/**
 * ActionCandidate → ActionKey bridge —— 门面。
 *
 * 这一层回答的**只有一个问题**：域模块提出的候选身份，对应哪一个受治理的 ActionKey。
 *
 * 它不回答、也不许回答的：
 *   · 准不准做（那是 Kernel 的授权层，见 `kernel/authorize.ts`）
 *   · 什么时候做、由谁提交（本模块**没有任何调用方**，这是当前的正确状态）
 *   · 这次做了什么（本模块不写库、不落审计 —— 见下）
 *
 * 🔴 **拒绝只是一个返回值。** 本模块不落任何记录。将来的调用方负责把
 *    结构化拒绝持久化留痕。**当前没有调用方，所以现在什么也没被留痕** ——
 *    这句话必须如实说，不能拿「返回了拒绝码」冒充「已经留下了痕迹」。
 */

import { ACTION_REGISTRY, type ActionRegistry } from '@/lib/kernel/registry'
import { MAPPING_TABLE, type CandidateMappingEntry } from './mapping-table'
import type {
  CandidateIdentity,
  CandidateMappingResult,
  GovernedActionVocabularyEntry,
} from './types'

export type {
  CandidateIdentity,
  CandidateMappingRejectionCode,
  CandidateMappingResult,
  GovernedActionVocabularyEntry,
} from './types'
export { MAPPING_TABLE } from './mapping-table'
export type { CandidateMappingEntry } from './mapping-table'

/**
 * 词汇表跟注册表对不上时抛这个。
 *
 * 🔴 **不静默过滤、不返回残缺词汇表。** 悄悄跳过一条对不上的配对，
 *    生成端拿到的就是一份少了东西的清单，而没有任何人会发现少了什么。
 *    这是配置错误，必须当场炸，且说清是哪一条。
 */
export class GovernedVocabularyConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GovernedVocabularyConfigurationError'
  }
}

/** 非空、且去掉首尾空白之后仍然有内容的字符串。 */
function isMeaningfulString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 读一个**自有的、可枚举的、数据**属性。不满足就返回 `undefined`。
 *
 * 🔴 为什么不能直接 `record.domain`：
 *    · **getter 会被执行** —— 一个恶意（或只是写坏了的）getter 能在这里抛异常，
 *      把「返回结构化拒绝」变成「炸给调用方」；
 *    · **原型链上的字段会被读到** —— `Object.create({domain:'geo'})` 看起来
 *      有 domain，但那不是这个对象自己的东西，不该被当成候选身份。
 *    所以先拿属性描述符，确认它是自有 + 可枚举 + 数据属性（有 `value`，
 *    不是 get/set），再取值。**全程不触发任何 getter。**
 */
function ownDataProperty(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (!descriptor) return undefined
  if (!descriptor.enumerable) return undefined
  // 访问器属性（get / set）一律不接受 —— 判据是「有没有 value 这个槽」，
  // 而不是「value 是不是 undefined」，后者分不清「没声明」和「声明成 undefined」。
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return undefined
  return descriptor.value
}

/**
 * 把**任意**输入安全地读成候选身份，读不成返回 null。
 *
 * 🔴 入参是 `unknown` 而不是 `CandidateIdentity`：调用方可能是别的模块、
 *    将来可能是一段 AI 产出反序列化来的东西。**不能靠调用方提前满足类型** ——
 *    TypeScript 的类型在运行时不存在，`null` / 数组 / 缺字段 / 数字
 *    全都能穿过一个声明成 `CandidateIdentity` 的形参。
 */
function readIdentity(input: unknown): CandidateIdentity | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null

  // 🔴 **恰好两个自有键，不多不少。**
  //    多带的字段一律拒绝，而不是「只取我要的两个、其余忽略」 ——
  //    忽略等于默许调用方往身份对象里夹带东西（`authorised: true` 之类），
  //    而那些字段今天不生效、明天被谁读一下就生效了。
  //    用 `Reflect.ownKeys` 才看得见 symbol 键；`Object.keys` 看不见。
  const keys = Reflect.ownKeys(input)
  if (keys.length !== 2) return null
  if (!keys.includes('domain') || !keys.includes('intent')) return null

  const domain = ownDataProperty(input, 'domain')
  const intent = ownDataProperty(input, 'intent')
  if (!isMeaningfulString(domain)) return null
  if (!isMeaningfulString(intent)) return null
  return { domain, intent }
}

/**
 * 配对表自身的结构问题；没问题返回 `null`。
 *
 * 🔴 **重复配对必须 fail closed，哪怕两条指向同一个 ActionKey。**
 *    `.find()` 会静默取第一条 —— 那等于让**数组顺序**决定一个候选映射到哪个动作。
 *    今天两条恰好一样，明天有人改了其中一条，行为就在没有任何提示的情况下变了。
 *    "受治理"的意思是歧义要当场报出来，不是挑一条继续走。
 *
 * 🔴 表项本身畸形（空 domain / 非字符串）也算 —— 表是坏的时候，
 *    对任何候选回答"没有配对"都是在假装自己知道答案。
 */
function mappingTableProblem(table: readonly CandidateMappingEntry[]): string | null {
  const seen: string[][] = []
  for (const entry of table) {
    if (!isMeaningfulString(entry?.domain) || !isMeaningfulString(entry?.intent)) {
      return '配对表里有一条 domain / intent 不是非空字符串的记录'
    }
    if (!isMeaningfulString(entry?.actionKey)) {
      return `配对表里「${entry.domain}」/「${entry.intent}」这条没有有效的 actionKey`
    }
    if (
      entry.submissionBoundary !== undefined &&
      entry.submissionBoundary !== 'generic_page_optimization' &&
      entry.submissionBoundary !== 'wordpress_reference_loop' &&
      entry.submissionBoundary !== 'cts_github_reference_loop'
    ) {
      return `配对表里「${entry.domain}」/「${entry.intent}」这条有非法 submissionBoundary`
    }
    // 逐项比对，跟 map() 用同一个判据 —— 不拼字符串，所以不会有分隔符碰撞
    if (seen.some(([d, i]) => d === entry.domain && i === entry.intent)) {
      return `配对表里「${entry.domain}」/「${entry.intent}」出现了不止一次 —— 歧义配对，不靠数组顺序决定`
    }
    seen.push([entry.domain, entry.intent])
  }
  return null
}

export interface CandidateMapperDeps {
  readonly registry: ActionRegistry
  readonly table: readonly CandidateMappingEntry[]
}

export interface CandidateMapper {
  /** 候选身份 → ActionKey。映射不上返回结构化拒绝，**不抛异常**。 */
  map(candidateIdentity: unknown): CandidateMappingResult
  /** 受治理的动作词汇表。配置漂移时**抛** `GovernedVocabularyConfigurationError`。 */
  listVocabulary(): readonly GovernedActionVocabularyEntry[]
}

/**
 * 工厂而不是模块级常量 —— 跟 `createCapabilities` / `createKernelDeps` 同一个理由：
 * 注册表和映射表都要能被注入，否则「注册表漂移」这条路根本测不出来。
 */
export function createCandidateMapper(deps: CandidateMapperDeps): CandidateMapper {
  const { registry, table } = deps

  return {
    map(candidateIdentity: unknown): CandidateMappingResult {
      const identity = readIdentity(candidateIdentity)
      if (!identity) {
        return {
          outcome: 'rejected',
          code: 'malformed_identity',
          reason:
            '候选身份不成立：需要 domain 和 intent 两个自有的、非空的字符串字段' +
            '（不接受 getter、不接受原型链上继承来的、去掉空白之后也要有内容）',
        }
      }

      // 🔴 表坏了就别回答 —— 对一个坏掉的配对表说「没有配对」是在假装知道答案。
      const tableProblem = mappingTableProblem(table)
      if (tableProblem) {
        return { outcome: 'rejected', code: 'registry_drift', reason: tableProblem }
      }

      // 🔴 两个字段各自精确相等。不拼接、不推断、不规范化、不模糊匹配。
      const entry = table.find(
        (candidate) => candidate.domain === identity.domain && candidate.intent === identity.intent,
      )
      if (!entry) {
        return {
          outcome: 'rejected',
          code: 'unmapped_identity',
          reason:
            `没有受治理的动作认领「${identity.domain}」/「${identity.intent}」这个候选身份 —— ` +
            '要么这条建议本身提错了，要么该走治理给它配一个动作（改代码、过 PR）',
        }
      }

      const definition = registry.get(entry.actionKey)
      if (!definition) {
        return {
          outcome: 'rejected',
          code: 'registry_drift',
          reason:
            `配对表把「${identity.domain}」/「${identity.intent}」指向了「${entry.actionKey}」，` +
            '但注册表里没有这个动作 —— 这是配置漂移，先把两边对齐',
        }
      }

      return {
        outcome: 'mapped',
        actionKey: entry.actionKey,
        actionVersion: definition.version,
        ...(entry.submissionBoundary
          ? { submissionBoundary: entry.submissionBoundary }
          : {}),
      }
    },

    listVocabulary(): readonly GovernedActionVocabularyEntry[] {
      // 🔴 歧义 / 畸形的配对表不许产出词汇表。生成端拿到一份「看起来正常」
      //    但其实有两条抢同一个身份的清单，比拿不到更糟。
      const tableProblem = mappingTableProblem(table)
      if (tableProblem) {
        throw new GovernedVocabularyConfigurationError(tableProblem)
      }
      return table.map((entry) => {
        const definition = registry.get(entry.actionKey)
        if (!definition) {
          throw new GovernedVocabularyConfigurationError(
            `配对表里的「${entry.domain}」/「${entry.intent}」指向「${entry.actionKey}」，` +
              '但注册表里没有这个动作 —— 不返回一份残缺的词汇表，先把配置修对',
          )
        }
        return {
          domain: entry.domain,
          intent: entry.intent,
          actionKey: entry.actionKey,
          title: definition.title,
          sideEffect: definition.sideEffect,
        }
      })
    },
  }
}

/** 接真实注册表与真实（当前为空的）配对表的默认实例。 */
export const candidateMapper: CandidateMapper = createCandidateMapper({
  registry: ACTION_REGISTRY,
  table: MAPPING_TABLE,
})

export function mapCandidateIdentity(candidateIdentity: unknown): CandidateMappingResult {
  return candidateMapper.map(candidateIdentity)
}

/**
 * 生成端唯一的动作词汇表来源。
 *
 * 🔴 将来的 ME2 域模块（WP05 起）**必须**消费这个 API，不许自己发明动作名。
 *    当前返回 `[]`（配对表是空的），且**没有任何生产调用方** ——
 *    legacy 的 `zhuge/conductor.ts` 不在此列，本 Work Package 不碰它。
 */
export function listGovernedActionVocabulary(): readonly GovernedActionVocabularyEntry[] {
  return candidateMapper.listVocabulary()
}
