/**
 * Minimal, dependency-free path glob matching for scope enforcement.
 *
 * Deliberately small: `**`, `*` and `?` only. Anything the policy layer cannot
 * express here should be written as an explicit path, not as a cleverer pattern.
 */

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g

function escapeLiteral(char: string): string {
  return char.replace(REGEX_SPECIALS, '\\$&')
}

function globToRegExp(pattern: string): RegExp {
  let source = '^'
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` matches zero or more leading directories; bare `**` matches the rest.
        if (pattern[i + 2] === '/') {
          source += '(?:.*/)?'
          i += 3
          continue
        }
        source += '.*'
        i += 2
        continue
      }
      source += '[^/]*'
      i += 1
      continue
    }

    if (char === '?') {
      source += '[^/]'
      i += 1
      continue
    }

    source += escapeLiteral(char)
    i += 1
  }

  return new RegExp(`${source}$`)
}

/** Strips `./` and leading slashes so `src/a.ts` and `./src/a.ts` compare equal. */
export function normalizePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\/+/, '')
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(normalizePath(pattern)).test(normalizePath(path))
}

export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern))
}

/** Returns the subset of `paths` that match at least one pattern. */
export function selectMatching(
  paths: readonly string[],
  patterns: readonly string[]
): readonly string[] {
  return paths.filter((path) => matchesAnyGlob(path, patterns))
}

/** Returns the subset of `paths` that match none of the patterns. */
export function selectNotMatching(
  paths: readonly string[],
  patterns: readonly string[]
): readonly string[] {
  return paths.filter((path) => !matchesAnyGlob(path, patterns))
}

/**
 * Wildcard match for values that are not paths — tool names such as
 * `Bash(npm test)` or `mcp__github__*`. Here `/` carries no special meaning, so
 * a single `*` spans everything.
 */
export function matchesWildcard(value: string, pattern: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(REGEX_SPECIALS, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`).test(value)
}

export function matchesAnyWildcard(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesWildcard(value, pattern))
}
