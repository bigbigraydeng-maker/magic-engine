/**
 * Read-only trial: crawl one client's product pages and print the structured facts. Writes nothing.
 * Usage: CLIENT_PRODUCT_FACT_SOURCES='{"<client-id>":{"origin":"https://…","product_path_prefixes":["/tours/…/"]}}' \
 *        npx tsx scripts/product-facts-dry-run.ts <client-id> [maxProducts]
 */
import { collectProductFacts, loadFactSource } from '../src/lib/product-facts/collect'

async function main(): Promise<void> {
  const [clientId, max] = process.argv.slice(2)
  const source = clientId ? loadFactSource(clientId) : null
  if (!source) throw new Error('source_not_configured: set CLIENT_PRODUCT_FACT_SOURCES and pass the client id')
  const facts = await collectProductFacts(source, { maxProducts: max ? Number(max) : undefined })
  console.log(JSON.stringify({ fetched_at: new Date().toISOString(), facts }, null, 2))
}
void main()
