# ICPDB

ICPDB is an MVP for SQLite hosting on the Internet Computer.

The current product surface is intentionally small:

- an ICPDB control canister hosting multiple isolated SQLite databases locally and provisioning database canisters for sharded DBs
- Candid SQL read query and table inspection APIs, plus billed update/write APIs
- ICP prepaid deposit using ICRC-2 approve / transfer_from
- payment history, usage, dump, restore, and token management APIs
- Next.js console at `/icpdb`

Phase 2 cleanup removes the old node/search/graph API and keeps the repository focused on the ICPDB SQL hosting surface.

## Repository

```text
crates/icpdb_canister   Rust canister entrypoints and Candid API
crates/icpdb_database_canister  Internal database-shard canister
crates/icpdb_runtime    SQLite runtime, billing, quota, payments
crates/icpdb_types      Shared SQL, lifecycle, billing, and deposit types
icpdb-console           ICPDB web console
scripts               Canister build helpers
```

SQLite storage uses `ic-sqlite-vfs` directly on stable memory:

- canister builds target `wasm32-unknown-unknown`
- no WASI filesystem, `stable-fs`, `ic-wasi-polyfill`, or `wasi2ic`
- one user DB consumes one `ic-sqlite-vfs` `MemoryId`

Lifecycle details are in `docs/DB_LIFECYCLE.md`. Database-canister sharding design and operator flow are in `docs/SHARDING.md`.

## Local Canister

```bash
bash scripts/build-icpdb-canister.sh
icp network start -d -e local-icpdb
icp deploy -e local-icpdb
node scripts/icpdb-local-cli-smoke.mjs
```

If the canister target is missing:

```bash
rustup target add wasm32-unknown-unknown
```

## Mainnet Preflight

Run a non-destructive deploy check before spending cycles:

```bash
node scripts/icpdb-mainnet-preflight.mjs
```

The preflight verifies the `icpdb` canister config, `.icp/data/mappings/ic.ids.json`, checked Candid metadata, and both release Wasm artifacts. It does not create, install, upgrade, or call a mainnet canister.

If the preflight passes, deploy with `icp-cli` environment syntax:

```bash
icp deploy -e ic -y icpdb
```

After the first deploy, commit `.icp/data/mappings/ic.ids.json` with the new `icpdb` canister id.

## Web Console

```bash
cd icpdb-console
pnpm install
cp .env.local.example .env.local
pnpm dev
```

Required browser env:

```bash
NEXT_PUBLIC_ICPDB_IC_HOST=http://127.0.0.1:8001
NEXT_PUBLIC_II_PROVIDER_URL=http://id.ai.localhost:8001
NEXT_PUBLIC_ICPDB_CANISTER_ID=<local-icpdb-canister-id>
```

Wallet approve env:

```bash
NEXT_PUBLIC_ICPDB_WALLET_SIGNER_URL=https://oisy.com/sign
NEXT_PUBLIC_ICPDB_WALLET_HOST=https://icp-api.io
```

Local signer tests can override `NEXT_PUBLIC_ICPDB_WALLET_HOST`.

The console currently includes:

- searchable database and table navigation with selected/available database badges and lifecycle filters
- Supabase-style paginated table preview with total row count, selected/available table badges, table/view list filtering, current-page table row search, current-page column sort, filtered table CSV download, explicit table row refresh, selected cell value/type/kind, sticky row-number gutter, searchable column/index/trigger/foreign-key schema, schema SQL download, index column metadata, foreign key group/seq/match metadata, generated/hidden column metadata, trigger DDL, and column-aware row editor with enforced read-only/editable status
- SQL query / update runner with result summary, searchable and sortable row-numbered result grid, CSV result download, no-match result state, row-returning batch summary, and searchable/sortable batch result grids
- searchable usage event summary, quota, billing, searchable token scope filtering, permission role filtering, and payment history management
- chunked archive / restore controls with snapshot download/load backed by the canister lifecycle API
- SQL dump download / load controls backed by table inspection and batch SQL APIs
- searchable shard placement and shard journal panels for the database-canister control plane

## Deposit Flow

The UI uses the existing canister APIs:

1. `get_deposit_quote(database_id, amount_e8s)`
2. wallet `icrc2_approve` for the ICP ledger
3. `deposit_with_approval(database_id, amount_e8s)`
4. refresh billing and payment history

Initial rate:

