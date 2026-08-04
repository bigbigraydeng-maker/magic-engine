import { supabaseAdmin } from '../src/lib/supabase'

async function main() {
  const clientId = 'c0000000-0000-0000-0000-000000000000'

  // Count results by engine
  const { data: runs, error } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select('id, ai_engine, ai_model, error_message, latency_ms, tokens_used, cost_usd')
    .eq('client_id', clientId)

  if (error) {
    console.error('❌ Query error:', error)
    return
  }

  console.log(`\n📊 AI Visibility Tracker Diagnostic Results\n${'='.repeat(60)}`)

  if (!runs || runs.length === 0) {
    console.log('❌ No runs found in database')
    return
  }

  const openaiRuns = runs.filter(r => r.ai_engine === 'openai')
  const claudeRuns = runs.filter(r => r.ai_engine === 'anthropic')

  console.log(`\n✅ Total runs: ${runs.length}`)
  console.log(`   OpenAI runs: ${openaiRuns.length}`)
  console.log(`   Claude runs: ${claudeRuns.length}`)

  // OpenAI summary
  const openaiSuccess = openaiRuns.filter(r => !r.error_message)
  const openaiErrors = openaiRuns.filter(r => r.error_message)
  console.log(`\n   🟢 OpenAI Success: ${openaiSuccess.length}`)
  if (openaiSuccess.length > 0) {
    const avgLatency = Math.round(
      openaiSuccess.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / openaiSuccess.length
    )
    const totalTokens = openaiSuccess.reduce((sum, r) => sum + (r.tokens_used || 0), 0)
    const totalCost = openaiSuccess.reduce((sum, r) => sum + (r.cost_usd || 0), 0)
    console.log(`      Avg latency: ${avgLatency}ms`)
    console.log(`      Total tokens: ${totalTokens}`)
    console.log(`      Total cost: $${totalCost.toFixed(4)}`)
  }
  console.log(`   🔴 OpenAI Errors: ${openaiErrors.length}`)
  if (openaiErrors.length > 0 && openaiErrors[0].error_message) {
    console.log(`      Sample: ${openaiErrors[0].error_message.substring(0, 100)}...`)
  }

  // Claude summary
  const claudeSuccess = claudeRuns.filter(r => !r.error_message)
  const claudeErrors = claudeRuns.filter(r => r.error_message)
  console.log(`\n   🟢 Claude Success: ${claudeSuccess.length}`)
  if (claudeSuccess.length > 0) {
    const avgLatency = Math.round(
      claudeSuccess.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / claudeSuccess.length
    )
    const totalTokens = claudeSuccess.reduce((sum, r) => sum + (r.tokens_used || 0), 0)
    const totalCost = claudeSuccess.reduce((sum, r) => sum + (r.cost_usd || 0), 0)
    console.log(`      Avg latency: ${avgLatency}ms`)
    console.log(`      Total tokens: ${totalTokens}`)
    console.log(`      Total cost: $${totalCost.toFixed(4)}`)
  }
  console.log(`   🔴 Claude Errors: ${claudeErrors.length}`)
  if (claudeErrors.length > 0 && claudeErrors[0].error_message) {
    console.log(`      Sample: ${claudeErrors[0].error_message.substring(0, 100)}...`)
  }

  // Brand mentions sample
  console.log(`\n📍 Brand Mentions Sample:`)
  const sampleRun = openaiSuccess[0]
  if (sampleRun) {
    const { data: fullRun } = await supabaseAdmin
      .from('ai_visibility_runs')
      .select('brands_mentioned, client_brand_rank')
      .eq('id', sampleRun.id)
      .single()

    if (fullRun?.brands_mentioned) {
      console.log(`   OpenAI sample brands:`)
      const brands = fullRun.brands_mentioned as any[]
      brands.slice(0, 3).forEach(b => {
        console.log(`     - ${b.brand || b} (rank: ${b.rank})`)
      })
      console.log(`   CTS Tours rank: ${fullRun.client_brand_rank || 'Not mentioned'}`)
    }
  }

  console.log(`\n${'='.repeat(60)}`)
}

main().catch(console.error)
