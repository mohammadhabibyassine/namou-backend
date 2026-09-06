import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
    // These suites share one PostgreSQL database, so file-level serialization
    // keeps setup and cleanup deterministic.
    fileParallelism: false,
  },
});
