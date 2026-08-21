import {
  getExistingWordpressPost,
  probeWordpressAtomicPageApply,
  updateExistingWordpressPostIfUnmodified,
  type ExistingWordpressPost,
  type AtomicUpdateExistingWordpressPostResult,
  type AtomicExpectedWordpressMeta,
  type UpdateExistingWordpressPostInput,
  type WordpressClientConfig,
  type WordpressPostType,
} from '@/lib/cms/wordpress-client'
import { getWordpressConnection } from '@/lib/cms/connection-store'
import {
  verifyConfiguredReferenceLoopAuthorizationProof,
} from '@/lib/reference-loop-authorization-proof'
import type { GrowthJsonValue } from '@/lib/growth'

export interface WordpressConnectionResolution {
  readonly config: WordpressClientConfig
  readonly status: 'connected' | 'disconnected' | 'error'
  readonly yoastPluginInstalled: boolean
}

export interface PageApplyWordpressDeps {
  readonly resolveConnection: (clientId: string) => Promise<WordpressConnectionResolution | null>
  readonly readPost: (
    config: WordpressClientConfig,
    postId: number,
    postType: WordpressPostType,
  ) => Promise<ExistingWordpressPost>
  readonly updatePost: (
    config: WordpressClientConfig,
    input: UpdateExistingWordpressPostInput,
    expectedModified: string,
    expectedMeta: AtomicExpectedWordpressMeta,
  ) => Promise<AtomicUpdateExistingWordpressPostResult>
  readonly supportsAtomicApply: (config: WordpressClientConfig) => Promise<boolean>
  readonly verifyAuthorizationProof: (payload: GrowthJsonValue, proof: unknown) => boolean
}

export function defaultWordpressDeps(): PageApplyWordpressDeps {
  return {
    resolveConnection: async (clientId) => {
      const connection = await getWordpressConnection(clientId)
      if (!connection) return null
      return {
        config: {
          siteUrl: connection.siteUrl,
          username: connection.username,
          appPassword: connection.plainAppPassword,
        },
        status: connection.status,
        yoastPluginInstalled: connection.yoastPluginInstalled,
      }
    },
    readPost: getExistingWordpressPost,
    updatePost: updateExistingWordpressPostIfUnmodified,
    supportsAtomicApply: probeWordpressAtomicPageApply,
    verifyAuthorizationProof: verifyConfiguredReferenceLoopAuthorizationProof,
  }
}
