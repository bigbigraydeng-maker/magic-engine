/** Tool registry assembly — P0 tools (spec §10.1). */
import { ToolRegistry } from './registry'
import {
  createOrUpdateLeadTool,
  endCallTool,
  getContactProfileTool,
  scheduleCallbackTool,
  searchKnowledgeBaseTool,
  transferToHumanTool,
} from './impl'

export * from './registry'
export { resolveTransferUri } from './impl'

export const P0_TOOLS = [
  searchKnowledgeBaseTool,
  getContactProfileTool,
  createOrUpdateLeadTool,
  transferToHumanTool,
  endCallTool,
  scheduleCallbackTool,
] as const

let registrySingleton: ToolRegistry | null = null

export function getToolRegistry(): ToolRegistry {
  if (!registrySingleton) {
    registrySingleton = new ToolRegistry()
    for (const t of P0_TOOLS) registrySingleton.register(t)
  }
  return registrySingleton
}
