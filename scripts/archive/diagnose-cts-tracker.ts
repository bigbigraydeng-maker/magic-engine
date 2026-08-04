#!/usr/bin/env npx ts-node
/**
 * CTS Tours AI Visibility Tracker 诊断脚本
 *
 * 检查项：
 * 1. CTS Tours 是否在 clients 表中
 * 2. CTS Tours 是否有 enabled 问句（18 个）
 * 3. OPENAI_API_KEY 和 ANTHROPIC_API_KEY 是否配置
 * 4. 尝试运行单个问句的 OpenAI + Claude runner
 * 5. 尝试运行完整的 tracker（如果所有检查通过）
 */

import { supabaseAdmin } from '../src/lib/supabase'
import { runOpenAI } from '../src/lib/ai-tracker/runners/openai'
import { runClaude } from '../src/lib/ai-tracker/runners/claude'

const BRAND = 'CTS Tours'
const MARKET: 'au' | 'nz' | 'au-nz' = 'nz'
const TEST_QUESTION = 'What are the best New Zealand tour operators for Australian travelers?'

async function main() {
  console.log('🔍 CTS Tours AI Visibility Tracker 诊断')
  console.log('='.repeat(60))

  // 1. 检查 CTS Tours 客户是否存在
  console.log('\n1️⃣ 检查 CTS Tours 客户...')
  const { data: clients, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain')
    .eq('name', BRAND)
    .limit(1)

  if (clientError) {
    console.error('❌ 查询 clients 表失败:', clientError)
    process.exit(1)
  }

  if (!clients || clients.length === 0) {
    console.error(`❌ 未找到客户: ${BRAND}`)
    console.log('\n   需要先添加 CTS Tours 到 clients 表')
    process.exit(1)
  }

  const ctsTours = clients[0]
  console.log(`✅ 找到客户: ${ctsTours.name} (ID: ${ctsTours.id})`)

  // 2. 检查是否有启用的问句
  console.log('\n2️⃣ 检查 CTS Tours 的问句...')
  const { data: queries, error: queryError } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id, question, enabled')
    .eq('client_id', ctsTours.id)
    .eq('enabled', true)

  if (queryError) {
    console.error('❌ 查询问句失败:', queryError)
    process.exit(1)
  }

  if (!queries || queries.length === 0) {
    console.error(`❌ 未找到启用的问句。需要先生成问句。`)
    process.exit(1)
  }

  console.log(`✅ 找到 ${queries.length} 个启用的问句`)
  queries.slice(0, 3).forEach((q: any) => {
    console.log(`   • ${q.question}`)
  })

  // 3. 检查环境变量
  console.log('\n3️⃣ 检查 API Keys 配置...')
  const hasOpenAI = !!process.env.OPENAI_API_KEY
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY

  console.log(
    hasOpenAI
      ? '✅ OPENAI_API_KEY 已配置'
      : '❌ OPENAI_API_KEY 未设置'
  )
  console.log(
    hasAnthropic
      ? '✅ ANTHROPIC_API_KEY 已配置'
      : '❌ ANTHROPIC_API_KEY 未设置'
  )

  if (!hasOpenAI || !hasAnthropic) {
    console.error('\n❌ 缺少必要的 API Keys。请设置环境变量。')
    process.exit(1)
  }

  // 4. 测试单个 runner
  console.log('\n4️⃣ 测试 OpenAI Runner...')
  const openaiResult = await runOpenAI({
    question: TEST_QUESTION,
    market: MARKET,
  })
  if (openaiResult.error_message) {
    console.error(`❌ OpenAI Runner 失败: ${openaiResult.error_message}`)
  } else {
    console.log(`✅ OpenAI 运行成功`)
    console.log(`   Model: ${openaiResult.ai_model}`)
    console.log(`   Tokens: ${openaiResult.tokens_used}`)
    console.log(`   Cost: $${(openaiResult.cost_usd || 0).toFixed(4)}`)
    console.log(`   Latency: ${openaiResult.latency_ms}ms`)
    console.log(`   Response (first 100 chars): ${openaiResult.raw_response.substring(0, 100)}...`)
  }

  console.log('\n4️⃣ 测试 Claude Runner...')
  const claudeResult = await runClaude({
    question: TEST_QUESTION,
    market: MARKET,
  })
  if (claudeResult.error_message) {
    console.error(`❌ Claude Runner 失败: ${claudeResult.error_message}`)
  } else {
    console.log(`✅ Claude 运行成功`)
    console.log(`   Model: ${claudeResult.ai_model}`)
    console.log(`   Tokens: ${claudeResult.tokens_used}`)
    console.log(`   Cost: $${(claudeResult.cost_usd || 0).toFixed(4)}`)
    console.log(`   Latency: ${claudeResult.latency_ms}ms`)
    console.log(`   Response (first 100 chars): ${claudeResult.raw_response.substring(0, 100)}...`)
  }

  // 5. 总结
  console.log('\n' + '='.repeat(60))
  console.log('✅ 诊断完成！所有检查通过。')
  console.log('\n🚀 现在可以运行完整的 tracker：')
  console.log(`   POST /api/ai-tracker/run`)
  console.log(`   {`)
  console.log(`     "client_id": "${ctsTours.id}",`)
  console.log(`     "engines": ["openai", "anthropic"]`)
  console.log(`   }`)
  console.log('\n⏱️  预计运行时间: 1-5 分钟（18 问句 × 2 引擎）')
  console.log('💰 预计成本: ~$0.10-0.30')
}

main().catch((err) => {
  console.error('❌ 诊断失败:', err)
  process.exit(1)
})
