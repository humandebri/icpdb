# ICPDB

ICPDB is a hosted SQLite database for Internet Computer identities. It provides:

- a Rust control canister and database-shard canister
- a generated TypeScript SDK package, `@icpdb/client`
- a Next.js console at `/icpdb`
- a package CLI, `icpdb`, for Server/CI jobs using `service.env`
- Candid and HTTP surfaces for SQL, table inspection, archive/restore, token
  sessions, usage, permissions, and sharding

The product target is a normal SQLite database path on IC. Turso/libSQL-shaped
APIs are migration aids at the SQL-client edge only. ICPDB keeps IC identities,
`icpdb://` URLs, principal ACLs, and canister execution semantics explicit.

## Quick Map

Use this README for the shortest working paths and operational constraints.
Detailed protocol and lifecycle docs stay in:

- `docs/SQLITE_ADMIN_PROTOCOL.md`: adapter Candid contract
- `docs/DB_LIFECYCLE.md`: database status, archive, restore, and slot model
- `docs/SHARDING.md`: database-canister routing, routed operations, and recovery
- `docs/GOAL_AUDIT.md`: goal evidence and release-gate audit notes
- `icpdb-console/README.md`: console-specific local setup

Repository layout:

```text
crates/icpdb_canister           Public control canister entrypoints and Candid API
crates/icpdb_database_canister  Internal database-shard canister
crates/icpdb_runtime            SQLite runtime, lifecycle, quota, and services
crates/icpdb_types              Shared SQLite admin, lifecycle, and hosted types
icpdb-console                   Next.js console and generated SDK package
scripts                         Build, CLI, smoke, release, and operator helpers
```

SQLite storage uses `ic-sqlite-vfs` directly on stable memory:

- canister builds target `wasm32-unknown-unknown`
- no WASI filesystem, `stable-fs`, `ic-wasi-polyfill`, or `wasi2ic`
- one user DB consumes one `ic-sqlite-vfs` `MemoryId`

## Local Canister

Build, start the local IC network, deploy, then run the focused local CLI smoke:

```bash
bash scripts/build-icpdb-canister.sh
icp network start -d -e local-icpdb
icp deploy -e local-icpdb
node scripts/icpdb-local-cli-smoke.mjs
```

If the Wasm target is missing:

```bash
rustup target add wasm32-unknown-unknown
```

Stop the local network when done:

```bash
icp network stop -e local-icpdb
```

## Web Console

Run the console:

```bash
cd icpdb-console
pnpm install
cp .env.local.example .env.local
pnpm dev
```

Required browser env:

```bash
NEXT_PUBLIC_ICPDB_IC_HOST=http://127.0.0.1:8001
NEXT_PUBLIC_II_PROVIDER_URL=http://id.ai.localhost:8000
NEXT_PUBLIC_ICPDB_CANISTER_ID=<local-icpdb-canister-id>
```

Open `http://localhost:3000/icpdb`.

Shortest console path:

1. Login with Internet Identity.
2. Create a database.
3. Run the starter batch that creates `notes`, inserts a row, shows schema, and
   previews rows.
4. Use the table, schema, SQL, permissions, archive/restore, dump/load, and
   shard panels from the same DB view.
5. Copy the `Connection URL` for SDK, CLI, or Server/CI handoff.

The console includes searchable database/table navigation, SQL query/update
runner, table editor, schema inspection, permissions, usage/quota views,
archive/restore controls, SQL dump/load, and shard placement/journal panels.

Generic adapter mode can point the SQL/table UI at another canister that
implements the SQLite Admin Protocol:

```text
/icpdb?mode=adapter&canisterId=<canister-id>&databaseId=<database-id>
```

`databaseId` defaults to `default`, so a single-database canister can use:

```text
/icpdb?mode=adapter&canisterId=<canister-id>
```

Adapter mode uses only the SQLite Admin Protocol methods: `list_tables`,
`describe_table`, `preview_table`, `sql_query`, `sql_execute`, and `sql_batch`.
Hosted-only controls are disabled in adapter mode, including DB creation,
permissions, tokens, billing, archive/restore, routed operation lookup, SQL
dump/load, and shards. The target canister remains responsible for authorizing
the logged-in Internet Identity principal.

## SDK Quickstart

Install the generated SDK package:

