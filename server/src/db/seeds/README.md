# `server/src/db/seeds/`

Standalone scripts that load data into the database.

[`data/`](../data/) · [`migrations/`](../migrations/) · **`seeds/`**

Git does not track empty directories. This file is the only tracked occupant.
Nothing invokes seeds automatically — neither the server nor the migration
runner knows they exist.

## Writing one

Importing the shared connection no longer applies migrations. Call
`runMigrations` first so a seed always runs against an up-to-date schema:

```ts
import db from "../sqlite"
import { runMigrations } from "../migrate"

runMigrations(db)
db.run("INSERT INTO ...")
```

Run one from anywhere in the repo:

```sh
bun server/src/db/seeds/admin.ts
```
