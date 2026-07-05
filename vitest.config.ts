import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // Colocated tests next to the modules they cover (masonry/horizon style).
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The `src/index/**` modules are pure and must NOT import `obsidian` at
    // runtime. This alias is a safety net: if a transitive import ever sneaks
    // one in, tests resolve to a tiny stub instead of failing to load.
    alias: {
      obsidian: resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
    },
  },
});