```bash
npm install @icpdb/client
pnpm add @icpdb/client
yarn add @icpdb/client
bun add @icpdb/client
```

Browser apps that use Internet Identity also need:

```bash
npm install @icpdb/client @icp-sdk/auth
```

When consuming the SDK artifact from this checkout:

```bash
pnpm --dir icpdb-console build:sdk
npm install ./icpdb-console/dist-sdk
```

Shortest browser/app path:

```ts
import { AuthClient } from "@icp-sdk/auth/client";
import { createClient, sql } from "@icpdb/client";

const DELEGATION_TTL_NS = BigInt(8) * BigInt(3_600_000_000_000);
const authClient = await AuthClient.create();
const host = window.location.hostname;

if (!(await authClient.isAuthenticated())) {
  await new Promise<void>((resolve, reject) => {
    authClient.login({
      identityProvider: host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")
        ? "http://id.ai.localhost:8000"
        : "https://id.ai",
      maxTimeToLive: DELEGATION_TTL_NS,
      onSuccess: () => resolve(),
      onError: (error) => reject(new Error(error ?? "Internet Identity login failed"))
    });
  });
}

const db = createClient({
  canisterId,
  identity: authClient.getIdentity(),
  setupSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)"
});

await db.execute(sql`INSERT INTO notes(body) VALUES (${"hello"})`);
const result = await db.query("SELECT id, body FROM notes ORDER BY id DESC");
const rows = result.rows;
const connectionUrl = await db.connectionUrl();
const info = await db.info();
```

Reconnect with a DB-bearing URL:

```ts
import { connectClient } from "@icpdb/client";

const db = connectClient({ connectionUrl, identity });
const note = await db.get("SELECT id, body FROM notes ORDER BY id DESC LIMIT 1");
```

The SDK rejects anonymous principals at client creation time. Browser code passes
the IC identity object, not a principal string or database bearer token.

## SDK Shape

Primary package paths:

- `@icpdb/client`: identity-first app/browser SDK
- `@icpdb/client/browser` and `@icpdb/client/web`: browser-safe aliases
- `@icpdb/client/server`: Server/CI helpers and file archive/restore helpers
- `@icpdb/client/node`: Node alias for existing imports
- `@icpdb/client/sqlite`: hosted SQLite names such as `createSqliteClient`
- `@icpdb/client/libsql`: libSQL-shaped migration helpers

Local development imports mirror those paths under `icpdb-console`,
`icpdb-console/browser`, `icpdb-console/server`, and related subpaths.

Core app methods:

- SQL: `execute`, `query`, `queryRows`, `queryOne`, `all`, `get`, `values`,
  `first`, `firstValue`, `scalar`, `prepare`, `run`
- groups: `batch`, `transaction`, `exec`, `executeMultiple`, `executeScript`,
  `migrate`
- schema/table: `schema`, `tables`, `views`, `describe`, `columns`, `indexes`,
  `triggers`, `foreignKeys`, `preview`, `inspect`
- operations: `status`, `getUsage`, `listUsageEvents`, `placement`,
  `getRoutedOperation`, `waitForRoutedOperation`, `reconcileRoutedOperation`
- lifecycle: `archive`, `snapshotInfo`, `restore`, `delete`, `connectionUrl`,
  `url`, `info`, `databaseId`, `close`, `reconnect`

`createClient({ canisterId, identity, setupSql })` creates a hosted DB on the
first SQL call. `connectClient({ connectionUrl, identity })` requires an
existing DB and never creates one. Setup options reject existing database
selection; use `exec`, `batch`, or `migrate` for setup on an existing DB.

SQL statements accept positional arrays, named `args`, named `params`, and
libSQL-style `[sql, args?]` tuples. SQLite integer result cells default to
strings to avoid precision loss; opt into number or bigint modes only when
needed.

Turso/libSQL-shaped code can keep ordinary SQL calls and replace only the
connection/auth boundary:

```ts
import { createLibsqlClient } from "@icpdb/client/libsql";

const libsqlDb = createLibsqlClient({ url: connectionUrl, identity });
await libsqlDb.execute({ sql: "INSERT INTO notes(body) VALUES (:body)", args: { body: "from-libsql" } });
const rows = (await libsqlDb.execute("SELECT id, body FROM notes ORDER BY id DESC")).rows;
libsqlDb.close();
```

