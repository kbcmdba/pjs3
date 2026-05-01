import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    setupFiles: ['./tests/setup-env.ts'],
    // Build the template DB once before any worker spawns. Workers clone
    // from this template via `withTestDb()` instead of running drizzle-kit's
    // migrator on every test. See `tests/globalSetup.ts` for the full
    // mechanism. ADR 0001 names this optimization; it landed in PR #38 to
    // unblock auth-flow PRs whose tests were eroding suite-runtime margin.
    globalSetup: ['./tests/globalSetup.ts'],
    testTimeout: 60000,
  },
});
