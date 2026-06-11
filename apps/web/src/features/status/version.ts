export type VersionSkew = 'match' | 'mismatch' | 'unknown'

const DEV_SENTINEL = 'dev'

export function frontendSha(): string {
  return (import.meta.env['VITE_GIT_SHA'] as string | undefined) ?? DEV_SENTINEL
}

export function compareSha(
  frontend: string,
  backend: string | undefined,
): VersionSkew {
  if (!backend || backend === DEV_SENTINEL || frontend === DEV_SENTINEL) {
    return 'unknown'
  }
  return frontend === backend ? 'match' : 'mismatch'
}

export function shortSha(sha: string): string {
  return sha === DEV_SENTINEL ? sha : sha.slice(0, 7)
}
