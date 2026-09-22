// 每条视频"结尾信息/固定文案"该填什么值——纯函数，零 LLM、零 DB(spec 见
// docs/PITFALLS.md §D5 事故记录 + 2026-09-13 子牙+魏征设计复审)。
//
// 这几个字段(团名/路线/价格/出发日期)是纯粹的真实事实，不是需要组织语言的创作，
// 交给 LLM 写只会引入两种风险：①幻觉出一个"读起来像那么回事"但其实编的值填满
// 非空校验；②即使事实源对了，也可能"转述/加工"出一个多余的限定词(如把
// "From NZD $3,480" 悄悄改写成"仅限本周 3480 起")。这里改成确定性字段名映射，
// 同样的输入永远产出同样的输出，Inngest 步骤重试多少次都不会漂移。
export function resolvePostFields(params: {
  requiredPostFields: string[]
  postFieldSources: Record<string, string> | undefined
  offerFacts: Record<string, string>
}): Record<string, string> {
  const { requiredPostFields, postFieldSources, offerFacts } = params
  if (requiredPostFields.length === 0) return {}

  const out: Record<string, string> = {}
  const missing: string[] = []
  for (const field of requiredPostFields) {
    const factKey = postFieldSources?.[field]
    const value = factKey ? offerFacts[factKey] : undefined
    if (!value?.trim()) {
      missing.push(factKey ? `${field}(取自事实字典的 ${factKey})` : `${field}(模板契约里没配 postFieldSources 映射)`)
      continue
    }
    out[field] = value
  }
  if (missing.length > 0) {
    throw new Error(`无法确定这几个字段该填什么真实数字，缺：${missing.join('、')}`)
  }
  return out
}

/**
 * 从模板契约声明的多档事实字典里，挑出这条视频该用哪一份——fail-closed：选不准
 * 就抛错拦渲染，绝不猜一份顶上(魏征复审①：猜错比模板写死的占位文字更危险，
 * 因为看起来像"这条视频专属核实过的数字"，其实可能是另一个团的价格)。
 */
export function resolveOfferFacts(params: {
  offers: Record<string, Record<string, string>> | undefined
  offerKey: string | null
}): Record<string, string> {
  const { offers, offerKey } = params
  const keys = Object.keys(offers ?? {})

  if (offerKey) {
    const facts = offers?.[offerKey]
    if (!facts) {
      throw new Error(`这条视频指定的团/档位「${offerKey}」在模板配置的事实字典里找不到，配置的档位有：${keys.join('、') || '(空)'}`)
    }
    return facts
  }

  if (keys.length === 1) return offers![keys[0]]

  throw new Error(
    keys.length === 0
      ? '模板要求填真实事实字段，但客户配置里一个团/档位的事实字典都没配（factory_config.render.creatomate.offers）'
      : `这条视频没有指定用哪个团/档位（content_posts.generation_context_snapshot.offer_key），客户配置里有 ${keys.length} 个档位（${keys.join('、')}），无法自动猜一个，必须明确指定`,
  )
}
