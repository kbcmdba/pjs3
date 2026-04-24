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

## Open Questions (pending leader intent)

1. **Repo layout** — single repo with `api/` + `web/` subdirectories, or npm workspaces monorepo? Leaning single-repo-subdirs for MVP; migrate later if shared code emerges.
2. **Email sending** for verification, password reset, and workspace invitations — SMTP relay, Resend, Postmark, or other? Needs at least a dev-mode inbox for TDD.
3. **Seed data strategy** — minimal seed + per-test fixtures (leaning this), vs. full demo dataset.
4. **Deployment target** — naming only: local dev → staging → prod. Details TBD.

## Changelog

- 2026-04-23: Initial draft with per-user tenancy (superseded).
- 2026-04-23: Revised for workspace tenancy (ownership + sharing) per leader intent.
