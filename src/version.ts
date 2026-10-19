export type Version = [major: number, minor: number, patch: number];

/**
 * Reads the leading numeric part of a version as Docker reports it, such as `29.1.3`, `v2.39.1` or `5.1.0-desktop.1`.
 * Missing minor and patch numbers count as 0.
 */
export function parseVersion(value: string): Version | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export function isAtLeast(version: Version, minimum: Version): boolean {
  for (let i = 0; i < version.length; i++) {
    if (version[i] !== minimum[i]) {
      return version[i] > minimum[i];
    }
  }
  return true;
}
