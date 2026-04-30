# PJS3 MVP Scope

Defines the initial-release scope for Personal Job Seeker 3 (PJS3). Anything not listed here is **explicitly deferred** — named so it doesn't get silently dropped, scoped so it doesn't get silently added.

## Purpose

The smallest useful job tracker that:

1. Proves the Node / Fastify / Drizzle / MySQL / React stack end-to-end under TDD discipline.
2. Supports primary users and shared viewers (e.g., a spouse) safely — workspace tenancy from day one.
3. Replaces the author's PJS2 workflow, so dogfooding drives feedback.

## Tenancy Model

PJS3 uses a **workspace** model, not per-user data isolation:

- A **Workspace** is the tenancy container. All user-owned data (Company, Contact, Job, Note, Search, and the workspace-scoped lookup tables) FKs on `workspaceId`.
- On signup, each user gets a **personal workspace** auto-created, with themselves as Owner. Creating additional workspaces is post-MVP.
- Workspace members have **roles**. MVP ships with **Owner** and **Viewer**. **Collaborator** (edit-without-admin) is explicitly named and deferred — see the deferred list below.
- Every query filters on `workspaceId`. Every handler checks the caller's role in the workspace.

## In Scope

### Entities

| Entity | Notes |
|---|---|
| **User** | Auth subject. Owns one personal workspace; may be a member of others. |
| **Workspace** | Tenancy container; has one Owner + zero or more Viewers. |
| **WorkspaceMember** | Junction: `(workspaceId, userId, roleId)`. |
| **Company** | Employers, agencies, etc. FK on `workspaceId`. |
| **Contact** | People at companies. FK on `workspaceId`. |
| **Job** | Specific job posting. FK to Company + `workspaceId`; optional FK to Contact. |
| **Note** | Polymorphic via `appliesToTable` + `appliesToId`; attachable to Job / Company / Contact. FK on `workspaceId`. |
| **Search** | Saved search the user revisits; shared via workspace membership. FK on `workspaceId`. |

### Lookup tables — workspace-scoped (seeded on workspace creation)

- `applicationStatus` — Applied, Interviewing, Offer, Rejected, Withdrawn (defaults; customizable per workspace)
- `positionType` — FTE, CTH, PTE, Contract, Seasonal, Freelance
- `workModel` — Remote, Hybrid, On-site
- `applicationMethod` — Online, Email, Phone, In-person, Referral, Staffing Agency
- `activityType` — Applied, Networking, Job Fair, Workshop, Staffing Agency Visit, Training

### Lookup tables — system-level

- `workspaceRole` — seeded with Owner and Viewer. `sortKey` leaves a gap for Collaborator when added.

### Definition of Done

A new user can:

1. Sign up, verify email, log in. Personal workspace is auto-created with the user as Owner.
2. Add a company, contact, job, note, and saved search within their workspace.
3. Update a job's application status.
4. Invite another user by email to their workspace as Viewer.
5. The invitee receives an invite link, creates an account (or logs in if existing), and joins the workspace.
6. The Viewer sees everything in that workspace but cannot create, edit, or delete.
7. The Owner can remove a Viewer from their workspace.
8. A member switches between workspaces they belong to (at minimum: their personal one + any they've been invited to).
9. Log out; on next login, see only data from workspaces they belong to.

### Non-functional

- **Cross-workspace isolation** enforced at the data layer from the first migration. Every user-owned row has `workspaceId`; every query filters on it. Every entity test suite MUST include:
  - A **cross-workspace isolation case** — a member of workspace A cannot read, update, or delete data in workspace B.
  - A **role enforcement case** — a Viewer cannot mutate; an Owner can.
- **TDD throughout.** No production code without a failing test that fails for the right reason.
- **Responsive web UI.** Usable on phone and desktop.

## Out of Scope for MVP (explicitly deferred)

Named so they don't silently reappear or disappear:

| Deferred | Status |
|---|---|
| **Collaborator role** (edit without invite/delete/member-management rights) | Explicitly named for post-MVP; schema leaves a `sortKey` gap for it |
| Creating additional workspaces beyond the auto-created personal one | Post-MVP |
| Workspace deletion | Post-MVP |
| Transferring workspace ownership | Post-MVP |
| REST API for external consumers (JobImporter etc.) | Post-MVP |
| Weekly / monthly activity reports | Post-MVP |
| Unemployment reporting (jurisdiction-specific compliance) | Post-MVP |
| Payment integration / paid subscriptions | Post-MVP |
| JobImporter integration | Post-MVP |
| Duplicate-URL detection | Likely post-MVP |
| Breadcrumb navigation across entity views | Nice-to-have; not blocking MVP |
| Admin / role system beyond workspace-level roles | Post-MVP |
| Keywords | Undecided — may not return in PJS3 |

## First TDD Target

The workspace/auth/role plumbing is foundational — there's no meaningful CRUD without it. Sequence:

1. **Walking skeleton** — health-check endpoint with one failing-then-green end-to-end test.
2. **Auth + workspace bootstrap** — signup auto-creates a personal workspace and Owner membership. Cross-workspace isolation is asserted by test at this stage.
3. **First CRUD entity: `applicationStatus`** — simplest workspace-scoped entity (id, value, sortKey, workspaceId). Exercises the full stack with workspace scoping and role enforcement. Once this pattern is green, every other entity follows its shape.

## Stack (committed)

| Layer | Choice |
|---|---|
| Runtime | Node.js LTS |
| Language | TypeScript |
| Backend framework | Fastify |
| Test runner | Vitest |
| Database | MySQL 8 |
| DB layer | Drizzle (schema-as-code; raw SQL via `` sql`...` `` when needed) |
| Migrations | Drizzle Kit |
| Auth + workspace membership | Better-Auth (organization plugin, surfaced as "Workspace" in UI/code) |
| Frontend | React + Vite |
| Frontend routing | React Router |
| Dev runners | `tsx` (backend), Vite (frontend) |

## Resolved Decisions

- **Repo layout** — single repo with `api/` and (eventually) `web/` as sibling subdirectories. No npm workspaces until shared code actually emerges. Resolved 2026-04-23.
- **Dev-mode email** — Mailpit (local catch-all SMTP with inbox UI) for TDD of signup verification and workspace invitations. Production provider deferred to closer to ship. Resolved 2026-04-23.
- **Seed data strategy** — two-tier: reference data (rows the schema requires; currently `workspaceRole`) seeded once per test DB; test fixtures (`.ts` factories under `tests/fixtures/`) called per-test as needed. Both source-controlled. Resolved 2026-04-23, refined 2026-04-24.
- **Local MySQL approach** — connect to existing `mysql2.hole` on the home network rather than Docker Compose or a fresh native install. Operationally mature, avoids dialect drift, no Docker dependency for the primary developer. External contributors point `DATABASE_URL` at their own MySQL. See `docs/adr/0001-database-setup-and-test-isolation.md`. Resolved 2026-04-24.
- **Test-database isolation** — per-test database lifecycle: each test that touches the DB does CREATE → migrate → seed reference data → run *with real commits and real rollbacks* → DROP. Realistic commit/rollback semantics; max isolation. See ADR 0001. Resolved 2026-04-24.
- **Forge workflow** — dual-home: Forgejo at `forgejo1.hole` is the working forge (home-network-only); GitHub `kbcmdba/pjs3` is a public mirror. PR workflow with feature branches, merge via Rebase or Merge-commit (never Squash). `CB>` / `KB>` prefix convention on Forgejo comments to make the two-voice dialogue legible despite both posts coming from `kbenton`. Resolved 2026-04-24.
- **Auth and workspace-bootstrap design** — Originally resolved 2026-04-26 around Better-Auth (with organization plugin, JWT plugin) per ADR 0003. **Reversed later the same day:** RTFM on Better-Auth's docs surfaced three structural mismatches with PJS3 conventions — string/UUID PKs vs project's `INT UNSIGNED` rule (the opt-in `serial` mode keeps TS types as `string`, a workable but real wrinkle), `member.role` as a string column conflicting with our `workspaceRole` lookup table from PR #13, and Better-Auth's JWT plugin explicitly *not* being a session replacement (Better-Auth's primary session model is cookie-based, contradicting ADR 0003's JWT-is-session premise). Pivot decision: **roll our own auth library** for MVP scope. Schema purity stays, project conventions hold, learning-artifact stance is reinforced. The *design* from ADR 0003 carries over (email-verification hard gate, workspace selection at login, full re-auth on workspace switch, idle TTL with activity-resets-timer, browser-binding rules); only the implementation library changes. OAuth and 2FA still roadmapped post-MVP, built in-house when there are users to need them. Magic links remain explicitly rejected. ADR 0003 amendment pending. Resolved 2026-04-26 (initial); pivot 2026-04-26 (later same day).

## Open Questions (pending leader intent)

Deferred-but-named (not blocking current work):

- **Deployment target** — local dev → staging → prod; details TBD when closer to ship.

## Changelog

- 2026-04-23: Initial draft with per-user tenancy (superseded).
- 2026-04-23: Revised for workspace tenancy (ownership + sharing) per leader intent.
- 2026-04-23: Resolved repo layout, dev-mode email, and seed-data strategy. Walking skeleton landed (api/ with passing GET /health test). Next-milestone blockers restated as infrastructure forks.
- 2026-04-24: PR #9 merged (config module + `config_loaded` check, `loadConfig` env input made explicit per review). Forgejo issues #1–#10 filed for the `/checkSetup` backlog. Resolved local MySQL approach (use existing `mysql2.hole`) and test-database isolation (per-test lifecycle with real commits/rollbacks); ADR 0001 captures both. Forge workflow (Forgejo primary + GitHub mirror, `CB>`/`KB>` prefix convention) resolved and documented.
- 2026-04-24 (later): PR #11 merged — `mysql2` driver, `src/db.ts` connection helper, `database_reachable` check on `/checkSetup`. ADR 0001 amended with forensic fixture log (`_pjs3_test_fixture_catalog` + `_pjs3_test_fixture_log` tables, `withFixture()` wrapper, INSERT-then-UPDATE pattern). ADR 0002 added — four-tier test cadence (per-commit / nightly / weekend / pre-release), file-location tier encoding, statistical SLA monitor + hard CI guard for reclassification. PR #12 (docs-only) carries both ADR changes.
- 2026-04-25: PR #12 merged. PR #13 merged — drizzle-kit + `workspaceRole` schema (column iterations: `value` → `roleValue` → bare `role`, settling on bare-noun for lookup tables) + initial migration. Upstream feature requests filed: drizzle-orm/drizzle-orm#5681 (snapshot-JSON field naming) and dbcli/mycli#1864 (`source -v` and `source -p` flags). PR #14 opened (ADR 0001 second amendment: `@IP/netmask` host grants, `pjs3_test_admin` → `pjs3_test_bootstrap` rename). PR #15 opened (PR 3a: per-test DB lifecycle helper + `seedReferenceData` + integration test, closes Forgejo issue #2). PR #16 opened (defensive `.gitignore` patterns for scratch files). `api/.env.example` renamed to `api/env.example` for newcomer discoverability.
- 2026-04-25 (evening): PR #14, #15, #17 merged. PR #16 closed without merging (its branch had drifted behind main and would have stomped PR #15's files); replaced by PR #18 (clean re-do, merged). PR #19 merged — PR 3b: forensic fixture log infrastructure (`_pjs3_test_fixture_catalog` + `_pjs3_test_fixture_log` tables, `withFixture()` wrapper using INSERT-then-UPDATE for partial-load visibility, `withCollaboratorRole` first sample fixture). PR #20 merged — PR 4: `migrations_current` check on `/checkSetup` comparing drizzle journal entries against `__drizzle_migrations` rows; closes Forgejo issue #3. **Original 4-PR test-infrastructure stack complete.** Vitest `testTimeout` bumped from default 5s to 10s to accommodate per-test DB lifecycle (3-4s setup + body). Workflow calibrations: merges now go through Claude via Forgejo API, not WUI; standing permission to run /self-learning without asking; user-owned data uniqueness landed firmly on `(workspaceId, <column>)` for the workspace-shared model. Follow-up Forgejo issues #22 (configurable drizzle journal path for production deployment) and #23 (run drizzle-kit `migrate()` on app startup to catch hash-mismatches the count-only check can't see) filed from PR #20 self-review; `parseUrl` is now duplicated across `src/db.ts`, `src/migrations.ts`, `tests/helpers/testDb.ts`, and `tests/fixtures.test.ts` — extract to a shared utility in a follow-up.
- 2026-04-26: PR #24 merged — `parseDatabaseUrl` extracted from four duplicates into `src/db.ts` as a shared utility (closes the parseUrl debt). PR #25 opened — ADR 0003 (auth and workspace-bootstrap design): Drizzle owns all DDL including Better-Auth's tables, email+password for MVP with OAuth+2FA roadmap (no magic links), email-verification hard gate, JWT sessions with user-configurable TTL (4h default), login prompts for workspace selection on multi-membership, workspace switching requires full re-authentication, JWT-bound workspace context (body/URL/header workspaceId fields ignored). Resolves the long-standing "Better-Auth schema ownership" open question. Doc landed early so it can be reviewed and edited with fresh eyes; design changes after merge are normal ADR amendment territory.
- 2026-04-26 (later): PRs #25, #26, #27 merged. **Auth-library decision pivoted: dropping Better-Auth, rolling our own.** RTFM on Better-Auth's docs revealed three structural mismatches with PJS3 conventions — string/UUID PKs by default, `member.role` string column conflicting with our `workspaceRole` lookup, and Better-Auth's JWT plugin explicitly *not* being a session replacement (cookies are Better-Auth's primary session, contradicting ADR 0003's JWT-is-session premise). Schema purity, project-convention coherence, and learning-artifact stance won out over framework convenience. Coming next: revert PR #27 (Better-Auth install), amend ADR 0003 to reflect the pivot, then schema PR for our own auth tables (`user`, `session`, `passwordResetToken`, `emailVerificationToken`) followed by signup → verify → login → session → logout → password-reset PRs each red/green-tested. UI conventions captured in project memory: zebra striping for fixed-height tabular data, discrete-per-row backgrounds for variable-height content rows (notes, free-form entries) — diagnosed from PJS2's `jobDetail.php` notes display where multi-paragraph rows blur together.
- 2026-04-29 / 2026-04-30: PRs #28, #29, #30, #31, #32 merged. **`<tableName>Id` PK convention** calibrated and applied repo-wide (PR #29) — `noteMap.noteMapId`, not `noteMap.id`, etc. — so joined queries returning multiple PK columns are unambiguous. Better-Auth dependency removed (#30). ADR 0003 amended (#31) to strip Better-Auth specifics; the design (email-verification hard gate, workspace selection at login, full re-auth on switch, idle TTL with activity-resets-timer, JWT-bound workspace context, browser-binding) carries over. **Auth-tables schema landed (#32):** `user`, `workspace`, `workspaceMember`, `emailVerificationToken`, `passwordResetToken`, `session` -- 7 tables on main with FKs, all `RESTRICT` (not `NO ACTION`), `INT UNSIGNED` PKs, `CHAR` for fixed-width fields, `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` on append-only createdAt. Schema-introspection tests for each table. Migration hand-edited to combine multi-FK ALTERs per table; `--> statement-breakpoint` documented as drizzle's metadata (only safe via `db:migrate`, not raw `mysql <`). Two new design-process calibrations captured globally: (a) "validate framework fit before designing around it" -- ADRs naming a library should include a fit-check pass; (b) "standards (RFCs, specs) are tools to evaluate, not authorities to obey" -- when a spec produces a dumb outcome, deviate, document, send upstream. Test-suite runtime grew to ~127s as the schema grew (drizzle-kit migrator runs each statement-breakpoint separately, round-trips multiply); template-DB cloning is the future fix per ADR 0001 (locally tracked, not yet a Forgejo issue). Coming next: signup endpoint as the first auth-flow TDD PR.
