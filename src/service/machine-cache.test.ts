import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  machineCacheDir,
  readCacheBinary,
  readCacheText,
  vaultCacheKey,
  writeCacheFile,
} from './machine-cache.ts';

describe('machineCacheDir', () => {
  it('uses ~/Library/Caches on macOS', () => {
    expect(machineCacheDir('darwin', {}, '/Users/m', 'abc')).toBe('/Users/m/Library/Caches/sonar/abc');
  });

  it('uses $XDG_CACHE_HOME on Linux, falling back to ~/.cache', () => {
    expect(machineCacheDir('linux', { XDG_CACHE_HOME: '/x/cache' }, '/home/m', 'abc')).toBe('/x/cache/sonar/abc');
    expect(machineCacheDir('linux', {}, '/home/m', 'abc')).toBe('/home/m/.cache/sonar/abc');
    expect(machineCacheDir('linux', { XDG_CACHE_HOME: '' }, '/home/m', 'abc')).toBe('/home/m/.cache/sonar/abc');
  });

  it('uses %LOCALAPPDATA% on Windows, falling back to AppData\\Local', () => {
    expect(machineCacheDir('win32', { LOCALAPPDATA: 'C:\\Users\\m\\AppData\\Local' }, 'C:\\Users\\m', 'abc')).toBe(
      'C:\\Users\\m\\AppData\\Local\\sonar\\abc',
    );
    expect(machineCacheDir('win32', {}, 'C:\\Users\\m', 'abc')).toBe('C:\\Users\\m\\AppData\\Local\\sonar\\abc');
  });

  it('never resolves inside the vault', () => {
    const vault = '/Users/m/Vaults/notes';
    const dir = machineCacheDir('darwin', {}, '/Users/m', vaultCacheKey(vault));
    expect(dir.startsWith(vault)).toBe(false);
  });
});

describe('vaultCacheKey', () => {
  it('is stable for the same vault and distinct across vaults', () => {
    const a = vaultCacheKey('/Users/m/Vaults/a');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(vaultCacheKey('/Users/m/Vaults/a')).toBe(a);
    expect(vaultCacheKey('/Users/m/Vaults/b')).not.toBe(a);
  });
});

describe('cache file I/O', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('reads null before the first write, then round-trips', async () => {
    root = mkdtempSync(join(tmpdir(), 'sonar-cache-'));
    const dir = `${root}/sonar/key`; // does not exist yet: the write creates it
    expect(await readCacheBinary(`${dir}/index.bin`)).toBeNull();
    expect(await readCacheText(`${dir}/attachments.json`)).toBeNull();

    await writeCacheFile(`${dir}/index.bin`, new Uint8Array([1, 2, 3]));
    await writeCacheFile(`${dir}/attachments.json`, '{"a.pdf":"text"}');
    expect([...(await readCacheBinary(`${dir}/index.bin`))!]).toEqual([1, 2, 3]);
    expect(await readCacheText(`${dir}/attachments.json`)).toBe('{"a.pdf":"text"}');
  });
});

describe('mobile safety', () => {
  it('loads Node modules lazily, never via a static import', () => {
    // A top-level node: import becomes a load-time require in the bundle and
    // would crash plugin load on mobile, where no Node runtime exists.
    const src = readFileSync(new URL('./machine-cache.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import .* from ['"](node:)?(fs|os|crypto|path)['"]/m);
  });
});
