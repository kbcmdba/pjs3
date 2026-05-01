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
    // Cap parallel test-file execution. Default = one fork per CPU core,
    // which causes mysql2.hole contention once the DB-touching test count
    // grows: too many concurrent DB CREATE + migrate cycles overwhelm the
    // server, individual migrations slow down, tests breach testTimeout.
    // Caught when adding the 7-test login suite (PR #36) tipped a
    // previously-green suite into 11 / 69 timeout failures. Capping at 2
    // forks restores reliability with acceptable wall-clock cost. Real fix
    // is still template-DB cloning per ADR 0001 (now actually blocking,
    // not just an optimization).
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
      },
    },
  },
});
