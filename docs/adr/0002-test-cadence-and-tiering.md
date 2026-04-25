# ADR 0002: Test-suite cadence and tiering

- **Status:** Accepted
- **Date:** 2026-04-25
- **Decision-makers:** kbenton; Claude (collaborator on this project)

## Context

Test suites that run every test on every invocation don't scale. As PJS3 grows from one entity (`workspaceRole` lookup) to a dozen entities × workspace tenancy × role enforcement × cross-workspace isolation cases, the per-test database lifecycle from [ADR 0001](0001-database-setup-and-test-isolation.md) (~100ms setup + N tests) compounds quickly. Running everything-on-every-commit becomes painful well before the suite is comprehensive.

Some tests are also inherently slow: production-scale load tests with concurrent users, end-to-end browser tests once the frontend lands, multi-hour soak runs. Running those on every commit wastes time without meaningful signal — the inner-loop developer experience suffers and CI cost rises with no benefit.

We need a cadence model that lets the suite scale: fast tests stay fast and run always, broader tests run when they're useful, expensive tests run only when there's a reason.

## Decision

### Four tiers of test cadence

| Tier | Trigger | Goal |
|---|---|---|
| **Per-commit** | Every push to any branch (CI) | Catch broken correctness within seconds-to-low-minutes |
| **Nightly** | Cron, every weekday night | Catch regressions where same-day signal matters but the per-commit tier can't fit them |
| **Weekend** | Cron, weekend mornings | Run the full suite at least once a week |
| **Pre-release** | Manual, gates a "stable" release | Anything too expensive even for the weekend window |

The **goal is weekly full coverage.** The weekend tier should run everything we can fit in its window; anything that consistently can't fit gets pushed to pre-release, not run less often. Pre-release is the pressure-relief valve, not the dumping ground for tests we'd rather not maintain.

### Tier-membership criteria (strawman — refine in practice)

These time bands are starting points, not load-bearing decisions. Reclassify based on observed pain (a 3s test isn't a problem alone; 200 of them in the per-commit tier is).

A test belongs in **per-commit** if:
- It runs in < 1 second, *or*
- It exercises code that's load-bearing for the inner TDD loop (we want the red/green signal even if it's a bit slower).

A test belongs in **nightly** if:
- It runs in 1–10 seconds, *and*
- It covers cross-cutting concerns (workspace isolation, role enforcement, multi-entity flows) where same-day signal matters.

A test belongs in **weekend** if:
- It runs in 10s–10min, *or*
- It's an end-to-end / multi-step test too noisy or slow for the nightly window.

A test belongs in **pre-release** only if:
- It runs > 10min, *or*
- It requires resources (concurrency at scale, real third-party services, production-shaped data volumes) inappropriate for routine CI.

### Mechanism: file location + `package.json` scripts

Tier membership is encoded by **file location**, not by tags or `describe.skipIf` — file location is visible at-a-glance in the directory tree, can't be silently forgotten, and matches how new contributors expect to organize tests.

```
api/tests/
├── *.test.ts                 # per-commit (default; existing tests stay here)
├── nightly/**/*.test.ts
├── weekend/**/*.test.ts
└── pre-release/**/*.test.ts
```

Vitest project filters in `package.json` scripts gate which tier runs:

| Script | Runs |
|---|---|
| `npm test` | per-commit only (current default) |
| `npm run test:nightly` | nightly tier |
| `npm run test:weekend` | per-commit + nightly + weekend |
| `npm run test:pre-release` | pre-release tier only |
| `npm run test:all` | every tier (escape hatch) |

CI invokes the script appropriate for its trigger: per-commit on every push; cron jobs invoke `:nightly` and `:weekend`; the release pipeline invokes `:pre-release`.

### Why file location rather than tags

Tags (Vitest's `describe.todo`-style filters or comment-based markers) require remembering to apply them, and break silently when forgotten — a tagless test runs in whatever tier the default invocation matches, which is usually per-commit. File location can't be forgotten: a test in `tests/weekend/jobs.soak.test.ts` is unambiguously a weekend test. Cadence concerns also stay out of the test body, so reading the test focuses on what it asserts, not when it runs.

### Shared fixtures are not tier-locked

Fixtures live at `tests/fixtures/<scenario>.ts` regardless of which tier(s) consume them. A nightly test and a per-commit test can both import `applyTwoWorkspacesThreeJobs`. Tier-locking fixtures would force duplication; we don't.

## Consequences

### Positive

- **Inner loop stays fast.** The per-commit tier holds the seconds-to-low-minutes budget; developers don't pay for nightly/weekend coverage on every red/green cycle.
- **Discovery is simple.** A reader sees the tier in the path. No grep for tags, no scanning describe blocks.
- **Pre-release is named, not invisible.** "Too expensive for the weekend" has a documented home, so contributors don't quietly dump load tests into the per-commit tier and slow everyone down.
- **Composable scripts.** `test:weekend` is a superset of `test:nightly` is a superset of `test`, mirroring the cadence stack.

### Negative

- **A test in the wrong tier is a real bug.** A 30-second test misfiled into `tests/` (per-commit) slows everyone's inner loop. Mitigation: a CI guard that times per-commit tests and fails if any individual test exceeds a threshold (e.g., 2s). Add when the first slow misclassification happens.
- **Cron infrastructure becomes load-bearing.** Nightly/weekend regressions only get caught if the cron actually runs. A failed-and-unnoticed cron is a silent regression channel — needs alerting on cron failures, not just on test failures.
- **Reclassification needs a habit.** Tests creep slower over time. Worth budgeting a periodic look at the per-commit tier's slowest tests.

## Alternatives considered

- **Single tier (everything runs every time).** Rejected — doesn't scale past low-hundreds of tests when each touches a per-test DB.
- **Three tiers (per-commit / weekend / on-demand)** — the shape of an earlier draft of this discussion. Rejected because collapsing nightly into weekend gives only weekly signal on regressions that warrant day-grain visibility once the suite has any cross-entity coverage.
- **Tag-based filtering.** Rejected — silent failures when forgotten; mixes cadence concerns into test bodies; harder to audit at a glance than a directory tree.
- **`describe.skipIf(env.TIER !== 'weekend')` pattern.** Rejected for the same reasons as tags, plus it makes the test body lie about when it runs.

## Open questions

These are not blockers for accepting this ADR; they're flagged so they don't drift.

- **CI infrastructure for cron-triggered tiers.** Forgejo Actions, a separate cron host on the home network, or GitHub Actions on the mirror? Resolves when nightly/weekend tiers actually have tests to run.
- **Per-commit timing guard.** Custom Vitest reporter, post-run script, or just discipline? Add when the first slow test sneaks into the per-commit tier.
- **Reporter/aggregation strategy across tiers.** Where do nightly/weekend results surface — email, Forgejo issues, dashboard? Resolves with the cron infrastructure decision.

## References

- [ADR 0001](0001-database-setup-and-test-isolation.md) — per-test DB lifecycle this strategy builds on.
- Project memory: `feedback_tdd` (TDD-first development), `project_data_modeling` (no JSON, synthetic PKs — applies to test-harness tables too).