- `1 ICP = 100_000 billing units`
- minimum deposit: `0.01 ICP`
- default ICP transfer fee cache: `10_000 e8s`

`top_up_database_balance` remains an operator correction API and is not exposed in the normal UI.

## Billing Model

Read-only `sql_query` calls are free and remain Candid query calls. They still enforce SQL mode, response limits, and role checks.

Write/update APIs consume billing units only after successful execution. `sql_execute` costs `5` units, and `sql_batch` costs `5 * statement_count` units.

## Table Editor API

The canister exposes read-only inspection calls for a Supabase-style table editor:

- `list_tables(database_id)`
- `describe_table(database_id, table_name)`
- `preview_table({ database_id, table_name, limit, offset })`

These calls require reader access and return SQLite schema objects, column metadata, indexes, triggers, foreign keys, and bounded preview rows.

Bearer token HTTP callers can use the same database surface:

- `POST /v1/sql/query`
- `POST /v1/sql/execute`
- `POST /v1/sql/batch`
- `POST /v1/tables/list`
- `POST /v1/tables/describe`
- `POST /v1/tables/preview`
- `POST /v1/session`
- `POST /v1/placements/get`
- `POST /v1/usage`
- `POST /v1/usage/events`
- `POST /v1/billing`
- `POST /v1/payments/list`
- `POST /v1/operations/get`
- `POST /v1/quota/set`
- `POST /v1/tokens/create`
- `POST /v1/tokens/list`
- `POST /v1/tokens/revoke`
- `POST /v1/archive/begin`
- `POST /v1/archive/read`
- `POST /v1/archive/finalize`
- `POST /v1/archive/cancel`
- `POST /v1/restore/begin`
- `POST /v1/restore/write`
- `POST /v1/restore/finalize`
- `POST /v1/members/list`
- `POST /v1/members/grant`
- `POST /v1/members/revoke`
- `POST /v1/database/delete`

## HTTP CLI

The local helper uses the bearer token HTTP surface without adding dependencies:

```bash
node scripts/icpdb-http.mjs \
  --network-url https://icp-api.io \
  --canister-id <canister-id> \
  create-db owner

# create-db calls Candid create_database and create_database_token, then prints the database_id and owner token.
# create-db --format table flattens database_id, owner_token_id, and owner_token.

node scripts/icpdb-http.mjs \
  --network-url https://icp-api.io \
  --canister-id <canister-id> \
  databases

# databases calls Candid list_databases and prints caller-visible database memberships.

ICPDB_HTTP_BASE_URL=https://<canister-id>.icp0.io \
ICPDB_TOKEN=<database-token> \
node scripts/icpdb-http.mjs tables <database-id>

ICPDB_HTTP_BASE_URL=https://<canister-id>.icp0.io \
ICPDB_TOKEN=<database-token> \
node scripts/icpdb-http.mjs views <database-id>

ICPDB_HTTP_BASE_URL=https://<canister-id>.icp0.io \
ICPDB_TOKEN=<database-token> \
node scripts/icpdb-http.mjs stats <database-id> --format table

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  preview <database-id> <table-name> --limit 25

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  columns <database-id> <table-name> --format table

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  indexes <database-id> <table-name> --format table

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  triggers <database-id> <table-name> --format table

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  foreign-keys <database-id> <table-name> --format table

Add `--format table` to render SQL rows, preview rows with page metadata, schema details, index details, trigger details, foreign-key details, and status responses as terminal tables.
Add `--format csv` to export SQL rows, preview rows, inspect table preview rows, table summaries, columns, indexes, triggers, foreign keys, and record lists as CSV.
For `stats --format csv`, the first row is the database summary and later rows are per-table summaries.
The default non-interactive format remains JSON for scripting.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  placement <database-id>

# placement shows whether the database is local or routed to a database canister.

# Controller placement and shard journal operations use Candid, not database bearer tokens.
node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  placements

node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  shards

node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  shard-status <database-canister-id>

node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  shard-top-up <database-canister-id> 1000000

node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  shard-maintain 1 0 0 1 8 1

node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  shard-ops

node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  shard-reconcile failed <operation-id> "operator verified failure"

node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  operation-reconcile <database-id> <operation-id>

node scripts/icpdb-http.mjs help inspect

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  inspect <database-id> <table-name> --limit 25

Omit `<table-name>` to inspect all table schemas in the database.
All-table inspect supports read, write, and owner tokens. It includes usage, recent usage event summaries with SQL operation labels, returned/affected row totals, table object types, row counts, column counts, schema object counts, and column names.
Owner-token inspect also includes billing.
Use `--access` with an owner token to include token, member, and payment summaries.
Access summaries include token active/revoked status, last-used metadata, member grant time, and payments.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  schema <database-id> [table-name]

# schema output includes table/view, index, and trigger DDL from the inspection metadata.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  dump <database-id> [table-name] > dump.sql

# dump output is SQLite SQL text built from schema metadata and paginated table previews.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  load <database-id> dump.sql \
  --idempotency-key import-001

# load executes a SQL dump through the batch API, skipping dump PRAGMA and transaction wrappers.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  usage <database-id>

# usage is the backend check_usage surface: it maps to Candid get_usage and HTTP /v1/usage.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  usage-events <database-id> --format table

# usage-events shows recent write API summaries, including returned rows and affected rows.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  operation <database-id> <idempotency-key>

# operation checks a remote routed write status by the same Idempotency-Key used for execute/batch.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  billing <database-id>

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  payments <database-id>

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  quota <database-id> 134217728

Quota updates require an `owner` database token.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  create-token <database-id> web-read read

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  tokens <database-id>

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  revoke-token <database-id> <token-id>

Payment history and token create/list/revoke commands require an `owner` database token.
`create-token --format table` flattens the new token secret and metadata.
`tokens --format table` shows token active/revoked status and last-used metadata.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  archive <database-id> ./snapshot.sqlite3

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  restore <database-id> ./snapshot.sqlite3

Archive/restore commands use the chunked HTTP API and require an `owner` database token.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  members <database-id>

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  grant-member <database-id> <principal> reader

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  revoke-member <database-id> <principal>

Member commands require an `owner` database token.
`members --format table` shows member roles and grant time.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  delete-db <database-id>

Database delete requires an `owner` database token.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  --idempotency-key notes-create-001 \
  execute <database-id> \
  "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)"

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  --idempotency-key notes-seed-001 \
  batch <database-id> \
  --statement "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)" \
  --statement "INSERT INTO notes(body) VALUES ('hello')"

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  shell <database-id>

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  shell <database-id> "SELECT count(*) AS total FROM notes"
```

