/**
 * Build-version skew between this frontend bundle and the gateway it talks to.
 * Both tiers are stamped with the same git SHA at build time (VITE_GIT_SHA for
 * the SPA, GIT_SHA on the gateway image), so "same version" is SHA equality.
 */
export type VersionSkew = 'match' | 'mismatch' | 'unknown'

/** Sentinel both tiers use when no SHA was injected (local/dev builds). */
const DEV_SENTINEL = 'dev'

/** The SHA baked into this loaded bundle. */
export function frontendSha(): string {
  return (import.meta.env['VITE_GIT_SHA'] as string | undefined) ?? DEV_SENTINEL
}

/**
 * Compare frontend and backend SHAs. Returns 'unknown' when either side lacks a
 * real SHA (dev build, fetch not yet resolved/failed) so callers never report a
 * spurious mismatch for a non-deployed build.
 */
export function compareSha(
  frontend: string,
  backend: string | undefined,
): VersionSkew {
  if (!backend || backend === DEV_SENTINEL || frontend === DEV_SENTINEL) {
    return 'unknown'
  }
  return frontend === backend ? 'match' : 'mismatch'
}

/** First 7 chars for display; passes through the dev sentinel unchanged. */
export function shortSha(sha: string): string {
  return sha === DEV_SENTINEL ? sha : sha.slice(0, 7)
}
