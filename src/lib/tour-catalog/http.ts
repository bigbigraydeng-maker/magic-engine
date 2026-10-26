/**
 * The implementations now live in `@/lib/http/request-helpers`. This file stays as the catalog
 * routes' entry point and re-exports the shared helpers unchanged.
 */

export {
  MAX_EDIT_BODY_BYTES,
  isUuid,
  invalidIdResponse,
  readJsonBody,
  asPlainObject,
} from '@/lib/http/request-helpers'

export type { JsonBodyResult } from '@/lib/http/request-helpers'