ICPDB does not implement `authToken`, `libsql://`, embedded replica sync,
`ATTACH`, or multi-call interactive transactions. The compatible subset is the
common SQL client surface: `execute`, `batch`, named SQLite placeholders,
`rows`, `columns`, `rowsAffected`, `changes`, `lastInsertRowid`, `close()`, and
`reconnect()`.

## Server/CI

Server/CI jobs should use a dedicated service identity stored in `service.env`.
Do not share a browser Internet Identity private key. The database ACL is the
join point between the browser owner principal and the service principal.

Create a new Server/CI-owned DB and persist `service.env`:

```bash
icpdb init \
  --canister-id <canister-id> \
  --network-url https://icp-api.io \
  --env-out service.env \
  --setup-file ./schema.sql \
  --format table

icpdb inspect-env --format table
icpdb check-env --require-role owner --smoke-sql --smoke-sdk --format table
```

For a one-table smoke without a schema file:

```bash
icpdb init \
  --canister-id <canister-id> \
  --network-url https://icp-api.io \
  --env-out service.env \
  --setup-sql "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)" \
  --format table
```

After `service.env` exists, commands read it from the current directory by
default:

```bash
icpdb execute "INSERT INTO notes(body) VALUES (?1)" \
  --params '["from-ci"]' \
  --idempotency-key ci-notes-insert-001 \
  --wait

icpdb query "SELECT id, body FROM notes ORDER BY id DESC" --format table
icpdb scalar "SELECT count(*) FROM notes" --format table
icpdb tables --format table
icpdb schema notes --format table
icpdb inspect notes --format table
icpdb status --format table
icpdb url --format env
```

Use non-default env files explicitly:

```bash
icpdb check-env --service-env-file ./ci/service.env --require-role writer --smoke-sql --format table
icpdb query "SELECT id, body FROM notes" --service-env-file ./ci/service.env --format table
```

`service.env` files can contain private keys and must be owner-only mode `0600`.
Choose exactly one secret source:

- `ICPDB_IDENTITY_JSON`
- `ICPDB_IDENTITY_JSON_FILE`
- `ICPDB_IDENTITY_PEM`
- `ICPDB_IDENTITY_PEM_FILE`

If `ICPDB_IDENTITY_PRINCIPAL` is present, env loaders verify that the private
key derives the same principal before creating an actor.

Base service env:

```bash
ICPDB_CANISTER_ID=<canister-id>
ICPDB_NETWORK_URL=https://icp-api.io
ICPDB_IDENTITY_PEM_FILE=./service.pem
```

Existing DB selection:

```bash
ICPDB_URL=icpdb://<canister-id>/<database-id>
# or:
ICPDB_CANISTER_ID=<canister-id>
ICPDB_DATABASE_ID=<database-id>
```

Optional setup values for DB creation:

```bash
ICPDB_SETUP_SQL=CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)
ICPDB_SETUP_STATEMENTS=[{"sql":"INSERT INTO notes(body) VALUES (:body)","args":{"body":"from-setup"}}]
ICPDB_SETUP_MIGRATIONS=[{"version":"001","name":"create_settings","sql":"CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)"}]
```

File-backed setup values are also supported. Do not set inline and file-backed
values for the same setup kind at the same time:

```bash
ICPDB_SETUP_SQL_FILE=./schema.sql
ICPDB_SETUP_STATEMENTS_FILE=./statements.json
ICPDB_SETUP_MIGRATIONS_FILE=./migrations.json
```

## Server SDK

Server code can consume the same `service.env` without shell sourcing:

```ts
import {
  archiveDatabaseToFileFromEnvFile,
  createClientFromEnvFile,
  restoreDatabaseFromFileFromEnvFile,
  snapshotInfoFile
} from "@icpdb/client/server";

const db = await createClientFromEnvFile();
await db.execute("INSERT INTO notes(body) VALUES (?1)", ["from-ci"]);
const rows = (await db.query("SELECT id, body FROM notes ORDER BY id DESC")).rows;

const archived = await archiveDatabaseToFileFromEnvFile("./backup.sqlite");
const snapshot = await snapshotInfoFile("./backup.sqlite");
if (snapshot.sha256 !== archived.sha256) throw new Error("snapshot hash mismatch");
await restoreDatabaseFromFileFromEnvFile("./backup.sqlite", { expectedSha256: snapshot.sha256 });
```

