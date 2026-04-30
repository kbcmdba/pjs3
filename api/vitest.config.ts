import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    setupFiles: ['./tests/setup-env.ts'],
    // Per-test DB lifecycle dominates DB-touching test runtime: CREATE +
    // migrate-7-tables-with-FKs + seed + harness tables + DROP. The
    // migrate step alone is ~28s as of the auth-tables schema landing
    // because drizzle-kit's migrator runs each statement-breakpoint
    // separately and the round-trip-times to mysql2.hole multiply. Bumped
    // to 60s for headroom. Real fix is the template-DB-cloning future
    // optimization named in ADR 0001 -- migrate once per worker, clone
    // per test -- which would cut per-test setup from ~30s to ~1s.
    // Tracked as future work; not blocking schema progress.
    testTimeout: 60000,
  },
});
