# ADR 0001: Database setup and test isolation strategy

- **Status:** Accepted
- **Date:** 2026-04-24 (amended 2026-04-24, 2026-04-25)
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

- **`pjs3_test_bootstrap`** — `CREATE`, `DROP` on `` `pjs3\_test\_%`.* `` namespace. Used only by the test bootstrap to create and drop per-test databases. (Originally proposed as `pjs3_test_admin`; renamed because "admin" connoted *more* privilege than this user actually holds, the opposite of reality.)
- **`pjs3_test`** — `ALL` on `` `pjs3\_test\_%`.* `` namespace. Used by tests within the per-test DB for migrations and test queries.

Both users are created with **host restrictions** in `IP/netmask` form -- not `@'%'`, which would allow connections from any host on any network. The provisioned grants look like:

```sql
CREATE USER 'pjs3_test_bootstrap'@'192.168.1.0/255.255.255.0' IDENTIFIED BY '<from-vault>';
GRANT CREATE, DROP ON `pjs3\_test\_%`.* TO 'pjs3_test_bootstrap'@'192.168.1.0/255.255.255.0';

CREATE USER 'pjs3_test'@'192.168.1.0/255.255.255.0' IDENTIFIED BY '<from-vault>';
GRANT ALL ON `pjs3\_test\_%`.* TO 'pjs3_test'@'192.168.1.0/255.255.255.0';

FLUSH PRIVILEGES;
```

The `192.168.1.0/255.255.255.0` is a documented placeholder; the actual provisioning uses the real internal subnet (kept out of committed docs to avoid leaking topology). `IP/netmask` form is preferred over wildcard host patterns like `'10.0.0.%'` because it's unambiguous -- no risk of a misplaced wildcard digit silently widening the grant.

The wildcard pattern uses backslash-escaped underscores so it matches `pjs3_test_xyz` strictly, not stray names like `pjs3atestbxyz`.

A separate production user (`pjs3_app` or similar) holds minimal CRUD privileges on the production `pjs3` database. Never used in tests.

#### Why the privilege split (and not one user with `ALL`)

`pjs3_test_bootstrap` is restricted to `CREATE, DROP` because that's all it needs -- spinning up empty per-test DBs and tearing them down. Migrations and test queries inside the DB run as `pjs3_test`, which has full `ALL` on the namespace. Principle of least privilege: a compromised bootstrap credential can churn empty databases (annoying, recoverable), but cannot read or modify any test data sitting in a preserved-on-failure database. Combining both into one `ALL`-granted user would be operationally simpler but loses the boundary.

#### Note on this section's history

The original draft of this ADR (2026-04-24) specified `@'%'` host patterns and named the elevated user `pjs3_test_admin`. Both were corrected on 2026-04-25:

- **`@'%'` → `@'IP/netmask'`** because `@'%'` allows connections from anywhere, which is wrong on a home-network DB box. Documented placeholder is `192.168.1.0/255.255.255.0`.
- **`pjs3_test_admin` → `pjs3_test_bootstrap`** because the "admin" name suggested broader privilege than the user actually holds; "bootstrap" describes its scope (per-test DB lifecycle).

Captured here rather than silently overwriting because the original mistake illustrates the principles future schema work should follow.

### Reference data and test fixtures

A two-tier model, both source-controlled:

- **Reference data** — the rows the schema *requires* for the application to function. Currently just the `workspaceRole` lookup. Lives in `src/seed/referenceData.ts`, called once after migrations in the test bootstrap.
- **Test fixtures** — discrete, source-controlled scenarios. Each fixture is a `.ts` file under `tests/fixtures/<scenario>.ts` that exports an `apply<Scenario>(db) → references` factory. Tests import the fixture they need; the factory inserts known data and returns typed references the test can use.

Both are committed code. A reader navigating from `tests/jobs.test.ts` → `tests/fixtures/two-workspaces-three-jobs.ts` can see the exact scenario the test ran against.

### Forensic fixture log

When a test fails and the per-test database is preserved (planned `KEEP_FAILED_DBS=1` flag), the operator inspecting that database needs to know **which fixtures contributed which rows**. Without that breadcrumb, partial state is hard to trace — especially when a fixture crashes mid-load.

The test bootstrap creates two harness-internal tables alongside reference data:

