# ADR 0002: Test-suite cadence and tiering

- **Status:** Accepted
- **Date:** 2026-04-24
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
| **Nightly** | Cron, weeknights | Catch regressions where same-day signal matters but the per-commit tier can't fit them |
| **Weekend** | Cron, weekend mornings | Run the full suite at least once a week |
| **Pre-release** | Manual, gates a "stable" release | Anything too expensive even for the weekend window |

Nightly runs on weeknights only because the weekend tier already covers Sat/Sun mornings — adding nightly runs on Fri/Sat/Sun would duplicate work the weekend tier does anyway.

The **goal is weekly full coverage.** The weekend tier should run everything we can fit in its window; anything that consistently can't fit gets pushed to pre-release, not run less often. Pre-release is the pressure-relief valve, not the dumping ground for tests we'd rather not maintain.

### Tier-membership criteria (strawman)

> ⚠ The time bands below are **starting points only**, not committed decisions. They give the SLA monitor (described later in this ADR) something concrete to push against. Expect them to move as the suite collects real per-test timing data.

Reclassify based on observed pain (a 3s test isn't a problem alone; 200 of them in the per-commit tier is).

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

Vitest globs in `package.json` scripts gate which tier runs:

| Script | Vitest invocation (illustrative) | Runs |
|---|---|---|
| `npm test` | `vitest run "tests/*.test.ts"` | per-commit only (current default) |
| `npm run test:nightly` | `vitest run "tests/nightly/**/*.test.ts"` | nightly tier |
| `npm run test:weekend` | `vitest run "tests/*.test.ts" "tests/nightly/**/*.test.ts" "tests/weekend/**/*.test.ts"` | per-commit + nightly + weekend |
| `npm run test:pre-release` | `vitest run "tests/pre-release/**/*.test.ts"` | pre-release tier only |
| `npm run test:all` | `vitest run "tests/**/*.test.ts"` | every tier (escape hatch) |

CI invokes the script appropriate for its trigger: per-commit on every push; cron jobs invoke `:nightly` and `:weekend`; the release pipeline invokes `:pre-release`.

When the frontend lands as a sibling `web/` package, the same cadence model applies per package — `web/tests/`, `web/tests/nightly/`, etc. The decision is repo-wide; the directory layout is per-package.

### Why file location rather than tags

Tags (Vitest's `describe.todo`-style filters or comment-based markers) require remembering to apply them, and break silently when forgotten — a tagless test runs in whatever tier the default invocation matches, which is usually per-commit. File location can't be forgotten: a test in `tests/weekend/jobs.soak.test.ts` is unambiguously a weekend test. Cadence concerns also stay out of the test body, so reading the test focuses on what it asserts, not when it runs.

### Shared fixtures are not tier-locked

Fixtures live at `tests/fixtures/<scenario>.ts` regardless of which tier(s) consume them. A nightly test and a per-commit test can both import `applyTwoWorkspacesThreeJobs`. Tier-locking fixtures would force duplication; we don't.

### SLA monitoring and reclassification

Each tier has an implicit SLA on per-test runtime — the time band in the criteria table above. A test that consistently exceeds its tier's SLA, *or* consistently runs much faster than its tier expects, should be reclassified.

The mechanism is statistical, not per-run:

- **Per-test timings are recorded across runs**, not just the current invocation. CI emits per-test duration into a persistence layer (mechanism TBD — see Open questions). One slow run is noise; a *pattern* of slow runs is signal.
- **Frequency thresholds, not single violations, trigger reclassification.** A per-commit test that crosses 1s on 1 of the last 20 runs is fine. Crossing it on 10 of 20 means the test has slipped categories — it needs to move (or get optimized).
- **Reclassification is bidirectional.** Slow per-commit tests get demoted to nightly. Faster-than-expected nightly tests get promoted to per-commit. Movement is human-reviewed: the SLA monitor surfaces candidates with the data; a developer reads the report and decides.
- **Backstop: a hard CI guard on per-commit tier.** Independent of the statistical monitor, CI fails outright if any per-commit test exceeds a hard limit (e.g., 5s). The statistical monitor catches drift; the hard guard prevents catastrophic miscategorization.

The principle this commits to: **tier membership is empirical, not aspirational.** The suite is expected to surface its own miscategorizations rather than relying on developer discipline alone.

## Consequences

### Positive

- **Inner loop stays fast.** The per-commit tier holds the seconds-to-low-minutes budget; developers don't pay for nightly/weekend coverage on every red/green cycle.
- **Discovery is simple.** A reader sees the tier in the path. No grep for tags, no scanning describe blocks.
- **Pre-release is named, not invisible.** "Too expensive for the weekend" has a documented home, so contributors don't quietly dump load tests into the per-commit tier and slow everyone down.
- **Composable scripts.** `test:weekend` is a superset of `test:nightly` is a superset of `test`, mirroring the cadence stack.

### Negative

- **A test in the wrong tier is a real bug.** A 30-second test misfiled into `tests/` (per-commit) slows everyone's inner loop. Mitigated by the SLA monitor described above (statistical, advisory) plus the hard CI guard on per-commit tier (catastrophic-backstop, blocking).
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
- **SLA monitor persistence and reporting.** Where per-test timing history lives (small MySQL table on `mysql2.hole`? CSV artifact in CI? something else), what window length to use for "the last N runs," and how candidates surface to a human (Forgejo issue, weekly digest, dashboard). Resolves when the per-commit tier has enough tests for noise to matter.
- **Hard-guard threshold for per-commit tier.** Concrete value (2s? 5s? Vitest's own per-test timeout?), and whether the guard is a custom reporter, a post-run script, or the test runner's built-in timeout. Decide when the first borderline test surfaces.
- **Reporter/aggregation strategy across tiers.** Where do nightly/weekend results surface — email, Forgejo issues, dashboard? Resolves with the cron infrastructure decision.

## References

- [ADR 0001](0001-database-setup-and-test-isolation.md) — per-test DB lifecycle this strategy builds on, including the forensic fixture log that any SLA-monitor persistence layer should follow the same schema conventions of (synthetic auto-increment PK, `UNSIGNED` for non-negative numerics, no JSON columns).
- The project's TDD-first development stance — every change lands as a red/green pair, which means the per-commit tier's speed materially affects the inner-loop developer experience.
