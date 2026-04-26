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

(none yet — add as they emerge)