```sql
CREATE TABLE _pjs3_test_fixture_catalog (
  id    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(255) NOT NULL,
  UNIQUE KEY (name)
);

CREATE TABLE _pjs3_test_fixture_log (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fixture_id    INT UNSIGNED NOT NULL,
  test_name     VARCHAR(255) NULL,
  created_at    DATETIME(6) NOT NULL,    -- when fixture load STARTED
  load_time_ms  INT UNSIGNED NULL,       -- NULL = load never completed
  FOREIGN KEY (fixture_id) REFERENCES _pjs3_test_fixture_catalog(id)
);
```

Underscore prefix marks both tables as test-harness internal, not domain. The fixture *catalog* normalizes fixture identity — a forensic query like "all log entries for the `two-workspaces-three-jobs` fixture" joins on an integer FK rather than scanning a varchar column. `test_name` stays as VARCHAR because test names are runtime strings (Vitest's `currentTestName`) — a finite catalog of them isn't knowable up front and renames would orphan rows.

`UNSIGNED` on `id` and `load_time_ms` expresses the invariant in the schema: neither value can ever be negative.

Fixtures call into a wrapper rather than logging themselves directly:

```typescript
// tests/fixtures/_harness.ts
export async function withFixture<TDb, T>(
  name: string,
  db: TDb,                               // shape settled in PR 3
  apply: (db: TDb) => Promise<T>,
): Promise<T> {
  const testName = expect.getState().currentTestName ?? null;
  const createdAt = new Date();

  const fixtureId = await upsertFixtureName(db, name);

  const [insertResult] = await db.execute(
    `INSERT INTO _pjs3_test_fixture_log
       (fixture_id, test_name, created_at)
     VALUES (?, ?, ?)`,
    [fixtureId, testName, createdAt],
  );
  const { insertId: logId } = insertResult;

  const startMs = performance.now();
  const result = await apply(db);
  const loadTimeMs = Math.round(performance.now() - startMs);

  await db.execute(
    `UPDATE _pjs3_test_fixture_log SET load_time_ms = ? WHERE id = ?`,
    [loadTimeMs, logId],
  );

  return result;
}
```

`TDb` is generic because PR 3 hasn't yet settled whether `db` is a Drizzle handle or a raw `mysql2` connection — the wrapper's contract works either way. `upsertFixtureName` is a one-line `INSERT ... ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)` against the catalog (returns the existing id if the name already exists, inserts otherwise).

Tests call `await withFixture('two-workspaces-three-jobs', db, applyTwoWorkspacesThreeJobs)` instead of calling the apply factory directly. Fixtures stay focused on data; the wrapper handles logging consistently.

#### Why INSERT-then-UPDATE rather than INSERT-only

If `apply()` throws partway through, an INSERT-only pattern leaves no log entry — the post-crash database shows partial data with no breadcrumb. INSERT-first-then-UPDATE means a crashed load leaves a row with `load_time_ms IS NULL`, which is itself the forensic signal: "started but didn't finish." `SELECT c.name, l.created_at FROM _pjs3_test_fixture_log l JOIN _pjs3_test_fixture_catalog c ON c.id = l.fixture_id WHERE l.load_time_ms IS NULL` answers "what was running when this DB went off-plan?"

#### Why two timing fields rather than one

`created_at` anchors the wall-clock moment the load began (correlates with test output, git commits, log lines elsewhere). `load_time_ms` captures duration, computed via `performance.now()` to be monotonic and immune to system-clock jitter mid-load. Together they reconstruct "data started landing at T, finished by T + load_time_ms" — both anchors are useful and answer different forensic questions.

#### Why a fixture catalog table rather than a varchar column

`fixture_name VARCHAR(255)` in the log table would work, but every forensic lookup ("show me all loads of fixture X") would scan or seek on a string column. Normalizing into a small catalog (id, name) keeps the log slim and makes joins indexable on integers. It also enforces fixture-name uniqueness through the catalog's `UNIQUE KEY (name)` rather than relying on convention. The cost is an extra table and an upsert per `withFixture` call — both negligible in the test-harness path.

#### What's deliberately not in the schema

No `metadata JSON` column. Tempting for "let each fixture stash extra context," but this project's schema-conventions stance opposes JSON-as-storage. If a fixture needs to record extras, it inserts into its own structured table — the forensic log stays relational and flat.

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
- The project's normalization stance and ORM posture inform the no-JSON / fixture-catalog choices above.