The shell renders grouped `.help`, focused `.help <command>`, `.help sql`, `.tables`, `.views`, `.stats`, `.usage`, `.billing`, `.payments`, `.placement`, `.operation <operation_id>`, `.usage-events`, `.tokens`, `.members`, `.describe`, `.columns`, `.indexes`, `.triggers`, `.foreign-keys`, `.schema`, `.dump`, `.preview`, `.inspect [table] [limit] [offset]`, `.inspect --access`, `.quit`, and SQL result rows in table form by default.
Passing SQL or a dot-command after `<database-id>` runs one shell command without opening interactive mode.
Passing `--format csv` to `shell` renders SQL and dot-command row output as CSV.

Remote database-canister writes require an idempotency key. The browser console generates one automatically for token-session execute / batch requests. CLI `shell` write SQL also generates one automatically. Other CLI write flows should pass `--idempotency-key` for `execute`, `batch`, and `load` when targeting remote placements.

## Checks

```bash
node scripts/check-icpdb-http-cli.mjs
cargo test -p icpdb-runtime
cargo test -p icpdb-canister
icp build

pnpm --dir icpdb-console test
pnpm --dir icpdb-console typecheck
pnpm --dir icpdb-console lint
pnpm --dir icpdb-console build
```

Live local goal smokes:

```bash
icp network start -d -e local-icpdb
icp deploy -e local-icpdb -y
node scripts/icpdb-local-cli-smoke.mjs
node scripts/icpdb-local-multicanister-smoke.mjs
node scripts/icpdb-local-browser-smoke.mjs
node scripts/icpdb-local-ii-browser-smoke.mjs
icp network stop -e local-icpdb
```

## Scope Limits

- ICP only; ckBTC, ckUSDC, and USD-denominated billing are future work.
- Deposit is prepaid top-up, not automatic recurring billing.
- The canister does not expose raw SQLite or Postgres wire protocols.
- Large responses still need pagination or chunking to fit IC response limits.
- Horizontal scaling uses controller-managed database-canister sharding; existing local DBs remain local until explicit migration.
