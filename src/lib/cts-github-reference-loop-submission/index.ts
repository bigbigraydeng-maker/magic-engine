/**
 * Legacy type-only boundary.
 *
 * Runtime CTS admission, proof signing and Kernel submission are intentionally
 * private to `cts-github-reference-loop-trigger`. Keeping this module
 * runtime-empty prevents callers from bypassing the authoritative GSC,
 * redline and tenant-source loaders.
 */
export type {
  CtsGithubReferenceLoopSubmissionDeps,
  SubmitCtsGithubReferenceLoopInput,
  SubmitCtsGithubReferenceLoopResult,
} from './types'
