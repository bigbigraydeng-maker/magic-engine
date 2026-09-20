import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { MetaPrincipal } from './store'
import { toolNames,schemas,descriptions,outputSchema } from './contract'
import { invokeMetaTool } from './read'
import { MetaReadError } from '../graph-read'
export function registerMetaAdsTools(server: McpServer, principal: MetaPrincipal) {
  for (const name of toolNames) {
    server.registerTool(name,{ description:descriptions[name],inputSchema:schemas[name],outputSchema,
      annotations:{ readOnlyHint:true,destructiveHint:false,openWorldHint:true } }, async (args: unknown) => {
      try {
        const result = await invokeMetaTool(principal,name,args)
        return { structuredContent:result,content:[{ type:'text' as const,text:JSON.stringify(result) }] }
      } catch (error) {
        return { isError:true,content:[{ type:'text' as const,text:JSON.stringify({ error:error instanceof MetaReadError ? error.code : 'request_failed' }) }] }
      }
    })
  }
}
