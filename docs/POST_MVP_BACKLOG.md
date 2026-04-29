# PJS3 Post-MVP Backlog

Candidates for post-MVP work. Separate from `MVP_SCOPE.md` so this list can grow without polluting in-scope contract decisions.

Items here are **candidates**, not commitments. When they get committed to a release, they migrate to Forgejo issues (or, if the scope itself shifts, back into `MVP_SCOPE.md`).

## Migrated from PJS2 `todo.php` (2026-04-26)

PJS2's `todo.php` was triaged at this point. Items already covered by PJS3 MVP scope or already named in MVP_SCOPE.md's "Out of Scope" list were dropped. The following PJS2 items represent genuinely new work for post-MVP PJS3:

- **Review panel for saved Searches** — same triage UI pattern as the Job review panel (iframe + minimal status/notes controls + queue navigation), applied to the Search entity once Search CRUD lands. Originally PJS2 todo.php priority 20.
- **User-controlled sorting per list view** — let the user pick sort order on Jobs, Companies, Contacts, Searches. PJS2 default was "by status, then next action due"; PJS3 should make this configurable. Originally priority 30.
- **Time + date activity logging on jobs** — capture *when* something happened (interview at 2pm Tuesday) not just *what* happened. May extend the activity log / Note model. Originally priority 40.
- **Job ↔ Search reclassification** — when a tracked URL turns out to be a search results page (not a posting), allow converting a Job entry into a Search entry without recreating it. Vice versa for the inverse case. Originally priority 40.
- **In-app help system** — contextual help / tooltips / "How do I...?" guides surfaced in the UI itself. Originally priority 95.
- **User manual** — written documentation on how to use the app, separate from in-app help. Originally priority 99.

## Future candidates

### Notes that link to multiple entities — added 2026-04-29

PJS2's note model is `(appliesToTable, appliesToId)` — one note belongs to exactly one job, contact, or company. Most real outreach events touch all three (a LinkedIn InMail to Anish Shah is *about* the Tandem job, *to* the contact, *at* the company). The current workaround is writing parallel notes — manually duplicating content across entities so each surface displays the activity. That fragments the audit trail and creates drift over time.

PJS3 should let a note attach to N entities. Sketch (per KB's data-model framing 2026-04-29):

- **Schema:** drop `appliesToTable` / `appliesToId` from `note`; add a `noteMap` join table with `(noteId, linkToTable, linkToId)`. A note can have 1..N rows in `noteMap`. The "linkTo" verb is more accurate for the N:N case than "appliesTo" was in the legacy 1:1 model.
- **UI:** when creating a note, pick a "primary" entity (where the note is composed from) plus optional secondary links (tags). Note detail shows the primary; entity detail pages show notes where they're either primary or linked.
- **Migration:** strictly additive. Every existing PJS2 note becomes one row in `noteMap` with `linkToTable` / `linkToId` populated from the legacy `appliesToTable` / `appliesToId`. No data loss; legacy columns can be dropped after the migration verifies.
- **Reporting impact:** weekly work-search reports can pull notes by *any* linked entity without missing cross-entity activity. (Current PJS2 friction: needing to read both job-side and contact-side notes to reconstruct one outreach event.)
- **Extensibility:** because `linkToTable` is an enum/string column, adding a new entity type that supports notes (Search, Keyword, Interview, Recruiter, Workspace, etc.) is a one-line enum addition — no schema migration on `noteMap` itself. Compare to the unscalable alternative where you'd add separate `linkToCompany` / `linkToContact` / `linkToJob` columns and have to alter the table every time the model grows.

Surfaced 2026-04-29 when an Anish Shah Tandem InMail had to be logged twice — once on the contact and once on the job — to show up correctly in both views.