`createClientFromEnvFile()` is the shortest create-or-connect path. If the env
only has a canister URL, the first SQL call creates an empty DB, writes
`ICPDB_DATABASE_ID` and the DB-bearing `ICPDB_URL` back to the file, then
removes create-time `ICPDB_SETUP_*` fields. `connectClientFromEnvFile()` requires
an existing DB-bearing env and never writes the file.

Archive/restore helpers stream bounded chunks and verify SHA-256 before restore
finalization. Backup jobs require owner role.

## Existing DB Handoff

For an existing DB where an owner service env is available, provision a
dedicated service identity:

```bash
icpdb provision-service <database-id> writer \
  --service-env-file owner.env \
  --env-out service.env \
  --format table

icpdb check-env --require-role writer --smoke-sql --format table
```

Use `owner` instead of `writer` for archive/restore jobs:

```bash
icpdb provision-service <database-id> owner \
  --service-env-file owner.env \
  --env-out service.env \
  --format table

icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table
```

For a browser/II-owned DB, generate a service env, copy the printed service
principal, grant it in console Permissions, then verify:

```bash
icpdb generate-identity \
  --canister-id <canister-id> \
  --database-id <database-id> \
  --network-url https://icp-api.io \
  --env-out service.env \
  --format table

icpdb principal --format table
icpdb inspect-env --format table
# Console: Permissions -> Member principal -> paste principal -> choose owner -> Grant member access.
icpdb status --format table
icpdb members --format table
icpdb check-env --require-role owner --smoke-sql --smoke-sdk --format table
```

Browser and service principals are intentionally different. Grant the service
principal through the database ACL instead of trying to reuse browser identity
secrets.

## SQL Files, Dump, and Migrations

Use file-backed commands for repeatable setup, import, and CI flows:

```bash
icpdb dump ./dump.sql
icpdb load ./dump.sql --mode write --idempotency-key ci-load-001 --wait
icpdb batch ./read-statements.json --mode read --format table
icpdb transaction ./transaction.json --mode write --idempotency-key ci-tx-001 --wait
icpdb script ./schema.sql --mode write --idempotency-key ci-schema-001 --wait
icpdb exec "CREATE TABLE inline_notes(id INTEGER); INSERT INTO inline_notes(id) VALUES (1)" --idempotency-key ci-exec-001 --wait
icpdb migrate ./migrations.json --idempotency-key ci-migrate-001 --wait
```

`script` and `load` also accept `-` for stdin where supported. Use
`--mode read` when every statement must be routed through the read-query path.

Read SQL classification handles:

- leading whitespace and SQL comments
- `SELECT`, read CTEs, read-only `PRAGMA`, and `EXPLAIN`
- `WITH ... AS MATERIALIZED (...) SELECT ...`
- `WITH ... AS NOT MATERIALIZED (...) SELECT ...`

`executeScript` and dump load split SQL by scanning tokens rather than using a
bare semicolon regex. Trigger bodies stay intact, including nested
`CASE ... END;` blocks inside `CREATE TRIGGER ... BEGIN ... END;`.

SQL dumps preserve `sqlite_sequence` rows for dumped AUTOINCREMENT tables,
paginate sequence reads, and omit generated/hidden INSERT columns from
`PRAGMA table_xinfo`. Restored generated values are recomputed by SQLite.

## Retry-Safe Writes

Remote database-canister writes require an idempotency key. Use the same key
when retrying the same write after a lost response:

```bash
icpdb execute "INSERT INTO notes(body) VALUES (?1)" \
  --params '["retry-safe"]' \
  --idempotency-key notes-insert-001 \
  --wait

icpdb operation notes-insert-001 --format table
icpdb operation-wait notes-insert-001 --reconcile-unknown --format table
```

For SDK calls, set `idempotencyKey` on write statements, batches,
transactions, script execution, or dump loads. Empty or whitespace-only keys are
rejected before requests are built.

Routed operation statuses:

- `pending`: the control canister has recorded the write and is waiting for the
  database canister outcome
- `applied`: the write is confirmed; a retry of the same request succeeds and
  returns the routed operation id without mutating SQLite again
- `failed`: the write failed and can follow the normal failure path
- `unknown`: the write may have applied; reconcile before deciding whether to
  retry with a different key

