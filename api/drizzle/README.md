# `drizzle/` -- generated migration artifacts

This directory is **machine-generated** by `drizzle-kit` (see `npm run db:generate`).
Mostly-don't-hand-edit; rerun the generator against `src/schema/*` instead. Some
post-generation hand-edits *are* expected and supported -- see "When hand-edits
are appropriate" below.

## What the schema represents

This directory captures the production database state PJS3 expects. As of the
current `0000_initial.sql`, the seven tables are:

- **`user`** -- auth subjects. Email + argon2id password hash + verification
  state + per-user session-idle-TTL preference + timestamps.
- **`workspace`** -- the multi-tenancy container. Each user's personal
  workspace, plus any they create or are invited to.
- **`workspaceMember`** -- the junction making (workspace × user × role)
  the unit of access. Append-only; role changes are DELETE+INSERT.
- **`workspaceRole`** -- system-level lookup of role names (Owner, Viewer in
  MVP; Collaborator post-MVP). Seeded by `seedReferenceData`.
- **`emailVerificationToken`** -- single-use tokens for verifying signup
  email. 24h TTL. Append-only; deleted on consume.
- **`passwordResetToken`** -- single-use tokens for password reset. 1h TTL.
  Append-only; deleted on consume.
- **`session`** -- server-side session record per issued JWT. The JWT acts as
  a cryptographically-signed handle; this row carries `currentWorkspaceId`,
  `currentRoleId`, `expiresAt`, and `lastActiveAt` (which drives the
  idle-TTL behavior). `jti` (JWT ID, RFC 7519) is the lookup key embedded
  in the JWT's claims.

See [ADR 0003](../../docs/adr/0003-auth-and-workspace-bootstrap.md) for the
auth + workspace-bootstrap design that this schema implements.

## Source of truth: the `.sql` files

`0000_initial.sql`, `0001_*.sql`, etc. are the migration files actually applied
to MySQL. These are the canonical schema state. If you want to know what the
database looks like, read these files.

## When hand-edits are appropriate

drizzle-kit's generated SQL is mostly fine as-is, but a few cases warrant
post-generation hand-editing:

- **Combining ALTER TABLE statements per table.** drizzle-kit emits one
  `ALTER TABLE ... ADD CONSTRAINT ...` per FK, even when multiple FKs target
  the same table. Combining them into a single `ALTER TABLE ... ADD ...,
  ADD ..., ADD ...` is more readable AND lets InnoDB do the table-rewrite
  work once per table instead of once per constraint. Hand-edited in
  `0000_initial.sql`.
- **Adding `RESTRICT` explicitly.** drizzle-kit's default for `.references()`
  with no options is `ON DELETE no action ON UPDATE no action`. Specify
  `{ onDelete: 'restrict', onUpdate: 'restrict' }` in the schema source so
  the generator emits the more readable `RESTRICT` (functionally equivalent
  in InnoDB but reads correctly: "no action" is misleading -- InnoDB does
  take action; it rejects the DELETE/UPDATE).
- **SQL comments documenting why an FK exists or why a constraint is set
  the way it is.** Drizzle's TypeScript-level `// FK ON DELETE RESTRICT: ...`
  comments live in `src/schema/*.ts` and don't make it to the SQL; if a
  reviewer of the migration file would benefit from the rationale, hand-add
  a `-- comment` in the migration after generating.

If `drizzle-kit generate` regenerates the file from a schema change, the
hand-edits get clobbered. Re-apply them before committing.

## Known wart: `-->` is not valid SQL

drizzle-kit emits `--> statement-breakpoint` markers between statements.
**`-->` is not a valid SQL line comment** -- valid line comments require
`-- ` followed by a space. The `-->` lines exist as metadata that
drizzle's migrator (`drizzle-orm/migrator.js`) splits the file on:

```js
const result = query.split("--> statement-breakpoint").map(...)
```

The drizzle migrator strips them out before sending statements to MySQL,
so the `-->` lines never actually reach the database. The migration runs
correctly when invoked through drizzle.

**But:** if a human runs the file directly through `mysql` or another raw
SQL tool (without drizzle's preprocessing), the `-->` lines fail with a
syntax error. Use `npm --prefix api run db:migrate` (drizzle-driven), not
`mysql < drizzle/0000_initial.sql`.

If you genuinely need a raw-SQL-runnable file, post-process the migration
to strip `--> statement-breakpoint` lines before piping to mysql:

```sh
grep -v '^--> statement-breakpoint$' drizzle/0000_initial.sql | mysql ...
```

Worth filing an upstream drizzle issue requesting valid line-comment
syntax (`-- > statement-breakpoint` would work and is one space away
from the current marker). Tracked locally; not blocking.

## `meta/` -- drizzle-kit internal bookkeeping

The two files under `meta/` are drizzle-kit's working state for computing
future migrations:

- `_journal.json` -- ordered list of which migrations have been emitted.
- `<n>_snapshot.json` -- a representation of the schema state *as drizzle-kit
  models it internally*, used to diff against the next `db:generate` run.

These files are committed because dropping them would lose drizzle-kit's
diff-from-prior-state capability -- without them, every `db:generate` run would
think the schema is being created from scratch and emit "drop everything,
recreate" instead of incremental migrations.

## Snapshot field naming -- mind the gap

A reader who opens `meta/<n>_snapshot.json` may be surprised by some field names
that read as if they say something different from what they mean. The snapshot
is drizzle-kit's internal data model serialized to JSON; the field names reflect
*its* internal representation, not the actual schema semantics.

Two examples worth flagging because they tripped review on PR #13:

### `"primaryKey": false` on a column that **is** the primary key

Look at the `id` column:

```json
"id": {
  "name": "id",
  "type": "int unsigned",
  "primaryKey": false,    <-- false even though id IS the PK
  "notNull": true,
  "autoincrement": true
}
```

In drizzle-kit's model, the column-level `primaryKey` boolean is `true` only
if the PK was declared inline as a column-only attribute *without producing
a separate constraint*. When you call `.primaryKey()` on a Drizzle column, the
generator records the PK as a *table-level constraint* in the
`compositePrimaryKeys` map (see below) and leaves the column-level boolean at
`false`. The actual generated SQL still has `PRIMARY KEY(id)` -- the snapshot
is just bookkeeping the constraint at a different level than the field name
suggests.

**Read this as:** "The PK is not declared *only* at the column level; check
`compositePrimaryKeys` for the canonical PK info."

### `"compositePrimaryKeys"` for a one-column primary key

```json
"compositePrimaryKeys": {
  "workspaceRole_id": {
    "name": "workspaceRole_id",
    "columns": ["id"]
  }
}
```

This map holds *all* table-level PK constraints, whether one column or many.
"Composite" is a misnomer in the single-column case -- a composite PK is
multi-column by definition. A clearer name would be `tablePrimaryKeys` or just
`primaryKey`. drizzle-kit's choice of "composite" reads as if it's reserved
for multi-column PKs; it isn't.

**Read this as:** "Table-level primary-key constraints, regardless of column
count."

## When in doubt, read the SQL

The `.sql` files are unambiguous. If the snapshot's wording confuses you, check
the SQL -- it'll show what actually hits MySQL.
