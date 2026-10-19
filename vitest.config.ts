import { defineConfig } from 'vitest/config';

// Workspace packages export their TypeScript source under the "@courmap/source"
// condition, so tests run against src/ without a build step.
export default defineConfig({
  resolve: { conditions: ['@courmap/source'] },
  ssr: { resolve: { conditions: ['@courmap/source'] } },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'worker/test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
