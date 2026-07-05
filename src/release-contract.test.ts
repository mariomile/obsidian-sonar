import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Manifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
}

const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as Manifest;
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };
const versions = JSON.parse(
  readFileSync(new URL('../versions.json', import.meta.url), 'utf8'),
) as Record<string, string>;

describe('release metadata', () => {
  it('is synchronized across manifest, package.json and versions.json', () => {
    expect(manifest.id).toBe('sonar');
    expect(manifest.name).toBe('Sonar');
    expect(packageJson.version).toBe(manifest.version);
    // versions.json is a single-entry map: current version → minAppVersion.
    expect(versions).toEqual({ [manifest.version]: manifest.minAppVersion });
  });
});
