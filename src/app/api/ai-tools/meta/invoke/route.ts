import { z } from 'zod'
import { apiPrincipal,json,failure,boundedBody } from '@/lib/meta/ai/http'
import { toolNames } from '@/lib/meta/ai/contract'
import { invokeMetaTool } from '@/lib/meta/ai/read'
import { MetaReadError } from '@/lib/meta/graph-read'
const requestSchema = z.object({ tool:z.enum(toolNames),arguments:z.record(z.string(),z.unknown()) }).strict()
export async function POST(request: Request) {
  try {
    const principal = await apiPrincipal(request)
    const parsed = requestSchema.safeParse(await boundedBody(request))
    if (!parsed.success) throw new MetaReadError('invalid_arguments')
    return json(await invokeMetaTool(principal,parsed.data.tool,parsed.data.arguments))
  } catch (error) { return failure(error) }
}
export const dynamic = 'force-dynamic'
export const maxDuration = 60
