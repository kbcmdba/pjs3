# ADR 0001: Database setup and test isolation strategy

- **Status:** Accepted
- **Date:** 2026-04-24
- **Decision-makers:** kbenton; Claude (collaborator on this project)

## Context

PJS3 is a multi-tenant SaaS being built test-first. Each entity (Workspace, User, Job, Company, Contact, Note, Search) needs database storage. The test suite must be:

- **Hermetic** — no shared state across tests, no order dependence, no leftover rows poisoning subsequent runs.
- **Fast enough for TDD** — the red/green cycle is the primary developer experience.
- **Realistic enough to catch issues that bite at scale** — index behavior, lock contention, real disk I/O, real commit/rollback cost.

We considered the conventional choices for each axis:

- **Engine:** SQLite, MySQL, PostgreSQL.
- **Local infrastructure:** Docker Compose, system-installed local DB, or a remote DB on existing home-network infrastructure.
- **Test isolation:** transaction rollback per test, or per-test fresh database.

## Decision

### Database engine: MySQL 8

PJS3 uses **MySQL 8** — the same engine PJS2 uses. Rationale:

- The author is MySQL-certified; existing operational knowledge transfers.
- The fully normalized schema (no JSON columns; see `MEMORY.md`) plays to MySQL's strengths.
- The eventual production target is the same MySQL fleet (`mysql1.hole`, `mysql2.hole`, plus the cluster) that already serves PJS2.

### Database host: existing `mysql2.hole`

For development and testing, PJS3 connects to the existing **`mysql2.hole`** MySQL instance on the home network — not Docker Compose, not a fresh local install. Rationale:

- The infrastructure already exists, is operationally mature, and is managed through the `Ansible-Terraform` project.
- Avoids the dev/prod dialect drift that any other engine in dev would invite.
- No Docker dependency for the primary developer.

External contributors (rare — Forgejo is home-network-only, GitHub serves only as a public mirror) point their `DATABASE_URL` at their own MySQL.

### Connection configuration: `DATABASE_URL`

The Node app reads a single `DATABASE_URL` env var of the form `mysql://user:pass@host:port/dbname`. Standard for the Node ecosystem, single source of truth, plays well with Drizzle. Populated via `.env` (gitignored) in dev, via Ansible-Vault-managed env in deployed contexts.

### Test isolation: per-test database lifecycle

**Each test that needs database state spins up its own `pjs3_test_<random>` database**, runs migrations, seeds reference data, executes with **real commits and real rollbacks** (no transaction wrapper), then drops the database. Tests that don't touch the DB skip the lifecycle entirely via opt-in helpers, so the existing fast tests stay fast.

Per-test lifecycle:

1. `CREATE DATABASE pjs3_test_<random>`
2. Run all migrations
3. Seed reference data (rows the schema *requires* for the app to function — currently only `workspaceRole`)
4. Test body executes (real commits, real rollbacks, real disk I/O)
5. `DROP DATABASE pjs3_test_<random>`

#### Why per-test DB instead of transaction rollback

A transaction-wrapper approach hides the commit/rollback semantics that matter at scale: real lock acquisition, real DDL behavior, real disk I/O, real index maintenance under genuine workload. A SaaS deployment will eventually need to know how a multi-row INSERT behaves under contention; tests-with-rollback-wrappers cannot answer that.

The cost is per-test setup overhead (~100ms for `CREATE` + migrations + seed). Acceptable now; optimizable later via template-DB cloning when the suite grows.

### DB users and privileges

Two test users on `mysql2.hole`, set up once via the Ansible MySQL role:

- **`pjs3_test_admin`** — `CREATE`, `DROP` on `` `pjs3\_test\_%`.* `` namespace. Used only by the test bootstrap to create and drop per-test databases.
- **`pjs3_test`** — `ALL` on `` `pjs3\_test\_%`.* `` namespace. Used by tests within the per-test DB.

The wildcard pattern uses backslash-escaped underscores so it matches `pjs3_test_xyz` strictly, not stray names like `pjs3atestbxyz`.

A separate production user (`pjs3_app` or similar) holds minimal CRUD privileges on the production `pjs3` database. Never used in tests.

### Reference data and test fixtures

A two-tier model, both source-controlled:

- **Reference data** — the rows the schema *requires* for the application to function. Currently just the `workspaceRole` lookup. Lives in `src/seed/referenceData.ts`, called once after migrations in the test bootstrap.
- **Test fixtures** — discrete, source-controlled scenarios. Each fixture is a `.ts` file under `tests/fixtures/<scenario>.ts` that exports an `apply<Scenario>(db) → references` factory. Tests import the fixture they need; the factory inserts known data and returns typed references the test can use.

Both are committed code. A reader navigating from `tests/jobs.test.ts` → `tests/fixtures/two-workspaces-three-jobs.ts` can see the exact scenario the test ran against.

## Consequences

### Positive

- **Realistic test behavior.** Real commits, real rollbacks, real disk I/O — catches what synthetic isolation cannot.
- **Maximum cross-test isolation.** No shared mutable state between tests; no transaction-leak surprises.
- **Forensic-friendly.** A failing test can leave its database behind for inspection (future `KEEP_FAILED_DBS` flag).
- **Source-controlled fixtures.** Test scenarios are repeatable, reviewable, and version-controlled like any other code.
- **Dev/prod parity.** MySQL throughout, same engine version, same dialect.

### Negative

- **Higher per-test setup cost** than transaction rollback (~10–100×). Acceptable now; optimizable later via template-DB cloning.
- **Test runtime depends on `mysql2.hole` reachability** from the developer's machine. Off-network development requires pointing `DATABASE_URL` at a local MySQL.
- **Bootstrap requires elevated DB privileges** (`CREATE DATABASE`, `DROP DATABASE`). Mitigated via the dedicated test users and wildcard GRANT pattern above.

## Alternatives considered

- **SQLite.** Rejected because of dialect drift between dev (SQLite) and prod (MySQL). Date/time handling, isolation semantics, full-text search, and JSON behavior all differ enough that "works on my machine" bugs become inevitable. SQLite would have given near-zero infrastructure friction and the fastest possible tests, but the author has MySQL infrastructure and expertise already; the parity wins outweigh the friction.
- **Docker Compose MySQL.** Rejected because `mysql2.hole` already exists and is operationally mature. Docker would add a redundant layer for the primary developer. Contributors who need it can still bring their own.
- **Per-test transaction rollback.** Rejected because it cannot exercise the commit/rollback semantics that matter at scale (see "Why per-test DB" above). It would have been faster, but the realism gap is the larger concern for a SaaS that'll see real concurrency.

## Future optimizations (not implemented)

- **Template-DB cloning.** Build a "template" DB once per worker (migrations + reference data), then clone it via `mysqldump | mysql` or `CREATE TABLE ... LIKE` per test. Avoids re-running migrations per test. Adopt when migration time becomes painful.
- **`KEEP_FAILED_DBS=1` env flag.** Skip `DROP DATABASE` on test failure, leaving the DB available for forensic inspection. Add the first time we actually want it.
- **Connection pooling.** `mysql2.createPool()` instead of one connection per request. Adopt when connection-establishment overhead matters.

## References

- PJS2's `~/.my.claude.cnf` credential pattern (deprecated in PJS3 in favor of `DATABASE_URL` + Ansible Vault).
- Forgejo issues #1–#10 (the `/checkSetup` backlog and follow-ups).
- Project memory: `feedback_orm_stance`, `project_data_modeling`, `project_forge_workflow`.
