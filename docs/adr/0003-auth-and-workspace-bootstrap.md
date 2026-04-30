# ADR 0003: Auth and workspace-bootstrap design

- **Status:** Accepted
- **Date:** 2026-04-25 (amended 2026-04-30 to replace Better-Auth with a roll-our-own implementation per the 2026-04-26 pivot decision; design preserved)
- **Decision-makers:** kbenton; Claude (collaborator on this project)

## Context

PJS3 is a multi-tenant SaaS with workspace tenancy from day one (Owner + Viewer roles in MVP, post-MVP Collaborator). The next milestone after the test-infrastructure stack (PRs #9–#20) is the auth + workspace-bootstrap layer: signup, email verification, login, session management, workspace creation, role enforcement, and cross-workspace isolation.

This ADR captures the design choices for that layer: how sessions are shaped, how multi-membership is handled, how isolation is enforced. The implementation library is **our own auth code**, not a third-party framework — see "Note on the Better-Auth pivot" below for why.

## Decision

### Schema ownership: Drizzle, project conventions throughout

All auth-related tables live in `src/schema/` alongside domain tables, managed by `drizzle-kit`. Project schema conventions apply uniformly: `<tableName>Id INT UNSIGNED` synthetic PKs, FK-to-catalog over repeated varchars, bare-noun lookup columns, no JSON columns, `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` on append-only tables, etc. (see `project_data_modeling.md` memory for the full convention list.)

The auth tables we expect to need:

- **`user`** — auth subject. Email, hashed password, verification state, account-management columns.
- **`session`** (or rely on JWT alone, see "Sessions" below) — if we keep server-side session records, this is where they live.
- **`emailVerificationToken`** — one-shot tokens for verifying signup emails.
- **`passwordResetToken`** — one-shot tokens for password resets.
- **`workspace`** — the workspace tenancy container.
- **`workspaceMember`** — junction: `(workspaceMemberId, workspaceId, userId, workspaceRoleId, createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`. UNIQUE KEY on `(workspaceId, userId)`.
- **`workspaceRole`** — already exists from PR #13 (system-level lookup, seeded with Owner and Viewer).

**Why:** A single source of DDL truth makes schema review, migrations, and forensic inspection simpler. No external library's table-shape assumptions to negotiate with; project conventions hold without exception.

### Auth methods (MVP and roadmap)

- **MVP:** email + password.
- **Post-MVP:** OAuth (Google, GitHub, possibly others), 2FA.
- **Explicitly rejected: magic links.** A magic link in transit is functionally a password sent in cleartext; anyone in possession of the link has access. The convenience benefit doesn't outweigh the security weakness for an app that holds personal job-search data.

### Email verification: hard gate

A user who has signed up but not yet verified their email **cannot perform any action that writes to the database beyond the unverified `user` row itself**. Specifically: their personal workspace is **not** created at signup, and no `WorkspaceMember` row is created. These materialize **atomically** at first verified sign-in.

**Why:** Prevents pollution of the DB with bogus data from never-confirmed signups (auto-spam, typos, abandoned signups). The DB only holds workspace records for users we know are reachable.

The flow:

1. Signup form: user enters email + password.
2. Auth code hashes the password (argon2id) and creates the `user` row in an unverified state. An `emailVerificationToken` row is also created with a cryptographically random token (≥256 bits).
3. Verification email sent (Mailpit in dev, real provider TBD) containing the token in the link.
4. User clicks the verification link. Endpoint validates the token (single-use, time-limited, indistinguishable failure modes), marks the `user` as verified, deletes the consumed token.
5. User is redirected to sign in.
6. On successful first sign-in:
   - Atomic transaction creates the user's personal `workspace` row + `workspaceMember` row with `workspaceRoleId` = Owner.
   - JWT issued (see "Login" below).
7. Subsequent sign-ins skip the workspace-creation step (already exists).

**Unverified-row TTL: 24 hours.** A periodic cleanup task purges `user` rows that remain unverified for more than 24h after creation. Bounds DB pollution from abandoned signups even though the row exists briefly. The cleanup mechanism (cron job, scheduled task, or manual sweep) settles when the cleanup task is built; the policy is the 24h cap.

### Sessions: JWT, configurable TTL, 4h default

**JWT** ([JSON Web Token, RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519)) is a compact, signed token format that carries claims (key-value pairs) in its payload. The signature lets the server verify a token came from itself without storing per-session state. Standard claim names (`iat`, `exp`, `sub`, etc.) are short by RFC convention because the token is transmitted on every authenticated request — bytes matter.

JWT is PJS3's session bearer. The project is API-first — long-term, the same backend serves the web UI and external API consumers, and JWT is the natural fit for both audiences without two parallel session models. The choice to use the RFC's standard claim names is **interoperability-driven, not deference**: standard JWT libraries (jsonwebtoken, jose, fast-jwt) auto-validate `exp`, debug tools (jwt.io, browser devtools) recognize the names, external API consumers know the shape. We retain the right to deviate from the spec if it ever produces a dumb outcome — and to document the deviation and report it upstream — but for these specific claim names the standard is good enough that compatibility wins.

**TTL:** default 4 hours **of idle time** — activity (any authenticated request) resets the timer. So a user actively working stays signed in indefinitely; a user who walks away gets logged out 4 hours after their last action. **User-configurable** via a setting on `user` (e.g., `sessionIdleTtlMinutes INT UNSIGNED DEFAULT 240`). The unit is **minutes** so users can pick finer-grained timeouts than hours allow (15 or 30 minutes are realistic for security-conscious users). Users with stricter security needs shorten the value; users with longer working windows extend up to a cap (provisionally 10080 minutes = 7 days; cap committed when the user-settings UI lands).

**JWT carries:**

- `userId` — the authenticated user
- `currentWorkspaceId` — the workspace bound to this session
- `currentRoleId` — the user's role in `currentWorkspaceId` (FK to `workspaceRole`)
- `iat` (issued-at, RFC 7519 standard claim) — Unix timestamp when the JWT was issued. Used by signing-key rotation and replay-window checks.
- `exp` (expires-at, RFC 7519 standard claim) — Unix timestamp after which the JWT must be rejected. Server enforces. With idle-TTL re-issuance on activity, `exp` moves forward as the user keeps working.

The JWT is signed with a server-held key (rotated periodically). It's stored in an `HttpOnly` + `SameSite=Lax` + `Secure` cookie for the web UI; external API consumers can also send it in the `Authorization: Bearer …` header. Same JWT, two delivery mechanisms — no parallel session model.

### Login: workspace selection on multi-membership

Users typically belong to multiple workspaces (their personal one, plus any they've been invited to as Viewer). Login is therefore a two-step process:

1. **Authenticate.** User enters credentials; auth code verifies the password against the argon2id-hashed value on `user`. Account-enumeration defenses apply: timing-safe comparison, identical response shape and timing for "wrong password" vs "no such user." Rate limiting on the endpoint (per-IP, per-email).
2. **Select workspace context (if multi-membership).**
   - Query `workspaceMember WHERE userId = ?` for all `(workspaceId, workspaceRoleId)` pairs.
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
3. Auth code re-verifies the password (same timing-safe + rate-limited path as login).
4. *(Post-MVP: 2FA re-triggers here as well.)*
5. Workspace selection menu shown.
6. User picks a workspace.
7. New JWT issued bound to the new workspace+role.
8. Old JWT invalidated (added to a short-lived blacklist that survives until the old JWT's natural `exp`).

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
- **Roll-our-own auth means we own the security details.** Account-enumeration defense, session fixation, password reset token entropy, rate limiting, argon2id parameter tuning, JWT signing key rotation, etc. — all our responsibility. Mitigated by `/security-review` (per global CLAUDE.md) before declaring auth "done," and by the security-test pass per ADR 0002's pre-release tier. Roadmap items (OAuth, 2FA) are also our build, not a library upgrade.
- **JWT-embedded role means staleness up to TTL.** A demoted user can act with their old role until JWT renewal. Mitigated by 4h default TTL; instant-revocation deferred to a future ADR if needed.

## Alternatives considered

- **Better-Auth library** (with the organization plugin and JWT plugin). The original 2026-04-25 design assumed Better-Auth would deliver clean Drizzle integration with project conventions. RTFM-on-the-docs (2026-04-26) revealed three structural mismatches: string/UUID PKs vs `INT UNSIGNED`; `member.role` as a string column conflicting with our `workspaceRole` lookup; the JWT plugin explicitly *not* a session replacement (Better-Auth's primary session model is cookies, contradicting this ADR's JWT-is-session premise). Pivoted to roll-our-own — see "Note on the Better-Auth pivot."
- **Workspace context in URL** (`/api/workspaces/{workspaceId}/...`, à la Slack / Notion / GitHub orgs). Cleaner REST shape; no token reissue on switch. Rejected because PJS3's user pattern (most time spent in one workspace) makes per-request workspace context overkill, and the explicit-selection model gives stronger forensic and accidental-action guarantees.
- **Workspace context in a cookie or custom header instead of JWT.** Same end result; rejected because JWT carries it natively without a parallel mechanism, and PJS3 will need JWT for the API anyway.
- **Magic links.** Rejected — security argument above.
- **Per-request DB role lookup instead of JWT-embedded role.** Rejected for MVP because the staleness window is bounded by the configurable TTL. Reconsider if instant revocation becomes a real requirement.
- **Workspace + Owner membership created at signup.** Rejected — unverified-user signups would pollute the DB with bogus workspace records. Materialization is deferred to first verified sign-in.
- **Soft re-auth on workspace switch (token refresh only, no credentials).** Rejected because it doesn't defend against session-hijack-then-pivot attacks. The friction cost is acceptable given switch-events are rare.

## Open questions

- **Session TTL upper bound.** 240-minute default is set; the upper bound for user-configurable TTL is provisionally 10080 minutes (7 days) but not yet committed. Resolve when the user-settings UI lands.
- **Cross-workspace isolation HTTP response shape.** Lean is **404** (security through info-non-leakage — don't reveal that a resource exists if the requester isn't entitled to know). Confirm vs. revisit when the first entity's HTTP handler is written; document the final call in this ADR or a follow-up.
- **Lookup-table column names** for the workspace-scoped lookups (`positionType`, `workModel`, `applicationMethod`, `activityType`) where the bare-noun convention collides with the table name. Resolve case-by-case as each table arrives.
- **Instant-revocation scenarios.** If / when PJS3 acquires a context where instant role revocation matters (B2B, employee termination, security incident), revisit the JWT-embedded-role vs DB-lookup tradeoff.
- **JWT signing key management.** Generation, storage (env var, Vault, file), rotation cadence, and how rotation invalidates in-flight JWTs (or doesn't) — all unsettled. Resolve when the auth implementation PRs land; the schema PR doesn't depend on this.

## Note on the Better-Auth pivot

This ADR was originally written 2026-04-25 around **Better-Auth** (the organization plugin surfaced as "Workspace," plus the JWT plugin). PR #27 installed the dependency. Reading Better-Auth's docs in detail the next day (2026-04-26) surfaced three structural mismatches:

1. **String/UUID PKs by default.** PJS3's project convention is `INT UNSIGNED` auto-increment. Better-Auth's opt-in `serial` mode keeps TS types as `string` and converts on read/write — workable but a real wrinkle that infects every typed call.
2. **`member.role` as a string column** ("owner", "admin", "member"). PJS3 has a `workspaceRole` lookup table from PR #13 with FK semantics. The two models conflict.
3. **JWT plugin is explicitly not a session replacement.** Better-Auth's docs: "This is not meant as a replacement for the session." Better-Auth's primary session model is cookie-based with server-side state. ADR 0003's "JWT is the session bearer" premise contradicts this.

User decision: roll our own auth library. Schema purity and project-convention coherence won over framework convenience. The *design* in this ADR (email-verification gate, workspace selection at login, full re-auth on workspace switch, idle TTL with activity-resets-timer, browser-binding, JWT-bound workspace context) carries over intact; only the implementation library changes. See PR #28 (auth-pivot doc) and PR #30 (Better-Auth dep removed).

The lesson worth carrying forward: **validate framework fit before designing around it.** An ADR that names a library should include a fit-check pass — read the library's actual schema, default behaviors, and stated non-features — *before* building a design on assumed behavior. Caught here at acceptable cost (no schema files written yet); discovery cost would have been much higher after.

## References

- [ADR 0001](0001-database-setup-and-test-isolation.md) — per-test DB lifecycle + forensic fixture log; the cross-workspace isolation tests this ADR mandates are exercised through that infrastructure.
- [ADR 0002](0002-test-cadence-and-tiering.md) — test cadence; the security-testing pass for cross-pollination probes runs in the pre-release tier.
- [MVP_SCOPE.md](../../MVP_SCOPE.md) — tenancy model, definition-of-done, explicitly-deferred items.
- [RFC 7519: JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519) — the spec underlying this ADR's session model. Defines the standard claim names (`iat`, `exp`, etc.) we follow for interoperability with JWT libraries and tooling.
- The project's TDD-first stance — every layer of this design lands red/green.
