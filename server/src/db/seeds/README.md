# `server/src/db/seeds/`

Standalone scripts that load data into the database.

Git does not track empty directories. This file is the only tracked occupant.
Nothing invokes seeds automatically.

## Writing one

Call `runMigrations` first so a seed always runs against an up-to-date schema:

```ts
import { db } from "@server/db/sqlite"
import { runMigrations } from "@server/db/migrate"

runMigrations(db)
db.run("INSERT INTO ...")
```

Run one from anywhere in the repo:

```sh
bun server/src/db/seeds/admin.ts
```