Request hash mismatches for the same idempotency key are rejected.

## Archive and Restore

Archive/restore requires owner role. A writer `service.env` is for SQL
write/query CI, not backup.

```bash
icpdb archive ./backup.sqlite --format env
icpdb snapshot-info ./backup.sqlite --format env
export ICPDB_SNAPSHOT_HASH=<value-from-snapshot-info>
icpdb restore ./backup.sqlite --expect-snapshot-hash "$ICPDB_SNAPSHOT_HASH" --format table
icpdb status --format table
```

`restore` writes into the selected DB. Pin the SHA-256 from `snapshot-info`
before promoting a snapshot in CI. The owner `check-env` archive/restore smoke
uses scratch DBs and leaves the configured DB intact.

## Shards and Controllers

Controller and shard operations use a canister-only `controller.env`. Do not put
`ICPDB_DATABASE_ID` or a DB-bearing `ICPDB_URL` in that file.

```bash
icpdb generate-identity \
  --canister-id <canister-id> \
  --network-url https://icp-api.io \
  --env-out controller.env \
  --format table

icpdb principal --service-env-file controller.env --format table
icpdb inspect-env --service-env-file controller.env --format table
eval "$(icpdb principal --service-env-file controller.env --format env)" && icp canister settings update -n ic <id> --add-controller "$ICPDB_SERVICE_PRINCIPAL" -f
icpdb health --service-env-file controller.env --format table
icpdb check-env --service-env-file controller.env --smoke-shards --smoke-sdk-shards --format table
```

Useful shard commands:

```bash
icpdb all-placements --service-env-file controller.env --format table
icpdb shards --service-env-file controller.env --format table
icpdb shard-maintain 0 0 0 0 0 0 --service-env-file controller.env --format table
icpdb shard-status <database-canister-id> --service-env-file controller.env --format table
icpdb shard-top-up <database-canister-id> 1000000 --service-env-file controller.env --format table
icpdb shard-migrate <database-id> <database-canister-id> --service-env-file controller.env --format table
icpdb shard-ops --service-env-file controller.env --format table
icpdb shard-reconcile <operation-id> applied --service-env-file controller.env --format table
icpdb shard-reconcile <operation-id> failed "operator verified failure" --service-env-file controller.env --format table
```

Use `applied` only for verified success. Use `failed` with a reason only after
operator verification.

## Mainnet and Release Gates

Run a non-destructive mainnet preflight before spending cycles:

```bash
node scripts/icpdb-mainnet-preflight.mjs
```

The preflight checks canister config, Candid metadata, release Wasm artifact
sizes, SHA-256 hashes, and mainnet mapping state. It does not create, install,
upgrade, or call a mainnet canister. Pass `--canister-id <id>` to include a
known first-deploy canister id before committing the mapping file.

Deploy with `icp-cli` environment syntax:

```bash
icp deploy -e ic -y icpdb
```

After first deploy, commit `.icp/data/mappings/ic.ids.json` with the new
`icpdb` canister id.

Postdeploy checks:

```bash
node scripts/icpdb-mainnet-postdeploy.mjs
node scripts/icpdb-mainnet-postdeploy.mjs --smoke-sql
node scripts/icpdb-mainnet-postdeploy.mjs --smoke-sql --smoke-archive-restore
node scripts/icpdb-mainnet-postdeploy.mjs --skip-call
```

Release checks:

```bash
node scripts/icpdb-release-check.mjs
node scripts/icpdb-release-check.mjs --skip-build --skip-console
node scripts/icpdb-release-check.mjs --with-rust
node scripts/icpdb-release-check.mjs --service-env-file service.env --with-service-env-sql-smoke
node scripts/icpdb-release-check.mjs --controller-env-file controller.env --with-controller-env-shard-smoke
node scripts/icpdb-release-check.mjs --goal-readiness --format table
node scripts/icpdb-release-check.mjs --goal-complete
node scripts/icpdb-release-check.mjs --self-test
```

Use `--goal-readiness --format table` before live final proof. It reports
missing prerequisites, selected mainnet canister id, service/controller env
shape, next commands, and approval-required actions without running live smoke
checks. Use `--goal-complete` only for final goal evidence.

## SQLite Admin Protocol

Any canister can be used with the console when it implements the SQLite Admin
Protocol. The required Candid surface is intentionally small:

- `list_tables(database_id)`
- `describe_table(database_id, table_name)`
- `preview_table({ database_id, table_name, limit, offset })`
- `sql_query({ database_id, sql, params, max_rows, idempotency_key })`
- `sql_execute({ database_id, sql, params, max_rows, idempotency_key })`
- `sql_batch({ database_id, statements, max_rows, idempotency_key })`

`sql_batch` is required because the console uses it for batch SQL and SQL dump
load. Single-database canisters should use `database_id = "default"` rather
than changing the wire contract.

`sql_query` must be read-only. `sql_execute` must require an authenticated
writer or admin. Protected methods must reject anonymous callers, enforce SQL
and response bounds, and perform access checks inside each method.
`canister_inspect_message` is not an authorization boundary.

Hosted sharded implementations set `routed_operation_id` for routed writes so
SDK, CLI, and console callers can inspect or reconcile the operation later.
Direct/local implementations should return `null`.

## HTTP CLI and Tokens

The helper `scripts/icpdb-http.mjs` uses the bearer-token HTTP surface. It is
for curl-compatible external HTTP flows, browser token sessions, or short-lived
sharing. Normal Server/CI automation should use `icpdb` plus `service.env`.

Create a token-backed DB env:

```bash
node scripts/icpdb-http.mjs \
  --network-url https://icp-api.io \
  --canister-id <canister-id> \
  --env-out database.env \
  --statement "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)" \
  --idempotency-key create-notes-001 \
  create-db owner
```

Use the env:

```bash
node scripts/icpdb-http.mjs --env-file database.env query \
  "SELECT id, body FROM notes ORDER BY id DESC"

node scripts/icpdb-http.mjs --env-file database.env \
  --idempotency-key insert-note-001 \
  --wait \
  execute "INSERT INTO notes(body) VALUES ('from-http')"
```

`database.env` contains `ICPDB_TOKEN` and must be owner-only. `ICPDB_URL` can
derive the mainnet HTTP gateway URL and selected database id.

HTTP endpoints include SQL, table inspection, usage, operations,
archive/restore, member management, database delete, and optional hosted demo
billing/token endpoints. See `node scripts/icpdb-http.mjs help` and
`node scripts/icpdb-http.mjs help shell sql` for focused syntax.

## Hosted Demo Billing

Billing and deposit APIs are part of the hosted reference canister, not the
SQLite Admin Protocol. Hosted billing-specific implementation is preserved on
the `billing-hosted-demo` branch.

Current hosted demo constraints:

- read-only `sql_query` calls are free update calls
- write/update APIs can charge after successful execution
- deposit is prepaid ICP top-up, not recurring billing
- `top_up_database_balance` is an operator correction API

Protocol adapter canisters do not need billing, deposits, or payment history.

## Checks

Focused root checks:

```bash
cargo fmt -- --check
cargo test
pnpm --dir icpdb-console test
pnpm --dir icpdb-console typecheck
pnpm --dir icpdb-console lint
node scripts/check-icpdb-http-cli.mjs
node scripts/check-icpdb-identity-cli.mjs
node scripts/check-icpdb-goal.mjs
node scripts/icpdb-release-check.mjs --self-test
```

Console build:

```bash
pnpm --dir icpdb-console build
```

Live local goal smoke:

```bash
icp network start -d -e local-icpdb
icp deploy -e local-icpdb -y
node scripts/icpdb-local-goal-smoke.mjs
icp network stop -e local-icpdb
```

The local goal smoke runs focused CLI, SDK, identity, service-env, controller,
multi-canister, browser, and Internet Identity browser checks. Use
`--list-steps` to see step ids and `--only <step>` to rerun one heavy proof.

Local helper checks:

```bash
/Users/0xhude/Desktop/MyCLI/checker/lint.sh
/Users/0xhude/Desktop/MyCLI/checker/check.sh
```

## Scope Limits

- Hosted demo billing is ICP-only; ckBTC, ckUSDC, and USD-denominated billing
  are future hosted-branch work.
- Hosted demo deposit is prepaid top-up, not automatic recurring billing.
- The canister does not expose raw SQLite or Postgres wire protocols.
- Large responses need pagination or chunking to fit IC response limits.
- Horizontal scaling uses controller-managed database-canister sharding.
- Existing local DBs remain local until explicit migration.
