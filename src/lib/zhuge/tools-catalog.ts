/**
 * 鲁班 tool catalog — static list of actions currently auto-executable by Luban.
 *
 * 诸葛亮 uses this list to decide whether an action can be executed in-house
 * (executable_by set to a tool name) or requires FDE / external handling (null).
 *
 * Keep in sync with actual Magic Engine capabilities. Add a tool here only when
 * the corresponding API route and UI flow are production-ready.
 *
 * Reference: ROADMAP.md Phase 12.G (P12.G.2)
 */

import type { LubanTool } from './types'

export const LUBAN_TOOL_CATALOG: LubanTool[] = [
  {
    name: 'luban.generate_blog_post',
    description: 'Generate an SEO + GEO dual-signal blog post targeting a specific keyword',
    flywheel: 'seo',
    execution_mode: 'in_house',
  },
  {
    name: 'luban.generate_geo_directive',
    description: 'Generate a GEO directive block optimised for AI search visibility',
    flywheel: 'geo',
    execution_mode: 'in_house',
  },
  {
    name: 'luban.publish_geo_snippet',
    description: 'Publish an approved GEO snippet to the client site embed code',
    flywheel: 'geo',
    execution_mode: 'in_house',
  },
  {
    name: 'luban.generate_social_campaign',
    description: 'Generate a full social media campaign with multiple posts from a brief',
    flywheel: 'social',
    execution_mode: 'in_house',
  },
  {
    name: 'luban.generate_social_post',
    description: 'Generate a single social media post for a specific platform',
    flywheel: 'social',
    execution_mode: 'in_house',
  },
]
