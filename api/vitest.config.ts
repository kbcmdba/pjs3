import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    setupFiles: ['./tests/setup-env.ts'],
    // Per-test DB lifecycle (CREATE + migrate + seed + harness tables + DROP)
    // plus the test body takes 3-4s on a warm connection. Default 5s timeout
    // is too tight for DB-touching tests; bumped to 10s for safety headroom.
    // Per ADR 0002's SLA monitor, individual slow tests will get surfaced
    // for tier reclassification once we have enough of them to see a pattern.
    testTimeout: 10000,
  },
});
