# `server/src/db/drafts/`

**written by Claude Opus 5**

Staging area for migrations that are not finished yet.

[`data/`](../data/) · **`drafts/`** · [`migrations/`](../migrations/)

---

> [!NOTE]
> **This README is load-bearing.** It is the only tracked file here, and Git
> does not track empty directories. Unlike its siblings this directory has no
> runtime role — `../migrate.ts` never reads it, which is precisely the point.

## Why bother

A half-written migration left in [`../migrations/`](../migrations/) is applied
on the very next boot. If it happens to be valid SQL it succeeds, gets recorded
in `schema_migrations`, and is then effectively frozen: the runner skips
versions it has already applied, so editing the file afterwards changes nothing.

Drafting here removes that risk. Nothing in this directory can execute, so work
in progress cannot quietly become part of your schema history.

## Workflow

**1. Draft.** The runner never reads these files, so name them however you like.

**2. Test.** Apply the SQL to a throwaway copy of the real database, so the
draft is checked against the schema it will actually meet:

```sh
cp server/src/db/data/db.sqlite /tmp/draft.sqlite
sqlite3 /tmp/draft.sqlite < server/src/db/drafts/users.sql
```

For a syntax-only check, skip the copy and use an in-memory database:

```sh
sqlite3 :memory: < server/src/db/drafts/users.sql
```

**3. Promote.** Move the file into `../migrations/` as `NNN_name.sql`, taking
the next unused version number:

```sh
mv server/src/db/drafts/users.sql server/src/db/migrations/001_users.sql
```

Only step 3 is hard to undo — see the warning in
[`../migrations/`](../migrations/).
