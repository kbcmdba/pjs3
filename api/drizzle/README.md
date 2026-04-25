# `drizzle/` -- generated migration artifacts

This directory is **machine-generated** by `drizzle-kit` (see `npm run db:generate`).
Don't hand-edit; rerun the generator against `src/schema/*` instead.

## Source of truth: the `.sql` files

`0000_initial.sql`, `0001_*.sql`, etc. are the migration files actually applied
to MySQL. These are the canonical schema state. If you want to know what the
database looks like, read these files.

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
