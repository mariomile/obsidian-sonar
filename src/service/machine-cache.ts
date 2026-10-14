/**
 * Machine-local home for Sonar's rebuildable caches (index.bin,
 * attachments.json). They live in the OS cache directory, not in the vault's
 * plugin folder, so ~100 MB of derived data never rides Sync/iCloud to other
 * devices. Desktop only: every Node module is loaded lazily, and callers reach
 * this file's I/O only behind `Platform.isDesktopApp`.
 */

interface CryptoModule {
  createHash(algorithm: string): { update(value: string): { digest(encoding: 'hex'): string } };
}

interface FsPromises {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
}

/** Per-OS cache root + `sonar/<vaultKey>`: ~/Library/Caches on macOS,
 *  %LOCALAPPDATA% on Windows, $XDG_CACHE_HOME (or ~/.cache) elsewhere. */
export function machineCacheDir(
  platform: string,
  env: Record<string, string | undefined>,
  home: string,
  vaultKey: string,
): string {
  if (platform === 'win32') return `${env.LOCALAPPDATA || `${home}\\AppData\\Local`}\\sonar\\${vaultKey}`;
  const root = platform === 'darwin' ? `${home}/Library/Caches` : env.XDG_CACHE_HOME || `${home}/.cache`;
  return `${root}/sonar/${vaultKey}`;
}

/** Stable per-vault key: two vaults never share a cache, the same vault
 *  always finds its own. Moving the vault just means one rebuild. */
export function vaultCacheKey(vaultBasePath: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, desktop-only load; a static import would break plugin load on mobile
  const crypto = require('node:crypto') as CryptoModule;
  return crypto.createHash('sha256').update(vaultBasePath).digest('hex').slice(0, 16);
}

/** The cache directory for the vault at `vaultBasePath` on this machine. */
export function desktopCacheDir(vaultBasePath: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, desktop-only load; a static import would break plugin load on mobile
  const os = require('node:os') as { homedir(): string };
  return machineCacheDir(process.platform, process.env, os.homedir(), vaultCacheKey(vaultBasePath));
}

function fs(): FsPromises {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, desktop-only load; a static import would break plugin load on mobile
  return (require('node:fs') as { promises: FsPromises }).promises;
}

function isMissing(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'ENOENT';
}

/** File bytes, or null when the cache file doesn't exist yet. */
export async function readCacheBinary(path: string): Promise<Uint8Array | null> {
  try {
    return await fs().readFile(path);
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

/** File text, or null when the cache file doesn't exist yet. */
export async function readCacheText(path: string): Promise<string | null> {
  try {
    return await fs().readFile(path, 'utf8');
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

/** Write a cache file (`<cacheDir>/<name>`), creating its directory on first use. */
export async function writeCacheFile(path: string, data: string | Uint8Array): Promise<void> {
  await fs().mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await fs().writeFile(path, data);
}
