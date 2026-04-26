# ADR 0003: Auth and workspace-bootstrap design

- **Status:** Accepted
- **Date:** 2026-04-25
- **Decision-makers:** kbenton; Claude (collaborator on this project)

## Context

PJS3 is a multi-tenant SaaS with workspace tenancy from day one (Owner + Viewer roles in MVP, post-MVP Collaborator). The next milestone after the test-infrastructure stack (PRs #9–#20) is the auth + workspace-bootstrap layer: signup, email verification, login, session management, workspace creation, role enforcement, and cross-workspace isolation.

`MVP_SCOPE.md` commits to **Better-Auth** (with the organization plugin, surfaced as "Workspace") as the auth library. This ADR captures the design choices that resolve how Better-Auth is integrated, how sessions are shaped, how multi-membership is handled, and how isolation is enforced.

## Decision

### Schema ownership: Drizzle owns all DDL

Better-Auth's tables (`user`, `session`, `account`, `organization`, `member`, `invitation`, plus its plugin tables) live in `src/schema/` alongside our domain tables, managed by `drizzle-kit`. Better-Auth's built-in migration support is **not** used.

**Why:** A single source of truth for DDL makes schema review, migrations, and forensic inspection simpler — a reader doesn't have to navigate to Better-Auth's repo to understand "what tables exist." Project schema conventions (synthetic UNSIGNED auto-increment PK, FK-to-catalog over repeated varchars, bare-noun lookup columns, no JSON columns) apply to Better-Auth's tables wherever Better-Auth's pluggable schema allows.

### Auth methods (MVP and roadmap)

- **MVP:** email + password.
- **Post-MVP:** OAuth (Google, GitHub, possibly others), 2FA.
- **Explicitly rejected: magic links.** A magic link in transit is functionally a password sent in cleartext; anyone in possession of the link has access. The convenience benefit doesn't outweigh the security weakness for an app that holds personal job-search data.

### Email verification: hard gate

A user who has signed up but not yet verified their email **cannot perform any action that writes to the database beyond the unverified `user` row itself**. Specifically: their personal workspace is **not** created at signup, and no `WorkspaceMember` row is created. These materialize **atomically** at first verified sign-in.

**Why:** Prevents pollution of the DB with bogus data from never-confirmed signups (auto-spam, typos, abandoned signups). The DB only holds workspace records for users we know are reachable.

The flow:

1. Signup form: user enters email + password.
2. Better-Auth creates the `user` row in an unverified state.
3. Verification email sent (Mailpit in dev, real provider TBD).
4. User clicks the verification link.
5. User is redirected to sign in.
6. On successful first sign-in:
   - Atomic transaction creates the user's personal `Workspace` row + `WorkspaceMember` row with role=Owner.
   - JWT issued (see "Login" below).
7. Subsequent sign-ins skip the workspace-creation step (already exists).

**Unverified-row TTL: 24 hours.** A periodic cleanup task purges `user` rows that remain unverified for more than 24h after creation. Bounds DB pollution from abandoned signups even though the row exists briefly. The cleanup mechanism (cron job, scheduled task, or manual sweep) settles when the cleanup task is built; the policy is the 24h cap.

### Sessions: JWT, configurable TTL, 4h default

JWT is the session bearer. PJS3 is API-first — long-term, the same backend serves the web UI and external API consumers, and JWT is the natural fit for both audiences without two parallel session models.

**TTL:** default 4 hours **of idle time** — activity (any authenticated request) resets the timer. So a user actively working stays signed in indefinitely; a user who walks away gets logged out 4 hours after their last action. **User-configurable** via a setting on `user` (e.g., `sessionIdleTtlMinutes INT UNSIGNED DEFAULT 240`). The unit is **minutes** so users can pick finer-grained timeouts than hours allow (15 or 30 minutes are realistic for security-conscious users). Users with stricter security needs shorten the value; users with longer working windows extend up to a cap (provisionally 10080 minutes = 7 days; cap committed when the user-settings UI lands).

**JWT carries:**

- `userId` — the authenticated user
- `currentWorkspaceId` — the workspace bound to this session
- `currentRoleId` — the user's role in `currentWorkspaceId`
- `exp` — expiry
- standard Better-Auth claims

### Login: workspace selection on multi-membership

Users typically belong to multiple workspaces (their personal one, plus any they've been invited to as Viewer). Login is therefore a two-step process:

1. **Authenticate.** User enters credentials; Better-Auth verifies.
2. **Select workspace context (if multi-membership).**
   - Query `WorkspaceMember WHERE userId = ?` for all `(workspaceId, roleId)` pairs.
   - **If exactly 1 membership:** directly issue the JWT bound to that workspace+role.
   - **If multiple memberships:** present a selection UI:
     ```
     Sign in as Owner of joe@example.com's workspace?
     Sign in as Viewer of tom@farfetched.com's workspace?
     ```
     User picks one. JWT is issued bound to the selection.

The JWT is **workspace-bound for the entire session lifetime.** There is no per-request workspace context.

### Workspace switching: full re-authentication

Switching workspaces is a **deliberate action**, not URL navigation. The UI exposes a "switch workspace" menu (visible only when the user has multiple memberships); selecting it triggers a re-authentication flow:

1. User clicks "switch workspace."
2. Credentials prompted again (same form as login).
3. Better-Auth re-verifies.
4. *(Post-MVP: 2FA re-triggers here as well.)*
5. Workspace selection menu shown.
6. User picks a workspace.
7. New JWT issued bound to the new workspace+role.
8. Old JWT invalidated.

The old JWT remains valid until the new one is issued, so a user who cancels the switch flow isn't accidentally logged out.

**Why full re-auth, not just token reissue:**

- Prevents session-hijacking pivots — an attacker with a stolen JWT cannot pivot to a higher-privilege workspace without the password.
- Aligns with banking / financial-app patterns where role escalation requires re-auth.
- Forensically clean: every workspace transition is a fresh credential proof.

### Per-request authorization

Every authenticated request runs through the same gate:

1. Parse and verify the JWT.
2. Extract `userId`, `currentWorkspaceId`, `currentRoleId` from the verified claims.
3. Every database query filters on `WHERE workspaceId = currentWorkspaceId` (the JWT value, no exceptions).
4. **Body, URL, and header `workspaceId` parameters are ignored.** A request that includes `workspaceId=42` in its body for a workspace the user isn't bound to in their JWT does not get routed to that workspace — the JWT is the authority.
5. Role enforcement: route handlers check `currentRoleId` against the action's required role. Owner can mutate; Viewer is read-only.

### Role staleness

A demotion (Owner → Viewer) takes effect on the next JWT issue (sign-in or workspace switch). With the default 4h TTL, the staleness window is bounded.

If instant role revocation ever becomes a real requirement (terminated-employee scenario in a future B2B context), the move is a per-request DB role lookup with a short cache — but for MVP, JWT-embedded role is fine.

### Browser-binding: one role per browser at a time

A browser instance can hold **exactly one** workspace+role context at a time. The cookie/storage scope is the unit; the same browser cannot be logged into two roles concurrently.

To work in two workspaces simultaneously, the user opens a **separate browser session** that has its own cookie store:

- **A different browser application** (Chrome + Firefox, Firefox + Safari, etc.).
- **A private / incognito tab** in the same browser. Private mode has separate cookie storage from the main profile, so it counts as a distinct session.
- **A different browser profile** (Chrome's "Profile 2", Firefox's containers).

Same-browser two-tab usage stays in the *same* role — this is intended, not a workaround. It aligns with the "deliberate workspace switch" framing: cross-workspace work should feel like a context change, not a tab change. Users with multiple memberships and a real need for parallel work can use any of the separate-session options above; they're a deliberate setup step, not accidental.

### Cross-workspace isolation testing

Per ADR 0001's "Non-functional" section, every entity test suite must include a cross-workspace isolation case and a role enforcement case. ADR 0003 makes those concrete:

**Layer:** HTTP handler tests (auth-aware) plus a follow-up security-testing pass.

**Required cases per entity:**

1. **Workspace isolation.** Authenticate as user-A bound to workspace W-A. Request a resource owned by W-B. **Likely 404** for security / info-leakage reasons (don't reveal that the resource exists at all, since the requesting user has no business knowing). Final shape settles when the first entity's HTTP handler is written and we see what actually feels right; documented in this ADR's open questions until then.
2. **JWT-override defense.** Authenticate as user-A bound to W-A. Send a request with `workspaceId=W-B` in the body / header / URL. Assert the request is scoped to W-A regardless of the override attempt.
3. **Role enforcement (Viewer).** Authenticate as Viewer of W-A. Attempt a mutation. Assert 403.
4. **Role enforcement (Owner).** Authenticate as Owner of W-A. Same mutation. Assert 200.

The shared fixture pattern from PR #19's `withFixture` infrastructure should be specialized as a `withTwoWorkspacesAndUsers` (or similar) fixture so every entity test reuses the setup rather than re-rolling it.

**Plus a security testing pass:** explicit cross-pollination probes — try to read, write, update, and delete every entity in a workspace the test user isn't a member of. Runs in the **pre-release tier** per ADR 0002 (too expensive for per-commit; runs before declaring a release "stable").

## Consequences

### Positive

- **Single source of DDL truth.** All schema changes go through `drizzle-kit`; no parallel migration system.
- **Workspace isolation is a JWT property.** A handler cannot accidentally serve cross-workspace data because the workspace ID isn't in the request payload.
- **Forensic clarity.** Every action's audit trail naturally includes the JWT's `userId` + `currentWorkspaceId`; "who did what in which workspace" is unambiguous.
- **Security posture matches PJS3's data sensitivity.** Hard email gate, no magic links, full re-auth on workspace switch — aligns with the personal-data-handling level the app warrants.
- **Multi-membership handled cleanly.** No "muddied role" because the user explicitly picks a workspace at login (or workspace switch); role is unambiguous within a session.

### Negative

- **Re-auth friction on workspace switch.** Users with multiple workspaces re-enter credentials each time they switch. Bounded by the fact that switches are rare events for most users (one personal workspace, occasional invited-to workspaces).
- **Multi-tab same-session restriction.** Users who want to work in two workspaces simultaneously must use separate browser sessions. Less convenient than tab-per-workspace, but intentional.
- **Better-Auth's pluggable schema means we accept its column shapes where it doesn't yield.** Some column names may not match project conventions if Better-Auth requires them. Documented case-by-case as encountered.
- **JWT-embedded role means staleness up to TTL.** A demoted user can act with their old role until JWT renewal. Mitigated by 4h default TTL; instant-revocation deferred to a future ADR if needed.

## Alternatives considered

- **Workspace context in URL** (`/api/workspaces/{workspaceId}/...`, à la Slack / Notion / GitHub orgs). Cleaner REST shape; no token reissue on switch. Rejected because PJS3's user pattern (most time spent in one workspace) makes per-request workspace context overkill, and the explicit-selection model gives stronger forensic and accidental-action guarantees.
- **Workspace context in a cookie or custom header instead of JWT.** Same end result; rejected because JWT carries it natively without a parallel mechanism, and PJS3 will need JWT for the API anyway.
- **Magic links.** Rejected — security argument above.
- **Per-request DB role lookup instead of JWT-embedded role.** Rejected for MVP because the staleness window is bounded by the configurable TTL. Reconsider if instant revocation becomes a real requirement.
- **Workspace + Owner membership created at signup.** Rejected — unverified-user signups would pollute the DB with bogus workspace records. Materialization is deferred to first verified sign-in.
- **Soft re-auth on workspace switch (token refresh only, no credentials).** Rejected because it doesn't defend against session-hijack-then-pivot attacks. The friction cost is acceptable given switch-events are rare.

## Open questions

- **Better-Auth column-name conventions.** Which Better-Auth columns we can rename to project conventions vs. which are pinned by Better-Auth's internal expectations. Surface as encountered during integration.
- **Session TTL upper bound.** 240-minute default is set; the upper bound for user-configurable TTL is provisionally 10080 minutes (7 days) but not yet committed. Resolve when the user-settings UI lands.
- **Cross-workspace isolation HTTP response shape.** Lean is **404** (security through info-non-leakage — don't reveal that a resource exists if the requester isn't entitled to know). Confirm vs. revisit when the first entity's HTTP handler is written; document the final call in this ADR or a follow-up.
- **Lookup-table column names** for the workspace-scoped lookups (`positionType`, `workModel`, `applicationMethod`, `activityType`) where the bare-noun convention collides with the table name. Resolve case-by-case as each table arrives.
- **Instant-revocation scenarios.** If / when PJS3 acquires a context where instant role revocation matters (B2B, employee termination, security incident), revisit the JWT-embedded-role vs DB-lookup tradeoff.

## References

- [ADR 0001](0001-database-setup-and-test-isolation.md) — per-test DB lifecycle + forensic fixture log; the cross-workspace isolation tests this ADR mandates are exercised through that infrastructure.
- [ADR 0002](0002-test-cadence-and-tiering.md) — test cadence; the security-testing pass for cross-pollination probes runs in the pre-release tier.
- [MVP_SCOPE.md](../../MVP_SCOPE.md) — tenancy model, definition-of-done, explicitly-deferred items.
- The project's TDD-first stance — every layer of this design lands red/green.
