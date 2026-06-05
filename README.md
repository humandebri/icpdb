# ICPDB

ICPDB is a hosted SQLite database for Internet Computer identities, with an SDK,
console, and CLI surface for creating a DB, running SQL, inspecting schema, and
operating archive/restore and shards.

The primary product target is a normal SQL DB path on IC, not full Turso
compatibility. Priority order:

1. app SDK that feels like a normal SQL database client
2. shortest DB creation to `query` / `execute` path
3. console schema, table, and SQL inspection
4. CLI and `service.env` operation from Server/CI
5. archive/restore and shard operation
6. auth and permission polish

Turso/libSQL compatibility is a migration aid at the SQL-client edge only. ICPDB
keeps IC identities, `icpdb://` connection URLs, principal ACLs, and canister
execution semantics explicit, so `authToken`, `libsql://`, embedded replica
sync, and multi-call interactive transactions are not product goals.

The current product surface is:

- generated standalone TypeScript SDK package `@icpdb/client` for app/browser
  identities and Node service identities
- one-client hosted DB creation for multiple isolated SQLite databases, setup
  SQL, `query` / `execute`, table inspection, archive/restore, and member/usage
  operations
- Next.js console at `/icpdb` for database creation, schema/table inspection,
  SQL editing, table editing, permissions, archive/restore, and shard views
- package `icpdb` CLI and `service.env` flow for Server/CI automation without browser
  login or database bearer tokens
- Candid and HTTP surfaces for SQL, table inspection, archive/restore, token
  sessions, usage, and controller-managed database-canister sharding

The protocol-first shape keeps custom application canisters free to implement
only the SQLite adapter surface they need. Hosted billing and deposit flows are
kept out of the main product narrative and preserved separately on the
`billing-hosted-demo` branch.

## Repository

```text
crates/icpdb_canister   Rust canister entrypoints and Candid API
crates/icpdb_database_canister  Internal database-shard canister
crates/icpdb_runtime    SQLite runtime, lifecycle, quota, and hosted demo services
crates/icpdb_types      Shared SQLite admin, lifecycle, and hosted demo types
icpdb-console           ICPDB web console
scripts               Canister build helpers
```

SQLite storage uses `ic-sqlite-vfs` directly on stable memory:

- canister builds target `wasm32-unknown-unknown`
- no WASI filesystem, `stable-fs`, `ic-wasi-polyfill`, or `wasi2ic`
- one user DB consumes one `ic-sqlite-vfs` `MemoryId`

The SQLite Admin Protocol is documented in `docs/SQLITE_ADMIN_PROTOCOL.md`.
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

The preflight verifies the `icpdb` canister config, checked Candid metadata,
both release Wasm artifact sizes and SHA-256 hashes, and mainnet mapping state. If
`.icp/data/mappings/ic.ids.json` does not exist yet, or exists without an
`icpdb` entry, the mapping is reported as `missing` instead of failing the
pre-deploy check. The current mapping file contains only `wiki`, so the ICPDB
mainnet target remains intentionally unconfigured until first deploy. It does
not create, install, upgrade, or call a mainnet canister. Pass
`--canister-id <id>` to include a known first-deploy canister id in the non-live
preflight output before committing the mapping file.

If the preflight passes, deploy with `icp-cli` environment syntax:

```bash
icp deploy -e ic -y icpdb
```

After the first deploy, commit `.icp/data/mappings/ic.ids.json` with the new `icpdb` canister id.

Verify the deployed canister without creating a database:

```bash
node scripts/icpdb-mainnet-postdeploy.mjs
```

Use `--format env` when CI should pass non-secret deployed-canister values such
as `ICPDB_MAINNET_CANISTER_ID`, `ICPDB_MAINNET_HTTP_BASE_URL`, and
`ICPDB_MAINNET_VERIFICATION_MODE` to later steps. SQL smoke env output also
includes `ICPDB_MAINNET_SQL_SMOKE_DATABASE_ID`,
`ICPDB_MAINNET_SQL_SMOKE_DELETED`,
`ICPDB_MAINNET_SQL_SMOKE_ARCHIVE_RESTORE_HASH`, and
`ICPDB_MAINNET_SQL_SMOKE_ARCHIVE_RESTORE_SIZE_BYTES` when those checks run.

After a deploy from an owner/controller identity, run an explicit SQL smoke that
creates a temporary DB, executes SQL, queries it, verifies scalar reads, and
deletes the DB:

```bash
node scripts/icpdb-mainnet-postdeploy.mjs --smoke-sql
```

Add `--smoke-archive-restore` when the same smoke should also archive/restore
the temporary DB and verify the restored row:

```bash
node scripts/icpdb-mainnet-postdeploy.mjs --smoke-sql --smoke-archive-restore
```

After provisioning a Server/CI `service.env`, verify the local env diagnosis
against canister-visible status:

```bash
node scripts/icpdb-service-env-check.mjs --format table
```

Use `--format env` when CI should pass non-secret diagnosis fields such as
`ICPDB_SERVICE_CHECK_PRINCIPAL`, `ICPDB_SERVICE_CHECK_CALLER_ROLE`,
`ICPDB_SERVICE_CHECK_SQL_ROW`, `ICPDB_SERVICE_CHECK_SDK_ROW`,
`ICPDB_SERVICE_CHECK_SQL_SCALAR_ROW`, `ICPDB_SERVICE_CHECK_SDK_SCALAR_ROW`,
`ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCRATCH_ARCHIVE_DATABASE_ID`,
`ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCRATCH_RESTORE_DATABASE_ID`,
`ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCRATCH_ARCHIVE_DATABASE_ID`,
`ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCRATCH_RESTORE_DATABASE_ID`,
`ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_HASH`,
`ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_HASH`,
`ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCALAR_ROW`,
`ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCALAR_ROW`,
`ICPDB_SERVICE_CHECK_SHARD_CANISTER_ID`,
`ICPDB_SERVICE_CHECK_SHARD_STATUS_CANISTER_ID`,
`ICPDB_SERVICE_CHECK_SHARD_STATUS_CYCLES_BALANCE`,
`ICPDB_SERVICE_CHECK_SHARD_MAINTENANCE_AVAILABLE_SLOTS`,
`ICPDB_SERVICE_CHECK_SDK_SHARD_CANISTER_ID`,
`ICPDB_SERVICE_CHECK_SDK_SHARD_STATUS_CANISTER_ID`,
`ICPDB_SERVICE_CHECK_SDK_SHARD_STATUS_CYCLES_BALANCE`,
`ICPDB_SERVICE_CHECK_SDK_SHARD_MAINTENANCE_AVAILABLE_SLOTS`,
`ICPDB_SERVICE_CHECK_SHARD_COUNT`, and
`ICPDB_SERVICE_CHECK_SDK_SHARD_COUNT` to later steps.

Use `--skip-call` for CI wiring checks that should validate only the env file,
service identity, and setup counts without calling the canister. It cannot be
combined with `--require-role`, because role proof requires canister-visible
status.

Before the first deploy, pass `--canister-id <id> --skip-call` to verify
postdeploy wiring without requiring a committed mapping file.
The explicit-id wiring-only proof reports `canister_id_source = "argument"` in
preflight output and `ICPDB_MAINNET_VERIFICATION_MODE="mapped_wiring_only"` with
`ICPDB_MAINNET_SKIPPED_CALL="true"` in postdeploy env output. This proves only
the id/URL wiring, not live health, SQL, or archive/restore behavior.

For CI wiring checks that should not call mainnet:

```bash
node scripts/icpdb-mainnet-postdeploy.mjs --skip-call
```

Add `--require-canister-id` when a release gate must fail unless the `icpdb`
mainnet canister id is already mapped or passed explicitly:

```bash
node scripts/icpdb-mainnet-postdeploy.mjs --skip-call --require-canister-id
```

For the non-live release gate that also checks SDK packaging and both CLIs:

```bash
node scripts/icpdb-release-check.mjs
```

CI also runs the release checker in no-build/no-console mode after the focused
root checks, so stale release-gate wiring fails before live mainnet checks:

```bash
node scripts/icpdb-release-check.mjs --skip-build --skip-console
```

Use `--with-rust` to include Rust tests and clippy. Use `--skip-build` for the same release gate without rebuilding Wasm artifacts. Pass `--mainnet-canister-id <id>` when verifying a first deploy before committing `.icp/data/mappings/ic.ids.json`; the release gate forwards it to preflight as `--canister-id <id>` and to postdeploy as `--canister-id <id>`. Pass `--require-mainnet-canister-id` when the release gate must fail on missing mainnet mapping. Pass `--service-env-file service.env` after provisioning Server/CI env to include the principal and connection URL check in the release gate. Pass `--controller-env-file controller.env` after provisioning a canister controller identity to include local controller env inspection. Add `--with-service-env-sql-smoke` and `--with-service-env-archive-restore-smoke` when the release gate should also run live Server/CI SQL and safe scratch-restore checks without using the full goal-completion gate. Add `--with-controller-env-shard-smoke` when the release gate should run the live controller shard preflight.

Use `--goal-complete` only for final goal completion evidence. It reads
cwd-local `service.env` and `controller.env` by default; pass
`--service-env-file <file>` or `--controller-env-file <file>` only for
non-default paths. It refuses `--skip-build`, `--skip-console`, and
`--service-env-skip-call`, fails before expensive local/mainnet checks when
`--goal-readiness` prerequisites are not ready, then runs console test/typecheck
checks, Rust tests/clippy, full local goal smoke, mainnet SQL smoke, mainnet archive/restore smoke, the live
service env status plus SQL/archive/restore smoke checks, and the live
controller env CLI/SDK shard smoke. Use
`--goal-readiness --format table`
first for a compact operator view with the mainnet deploy/preflight/wiring/SQL/archive
commands, service-env shape checks, browser-II/controller handoff commands, completion plan, and next steps; omit
`--format table` when CI wants the full JSON report. It prints a prerequisite report for the mainnet canister id, owner-only service
env file, database connection, service-env/mainnet canister and network match,
absence of DB-bearing create-time setup env, service identity secret, local
`inspect-env` principal loading, `inspect-env` canister/database/URL echo,
owner-only controller env file,
canister-only controller env shape, controller-env/mainnet canister and network
match, controller identity secret, local controller `inspect-env` principal loading,
and controller `inspect-env` canister echo
without running live checks. Readiness accepts either a database-bearing
`ICPDB_URL=icpdb://<canister-id>/<database-id>` or a canister-only
`ICPDB_URL=icpdb://<canister-id>` plus `ICPDB_DATABASE_ID=<database-id>`, and
parses the same single-quoted env values accepted by the identity CLI. For mainnet,
`ICPDB_NETWORK_URL=https://icp-api.io/` is normalized like `https://icp-api.io`.
Referenced
`ICPDB_IDENTITY_JSON_FILE` and `ICPDB_IDENTITY_PEM_FILE` files must also be
owner-only before readiness treats the identity source as valid. The
same readiness report flags `ICPDB_SETUP_*` in a DB-bearing `service.env` and
points existing-DB setup back to `script`, `batch`, or `migrate`. The
same readiness check accepts `--format table` for human inspection and
`--format env` for non-secret CI outputs such as `ICPDB_GOAL_READY`,
`ICPDB_GOAL_MAINNET_CANISTER_ID`,
`ICPDB_GOAL_MAINNET_CANISTER_ID_SOURCE`,
`ICPDB_GOAL_REQUIRED_SERVICE_ENV_ROLE`,
`ICPDB_GOAL_SERVICE_ENV_STATUS`, `ICPDB_GOAL_CONTROLLER_ENV_STATUS`,
`ICPDB_GOAL_MISSING_EVIDENCE_IDS`, per-check `ICPDB_GOAL_CHECK_*`, and
`ICPDB_GOAL_COMPLETION_COMMAND`. It also emits
`ICPDB_GOAL_NEXT_STEP_COUNT` plus numbered `ICPDB_GOAL_NEXT_STEP_<n>` values so
CI can surface the same operator guidance without parsing JSON or table output.
`ICPDB_GOAL_COMPLETION_PLAN_COUNT` plus numbered
`ICPDB_GOAL_COMPLETION_PLAN_<n>` variables expose the same ordered completion plan
with each step id, requirement label, blocked evidence ids, choice metadata, and
approval metadata, external action label, and command/manual items.
On 2026-06-05, `node scripts/icpdb-release-check.mjs --goal-readiness --format table`
and `--format env` reported `ready false` / `ICPDB_GOAL_READY="false"` with
missing `mainnet_canister_id`, `service_env_file`, `service_env_connection`,
`controller_env_file`, and `controller_env_canister`, while still emitting the
mainnet preflight/deploy/SQL/archive commands and local focused evidence commands.
`ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_COUNT` plus numbered
`ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_<n>` variables expose only the external
actions that need approval, including each action's choice metadata and
command/manual items, so CI can surface mainnet deploy, live SQL/archive smoke,
one-of service-env provisioning, Browser/II ACL grant, controller grant, and the
final gate without parsing every completion-plan item. The skip-call wiring
check is excluded from that approval-required list.
It also emits command values such as
`ICPDB_GOAL_MAINNET_DEPLOY_COMMAND`,
`ICPDB_GOAL_MAINNET_PREFLIGHT_COMMAND`,
`ICPDB_GOAL_MAINNET_WIRING_CHECK_COMMAND`,
`ICPDB_GOAL_MAINNET_SQL_SMOKE_COMMAND`,
`ICPDB_GOAL_MAINNET_SQL_ARCHIVE_RESTORE_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_PROVISION_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_GENERATE_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_SCALAR_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_CREATE_TABLE_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_WRITE_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_READ_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_URL_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_INFO_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_OWNER_SMOKE_COMMAND`, and
`ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_COMMAND`. It also emits post-provision
shape check commands for both new and existing owner-key service env paths:
`*_INSPECT_ENV_COMMAND`, `*_STATUS_COMMAND`, `*_MEMBERS_COMMAND`, `*_SCALAR_COMMAND`,
`*_TABLES_COMMAND`, `*_VIEWS_COMMAND`, `*_SCHEMA_COMMAND`,
`*_DESCRIBE_COMMAND`, `*_COLUMNS_COMMAND`, `*_INDEXES_COMMAND`, `*_TRIGGERS_COMMAND`,
`*_FOREIGN_KEYS_COMMAND`, `*_PREVIEW_COMMAND`, `*_INSPECT_COMMAND`, `*_URL_COMMAND`, and
`*_INFO_COMMAND`, plus
`ICPDB_GOAL_SERVICE_ENV_PROVISION_SQL_WRITE_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_PROVISION_SQL_READ_COMMAND`,
`ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_SQL_READ_COMMAND`,
`ICPDB_GOAL_SERVICE_ENV_PROVISION_OWNER_SMOKE_COMMAND`, and
`ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_OWNER_SMOKE_COMMAND`. It also emits
`ICPDB_GOAL_SERVICE_ENV_OWNER_SMOKE_COMMAND`, which is the live owner-role SQL
plus archive/restore smoke that proves `service.env` can run final Server/CI
ops, and `ICPDB_GOAL_LOCAL_OWNER_SERVICE_ENV_SMOKE_COMMAND`, which replays the
local package `icpdb init` owner `service.env` smoke through the default local
goal runner. `ICPDB_GOAL_LOCAL_SDK_SHORTEST_SMOKE_COMMAND` replays only the
SDK shortest one-DB `CREATE TABLE` / `INSERT` / `SELECT` / `scalar` /
`connectionUrl()` handoff smoke for quick local proof, while
`ICPDB_GOAL_LOCAL_SDK_SQLITE_SHORTEST_SMOKE_COMMAND` replays the same one-DB proof
through the explicit hosted SQLite subpath, and
`ICPDB_GOAL_LOCAL_SDK_LIBSQL_SHORTEST_SMOKE_COMMAND` replays the same one-DB proof
through the libSQL-shaped `createLibsqlClient` entry. Browser/II-owned DB handoff is
exposed as `ICPDB_GOAL_BROWSER_II_SERVICE_ENV_GENERATE_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_PRINCIPAL_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_INSPECT_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_GRANT_STEP`,
`ICPDB_GOAL_BROWSER_II_SERVICE_STATUS_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_MEMBERS_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_SCALAR_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_TABLES_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_VIEWS_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_SCHEMA_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_DESCRIBE_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_COLUMNS_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_INDEXES_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_TRIGGERS_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_FOREIGN_KEYS_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_PREVIEW_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_INSPECT_DB_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_URL_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_INFO_COMMAND`,
`ICPDB_GOAL_BROWSER_II_SERVICE_SQL_READ_COMMAND`, and
`ICPDB_GOAL_BROWSER_II_SERVICE_SMOKE_COMMAND`. Controller/shard setup is also
exposed as `ICPDB_GOAL_CONTROLLER_ENV_GENERATE_COMMAND`,
`ICPDB_GOAL_CONTROLLER_ENV_PRINCIPAL_COMMAND`,
`ICPDB_GOAL_CONTROLLER_ENV_INSPECT_COMMAND`,
`ICPDB_GOAL_CONTROLLER_HEALTH_COMMAND`,
`ICPDB_GOAL_CONTROLLER_ADD_COMMAND`,
`ICPDB_GOAL_CONTROLLER_ALL_PLACEMENTS_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARDS_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARD_OPS_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARD_MAINTAIN_DRY_RUN_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARD_CREATE_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARD_REGISTER_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARD_STATUS_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARD_TOP_UP_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARD_MAINTAIN_CREATE_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARD_MIGRATE_COMMAND`,
`ICPDB_GOAL_CONTROLLER_REMOTE_CREATE_DB_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARD_RECONCILE_APPLIED_COMMAND`,
`ICPDB_GOAL_CONTROLLER_SHARD_RECONCILE_FAILED_COMMAND`, and
`ICPDB_GOAL_CONTROLLER_SHARD_SMOKE_COMMAND`, so CI can run the reported next
steps without parsing JSON.
The
report includes `next_steps` for missing or
mismatched prerequisites, plus `service_env_provision_command` for creating a
new Server/CI DB through package `icpdb init` with inline setup SQL and
`service_env_query_only_generate_command` through
`service_env_query_only_owner_smoke_command` for the shortest empty DB smoke plus
immediate `execute` / `query` and owner smoke, plus
`existing_db_service_env_command` for granting an owner service identity to an
existing DB when an owner service env is available.
The table view and completion plan render `choice_group` / `choice_required`
metadata and expand the service-env choices into the post-provision checks:
`inspect-env`, `status`, `members`, `scalar`, `tables`, `views`, `schema`,
`columns`, `indexes`, `triggers`, `foreign-keys`, `inspect`, `url`, and the live owner-role smoke.
For browser/II-owned existing DBs, the report also includes command rows from
`browser_ii_service_env_generate_command` through
`browser_ii_service_smoke_command`: generate a database-bearing `service.env`
with package `icpdb generate-identity`, copy the console Response sidebar
`Connection URL` to identify the browser-owned database id, print the service principal with package `icpdb principal --format table`,
inspect the generated env with package `icpdb inspect-env --format table`, grant
that principal in console Permissions while logged in with the browser Internet
Identity owner, confirm canister-visible role with package
`icpdb status --format table`, confirm ACL membership with package
`icpdb members --format table`, run package
`icpdb scalar 'SELECT count(*) FROM sqlite_schema' --format table`, check DB
shape with package `icpdb tables`, `views`, `schema`, `describe <table>`,
`columns <table>`, `indexes <table>`, `triggers <table>`, `foreign-keys <table>`, and `inspect`,
print `icpdb url --format env` and `icpdb info --format env`, then run package `icpdb check-env` owner-role
env smoke. The same readiness report also prints
`local_owner_service_env_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only service-owner --skip-top-up`,
and passed on 2026-06-05 against local canister
`t63gs-up777-77776-aaaba-cai` with DB `db_fv4pflvnrkvb`, verifying owner
`service.env` SQL/setup checks through package init, setup-file, and migrations.
`local_owner_service_env_backup_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only service-owner-backup --skip-top-up`,
`local_identity_quickstart_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only identity-quickstart --skip-top-up`,
`local_postdeploy_sql_archive_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only postdeploy-sql-archive --skip-top-up`,
`local_service_env_query_only_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,service-query-only --skip-top-up`,
`local_sdk_shortest_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-shortest --skip-top-up`,
`local_sdk_browser_shortest_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-browser-shortest --skip-top-up`,
`local_sdk_sqlite_shortest_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-sqlite-shortest --skip-top-up`,
`local_sdk_libsql_shortest_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-libsql-shortest --skip-top-up`,
`local_console_shortest_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only console-shortest --skip-top-up`,
`local_controller_quickstart_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only controller-quickstart --skip-top-up`,
`local_shards_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only shards --skip-top-up`,
and on 2026-06-05 proved DB `db_pwadvhpxeay4` routed to shard canister
`tz2ag-zx777-77776-aaabq-cai` with HTTP, SDK, and identity remote SQL
archive/restore plus reconcile markers,
`local_browser_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only browser --skip-top-up`,
and on 2026-06-05 verified owner-token browser SQL/table/token/permission,
archive/restore, remote shard routing, and deletion for DB
`db_foztxqlaq32v`, table `browser_notes_1780597988063`, and shard
`tz2ag-zx777-77776-aaabq-cai`,
`local_ii_browser_smoke_command`, which runs
`node scripts/icpdb-local-goal-smoke.mjs --only ii-browser --skip-top-up`,
and on 2026-06-05 verified Internet Identity login, II-owned DB creation,
schema/table/SQL, archive/restore, and deletion for table `ii_notes_1780597784016`,
and
`service_env_full_smoke_command`, which runs
`node scripts/icpdb-service-env-check.mjs` with SQL, SDK, archive, and SDK archive smokes
before the final completion gate. For package-bin owner verification, the report
also prints split `service_env_owner_sql_sdk_smoke_command`,
`service_env_owner_archive_restore_smoke_command`, and
`service_env_owner_sdk_archive_restore_smoke_command` rows before the one-shot
`service_env_owner_smoke_command`. It also prints direct
`service_env_archive_command`, `service_env_snapshot_info_command`, and
hash-pinned `service_env_restore_command` rows for the normal archive /
snapshot-info / restore operator path. `completion_plan` also includes the same
split smoke commands as the required `verify_owner_service_env_package_smoke`
step, so CI can run heavy owner checks in stages.
The local default goal smoke also runs
`node scripts/icpdb-local-service-env-owner-smoke.mjs`, which creates a package
`icpdb init` owner `service.env`, checks seeded SQL, and runs package
`icpdb check-env --require-role owner --smoke-sql --format table`.
The full default local goal smoke passed on 2026-06-05 after
`icp network start -d -e local-icpdb` and `icp deploy -e local-icpdb -y`,
printing `ICPDB local goal smoke OK` after HTTP CLI DBs
`db_yia5qanpsoq7`, `db_wvoya56qvv3v`, `db_pmz3ozmxuvvs`,
`db_fyqrpxajsf5k`, and `db_nnt5ixdfzi7r`; SDK main DB
`db_fvoz46aig2oa`; owner `service.env` DB `db_2wbjui5quhwr`; controller
principal `vov4k-sjgk6-xc3xj-xhkbl-fd54i-oww3a-roewn-liaxf-gjl3t-3u42f-pae`;
multi-canister DB `db_s6tqxsnsemzp`; owner-token browser DB
`db_3gmigq2wdben` / table `browser_notes_1780600072519`; II table
`ii_notes_1780600078967`; and shard `tz2ag-zx777-77776-aaabq-cai`.
The optional `service-owner-backup` local goal step adds package
`icpdb check-env --require-role owner --smoke-sql --smoke-archive-restore --format table`
and `icpdb check-env --require-role owner --smoke-sdk-archive-restore --format table`
against scratch archive/restore databases. The same focused smoke also verifies
package `icpdb init --setup-file <file> --format table` next-command output,
view inspection, `icpdb init --setup-migrations-file <file> --format table`,
`icpdb_schema_migrations`, and post-migration table preview before deleting the
created DBs. The focused owner backup smoke passed on 2026-06-05 after local
network start and deploy, printing package CLI and SDK archive/restore owner
service-env markers.
For first mainnet deploys, the
same report includes `mainnet_deploy_command`, `mainnet_preflight_command`, `mainnet_wiring_check_command`,
`mainnet_sql_smoke_command` with explicit `--smoke-sql`, and
`mainnet_sql_archive_restore_command` with explicit `--smoke-sql` plus
`--smoke-archive-restore`; service-env and controller-env setup commands
use a quoted `'<id>'` placeholder until the deployed canister id is known, and
`next_steps` calls out replacing it after deploy, running the SQL smoke command
after wiring, then running the SQL/scalar/archive/restore command. It also calls out replacing
`'<database-id>'` in the browser/II handoff command with the database id from the
console Response sidebar `Connection URL`, and replacing
`'<table>'` in existing-DB detail checks with a real table name from the
`tables` step. It also calls out running
`service_env_provision_command`, `service_env_query_only_generate_command`
through `service_env_query_only_owner_smoke_command`, `existing_db_service_env_command`,
or the `browser_ii_service_env_generate_command` through
`browser_ii_service_smoke_command` rows for the chosen Server/CI handoff, plus
the `controller_env_generate_command` through `controller_shard_smoke_command`
rows for controller/shard proof.
When `--mainnet-canister-id <id>` is already known, `next_steps` still keeps
the non-live `mainnet_preflight_command`, `mainnet_wiring_check_command`, local
postdeploy SQL/archive rehearsal, mainnet SQL smoke, and mainnet archive/restore
smoke sequence visible before service-env and controller-env setup. If the
explicit id is for a first deploy and is not live yet, run `deploy_mainnet`
before `mainnet_wiring_check_command`; skip `deploy_mainnet` only when the
canister is already deployed.
The controller command sequence
generates a canister-targeted `controller.env` with package
`icpdb generate-identity`, `ICPDB_CANISTER_ID`, and `ICPDB_NETWORK_URL`, prints its principal, runs package
`icpdb inspect-env --service-env-file controller.env --format table`
and `icpdb health --service-env-file controller.env --format table`
before the controller grant, shows the `eval "$(icpdb principal --service-env-file controller.env --format env)" && icp canister settings update -n ic <id> --add-controller "$ICPDB_SERVICE_PRINCIPAL" -f` controller grant, runs
`icpdb all-placements`, `icpdb shards`, `icpdb shard-ops`, and zero-action
`icpdb shard-maintain 0 0 0 0 0 0`, then runs
`icpdb check-env --service-env-file controller.env --smoke-shards --smoke-sdk-shards --format table`.
The report also prints `controller_full_shard_smoke_command`, which runs
`node scripts/icpdb-service-env-check.mjs --env-file controller.env --smoke-shards --smoke-sdk-shards --format table`.
The focused controller quickstart smoke passed on 2026-06-05 after local
network start and deploy, printing the controller.env CLI/SDK shard smoke marker.
Readiness and shard smokes reject `controller.env` if it also contains
`ICPDB_DATABASE_ID` or a database-bearing `ICPDB_URL`; controller proof is
canister-level, not database-selected.
Readiness next steps explicitly say not to create database bearer tokens for
goal completion; final proof uses `service.env` service identity and
`controller.env` service identity.
`completion_plan` lists the same actions in
execution order with stable ids, `required` flags, `blocked_by` prerequisites,
`approval_required`, and `external_action`
for CI/job orchestration, including non-mutating mainnet preflight before deploy
and a required staged owner service-env package smoke before controller/shard proof. `missing_evidence` mirrors false readiness checks with
stable ids and concrete evidence labels so CI can report the exact missing
artifact without parsing prose. Alternative paths, such as creating a new
Server/CI DB or granting an existing browser/II DB via console, share a
`choice_group` with `choice_required`.
`approval_required_actions` is the compact approval-only projection of the same
plan; table output renders it as `Approval required actions:`, and env output
renders it as `ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_<n>_*`, including the
choice group, choice-required flag, and filtered command/manual items for each
approval-required action.
`evidence_manifest` groups the final proof commands by requirement: SDK package
artifact, local goal smoke, local postdeploy SQL/archive rehearsal, mainnet
preflight, mainnet wiring, mainnet SQL smoke, mainnet archive/restore smoke,
focused SDK shortest smokes including the browser package subpath, focused Server/CI query-only smoke, focused console
schema/table/SQL smoke, focused package owner `service.env` init/setup smoke,
focused identity quickstart smoke, focused package owner `service.env`
archive/restore smoke, focused controller quickstart smoke, focused multi-canister
shard smoke, full `service.env` smoke, direct `service.env` archive/snapshot-info/restore,
full `controller.env` shard smoke, safe `controller.env` shard-maintain dry-run,
Browser/II service-principal ACL handoff, local II browser smoke, and the final
`--goal-complete` gate.
The mainnet wiring manifest entry is skip-call evidence only: it proves the
selected canister id and HTTP URL wiring, while live health, SQL, and
archive/restore remain separate proof commands.
The manifest separates broad smoke proof from focused SDK shortest, browser package
subpath shortest, service-env query-only, package owner service-env init/setup,
identity quickstart, package owner archive/restore, controller quickstart,
multi-canister shard operation, console schema/table/SQL, local mainnet-style postdeploy SQL/archive
rehearsal, non-mutating mainnet artifact preflight, direct
archive/snapshot-info/restore, zero-action shard-maintain dry-run, Browser/II
service-principal ACL handoff, and local II browser smoke commands.
Env output exposes the same
manifest as `ICPDB_GOAL_EVIDENCE_*` fields for CI logs.
When readiness used `--mainnet-canister-id <id>`, the printed completion
command preserves that explicit id for first-deploy checks before the mapping
file is committed. Dynamic command values are shell-quoted, so a `service.env`
path under a directory with spaces is safe to copy.
The final gate runs local goal smoke before mainnet checks, so mainnet calls are
not used to compensate for local SDK/CLI/console regressions.

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
NEXT_PUBLIC_II_PROVIDER_URL=http://id.ai.localhost:8000
NEXT_PUBLIC_ICPDB_CANISTER_ID=<local-icpdb-canister-id>
```

Hosted demo deposit env:

```bash
NEXT_PUBLIC_ICPDB_WALLET_SIGNER_URL=https://oisy.com/sign
NEXT_PUBLIC_ICPDB_WALLET_HOST=https://icp-api.io
```

Local signer tests can override `NEXT_PUBLIC_ICPDB_WALLET_HOST`.

Console shortest path:

1. Open `/icpdb` and click `Login`.
2. Click `Create database`; the SQL editor opens a starter batch that creates
   `notes`, inserts a seed row, shows `sqlite_schema`, and previews rows.
3. Click `Run batch`, then use `Search result rows`, `Copy result CSV`,
   `Download result CSV`, the table list, and `Open SELECT SQL` to inspect the
   SQL result and created table through the SQL editor.
4. Use the SQL editor `Schema`, `Tables`, `Stats`, `Columns`, `Views`, `Indexes`, `Foreign Keys`, and `Triggers` shortcuts for DB-wide SQLite catalog checks, use `Copy SQL` to copy the current editor SQL, or use `Copy schema SQL`, `Open schema SQL`,
   `Open schema lookup SQL`, `Open column SQL`, `Open foreign key SQL`,
   `Open INSERT SQL`, `Open count SQL`, `Open page SQL`, `Copy page SQL`, and `Copy table CSV` from the table panels when checking
   schema metadata or current-page rows.
5. Confirm `Caller role`, then Copy `Connection URL` from the response sidebar
   for SDK, CLI, or Server/CI handoff.

The console currently includes:

- searchable database and table navigation with selected/available database badges, lifecycle filters, setup SQL handoff from the create-table inputs with a default seed row, and one-click SELECT SQL handoff from a table row
- Create database opens a starter batch that creates `notes`, inserts a seed row, shows its schema SQL, and selects it for the shortest console SQL path
- Supabase-style paginated table preview with total row count, current-page SQL handoff and direct current-page SQL copy, count-SQL handoff, INSERT SQL handoff from table metadata, selected/available table badges, table/view list filtering, current-page table row search, current-page column sort, filtered table CSV copy/download, explicit table row refresh, selected cell value/type/kind, sticky row-number gutter, searchable column/index/trigger/foreign-key schema, schema SQL copy/download/open-in-editor, column and foreign-key PRAGMA SQL handoff, `sqlite_schema` lookup SQL handoff, index column metadata, foreign key group/seq/match metadata, generated/hidden column metadata, trigger DDL, and column-aware row editor with enforced read-only/editable status
- SQL query / update runner with `Run query`, `Run update`, `Run batch`, `Copy SQL`, `Schema` / `Tables` / `Stats` / `Columns` / `Views` / `Indexes` / `Foreign Keys` / `Triggers` SQLite catalog shortcuts, result summary, searchable and sortable row-numbered result grid, CSV result download, no-match result state, row-returning batch summary, and searchable/sortable batch result grids
- searchable usage event summary, quota, token scope filtering, and permission role filtering for the hosted reference canister
- copyable URL-encoded `icpdb://<canister-id>/<database-id>` connection URL in the response sidebar for SDK and Server/CI handoff
- chunked archive / restore controls with snapshot download/load backed by the canister lifecycle API
- SQL dump download / load controls backed by table inspection and batch SQL APIs, preserving AUTOINCREMENT sequence rows and omitting generated/hidden INSERT columns
- searchable shard placement and shard journal panels for the database-canister control plane

## Fast Start: Hosted SQL DB

App code can create a hosted DB, set up schema, write, read, and persist the
connection URL with one SDK client:

Shortest app path:

```ts
import { AuthClient } from "@icp-sdk/auth/client";
import { createClient, sql } from "@icpdb/client";

const DELEGATION_TTL_NS = BigInt(8) * BigInt(3_600_000_000_000);
const host = window.location.hostname;
const identityProvider = host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")
  ? "http://id.ai.localhost:8000"
  : "https://id.ai";
const authClient = await AuthClient.create();
if (!(await authClient.isAuthenticated())) {
  await new Promise<void>((resolve, reject) => {
    authClient.login({
      identityProvider,
      maxTimeToLive: DELEGATION_TTL_NS,
      onSuccess: () => resolve(),
      onError: (error) => reject(new Error(error ?? "Internet Identity login failed"))
    });
  });
}
const identity = authClient.getIdentity();
const db = createClient({ canisterId, identity, setupSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)" });
await db.execute(sql`INSERT INTO notes(body) VALUES (${"hello"})`);
const result = await db.query("SELECT id, body FROM notes ORDER BY id DESC");
const rows = result.rows;
const connectionUrl = await db.connectionUrl();
const info = await db.info();
```

Hosted SQLite apps can use the same client through the explicit SQL DB subpath:

```ts
import { createSqliteClient, sql as sqliteSql, type SqliteRow } from "@icpdb/client/sqlite";

const sqliteDb = createSqliteClient({ canisterId, identity, setupSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)" });
await sqliteDb.execute(sqliteSql`INSERT INTO notes(body) VALUES (${"from-sqlite"})`);
const sqliteRows: SqliteRow[] = (await sqliteDb.query("SELECT id, body FROM notes ORDER BY id DESC")).rows;
const sqliteUrl = await sqliteDb.connectionUrl();
```

libSQL-shaped app code can keep SQL calls and replace only connection/auth with
IC identity and the `icpdb://` connection URL:

```ts
import { createLibsqlClient } from "@icpdb/client/libsql";

const libsqlDb = createLibsqlClient({
  url: connectionUrl,
  identity
});

await libsqlDb.execute({ sql: "INSERT INTO notes(body) VALUES (:body)", args: { body: "from-libsql" } });
const libsqlResult = await libsqlDb.execute("SELECT id, body FROM notes ORDER BY id DESC");
const libsqlRows = libsqlResult.rows;
libsqlDb.close();
```

The SDK rejects the anonymous principal `2vxsx-fae` at client creation time, so
an app cannot silently create or query a DB with a failed II login.

Shortest Server/CI path after `service.env` exists:

```ts
import { createClientFromEnvFile } from "@icpdb/client/server";

const db = await createClientFromEnvFile();
await db.execute("INSERT INTO notes(body) VALUES (?1)", ["from-ci"]);
const result = await db.query("SELECT id, body FROM notes ORDER BY id DESC");
const rows = result.rows;
const connectionUrl = await db.connectionUrl();
const info = await db.info();
// Use an explicit path when service.env is not in the current working directory.
const ciDb = await createClientFromEnvFile("./ci/service.env");
```

If `service.env` only has a canister URL and no setup SQL, the first SQL call
creates an empty hosted DB and writes the DB id back. The same client can then
create a table, write, read, and print the reusable connection handoff:

```ts
const smokeDb = await createClientFromEnvFile();
const firstValue = await smokeDb.scalar("SELECT 1 AS value");
const createResult = await smokeDb.execute({
  sql: "CREATE TABLE readiness_query_only(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
  idempotencyKey: "readiness-query-only-create-table-001",
  wait: true
});
const writeResult = await smokeDb.execute({
  sql: "INSERT INTO readiness_query_only(body) VALUES (?1)",
  args: ["readiness-query-only"],
  idempotencyKey: "readiness-query-only-write-001",
  wait: { reconcileUnknown: true }
});
const smokeRows = await smokeDb.queryRows("SELECT body FROM readiness_query_only ORDER BY id DESC LIMIT 1");
const persistedUrl = await smokeDb.connectionUrl();
const smokeInfo = await smokeDb.info();
```

Owner-role jobs can back up and hash-pin restore from the same `service.env`:

```ts
import {
  archiveDatabaseToFileFromEnvFile,
  restoreDatabaseFromFileFromEnvFile,
  snapshotInfoFile
} from "@icpdb/client/server";

const archived = await archiveDatabaseToFileFromEnvFile("./backup.sqlite");
const snapshot = await snapshotInfoFile("./backup.sqlite");
if (snapshot.sha256 !== archived.sha256) throw new Error("snapshot hash mismatch");
await restoreDatabaseFromFileFromEnvFile("./backup.sqlite", { expectedSha256: snapshot.sha256 });
```

```bash
npm install @icpdb/client
pnpm add @icpdb/client
yarn add @icpdb/client
bun add @icpdb/client
```

Browser Internet Identity login examples also need the auth helper package:

```bash
npm install @icpdb/client @icp-sdk/auth
pnpm add @icpdb/client @icp-sdk/auth
yarn add @icpdb/client @icp-sdk/auth
bun add @icpdb/client @icp-sdk/auth
```

When consuming the generated SDK artifact from this checkout:

```bash
pnpm --dir icpdb-console build:sdk
npm install ./icpdb-console/dist-sdk
```

The package also installs a thin Server/CI bin:

```bash
icpdb help quickstart
icpdb help sdk
icpdb help server
icpdb help init
icpdb help provision-service
icpdb help lifecycle
icpdb help database
icpdb help db
icpdb help databases
icpdb help sql
icpdb help query
icpdb help execute
icpdb help scalar
icpdb help exec
icpdb help batch
icpdb help transaction
icpdb help script
icpdb help load
icpdb help dump
icpdb help migrate
icpdb help inspect
icpdb help schema
icpdb help tables
icpdb help views
icpdb help describe
icpdb help columns
icpdb help indexes
icpdb help triggers
icpdb help foreign-keys
icpdb help preview
icpdb help status
icpdb help stats
icpdb help health
icpdb help usage
icpdb help usage-events
icpdb help placement
icpdb help inspect-env
icpdb help principal
icpdb help url
icpdb help info
icpdb help service-env
icpdb help env
icpdb help check-env
icpdb help generate-identity
icpdb help identity
icpdb help permissions
icpdb help auth
icpdb help token
icpdb help http
icpdb help members
icpdb help grant-member
icpdb help revoke-member
icpdb help backup
icpdb help archive
icpdb help snapshot-info
icpdb help restore
icpdb help operation
icpdb help operation-wait
icpdb help operation-reconcile
icpdb help operations
icpdb help shell
icpdb help shell sql
icpdb help shell delete-db
icpdb help ops
icpdb help placements
icpdb help all-placements
icpdb help shards
icpdb help shard-create
icpdb help shard-register
icpdb help shard-status
icpdb help shard-top-up
icpdb help shard-maintain
icpdb help shard-migrate
icpdb help remote-create-db
icpdb help shard-reconcile
icpdb help shard-ops
icpdb help controller
icpdb help create-db
icpdb help delete-db
icpdb init --canister-id <id> --network-url https://icp-api.io --env-out service.env --setup-sql "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)" --format table
icpdb provision-service <database-id> owner --service-env-file owner.env --env-out service.env --format table
icpdb generate-identity --canister-id <id> --network-url https://icp-api.io --env-out service.env --format table
icpdb inspect-env --format env
icpdb principal --format env
icpdb check-env --require-role writer --smoke-sql --format table
icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table
icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller.env --format table
icpdb url --format env
icpdb info --format env
icpdb databases
icpdb execute "INSERT INTO notes(body) VALUES (?1)" --params '["from-ci"]' --idempotency-key ci-notes-insert-001 --wait
icpdb query "SELECT id, body FROM notes WHERE body = :body" --params-file ./params.json --format table
icpdb query "SELECT id, body FROM notes ORDER BY id DESC" --format csv
icpdb exec "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes(body) VALUES ('from-ci')" --idempotency-key ci-notes-exec-001 --wait
icpdb batch ./statements.json --mode write --idempotency-key ci-notes-batch-001 --wait
icpdb transaction ./transaction.json --mode write --idempotency-key ci-notes-transaction-001 --wait
icpdb script ./schema.sql --mode write --idempotency-key ci-schema-001 --wait
icpdb dump ./dump.sql
icpdb migrate ./migrations.json --idempotency-key ci-migrate-001 --wait
icpdb create-db --setup-sql "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)" --format table
icpdb create-db --setup-statements-file ./setup-statements.json --format env
icpdb create-db --setup-migrations-file ./migrations.json --format env
icpdb create-db --format env
icpdb status --format table
icpdb stats --format table
icpdb usage --format table
icpdb usage-events --format table
icpdb placement --format table
icpdb tables --format table
icpdb views --format table
icpdb schema notes --format table
icpdb describe notes --format table
icpdb columns notes --format table
icpdb indexes notes --format table
icpdb triggers notes --format table
icpdb foreign-keys notes --format table
icpdb preview notes --limit 25 --offset 0 --format table
icpdb inspect notes --limit 25 --format table
icpdb members --format table
icpdb grant-member <service-principal> writer --format table
icpdb revoke-member <service-principal> --format table
icpdb operation <operation-id> --format table
icpdb operation-wait <operation-id> --reconcile-unknown --format table
icpdb shell ".health" --format table
icpdb shell ".url" --format table
icpdb shell ".info" --format table
icpdb shell ".status" --format table
icpdb shell ".stats" --format table
icpdb shell ".tables" --format table
icpdb shell ".describe notes" --format table
icpdb shell ".schema notes" --format table
icpdb shell "SELECT count(*) AS total FROM notes" --format table
icpdb shell "INSERT INTO notes(body) VALUES ('from-shell')" --wait --format table
icpdb shell ".delete-db <database-id>" --format table
icpdb sql "INSERT INTO notes(body) VALUES ('from-sql')" --idempotency-key ci-sql-insert-001 --wait --format table
icpdb sql "SELECT id, body FROM notes ORDER BY id DESC" --format table
icpdb generate-identity --canister-id <id> --network-url https://icp-api.io --env-out controller.env --format table
eval "$(icpdb principal --service-env-file controller.env --format env)" && icp canister settings update -n ic <id> --add-controller "$ICPDB_SERVICE_PRINCIPAL" -f
icpdb inspect-env --service-env-file controller.env --format table
icpdb principal --service-env-file controller.env --format table
icpdb health --service-env-file controller.env --format table
icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller.env --format table
# shard table/json/csv output includes nextShardInventoryCommand, nextAllPlacementsCommand, nextShardOpsCommand, and nextShardMaintainDryRunCommand
# shard canister output includes nextShardStatusCommand and nextShardTopUpCommand
icpdb all-placements --service-env-file controller.env --format table
icpdb shards --service-env-file controller.env --format table
icpdb shard-maintain 0 0 0 0 0 0 --service-env-file controller.env --format table
icpdb shard-create 100000000000 8 --service-env-file controller.env --format table
icpdb shard-register <database-canister-id> 8 --service-env-file controller.env --format table
icpdb shard-status <database-canister-id> --service-env-file controller.env --format table
icpdb shard-top-up <database-canister-id> 1000000 --service-env-file controller.env --format table
icpdb shard-maintain 1 0 0 0 8 0 --service-env-file controller.env --format table
icpdb shard-migrate <database-id> <database-canister-id> --service-env-file controller.env --format table
icpdb remote-create-db <database-id> <database-canister-id> --service-env-file controller.env --format table
icpdb shard-ops --service-env-file controller.env --format table
icpdb shard-reconcile <operation-id> applied --service-env-file controller.env --format table
icpdb shard-reconcile <operation-id> failed "operator verified failure" --service-env-file controller.env --format table
icpdb operation <operation-id> --format table
icpdb operation-wait <operation-id> --reconcile-unknown --format table
icpdb operation-reconcile <operation-id> --format table
icpdb delete-db --confirm <database-id> --format table
icpdb query "SELECT id, body FROM notes ORDER BY id DESC" --format table
icpdb archive ./backup.sqlite --format env
icpdb snapshot-info ./backup.sqlite --format table
icpdb snapshot-info ./backup.sqlite --format env
icpdb restore ./backup.sqlite --expect-snapshot-hash <sha256> --format table
eval "$(icpdb snapshot-info ./backup.sqlite --format env)" && icpdb restore ./backup.sqlite --expect-snapshot-hash "$ICPDB_SNAPSHOT_HASH" --format table
icpdb stats --format table
icpdb restore ./backup.sqlite --expect-snapshot-hash <sha256> --service-env-file ./ci/service.env --format table
```

The bin reads cwd-local `service.env` by default and supports
`--service-env-file <path>` for non-default handoff files.
`--service-env-file` and `--env-file` are for commands that read an existing
service env; `init`, `generate-identity`, and `snapshot-info` reject them
because they use `--env-out`, direct identity target options, or a local
snapshot file instead.
`icpdb help sql` shows auto-routed `sql` for SELECTs, says read SQL uses query
while writes use execute, and states that read-routed `sql` / `execute` reject
`--idempotency-key` and `--wait` before `service.env` or params files are
loaded, so CI read checks do not silently produce empty wait output.
`icpdb exec <sql>` runs an inline semicolon-separated SQL script, while
`icpdb script <file|->` remains the file-backed form.
`--params` and `--params-file` are valid only for `query`, `execute`, `sql`,
and `scalar`; statement groups and scripts carry params in their JSON statement
files instead.
`--mode` is valid only for `exec`, `batch`, `transaction`, `script`, and `load`.
`--expect-snapshot-hash` is valid only for top-level `restore`; shell restore
hash pins use `.restore <file> [expected_sha256]`.
`icpdb help lifecycle`, `icpdb help database`, and `icpdb help db` print the
normal canister-only create, database list, post-create write, read, count,
table/view, schema/describe, stats, preview, and inspect health checks, status,
URL/info handoff, and guarded `delete-db --confirm <database-id>` cleanup flow
without reading `service.env`.
`icpdb help service-env` and `icpdb help env` print service identity generation,
local service-env diagnosis, principal, URL/info handoff, explicit canister-only DB
creation, post-create env verification, canister-only controller.env generation
and controller-grant steps, and non-default env-file examples without reading
secrets beyond the selected owner-only env file.
`icpdb help check-env` prints the installed-SDK service env verification path:
local-only file/principal inspection, canister-visible role checks, optional SQL
smoke, scratch archive/restore smoke for owner envs, canister-only
`controller.env` generation, controller-grant, shard smoke, Browser/II
console-grant verification, and non-default env-file checks.
The `check-env` table/json/csv output itself includes next commands:
canister-only checks show `nextInspectEnvCommand`, `nextCreateDbCommand`,
`nextCheckEnvCommand`, and `nextInfoCommand`; DB-bearing checks show
`nextStatusCommand`, `nextMembersCommand`, `nextQueryCommand`,
`nextSchemaCountCommand`, `nextTablesCommand`, `nextViewsCommand`,
`nextStatsCommand`, `nextSchemaCommand`, `nextUrlCommand`, and
`nextInfoCommand`; writer/owner checks also show `nextExecuteCommand`,
`nextInsertCommand`, `nextReadCommand`, `nextDescribeCommand`,
`nextPreviewCommand`, and `nextSqlSmokeCommand`; owner checks also show `nextArchiveCommand`,
`nextSnapshotInfoCommand`, `nextHashPinnedRestoreCommand`, and
`nextOwnerArchiveRestoreSmokeCommand`. `--format env` remains limited to
non-secret check fields for CI export.
`icpdb help generate-identity` and `icpdb help identity` print the installed-SDK
service identity bootstrap path. `generate-identity --env-out service.env`
writes a new owner-only `service.env` and refuses to overwrite an existing file;
`init --env-out service.env` uses the same guard before generating the Server/CI
private key or creating a DB. `generate-identity --format env` prints the
secret-bearing env block for secret-manager setup. The same focused help states
that Browser/II and generated Server/CI service principals are different, joined
through the DB ACL rather than shared browser private keys, names the console
`Member principal` paste target and `Grant member access` button, and shows
`members` plus scalar verification after the console grant.
`icpdb help migrate` prints the versioned migration JSON shape, retry-safe
migrate command, applied-version inspection query, first-DB setup-migration path,
and read-only script check alternative without reading `service.env`.
`icpdb help query` and `icpdb help scalar` print focused read-SQL examples with
table/csv output, inline and file-backed params, auto-routed read SQL, and a
non-default `--service-env-file ./ci/service.env` example.
`icpdb help execute` prints focused write-SQL examples with inline and named
params, retry-safe idempotency keys, `--wait`, auto-routed write SQL,
script-style writes, and a non-default `--service-env-file ./ci/service.env`
example.
`icpdb help batch`, `icpdb help script`, and `icpdb help dump` print the focused
statement-file and SQL dump flow with JSON statement batches, transactions,
read-mode checks, SQL files/stdin, dump export/import, retry-safe write waits,
and non-default `--service-env-file ./ci/service.env` examples.
Use `--format table` for human CI logs and quick schema/table checks; use
`--format csv` for row export and spreadsheet-friendly checks; use `--format env`
for URL/info/snapshot handoff fields or explicit secret-bearing
`generate-identity` output.
`create-db --format table` and `create-db --format csv` print flat key/value
rows for the created database id, reusable URL, service principal, and network.
Without setup flags, `create-db` creates an empty DB from a canister-only
`service.env`, persists `ICPDB_DATABASE_ID`, then prints `ICPDB_URL` and
`ICPDB_CONNECTION_URL` for immediate query/execute follow-up.
For `init` and `create-db`, table/json/csv output also includes
`nextInspectEnvCommand`, `nextExecuteCommand`, `nextInsertCommand`, `nextQueryCommand`, `nextReadCommand`,
`nextSqlSmokeCommand`, `nextSchemaCountCommand`, `nextTablesCommand`,
`nextViewsCommand`, `nextStatsCommand`, `nextSchemaCommand`,
`nextDescribeCommand`, `nextPreviewCommand`, `nextStatusCommand`,
`nextMembersCommand`, `nextUrlCommand`, and `nextInfoCommand`; env output
remains only the shell-loadable connection fields.
`create-db --setup-sql "<sql>"` creates and seeds the first DB without a setup
file when a Server/CI job only needs one inline schema statement.
`icpdb help create-db` prints canister-only env inspection, explicit DB creation
variants, the table/json/csv next-command fields, and the persisted-DB SQL
health path with write, read, count, table/view list, stats, schema/describe,
preview, table inspect, status, members, and reusable URL/info handoff.
`icpdb help init` prints the one-command Server/CI DB bootstrap, local
`inspect-env`, table/json/csv next-command fields, owner SQL plus
archive/restore smoke, write, read, count, table/view list, stats,
schema/describe, preview, table inspect, status, members, and reusable URL/info handoff without requiring a separate
`generate-identity` then `create-db` sequence.
`icpdb help databases` prints the focused DB inventory and selected-DB
operations flow with database list, status, usage, usage events, placement,
URL/info handoff, guarded `delete-db --confirm <database-id>` cleanup, and
non-default `--service-env-file ./ci/service.env` examples.
`icpdb help schema`, `icpdb help tables`, and `icpdb help describe` print the
focused schema/table catalog flow with table and view lists, full and per-table
schema SQL, table description, column/index/trigger/foreign-key checks,
preview/inspect window checks, CSV export, and a non-default
`--service-env-file ./ci/service.env` example.
`icpdb help status` prints the focused DB health and handoff check with caller
role, connection URL, placement, usage, table stats, nearby members/schema/stats
checks, writer/owner smoke checks, and a non-default
`--service-env-file ./ci/service.env` example instead of falling back to a single
command usage line.
`icpdb help stats` prints the focused DB aggregate and per-table stats check
with table/json/csv formats, nearby status/table/view/inspect commands, and a
non-default `--service-env-file ./ci/service.env` example.
`icpdb help health` prints the control canister health check without selecting
or creating a DB, table/json/csv formats, canister-only controller.env preflight
before shard operations, and a non-default `--service-env-file ./ci/service.env`
example.
`icpdb help quickstart`, `icpdb help sdk`, and `icpdb help server` print the app SDK shortest path with
`createClient({ canisterId, identity, setupSql })`, `execute`, `query`, `result.rows`, `connectionUrl()`, and `info`,
the explicit hosted SQLite subpath block with `createSqliteClient` from
`@icpdb/client/sqlite`, `sqliteDb.execute`, `sqliteDb.query`, and
`sqliteDb.connectionUrl()`,
then one-command `init` service identity and DB bootstrap with inline SQL,
`--setup-file ./schema.sql`, or `--setup-migrations-file ./migrations.json`,
the table/json/csv next-command fields, local `inspect-env` verification before
canister calls, service-env role verification, Server/CI SDK
`createClientFromEnvFile()` and `createClientFromEnvFile("./ci/service.env")`
usage, auto-routed `sql` write/read, explicit
`execute` / `query`, scalar, schema/describe/preview inspection, status, reusable URL/info handoff,
optional owner backup check, existing owner-env DB handoff, and Browser/II
service-principal handoff without reading `service.env`; the Browser/II
quickstart grant line says Browser/II and Server/CI principals stay different,
are joined through the DB ACL, and names the console `Member principal` paste
target plus `Grant member access` button, so CI scripts can discover the normal
flow before secrets exist without implying principal equality.
`icpdb help provision-service` prints the existing-DB owner-env handoff:
package `provision-service`, writer/owner role verification, owner-only
archive/restore proof, and the Browser/II alternative that generates a service
identity and joins it through console Permissions instead of sharing a browser
private key; the focused Browser/II grant line also says Browser/II and
Server/CI principals stay different, are joined through the DB ACL, and points
to `Member principal` plus `Grant member access` in console Permissions.
`icpdb help inspect-env` prints the local-only service env diagnosis path
before canister calls, including owner-only file mode, connection URL, setup
field, derived principal, database-bearing URL/check-env follow-up,
canister-only first-call info/url/sql creation plus explicit create-db for
setup SQL, controller.env diagnosis, shard smoke, and non-default env-file
examples. The `inspect-env` table/json/csv output itself includes next commands:
canister-only envs show `nextCreateDbCommand`, `nextScalarCommand`,
`nextExecuteCommand`, `nextQueryCommand`, and `nextInfoCommand`; database-bearing
envs show `nextCheckEnvCommand`, `nextQueryCommand`,
`nextSchemaCountCommand`, `nextTablesCommand`, `nextViewsCommand`,
`nextStatsCommand`, `nextStatusCommand`, `nextMembersCommand`,
`nextUrlCommand`, and `nextInfoCommand`.
`icpdb help principal` prints the exact service principal loaded from
`service.env` without a canister call, Browser/II console Permissions handoff
steps, owner-env grant/revoke commands, controller.env principal use for
canister controller grants, and non-default env-file examples.
`icpdb help url` prints the reusable `icpdb://<canister-id>/<database-id>`
handoff path with local `inspect-env`, `url --format env`, matching
`ICPDB_URL` / `ICPDB_CONNECTION_URL` output, app SDK `connectClient` reconnect,
Server/CI `connectClientFromEnvFile()` reconnect, canister-only first-call
URL/info creation plus explicit `create-db` for setup SQL, and non-default
env-file examples.
`icpdb help info` prints the Server/CI handoff object path with local
`inspect-env`, `info --format table`, `info --format env`, `check-env`, SQL
scalar/table verification, the matching app SDK `client.info()` call, and
non-default env-file examples.
`icpdb help permissions` and `icpdb help auth` print the Browser/II-owned DB
service-principal grant check, database-bearing `generate-identity --env-out
service.env`, the warning that Browser/II and Server/CI service principals are
intentionally different and joined by the DB ACL, concrete console Permissions
paste/role/grant steps, writer-role SQL smoke verification, and owner-role
`check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table` verification, ACL member list,
owner-only grant/revoke commands, and owner-role backup reminder without
reading `service.env`.
`icpdb help token`, `icpdb help tokens`, `icpdb help http`, and `icpdb help curl`
state that normal Server/CI jobs use `service.env` service identities instead of
database bearer tokens, show the Browser/II DB ACL handoff for generated service
principals, and keep bearer tokens optional for curl-compatible external HTTP
clients, browser token sessions, or short-lived sharing. The package `icpdb` CLI
intentionally has no `create-token` command, so token help does not imply tokens
are required for CI.
`icpdb help members` prints the focused ACL member flow with member listing,
loaded service principal, status, owner-env grant/revoke commands, writer versus
owner role verification, and a non-default `--service-env-file owner.env`
example.
`icpdb help backup`, `icpdb help archive`, `icpdb help snapshot-info`, and
`icpdb help restore` print the owner-role archive preflight, SQL plus scratch
archive/restore smoke, offline snapshot hash check, env hash handoff,
hash-pinned restore, archive table/json/csv next-command fields, non-default
restore env-file usage, and post-restore scalar/table/views/schema/inspect/stats/status/members/url/info
verification flow without reading `service.env`.
`icpdb help operation`, `icpdb help operation-wait`, `icpdb help
operation-reconcile`, and `icpdb help operations` print the remote-shard routed
write recovery path, including idempotent write examples, operation lookup, wait
with unknown reconciliation, manual reconcile, and non-default env-file
operation lookup without reading `service.env`. Actual recovery command-name
topics render the same flow instead of falling back to single command usage
lines.
`icpdb help ops` / `icpdb help shards` / `icpdb help shard-status` /
`icpdb help shard-ops` / `icpdb help controller` print controller identity generation,
the explicit `icp canister settings update` controller-grant step,
controller.env inspection, controller `health`, shard smoke, inventory,
zero-action maintenance, shard create/register/status/top-up, migration, remote
create, shard journal, and reconcile commands without reading the default
`service.env`.
`icpdb help shards`, `icpdb help shard-status`, `icpdb help shard-ops`, and
other shard command names are aliases for `icpdb help ops`, so shard operators
can discover controller/shard operations from the actual command terminology
instead of falling back to single command usage lines.
`icpdb help shell` and `icpdb help shell sql` print the service-env Turso-like
shell commands for health, URL/info/status handoff, stats, schema/table checks,
table description, member grants, file-backed load/script/migrate, backup,
guarded cleanup, and one-shot SQL; shell write SQL and
file write dot-commands auto-generate idempotency keys and honor `--wait` for
routed remote writes.

```ts
import { createClient, sql } from "@icpdb/client";

const client = createClient({
  canisterId,
  identity,
  setupSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)"
});

const body = "hello";
await client.execute(sql`INSERT INTO notes(body) VALUES (${body})`);
const result = await client.query("SELECT id, body FROM notes ORDER BY id DESC");
const note = await client.get("SELECT id, body FROM notes ORDER BY id DESC LIMIT 1");
const total = await client.scalar("SELECT count(*) FROM notes");
const rows = result.rows;
const connectionUrl = await client.connectionUrl();
const info = await client.info();
```

`connectionUrl` and `url` inside `client.info()` are reusable `icpdb://<canister-id>/<database-id>` values for later app, Server, CLI, or CI runs.
`client.info()` returns `{ canisterId?, databaseId, connectionUrl, url, principal? }` after
the DB exists, so app code can persist one handoff object without separate
`databaseId()`, `url()`, and `principal()` calls.
Because `databaseId` is omitted, the first SQL call creates the hosted DB, runs
`setupSql`, and then executes the insert.
The first write uses the exported `sql` tagged template for bound values; the libSQL-shaped `client.execute({ sql, args })` form and positional `execute(sql, args)` calls work too.
If setup creates the readable table and seed data, the first call can be
`query`, `get`, or `scalar`; creation is not tied to writes.

For libSQL-shaped app code, keep the SQL calls and replace only connection/auth
with the IC identity and `icpdb://` connection URL:

```ts
import { createLibsqlClient } from "@icpdb/client/libsql";

const libsqlDb = createLibsqlClient({
  url: connectionUrl,
  identity
});

await libsqlDb.execute({ sql: "INSERT INTO notes(body) VALUES (:body)", args: { body: "from-libsql" } });
const libsqlRows = (await libsqlDb.execute("SELECT id, body FROM notes ORDER BY id DESC")).rows;
libsqlDb.close();
```

Read-first setup can seed data before the first app read:

```ts
const readFirstClient = createClient({
  canisterId,
  identity,
  setupSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
  setupStatements: [{ sql: "INSERT INTO notes(body) VALUES (:body)", args: { body: "seed" } }]
});

const seeded = await readFirstClient.get("SELECT body FROM notes LIMIT 1");
```

Calling `connectionUrl()` or `url()` first also creates the hosted DB, runs
`setupSql`, and returns the reusable URL before application SQL runs.
If no setup block is needed, the first `execute("CREATE TABLE ...")` call still
creates the hosted DB and `connectionUrl()` returns the newly created DB URL.

Start from a canister-only ICPDB URL when setup code wants one connection field
from the first call:

```ts
import { createClient, formatIcpdbCanisterUrl, sql } from "@icpdb/client";

const client = createClient({
  connectionUrl: formatIcpdbCanisterUrl(canisterId),
  identity,
  setupSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)"
});

await client.execute(sql`INSERT INTO notes(body) VALUES (${"hello"})`);
const result = await client.query("SELECT id, body FROM notes ORDER BY id DESC");
const connectionUrl = await client.connectionUrl();
```

Reconnect later with the explicit DB connection URL:

```ts
import { connectClient } from "@icpdb/client";

const client = connectClient({
  connectionUrl,
  identity
});

const note = await client.get("SELECT id, body FROM notes ORDER BY id DESC LIMIT 1");
const count = await client.scalar("SELECT count(*) FROM notes");
```

Using `connectClient` requires a DB-bearing URL or `canisterId` plus
`databaseId`; canister-only URLs fail with `databaseId is required`, and
`databaseId` without a canister id or DB URL fails with `missing canisterId`, so
reconnect jobs do not create another hosted DB. Choose either `connectionUrl` or
`url` in SDK options; passing both is rejected.

Browser Internet Identity apps pass the delegation identity directly; no
database bearer token is needed. Use `@icpdb/client/browser` when app code wants
an explicit browser-safe import path; it resolves to the same client as the root
entry:

```ts
import { AuthClient } from "@icp-sdk/auth/client";
import { createClient } from "@icpdb/client";

const DELEGATION_TTL_NS = BigInt(8) * BigInt(3_600_000_000_000);

function identityProviderUrl() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) {
    return "http://id.ai.localhost:8000";
  }
  return "https://id.ai";
}

const authClient = await AuthClient.create();

if (!(await authClient.isAuthenticated())) {
  await new Promise<void>((resolve, reject) => {
    authClient.login({
      identityProvider: identityProviderUrl(),
      maxTimeToLive: DELEGATION_TTL_NS,
      onSuccess: () => resolve(),
      onError: (error) => reject(new Error(error ?? "Internet Identity login failed"))
    });
  });
}

const identity = authClient.getIdentity();

const client = createClient({
  canisterId,
  identity,
  setupSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)"
});
```

The SDK uses the IC identity object. Do not pass the browser principal as a
string, and do not configure `derivationOrigin` for the normal `icp0.io` /
`ic0.app` mainnet domains.

Add parameterized setup statements or versioned migrations when first-run schema
needs more than one statement:

```ts
import { createClient, sql } from "@icpdb/client";

const client = createClient({
  canisterId,
  identity,
  setupSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
  setupStatements: [
    sql`INSERT INTO notes(body) VALUES (${"from-setup"})`
  ],
  setupMigrations: [
    { version: "001", name: "create_settings", sql: "CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)" }
  ]
});

await client.execute({ sql: "INSERT INTO notes(body) VALUES (?1)", args: ["hello"] });
await client.run({ sql: "INSERT INTO notes(body) VALUES (:body)", params: { body: "from-params" } });
const result = await client.query("SELECT id, body FROM notes ORDER BY id DESC");
const note = await client.get({ sql: "SELECT id, body FROM notes WHERE body = :body", params: { body: "from-params" } });
const databaseId = await client.databaseId();
const connectionUrl = await client.connectionUrl();
const status = await client.status();
```

The same `sql` tagged template works for single statements, `batch`,
`transaction`, `setupStatements`, and libSQL-shaped `migrate` statement arrays,
so setup, migrations, and normal writes can share one bound-value style.

Turso / libSQL-shaped code can use the explicit aliases:

```ts
import { createLibsqlClient, createTursoLikeClient, formatIcpdbDatabaseUrl, sql } from "@icpdb/client/libsql";

const db = createLibsqlClient({
  url: formatIcpdbDatabaseUrl(canisterId, databaseId),
  identity
});

await db.execute({ sql: "SELECT * FROM notes WHERE id = ?", args: [1] });
await db.batch([sql`INSERT INTO notes(body) VALUES (${"hello"})`], "write");
```

This is intentionally not a drop-in `@libsql/client` replacement. ICPDB uses IC
identities instead of `authToken`, `icpdb://<canister-id>/<database-id>` instead
of `libsql://` or `file:` URLs, and does not implement embedded replicas,
`sync()`, ATTACH, or multi-call interactive transactions. The compatible subset
is the common SQL client path: `execute`, `batch`, named SQLite placeholders,
`rows`, `columns`, `rowsAffected`, `affectedRows`, SQLite-style `changes`,
`lastInsertRowid`, `lastInsertRowId`, `protocol`, `closed`, `close()`, and `reconnect()`.
The `sql` tagged template helper is for value binds only; it returns the same
statement shape as `{ sql: "SELECT ?1 AS id", args: [id] }`.
Full Turso compatibility is not the goal because it would imply bearer-token
`authToken` auth, libSQL URL schemes, replica sync, and interactive transaction
semantics that do not match IC identity ACLs or canister execution. The target
is Turso-like SQL ergonomics with explicit IC boundaries.
SQLite integer result cells default to strings to avoid precision loss; pass
`intMode: "number"` or `intMode: "bigint"` when copied libSQL-shaped code wants
number or bigint row values.
For TypeScript migration ergonomics, `@icpdb/client` also exports familiar
SQL-client type aliases: `Client`, `Config`, `ResultSet`, `Row`, `InArgs`,
`InStatement`, `Statement`, `BatchStatement`, `BatchResult`,
`PreparedStatement`, `Sql`, `InValue`, `Value`, `TransactionMode`, and
`IntMode`.
Public response types for schema, usage, members, archive, routed operations,
and shard operations are exported from the root package, so application code can
annotate SDK results without importing console internals.
`@icpdb/client/web` and `@icpdb/client/browser` resolve to the
browser-safe identity-first SQL client.
`@icpdb/client/sqlite` re-exports the same root SQL client under an explicit
hosted SQLite subpath for ordinary SQL DB imports and adds hosted SQLite aliases
such as `createSqliteClient`, `connectSqliteClient`, `createSqliteDatabase`,
`connectSqliteDatabase`, `parseSqliteDatabaseUrl`, `SqliteClient`, and
`SqliteDatabaseClient`. It also includes SQLite-named row/value/prepared/batch
type aliases such as `SqliteRow`, `SqliteValue`, `SqlitePreparedStatement`,
`SqliteBatchStatement`, and `SqliteBatchResult`.
`@icpdb/client/libsql` re-exports the root SQL client under a libSQL-shaped
subpath for migration ergonomics, including `createLibsqlClient` and
`createTursoLikeClient`, plus explicit aliases such as `connectLibsqlClient`,
`connectLibsqlDatabase`, `createLibsqlDatabase`, `parseLibsqlDatabaseUrl`,
`LibsqlClient`, `LibsqlDatabaseClient`, `LibsqlConfig`,
`ConnectLibsqlClientOptions`, `ConnectLibsqlDatabaseOptions`,
`CreateLibsqlDatabaseOptions`, `LibsqlResultSet`, and `LibsqlBatchResult`; both
subpaths still require IC identity options, use
`icpdb://` URLs, and reject `authToken` / `libsql://` semantics.
`@icpdb/client/server` is the Server/CI subpath. It re-exports the same SQL
client plus the Node-only `service.env` helpers, so server jobs can import one
subpath for `createClient`, `connectClientFromEnvFile`,
`createClientFromEnvFile`, archive/restore file helpers, and principal
inspection. `@icpdb/client/node` remains an equivalent Node alias for existing
imports.
Local typecheck fixtures mirror those package subpaths as `icpdb-console/web`,
`icpdb-console/browser`, `icpdb-console/sqlite`, `icpdb-console/libsql`,
`icpdb-console/server`, `icpdb-console/node`, and
`icpdb-console/service-identity`.
Database bearer tokens are not the SDK's Server/CI path. Use
`@icpdb/client/server` or `@icpdb/client/service-identity` for jobs that can
store a service identity private key, and keep bearer tokens for curl-compatible
external HTTP clients, browser token sessions, or short-lived sharing.

When porting common `@libsql/client` app code, keep the SQL calls and replace
only the connection/auth boundary:

```ts
import { connectClient, formatIcpdbDatabaseUrl } from "@icpdb/client";

const db = connectClient({
  url: formatIcpdbDatabaseUrl(canisterId, databaseId),
  identity
});

await db.execute({ sql: "INSERT INTO notes(body) VALUES (?1)", args: ["hello"] });
const rows = (await db.execute("SELECT id, body FROM notes ORDER BY id DESC")).rows;
```

`execute("SELECT ...")` stays reader-role safe: the SDK classifies read SQL
locally and sends it through the query path, while writes use execute/batch.

Do not carry over `authToken`; database access is granted to the IC principal
behind `identity`.

Passing `authToken`, `syncUrl`, `syncInterval`, `tls`, `fetch`,
`concurrency`, `offline`, `readYourWrites`, or `encryptionKey` is rejected
instead of being silently ignored. Calling replica `sync()` or libSQL
interactive `transaction("write")` fails with an explicit unsupported-feature
error.
SDK canister errors throw `LibsqlError` with a machine-readable `code`.
Read-mode batch validation throws `LibsqlBatchError` with `statementIndex`, so
copied libSQL-shaped error handling can identify the first rejected statement.
`classifyLibsqlErrorMessage` maps common SQLite and ICPDB errors to
machine-readable codes such as `SQLITE_CONSTRAINT`, `SQLITE_BUSY`,
`SQLITE_READONLY`, `SQLITE_ERROR`, `ICPDB_AUTH`, and `ICPDB_QUOTA`.
`isLibsqlError`, `isLibsqlBatchError`, and `isIcpdbLibsqlErrorCode` narrow
unknown caught errors before branching on typed `IcpdbLibsqlErrorCode` values.

Server/CI setup uses the installed package `icpdb` bin. A new DB can be created,
initialized, written to `service.env`, queried, inspected, and backed up without
repository-local scripts:

```bash
icpdb init \
  --canister-id <canister-id> \
  --network-url https://icp-api.io \
  --env-out service.env \
  --setup-file ./schema.sql \
  --format table

# For a one-table smoke without a schema file, use inline setup SQL:
icpdb init \
  --canister-id <canister-id> \
  --network-url https://icp-api.io \
  --env-out service.env \
  --setup-sql "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)" \
  --format table

# If service.env only has a canister URL, scalar creates an empty DB and persists it:
icpdb scalar "SELECT 1 AS value" --format table
icpdb execute "CREATE TABLE readiness_query_only(id INTEGER PRIMARY KEY, body TEXT NOT NULL)" --idempotency-key readiness-query-only-create-table-001 --wait --format table
icpdb execute "INSERT INTO readiness_query_only(body) VALUES (?1)" --params '["readiness-query-only"]' --idempotency-key readiness-query-only-write-001 --wait --format table
icpdb query "SELECT body FROM readiness_query_only ORDER BY id DESC LIMIT 1" --format table
icpdb url --format env
icpdb info --format env

# Later commands read cwd-local service.env by default.
# First verify service.env locally: file mode, connection URL, and derived service principal.
icpdb inspect-env --format table

# Generic .env is explicit: write it with --env-out .env, then pass
# --service-env-file .env for later package CLI commands.

icpdb execute \
  "INSERT INTO notes(body) VALUES (?1)" \
  --params '["hello"]' \
  --idempotency-key ci-notes-insert-001 \
  --wait

icpdb query \
  "SELECT id, body FROM notes ORDER BY id DESC" --format table

icpdb scalar \
  "SELECT count(*) FROM notes" --format table

icpdb tables --format table

icpdb views --format table

icpdb stats --format table

icpdb schema notes --format table

icpdb describe notes --format table

icpdb columns notes --format table

icpdb indexes notes --format table

icpdb triggers notes --format table

icpdb foreign-keys notes --format table

icpdb preview notes --limit 25 --format table

icpdb inspect notes --format table

icpdb status --format table

icpdb check-env \
  --require-role writer \
  --smoke-sql \
  --format table

icpdb url --format env

icpdb info --format env
```

Use `icpdb init --setup-migrations-file ./migrations.json` for
versioned setup, `--params '{"body":"hello"}'` for named params, and
`--format csv` when CI needs row output as CSV.
For backup jobs, use owner role before running archive/restore, then run
`icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table`
before promoting snapshot artifacts. Writer `service.env` is for SQL write/query
CI, not archive/restore.
The SDK smoke connects to the DB-bearing `service.env` with
`connectClientFromEnvFile`; it does not use the canister-only create path.
Scratch DB creation is limited to the archive/restore checks.

For an existing DB where an owner service env is available, provision a
dedicated service identity from the owner env and run the same writer smoke
before CI depends on it:

```bash
icpdb provision-service <database-id> writer \
  --service-env-file owner.env \
  --env-out service.env \
  --format table

icpdb inspect-env --format table

icpdb status --format table

icpdb scalar "SELECT count(*) FROM sqlite_schema" --format table

icpdb tables --format table

icpdb views --format table

icpdb schema --format table

icpdb columns <table-name> --format table

icpdb indexes <table-name> --format table

icpdb triggers <table-name> --format table

icpdb foreign-keys <table-name> --format table

icpdb inspect --format table

icpdb check-env \
  --require-role writer \
  --smoke-sql \
  --format table

icpdb url --format env

icpdb info --format env

# For archive/restore or final goal proof on this existing DB, provision owner instead:
icpdb provision-service <database-id> owner \
  --service-env-file owner.env \
  --env-out service.env \
  --format table

icpdb check-env \
  --require-role owner \
  --smoke-sql \
  --smoke-sdk \
  --smoke-archive-restore \
  --smoke-sdk-archive-restore \
  --format table

icpdb url --format env

icpdb info --format env
```
The `--smoke-sdk` part connects to the existing DB through
`connectClientFromEnvFile`; only the archive/restore smoke creates scratch DBs.

For an existing DB owned by browser Internet Identity, keep the browser
principal as owner and grant a separate service principal from console
Permissions:

First copy the console Response sidebar `Connection URL`; use the database id
from that `icpdb://<canister-id>/<database-id>` value in the command below.

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

icpdb scalar "SELECT count(*) FROM sqlite_schema" --format table

icpdb tables --format table

icpdb views --format table

icpdb schema --format table

icpdb columns <table-name> --format table

icpdb indexes <table-name> --format table

icpdb triggers <table-name> --format table

icpdb foreign-keys <table-name> --format table

icpdb inspect --format table

icpdb url --format env

icpdb info --format env

icpdb check-env \
  --require-role owner \
  --smoke-sql \
  --smoke-sdk \
  --smoke-archive-restore \
  --smoke-sdk-archive-restore \
  --format table
```

## Identity SDK Shape

The normal application SDK import is the generated standalone package:

- browser/app identity client: `@icpdb/client`
- browser/app identity client subpaths: `@icpdb/client/web`, `@icpdb/client/browser`
- Server/CI identity and `service.env` client subpath: `@icpdb/client/server`
- equivalent Node alias for existing imports: `@icpdb/client/node`
- Node Server/CI service identity client: `@icpdb/client/service-identity`

The repository also exports local development subpaths:

- browser/app identity client: `icpdb-console`
- legacy browser/app identity client subpath: `icpdb-console/sdk`
- browser/app identity client subpaths: `icpdb-console/web`, `icpdb-console/browser`
- Server/CI identity and `service.env` client subpath: `icpdb-console/server`
- equivalent Node alias for existing imports: `icpdb-console/node`
- Node Server/CI service identity client: `icpdb-console/service-identity`

`icpdb-console/scripts/check-sdk-package-import.ts` typechecks both package
subpath imports. `pnpm --dir icpdb-console build:sdk` emits the JavaScript and
`.d.ts` SDK artifacts under `icpdb-console/dist-sdk`; the package `files`
metadata includes that artifact directory. The build also writes
`icpdb-console/dist-sdk/package.json` for a standalone `@icpdb/client` package
artifact with only `@icp-sdk/core` as a runtime dependency. Import the app SDK
from `@icpdb/client` and Server/CI helpers from `@icpdb/client/server` or
`@icpdb/client/service-identity` when packing or publishing the generated SDK
artifact directly. `@icpdb/client/node` resolves to the same server entry for
existing Node imports. `icpdb-console/scripts/check-sdk-package-artifact.mjs`
verifies the generated package manifest, `npm pack --dry-run` file list, entry
files, package-name runtime imports, TypeScript type resolution for those
package-name imports, the artifact-local quickstart README, and
`npm publish --dry-run` against the generated package. The generated manifest
sets `publishConfig.access` to `public` so the scoped package can be published
without relying on npm's default access behavior. It also exports
`@icpdb/client/package.json` so tooling can inspect the installed SDK package
name and version even though package exports are otherwise explicit.

The app-facing client is identity-first. Browser code passes the Internet
Identity delegation, while server, CLI, and CI code should pass a dedicated
service identity and grant that service principal to the database.
Browser Internet Identity principals and Server/CI service identity principals
are intentionally different. Do not share a private key to force principal
equality. Grant the service principal to the same database ACL, then verify the
exact principal with `await client.principal()` or
`icpdb principal --format table`.
`createDatabase` and `connectDatabase` are short aliases for explicit database
lifecycle code; `createIcpdbDatabase` and `connectIcpdbDatabase` remain the
descriptive names.
SDK runtime checks cover the short alias path from `createDatabase({ canisterId,
identity, setupSql })` through setup, `execute`, `queryRows`, `connectionUrl()`,
`info()`, and `delete()`.

```ts
import { connectDatabase, createClient, createDatabase } from "@icpdb/client";

const db = await createDatabase({ canisterId, identity });

await db.execute("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)");
await db.execute("INSERT INTO notes(body) VALUES (?1)", ["hello"]);
await db.execute({ sql: "INSERT INTO notes(body) VALUES (:body)", args: { body: "from-direct-named-args" } });
await db.execute({ sql: "INSERT INTO notes(body) VALUES (:body)", params: { body: "from-direct-named" } });
await db.run("INSERT INTO notes(body) VALUES (?1)", ["from-run"]);
await db.transaction([["INSERT INTO notes(body) VALUES (?1)", ["from-direct-transaction"]]]);
await db.executeMultiple(`
  CREATE TABLE direct_multiple(id INTEGER PRIMARY KEY, body TEXT);
  INSERT INTO direct_multiple(body) VALUES ('from-direct-multiple');
`);
await db.migrate([
  { version: "001", name: "create_direct_settings", sql: "CREATE TABLE direct_settings(key TEXT PRIMARY KEY, value TEXT)" }
]);
const rows = await db.queryRows("SELECT id, body FROM notes ORDER BY id DESC");
const first = await db.queryOne("SELECT id, body FROM notes WHERE id = ?1", [1]);
const allRows = await db.all("SELECT id, body FROM notes ORDER BY id DESC");
const oneRow = await db.get("SELECT id, body FROM notes WHERE id = ?1", [1]);
const schemaSql = await db.schema();

const existingDb = await connectDatabase({ canisterId, databaseId: db.databaseId, identity });

// createDatabase always creates a new DB. Use connectDatabase or
// createClient for an existing icpdb://<canister-id>/<database-id> URL.
// connectDatabase requires canisterId + databaseId, or a DB URL, and never creates one.

const usage = await db.getUsage();
const status = await db.status();
const placement = await db.placement();
const sqlDump = await db.dumpSql();
await db.loadSqlDump(sqlDump);
const snapshot = await db.archive();
const snapshotMetadata = await db.snapshotInfo(snapshot);
await db.restore(snapshot, { expectedSha256: snapshotMetadata.sha256 });

const client = createClient({ canisterId, identity });
await client.executeScript(`
  CREATE TABLE app_notes(id INTEGER PRIMARY KEY, body TEXT);
  INSERT INTO app_notes(body) VALUES ('hello');
`);
const databaseId = await client.databaseId();
const setupClient = createClient({
  canisterId,
  identity,
  setupSql: "CREATE TABLE setup_notes(id INTEGER PRIMARY KEY, body TEXT)",
  setupStatements: [
    { sql: "INSERT INTO setup_notes(body) VALUES (:body)", args: { body: "from-setup-statements" } }
  ],
  setupMigrations: [
    { version: "001", sql: "CREATE TABLE setup_settings(key TEXT PRIMARY KEY, value TEXT)" }
  ]
});
await setupClient.run("INSERT INTO setup_notes(body) VALUES (?1)", ["from-setup"]);
const result = await client.execute({
  sql: "SELECT id, body FROM app_notes WHERE id = ?1",
  args: [1]
});
await client.execute({
  sql: "INSERT INTO app_notes(body) VALUES (:body)",
  args: { body: "from-named-args" }
});
await client.execute({
  sql: "SELECT :enabled AS enabled",
  args: { enabled: true }
});
await client.execute({
  sql: "SELECT :created_at AS created_at",
  args: { created_at: new Date("2026-05-29T00:00:00.000Z") }
});
await client.execute({
  sql: "SELECT :payload AS payload",
  args: { payload: new ArrayBuffer(2) }
});
await client.execute({
  sql: "SELECT :payload AS payload",
  args: { payload: new DataView(new ArrayBuffer(2)) }
});
await client.execute({
  sql: "INSERT INTO app_notes(body) VALUES (:body)",
  params: { body: "from-named-params" }
});
const byId = client.prepare("SELECT id, body FROM app_notes WHERE id = ?1");
const preparedFirst = await byId.get([1]);
const boundFirst = await byId.bind([1]).get();
const initiallyBound = await client.prepare("SELECT id, body FROM app_notes WHERE id = ?1", [1]).get();
await client.prepare("INSERT INTO app_notes(body) VALUES (?1)").run(["from-prepare"]);
const topLevelFirst = await client.get("SELECT id, body FROM app_notes WHERE id = ?1", [1]);
const tupleFirst = await client.get(["SELECT id, body FROM app_notes WHERE id = ?1", [1]]);
const topLevelRows = await client.all("SELECT id, body FROM app_notes ORDER BY id DESC");
const appWrite = await client.run("INSERT INTO app_notes(body) VALUES (?1)", ["from-run"]);
if (appWrite.routedOperationId) await client.waitForRoutedOperation(appWrite.routedOperationId, { reconcileUnknown: true });
await client.run({ sql: "INSERT INTO app_notes(body) VALUES (?1)", args: ["from-idempotent-run"], idempotencyKey: "sdk_retry_insert_1" });
await client.run(["INSERT INTO app_notes(body) VALUES (?1)", ["from-tuple-run"]]);
await client.exec(`
  CREATE TABLE app_exec(id INTEGER PRIMARY KEY, body TEXT);
  INSERT INTO app_exec(body) VALUES ('from-exec');
`);
await client.executeMultiple(`
  CREATE TABLE app_multiple(id INTEGER PRIMARY KEY, body TEXT);
  INSERT INTO app_multiple(body) VALUES ('from-multiple');
`);
await client.batch([{ sql: "INSERT INTO app_notes(body) VALUES (?1)", args: ["from-batch"] }], "write");
await client.batch([{ sql: "INSERT INTO app_notes(body) VALUES (?1)", params: ["from-batch-params"] }], "write");
await client.batch([{ sql: "INSERT INTO app_notes(body) VALUES (?1)", args: ["from-idempotent-batch"] }], { idempotencyKey: "sdk_retry_batch_1" });
await client.batch([["INSERT INTO app_notes(body) VALUES (?1)", ["from-tuple"]]], "write");
await client.transaction([["INSERT INTO app_notes(body) VALUES (?1)", ["from-transaction"]]], "write");
await client.migrate([
  { version: "001", name: "create_settings", sql: "CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)" }
]);
const appRows = await client.queryRows("SELECT id, body FROM app_notes ORDER BY id DESC");
const appFirst = await client.queryOne("SELECT id, body FROM app_notes WHERE id = ?1", [1]);
const tables = await client.tables();
const views = await client.views();
const description = await client.describe("app_notes");
const columns = await client.columns("app_notes");
const indexes = await client.indexes("app_notes");
const triggers = await client.triggers("app_notes");
const foreignKeys = await client.foreignKeys("app_notes");
const preview = await client.preview("app_notes", { limit: 25 });
const inspection = await client.inspect({ tableName: "app_notes", previewLimit: 25 });
const appUsage = await client.getUsage();
const appUsageEvents = await client.listUsageEvents();
const appPlacement = await client.placement();
const appStatus = await client.status();
const appConnectionUrl = await client.connectionUrl();
const appSnapshot = await client.archive();
const appSnapshotInfo = await client.snapshotInfo(appSnapshot);
await client.restore(appSnapshot, { expectedSha256: appSnapshotInfo.sha256 });
await client.delete();
client.close();
```

Pass `canisterId` plus `databaseId`, or a DB URL, to connect to an existing
database instead of creating one.
`createIcpdbDatabase` is the explicit create-and-use path for a new hosted
SQLite DB.
Its create option type marks `databaseId?: never`, so TypeScript rejects
existing-DB selection on the create path before runtime validation.
`connectIcpdbDatabase`, low-level `client.connectDatabase()`, and low-level
`client.database(databaseId)` require an existing database locator: either
`canisterId` plus `databaseId`, a DB-bearing `connectionUrl`, or a DB-bearing
`url`. They never create a database implicitly and reject missing database ids.
Direct database clients accept positional arrays and named `args` / `params` objects, and
expose `all`, `get`, `values`, `first`, `firstValue`, `scalar`, `prepare`, `run`, `transaction`, `executeMultiple`, `migrate`, `views`, `delete()`, and `close()`
shortcuts alongside `queryRows`, `queryOne`, and `execute`. Their `migrate`
helper accepts both ICPDB versioned migrations and libSQL-shaped statement arrays.
Custom adapters can start with only `databaseId`, `query`, and `execute`:

```ts
import { createClientFromDatabase } from "@icpdb/client";

const client = createClientFromDatabase({
  databaseId: "db_notes",
  query: (statement) => adapter.query(statement),
  execute: (statement) => adapter.execute(statement)
});

await client.get("SELECT id, body FROM notes WHERE id = ?1", [1]);
await client.run("INSERT INTO notes(body) VALUES (?1)", ["hello"]);
```

Add a source `batch(statements, options)` method only when atomic write batches,
transactions, write-mode scripts, migrations, or dump loads are needed.
Schema inspection also has short aliases: `tables()`, `views()`,
`describe(table)`, `columns(table)`, `indexes(table)`, `triggers(table)`,
`foreignKeys(table)`, and `preview(table)`. The descriptive `listTables`,
`describeTable`, `listColumns`, `listIndexes`, `listTriggers`,
`listForeignKeys`, and `previewTable` names remain available.
The low-level `createIcpdbClient` surface also exposes `all`, `get`, `values`, `first`, `firstValue`, `scalar`, `prepare`, `run`,
`transaction`, and `executeMultiple` aliases plus `migrate(migrationsOrStatements, databaseId?)`
for versioned migrations or libSQL-shaped statement arrays against an explicit `databaseId`. `client.createDatabase({ setupSql,
setupStatements, setupMigrations })` is available when operation scripts want a
low-level client but still need the same create-and-setup shortest path. Its
setup option type marks `databaseId?: never`, and runtime calls reject setup
`databaseId` before creating a DB.
It also exposes `listShards()`,
`topUpDatabaseBalance(...)`, `createDatabaseShard(...)`,
`createRemoteDatabase(...)`, `registerDatabaseShard(...)`, `getShardStatus(...)`, `topUpShard(...)`, `maintainShards(...)`,
`migrateDatabaseToShard(...)`, `listAllPlacements()`,
`listShardOperations()`, `reconcileShardOperation(...)`,
`getRoutedOperation(...)`, `reconcileRoutedOperation(...)`, and
`waitForRoutedOperation(...)` for
owner/controller Node operation scripts that manage shard inventory/status,
creation, registration, remote DB creation, maintenance, placement, journal state, and routed write recovery.
It also exposes `health()` for control canister cycle checks.
When `createIcpdbClient` is constructed with `databaseId`,
`client.inspect({ tableName })` inspects that DB directly; pass
`client.inspect(databaseId, { tableName })` for an explicit DB override.
The same default-DB shape works for `client.dumpSql({ pageSize })` and
`client.restore(snapshot, { expectedSha256 })`; pass the database id first to
override.
It also works for low-level member operations: `client.grantMember(principal,
role)`, `client.listMembers()`, and `client.revokeMember(principal)` use the
configured `databaseId`; pass the database id first to override.
SDK, identity CLI, II-backed console, and owner-token HTTP admin member
operations reject empty principal strings before sending a request. Grant paths
also reject the anonymous principal. Browser/HTTP admin helpers reject empty
token names/ids, invalid snapshot hashes, unsafe archive/restore numbers, and
non-byte snapshot chunks before sending a request.
Archive/restore and SQL file commands in both CLIs reject empty or
whitespace-only file paths before file I/O, Candid, or HTTP requests.
Routed write recovery follows the same shape:
`client.getRoutedOperation(operationId)`,
`client.reconcileRoutedOperation(operationId)`, and
`client.waitForRoutedOperation(operationId, options)` use the configured
`databaseId`; pass the database id first to override.
SDK, identity CLI, and bearer-token CLI routed operation helpers reject empty or
whitespace-only operation ids before polling or reconcile requests.
SDK, identity CLI, and bearer-token CLI shard helpers reject empty or
whitespace-only database canister ids before shard status, top-up, registration,
remote-create, or migration requests.
SDK shard cycle/count helpers reject empty, whitespace-only, negative, or
unsafe numeric inputs before shard creation, maintenance, balance top-up, or
cycles top-up requests, and reject out-of-range `nat16` shard counts before
`max_databases`, `max_new_shards`, or `new_shard_max_databases` Candid fields
are built.
Shard and hosted-balance helpers follow it too: `client.placement()`,
`client.topUpDatabaseBalance(units)`, and
`client.migrateDatabaseToShard(databaseCanisterId)` use the configured
`databaseId`; pass the database id first to override.
`queryRows` / `all` and `queryOne` / `get` return null-prototype column-name
objects that also support non-enumerable positional access such as `row[0]` and
`row.length` when the result does not include a `length` column, so SQL aliases
such as `__proto__` and `constructor` remain normal column data. `run` is the
direct database write shortcut. SQLite integer cells are returned as strings to
avoid JavaScript precision loss.
`args` and `params` both accept positional arrays or named objects for `:name`,
`@name`, and `$name` placeholders.
Repeated named placeholders such as `:payload` bind once and can be reused in
the same SQL statement.
Boolean bind values map to SQLite integer `1` / `0`.
Number bind values must be finite. Integer number binds must be JavaScript safe
integers; use `bigint` or string-backed `{ kind: "integer", value }` for larger
SQLite integers.
Explicit `{ kind, value }` bind objects are validated before SQL calls:
`integer.value` must be a base-10 string, `real.value` must be finite,
`text.value` must be a string, and `blob.value` must be a byte array.
Date bind values map to SQLite ISO-8601 text.
ArrayBuffer and Uint8Array bind values map to SQLite blobs.
DataView and typed-array bind values map to SQLite blobs.
Single statement calls also accept libSQL-style `[sql, args?]` tuples.
Statement strings and object/tuple `sql` values must be non-empty strings before
the SDK sends a query or execute request.
`all`, `get`, `values`, `first`, `firstValue`, `scalar`, and `run` are top-level shortcuts for one-off row reads and
writes.
`prepare(sql, args?)` returns a reusable statement object with initial binds plus `bind(args)`,
`execute`, `query`, `queryRows`, `queryOne`, `all`, `get`, `values`, `first`, `firstValue`, `scalar`, and `run` helpers.
SDK result metadata follows common JS SQL clients: `columnTypes` lists inferred
returned cell storage types, blob cells return `ArrayBuffer`, `rowsAffected`,
`affectedRows`, and the SQLite-style `changes` alias are safe JavaScript numbers, and
`lastInsertRowid` is `bigint | undefined`, with `lastInsertRowId` as the
capital-I alias for code that follows the canister field name.
`result.toJSON()` keeps CI logging safe by converting blob cells to byte arrays
and serializing both insert-id fields to a string or `null`. Remote shard writes
also expose `routedOperationId` when the control canister routed the write
through a database canister.
SQL client statement objects, SQL client script/dump options, database preview/inspect/dump/restore/wait options, database handle statement objects, database handle batch/script options, and SQL client batch options reject `databaseId`;
choose the DB with the client connection URL, low-level inspect/dump/restore argument, or database handle so JS code does
not silently query a different database than the one it intended.
SDK SQL client DB boundary proof: high-level SQL client statement objects mark `databaseId?: never`, high-level SQL client script/dump options mark `databaseId?: never`, database preview/inspect/dump/restore/wait options mark `databaseId?: never`, database handle statement objects mark `databaseId?: never`, database handle batch/script options mark `databaseId?: never`, SQL client batch options mark `databaseId?: never`, reject JS runtime inputs with `SQL client statement databaseId is not supported`, `database preview option databaseId is not supported`, `database inspect option databaseId is not supported`, `database dump option databaseId is not supported`, `database restore option databaseId is not supported`, `database wait option databaseId is not supported`, `database handle statement databaseId is not supported`, or `SQL client batch option databaseId is not supported`, and low-level DB-first inspect/dump/restore/wait overloads also reject a conflicting option `databaseId`; low-level `IcpdbStatementInput.databaseId` / `IcpdbBatchOptions.databaseId` remain available for explicit low-level client methods.
`idempotencyKey` on single-statement write objects, batch options, and transaction
options sets the routed operation id for principal-signed remote writes, so
Server/CI retries can reuse the same key. Direct and low-level `exec`,
`executeScript`, `executeMultiple(sql, { idempotencyKey })`, and `loadSqlDump` forward the same
`idempotencyKey` to their underlying batch write. Empty or whitespace-only SDK
`idempotencyKey` values are rejected before lazy DB creation or Candid requests.
Use `exec(sql, { mode: "read" })`, `executeScript(sql, { mode: "read" })`, or
`loadSqlDump(sql, { mode: "read" })` for reader-role script/dump checks; read
mode routes each statement through query and rejects writes before sending.
Per-statement batch/transaction `idempotencyKey`, `maxRows`, and `databaseId`
are rejected instead of being silently ignored; set them on the client,
database handle, or batch/transaction option.
SDK `maxRows`, table preview `limit`, inspect `previewLimit`, and dump `pageSize`
values are validated as integers from 1 to 500 before Candid calls; preview
offsets are validated as unsigned 32-bit integers.
Identity CLI and bearer-token HTTP CLI `--max-rows` / `--limit` values use the
same 1 to 500 row bound, and shell `.preview` / `.inspect` offsets reject values
outside the unsigned 32-bit range before request construction.
SDK table inspection helpers reject empty or whitespace-only table names before
database creation or Candid table requests, while preserving quoted SQLite
identifiers that contain spaces.
`tables()`, `views()`, `describe(tableName)`, `columns(tableName)`,
`indexes(tableName)`, `triggers(tableName)`, `foreignKeys(tableName)`, and
`preview(tableName)` are short aliases over the descriptive table-inspection
helpers for schema/table checks without dropping to `database()`.
`client.snapshotInfo(snapshot)` returns local snapshot size and SHA-256 metadata before
restore or CI artifact promotion.
`restore(snapshot, { expectedSha256 })` refuses to restore a snapshot whose
local SHA-256 does not match the expected artifact hash, and rejects empty or
malformed hash pins before Candid restore calls.
`dumpSql` and `loadSqlDump` use SQLite SQL text for portable import/export.
SQL dumps preserve `sqlite_sequence` rows for dumped AUTOINCREMENT tables, so
restore keeps the next rowid sequence instead of deriving it only from restored
rows. Dump INSERT statements omit generated/hidden columns from `PRAGMA
table_xinfo`, so generated column values are recomputed by SQLite on restore.
`archive` and `restore` stream binary snapshot chunks and verify SHA-256 before
finalizing the canister lifecycle; use them when preserving an exact hosted
snapshot matters. The HTTP CLI and identity CLI also read restore files and
snapshot-info hashes in bounded chunks, so backup validation does not require
loading a full SQLite snapshot into memory. Archive `size_bytes` values outside
the JavaScript safe integer range are rejected before offset-based transfer
starts.
Low-level SDK archive/restore chunk helpers reject invalid `nat64` offsets,
invalid `nat32` max byte counts, invalid restore `sizeBytes`, and non-32-byte
snapshot hashes before Candid lifecycle requests are built.

`createClient` is the Turso-like convenience facade. It exposes `execute`,
`query`, `queryRows`, `queryOne`, `all`, `get`, `values`, `first`, `firstValue`, `scalar`, `prepare`, `batch`, `exec`, `executeMultiple`, `executeScript`, `schema`,
`tables`, `views`, `describe`, `columns`, `indexes`, `triggers`, `foreignKeys`,
`preview`, `listTables`, `describeTable`, `listColumns`, `listIndexes`,
`listTriggers`, `listForeignKeys`, `previewTable`, `inspect`, `health`, `getUsage`, `status`, `listUsageEvents`,
`grantMember`, `listMembers`, `revokeMember`, `placement`, `archive`, `restore`, `delete`, `databaseId`, `info`, and a cached
`database()` handle. The handle exposes the same row helpers and table shortcuts
derived from the minimal database source, including `queryRows`, `queryOne`,
`all`, `get`, `values`, `first`, `firstValue`, `scalar`, `prepare`, `run`, `transaction`, `exec`, `executeMultiple`,
`executeScript`, `migrate`, `dumpSql`, `loadSqlDump`, `tables`, `views`,
`describe`, `columns`, `indexes`, `triggers`, `foreignKeys`, `preview`,
`inspect`, `connectionUrl`, `url`, `info`, `delete`, `getUsage`, `status`,
`listUsageEvents`, `getRoutedOperation`, `reconcileRoutedOperation`,
`waitForRoutedOperation`, `grantMember`, `revokeMember`, `listMembers`,
`placement`, `archive`, `snapshotInfo`, `restore`, and `close`. Omitting `databaseId` creates a database on the first SQL
call; `setupSql`, parameterized `setupStatements`, and `setupMigrations` run
immediately after that created DB is available, and the created DB is deleted if
setup fails. Setup options reject existing `databaseId` at the type boundary and
existing `databaseId` or DB-bearing `icpdb://` URLs at runtime; use `exec`,
`batch`, or `migrate` for existing DB setup. Call `databaseId()`
afterward to persist the created DB id. `execute`
routes read SQL through query calls and write SQL through execute calls, ignoring
leading SQL whitespace/comments and inspecting CTE-leading statements for the
read/write decision.
`url: "icpdb://<canister-id>"` can replace `canisterId` for create-and-setup
paths, and `url: "icpdb://<canister-id>/<database-id>"` can replace separate
`canisterId` and `databaseId` fields when reconnecting.
`parseIcpdbDatabaseUrl(url)` is exported for setup code that wants to validate
the explicit ICPDB URL format, including malformed database id encoding and
decoded empty database ids.
`connectionUrl()` and its short alias `url()` return that reusable connection value after the DB exists, and `info()` returns the same URL plus the canister id, DB id, and available principal in one object.
`formatIcpdbCanisterUrl(canisterId)` formats the create URL, and
`formatIcpdbDatabaseUrl(canisterId, databaseId)` formats the reconnect URL when
setup code already has both values.
`inspect()` returns schema SQL plus table descriptions and preview rows in one
call for schema/table checks.
`health()` returns canister health without creating or connecting a database,
which is useful for app and Server/CI readiness checks before a DB id exists.
`status()` returns the connection URL, caller principal, caller role, usage, placement,
aggregate stats, and per-table stats for health checks without composing
multiple SDK calls.
`waitForRoutedOperation(operationId, { reconcileUnknown: true })` polls remote
write status and can reconcile an unknown routed write through the database
canister proof path.
`database().waitForRoutedOperation(...)` lets handle-oriented app code wait for
routed write ids returned by `run`, `exec`, `executeScript`, or `loadSqlDump`
without returning to the top-level client.
Direct database handles and enriched custom-source handles expose `info()` as a
synchronous handoff object with `{ canisterId?, databaseId, connectionUrl, url }`, so
handle-oriented setup code does not need to compose those fields manually.
Custom source `connectionUrl()`, `url()`, and `info()` results must be non-empty
strings before app or Server/CI handoff code can persist them. Explicit
custom-source `canisterId` is kept, and mismatches with standard `icpdb://`
URLs are rejected.
`database().status()`, `database().archive()`, and `database().restore(...)`
keep handle-oriented operation scripts on the same DB handle for health checks
and snapshot transfer.
`close()` delegates to the current database handle's `close()`, clears the
cached database handle, and marks `closed`; `reconnect()` clears that marker and
closes the cached handle before the next call resolves a fresh handle. If this
client created a DB because `databaseId` was omitted, later calls reuse that
created DB id instead of creating another database. `delete()` is terminal for
that client; create a new client after deleting a hosted DB.
Failed initial connect/create attempts are not cached, so the next SDK call can
retry the same shortest-path setup after a transient network or setup failure.
`batch(statements, "write")` accepts libSQL-style `read` / `write` /
`deferred` mode strings; `read` mode runs each statement through the read-query
endpoint, rejects non-read SQL before sending, and uses the same CTE-aware SQL
classification, so CTE-leading write statements are still rejected in `read`
mode. `write` and `deferred` modes are forwarded to the database client source.
Use
`batch(statements, { mode: "write", idempotencyKey })` when a retry-safe remote
batch also needs an explicit transaction mode. Batch statements can be
strings, `{ sql, args }` objects, `{ sql, params }` objects, or libSQL-style `[sql, args?]` tuples. Batch
execution is atomic: if one statement fails, earlier statements in the batch are
rolled back.
`migrate([{ version, name, sql }])` is ICPDB's versioned migration path, while
`migrate(["CREATE TABLE ...", { sql, args }, sql tagged template statement objects])`
accepts libSQL-shaped statement arrays, disables SQLite foreign-key checks around the batch like libSQL
`migrate`, and returns only the user statement results. The same two migrate
forms work on SQL clients and direct database clients.
`transaction(statements)` is available on SQL clients, direct database clients,
and the low-level client as a one-call atomic write transaction backed by the
same canister batch boundary. SQL clients, direct database clients, and
low-level clients also accept `transaction(statements, "write")` and the same
`{ mode, idempotencyKey }` option object as `batch`. It is not a multi-call interactive transaction.
Calling `transaction("write")` follows the libSQL interactive transaction shape
and is rejected with an explicit unsupported-feature error.
`migrate([{ version, name, sql }])` records applied versions in
`icpdb_schema_migrations` and only runs new versions. It checks the metadata
table through `sqlite_master` before creating it, instead of relying on
`IF NOT EXISTS`.
`executeMultiple(sql)` keeps the libSQL one-argument shape, splits
semicolon-separated statements, runs them sequentially with read/write routing,
and ignores statement results. `executeMultiple(sql, { idempotencyKey })` is the
ICPDB retry-safe variant; it routes through the same batched script path as
`exec(sql, { idempotencyKey })` and `executeScript(sql, { idempotencyKey })` when
one routed operation id should cover the whole script.
`executeScript` splits semicolon-separated SQL, preserving quoted semicolons,
backtick-quoted and square-bracket SQLite identifiers, and `CREATE TRIGGER` /
`CREATE TEMP TRIGGER` bodies, then runs the statements through bounded batch
calls. Leading SQL comments before `CREATE TRIGGER` are preserved without
splitting the trigger body.
`loadSqlDump` skips dump transaction wrappers such as `PRAGMA`, `BEGIN`, and
`COMMIT`, including wrappers preceded by SQL comments.

```ts
await client.grantMember("<service-principal>", "writer");
const members = await client.listMembers();
await client.revokeMember("<service-principal>");
```

Server and CI code can create the same SDK client from env:

```ts
import {
  archiveDatabaseToFileFromEnv,
  archiveDatabaseToFileFromEnvFile,
  archiveIcpdbServiceDatabaseToFile,
  archiveIcpdbServiceDatabaseToFileFromEnvFile,
  connectClientFromEnv,
  connectClientFromEnvFile,
  connectDatabaseFromEnvFile,
  connectIcpdbServiceDatabaseFromEnv,
  connectIcpdbServiceDatabaseFromEnvFile,
  checkIcpdbServiceEnvFileMode,
  createClientFromEnv,
  createClientFromEnvFile,
  createDatabaseFromEnvFile,
  createIcpdbPersistedServiceSqlClientFromEnvFile,
  createIcpdbServiceClientFromEnvFile,
  createIcpdbServiceDatabaseFromEnv,
  createIcpdbServiceSqlClientFromEnv,
  createIcpdbServiceSqlClientFromEnvFile,
  generateIcpdbServiceIdentity,
  inspectIcpdbServiceEnvFile,
  loadIcpdbServiceEnvFile,
  loadIcpdbServiceSetupFromEnvFile,
  persistIcpdbServiceDatabaseId,
  provisionIcpdbServiceDatabaseEnvFile,
  provisionIcpdbServiceEnvFile,
  provisionIcpdbServiceIdentity,
  restoreDatabaseFromFileFromEnv,
  restoreDatabaseFromFileFromEnvFile,
  restoreIcpdbServiceDatabaseFromFile,
  restoreIcpdbServiceDatabaseFromFileFromEnvFile,
  snapshotInfoFile,
  snapshotInfoIcpdbServiceFile,
  writeGeneratedIcpdbServiceEnvFile
} from "@icpdb/client/server";

const generated = await writeGeneratedIcpdbServiceEnvFile("./service.env", "ed25519", {
  canisterId,
  databaseId,
  networkUrl: "https://icp-api.io"
});
console.log(generated.principal);
console.log(await checkIcpdbServiceEnvFileMode());
console.log(generateIcpdbServiceIdentity().envText);

await provisionIcpdbServiceDatabaseEnvFile({
  canisterId,
  identityPemFile: "./owner.pem",
  setupSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)"
}, "./service.env", "writer");

const db = await connectIcpdbServiceDatabaseFromEnvFile();
await db.execute("INSERT INTO notes(body) VALUES (?1)", ["from-ci"]);

// Direct DB connect requires a DB-bearing service.env and never creates a DB.
const shortDb = await connectDatabaseFromEnvFile();
await shortDb.run("INSERT INTO notes(body) VALUES (?1)", ["from-short-db-ci"]);

// SQL client connect also requires a DB-bearing service.env and never creates a DB.
const connectedShortClient = await connectClientFromEnvFile();
await connectedShortClient.get("SELECT count(*) AS total FROM notes");

const serviceEnv = await loadIcpdbServiceEnvFile();
console.log(serviceEnv.ICPDB_DATABASE_ID);

const shortClient = await createClientFromEnvFile();
await shortClient.run("INSERT INTO notes(body) VALUES (?1)", ["from-short-ci"]);
const shortRows = await shortClient.query("SELECT id, body FROM notes ORDER BY id DESC");
// If service.env only has a canister URL, createClientFromEnvFile() creates a DB
// on the first SQL call and writes ICPDB_DATABASE_ID back.

const client = await createIcpdbServiceSqlClientFromEnvFile();
const inspection = await inspectIcpdbServiceEnvFile();
console.log(inspection.connectionUrl, inspection.principal);
await client.execute({ sql: "INSERT INTO notes(body) VALUES (?1)", args: ["from-ci"] });
await persistIcpdbServiceDatabaseId("./service.env", await client.databaseId());
const ciRows = await client.query({ sql: "SELECT count(*) AS total FROM notes" });
const ciTotal = await client.scalar("SELECT count(*) FROM notes");
const persistedClient = await createIcpdbPersistedServiceSqlClientFromEnvFile("./service.env");
await persistedClient.run("INSERT INTO notes(body) VALUES (?1)", ["from-persisted-ci"]);

const shortArchive = await archiveDatabaseToFileFromEnvFile("./backup-short.sqlite");
console.log(shortArchive.sha256);
const shortSnapshot = await snapshotInfoFile("./backup-short.sqlite");
await restoreDatabaseFromFileFromEnvFile("./backup-short.sqlite", {
  expectedSha256: shortSnapshot.sha256
});
await archiveDatabaseToFileFromEnv("./backup-process-env.sqlite");
await restoreDatabaseFromFileFromEnv("./backup-process-env.sqlite", {
  expectedSha256: shortSnapshot.sha256
});
// `ICPDB_SETUP_STATEMENTS` can seed SDK-created service DBs from a JSON statement array.
// `ICPDB_SETUP_SQL_FILE`, `ICPDB_SETUP_STATEMENTS_FILE`, and
// `ICPDB_SETUP_MIGRATIONS_FILE` keep larger setup inputs in normal files.
console.log(await loadIcpdbServiceSetupFromEnvFile("./service.env"));

const createdDb = await createIcpdbServiceDatabaseFromEnv();
await createdDb.execute("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)");
console.log(createdDb.databaseId);

const createdShortDb = await createDatabaseFromEnvFile("./service-create.env");
await createdShortDb.execute("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)");

const archive = await archiveIcpdbServiceDatabaseToFile(createdDb, "./backup.sqlite");
console.log(archive.sha256);
const snapshot = await snapshotInfoIcpdbServiceFile("./backup.sqlite");
await restoreIcpdbServiceDatabaseFromFile(createdDb, "./backup.sqlite", {
  expectedSha256: snapshot.sha256
});
await archiveIcpdbServiceDatabaseToFileFromEnvFile("./backup-from-env.sqlite");
await restoreIcpdbServiceDatabaseFromFileFromEnvFile("./backup-from-env.sqlite");

const setupDb = await createIcpdbServiceDatabaseFromEnv({
  ...process.env,
  ICPDB_SETUP_SQL: "CREATE TABLE setup_notes(id INTEGER PRIMARY KEY, body TEXT)",
  ICPDB_SETUP_STATEMENTS: JSON.stringify([
    { sql: "INSERT INTO setup_notes(body) VALUES (:body)", args: { body: "from-ci-setup" } }
  ])
});
console.log(await setupDb.get("SELECT body FROM setup_notes"));

const existingDb = await connectIcpdbServiceDatabaseFromEnvFile("./service.env");
console.log(await existingDb.schema());

// Controller-only maintenance calls require an identity configured to be a canister controller.
const operations = await createIcpdbServiceClientFromEnvFile("./controller.env");
const canisterHealth = await operations.health();
await operations.topUpDatabaseBalance(process.env.ICPDB_DATABASE_ID ?? "", 1000000n);
const shards = await operations.listShards();
await operations.createDatabaseShard({ initialCycles: 100000000000n, maxDatabases: 8 });
await operations.registerDatabaseShard({ databaseCanisterId: "<database-canister-id>", maxDatabases: 8 });
const shardStatus = await operations.getShardStatus(shards[0].canisterId);
await operations.createRemoteDatabase({ databaseId: "db_remote", databaseCanisterId: shardStatus.shard.canisterId });
await operations.topUpShard(shardStatus.shard.canisterId, 1000000n);
await operations.maintainShards({
  minAvailableSlots: 1,
  minCyclesBalance: 0n,
  topUpCycles: 0n,
  maxNewShards: 1,
  newShardMaxDatabases: 8,
  newShardInitialCycles: 0n
});
await operations.migrateDatabaseToShard("db_alpha", shardStatus.shard.canisterId);
await operations.listAllPlacements();
await operations.listShardOperations();
await operations.reconcileShardOperation({ operationId: "op_1", status: "applied", error: null });
await operations.getRoutedOperation("db_alpha", "op_1");
await operations.reconcileRoutedOperation("db_alpha", "op_1");
```

Direct service identity helpers also accept `connectionUrl` in options, so
`createIcpdbServiceClient`, `connectIcpdbServiceDatabase`,
`createIcpdbServiceSqlClient`, and `createIcpdbServiceDatabase` can consume the
same `client.info().connectionUrl`, console copy, or CLI URL handoff value
without renaming it to `url`. Choose either `connectionUrl` or `url`, not both.

`service.env`, `controller.env`, explicit `.env`, and token-backed
`database.env` files can contain private keys or bearer tokens. The repository
ignores those handoff files by default, and SDK/CLI helpers still require
owner-only mode 0600 before loading private-key env files.

Base service env:

```bash
ICPDB_CANISTER_ID=<canister-id>
ICPDB_NETWORK_URL=https://icp-api.io
ICPDB_IDENTITY_PEM_FILE=./service.pem
```

For existing DB helpers, choose one connection form:

```bash
ICPDB_URL=icpdb://<canister-id>/<database-id>
# or:
ICPDB_CANISTER_ID=<canister-id>
ICPDB_DATABASE_ID=<database-id>
```

Choose one service identity secret form: `ICPDB_IDENTITY_JSON`,
`ICPDB_IDENTITY_JSON_FILE`, `ICPDB_IDENTITY_PEM`, or
`ICPDB_IDENTITY_PEM_FILE`. Multiple secret sources are rejected so Server/CI
code cannot silently use a different principal from the one granted in the DB
member list. Generated service env also includes `ICPDB_IDENTITY_PRINCIPAL`;
env loaders reject a private key whose derived principal does not match that
pin, so secret rotation or CI variable drift fails before DB calls.

For DB creation helpers, omit `ICPDB_DATABASE_ID` and use `ICPDB_CANISTER_ID`
or `ICPDB_URL=icpdb://<canister-id>`.

Optional setup env when creating a new database. Use inline values:

```bash
ICPDB_SETUP_SQL=CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)
ICPDB_SETUP_STATEMENTS=[{"sql":"INSERT INTO notes(body) VALUES (:body)","args":{"body":"from-setup"}}]
ICPDB_SETUP_MIGRATIONS=[{"version":"001","name":"create_settings","sql":"CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)"}]
```

`ICPDB_SETUP_STATEMENTS` values accept the same structured `{ "kind",
"value" }` bind objects as SDK SQL calls, including large SQLite integers such
as `{ "kind": "integer", "value": "9007199254740993" }` and blob byte arrays.

Or use file-backed setup values, not both forms for the same setup kind:

```bash
ICPDB_SETUP_SQL_FILE=./schema.sql
ICPDB_SETUP_STATEMENTS_FILE=./statements.json
ICPDB_SETUP_MIGRATIONS_FILE=./migrations.json
```

Local-only root key, when using an icp-cli local network:

```bash
ICPDB_ROOT_KEY=<hex-root-key>
```

For each setup kind, choose either the inline env value or the file-backed env
value. Setting both, such as `ICPDB_SETUP_SQL` and `ICPDB_SETUP_SQL_FILE`, is
rejected before creating the client.

Omit `ICPDB_DATABASE_ID` and use `ICPDB_CANISTER_ID` or canister-only
`ICPDB_URL=icpdb://<canister-id>` when creating a new database with
`createIcpdbServiceDatabaseFromEnv` or with
`createIcpdbServiceSqlClientFromEnv` followed by the first SQL call, then persist
the returned `databaseId`.
`connectClientFromEnv` is the short Server/CI SQL client alias for DB-bearing
`process.env` connections and never creates a DB.
`connectClientFromEnvFile()` reads `service.env` by default, requires a
DB-bearing `ICPDB_URL` / `ICPDB_DATABASE_ID`, and never writes the env file.
`createClientFromEnv` remains the DB-bearing `process.env` SQL client alias.
`createClientFromEnv()` reads `process.env` directly and cannot write a newly
created database id back to an env file, so it rejects canister-only env. Use it
with a DB-bearing `ICPDB_URL` / `ICPDB_DATABASE_ID`, or use
`createClientFromEnvFile()` when canister-only setup should auto-create once and
persist the database id.
`createClientFromEnvFile()` is the shortest create-or-connect env-file SQL path; all service
identity `*FromEnvFile()` helpers read `service.env` by default. The persisted
SQL helper returns the same SQL client and persists a newly created database id
back to the env file when the env only contains a canister URL. Pass an explicit
path such as `createClientFromEnvFile("./service.env")` or
`createClientFromEnvFile("./.env")` when the file lives elsewhere or uses the
generic `.env` name.
When `ICPDB_SETUP_SQL` creates readable seed data, the first
`createClientFromEnvFile()` SQL call can be `get()` or `scalar()`; Server/CI does
not need a dummy write just to persist `ICPDB_DATABASE_ID`.
Without setup SQL, a first `scalar("SELECT 1 AS value")` also creates an empty
hosted DB, writes `ICPDB_DATABASE_ID` plus the DB-bearing `ICPDB_URL` back to
`service.env`, and returns `1`.
The first call can also be `info()` when a setup job only needs the handoff
object; it creates the DB, writes `ICPDB_DATABASE_ID` and the DB-bearing
`ICPDB_URL` back to the same env file, and returns `{ canisterId?, databaseId,
connectionUrl, url, principal }`.
In short, the first service-env call can also be get(), scalar(), or info().
After the auto-created database id is written back, create-time
`ICPDB_SETUP_*` keys are removed from the env file so later CI runs cannot
silently carry stale setup.
Service SQL client options reject `databaseId` plus setup at the type boundary,
and env helpers reject DB-bearing setup env at runtime. Use `exec`, `batch`, or
`migrate` when an existing `service.env` needs setup SQL.
The identity CLI and `icpdb-service-env-check.mjs` apply the same rule for
DB-bearing service env files, so `ICPDB_SETUP_*` cannot sit in CI env and be
silently ignored by normal `query`, `execute`, `status`, or smoke checks.
`connectDatabaseFromEnvFile()` is the short env-file alias for
`connectIcpdbServiceDatabaseFromEnvFile()` when Server/CI needs the direct
database client shape for an existing DB. It requires a DB-bearing
`service.env` and never creates a database.
`createDatabaseFromEnvFile("./service-create.env")` is the short env-file alias
for `createIcpdbServiceDatabaseFromEnvFile(...)` when setup should create a new
direct database client.
`archiveDatabaseToFileFromEnvFile("./backup.sqlite")`,
`snapshotInfoFile("./backup.sqlite")`, and
`restoreDatabaseFromFileFromEnvFile("./backup.sqlite", { expectedSha256 })` are
the short Server/CI backup helpers for the same bounded chunk transfer.
`archiveDatabaseToFileFromEnv("./backup.sqlite")` and
`restoreDatabaseFromFileFromEnv("./backup.sqlite", { expectedSha256 })` use
already-loaded `process.env` for CI jobs that source `.env` in the job runner.
For package CLI commands that should read `.env` directly, pass
`--service-env-file .env`; the file still must be mode 0600. Repository-local
legacy scripts use `ICPDB_ENV_FILE=.env` or `--env-file .env` for the same
non-default path.
Use `ICPDB_URL=icpdb://<canister-id>/<database-id>` when a single explicit
connection value is more convenient than separate `ICPDB_CANISTER_ID` and
`ICPDB_DATABASE_ID` env values.
If `ICPDB_URL` is set together with `ICPDB_CANISTER_ID` or `ICPDB_DATABASE_ID`,
the values must describe the same canister and database; mismatches are rejected
before a client is created or a database id is persisted. Malformed database id
encoding is rejected.
Use the `ICPDB_SETUP_*_FILE` variables when CI should read schema, statement
JSON, or migration JSON from files instead of embedding large setup content in
`.env`. Do not set the inline `ICPDB_SETUP_*` value and matching file variable
together.
`generateIcpdbServiceIdentity` creates a dedicated service principal and `.env`
payload. Pass `{ canisterId, databaseId, networkUrl, rootKey }` as the second
argument when a browser/II or controller handoff should generate a
canister-targeted env without hand-editing connection values; `databaseId` also
writes `ICPDB_URL`.
`writeGeneratedIcpdbServiceEnvFile("./service.env", "ed25519", { canisterId, databaseId, networkUrl: "https://icp-api.io" })`
writes that DB-bearing canister-targeted payload with mode 0600.
`provisionIcpdbServiceIdentity(ownerDb, "writer")` generates a
service identity and grants the generated principal to an existing owner DB
handle.
`provisionIcpdbServiceEnvFile(ownerDb, "./service.env", "writer")` does the
same grant for an existing DB and writes a complete 0600 Server/CI env file with
`ICPDB_URL`, `ICPDB_CANISTER_ID`, `ICPDB_DATABASE_ID`, and the service identity
private key.
`provisionIcpdbServiceDatabaseEnvFile({ canisterId, identityPemFile, setupSql }, "./service.env", "writer")`
creates a DB with the owner identity, runs setup, grants a generated service
identity, and writes the complete Server/CI env file in one call.
SDK grant/provision helpers reject roles other than `reader`, `writer`, or
`owner` before sending a canister call, so plain JavaScript setup scripts cannot
silently downgrade an invalid role to reader.
Use `createIcpdbServiceSqlClientFromEnvFile("./service.env")` or
`connectIcpdbServiceDatabaseFromEnvFile("./service.env")` when the same
`service.env` file from the identity CLI should be consumed directly without
shell sourcing. SQL clients created from app identity or service identity expose
`await client.principal()`, so setup scripts can print the exact principal that
will be checked by database ACLs.
Env-file SDK helpers call `checkIcpdbServiceEnvFileMode()` before reading the
default `service.env` file and reject group/world-readable private-key env
files. `loadIcpdbServiceEnvFile()` also reads `service.env` by default.
Service env, service identity secret, and snapshot/archive file helpers reject
empty or whitespace-only file paths before env loading, file I/O, or canister
archive calls. Restore helpers reject empty or malformed `expectedSha256` pins
before loading env files or reading snapshots.
`inspectIcpdbServiceEnv` and `inspectIcpdbServiceEnvFile` validate the env
connection, load the service principal, and report the resolved `canisterId`,
optional `databaseId`, connection URL, network URL, root-key presence, and setup
counts without making a canister call.
SDK connection and service env helpers reject empty or whitespace-only
`canisterId`, `databaseId`, SDK `host`, empty SDK `rootKey`, and `ICPDB_*`
connection values before creating a client or persisting a database id.
This service principal is separate from the browser Internet Identity
principal. The database member list is the join point: keep the browser user
principal for interactive ownership and grant the service principal for
automation.
Use `createIcpdbServiceClientFromEnvFile("./controller.env")` for the service identity low-level client when Server/CI needs controller operations including DB balance correction, shard inventory/status/creation/registration/remote DB creation/maintenance/top-up/migration, global shard placement, shard journal listing, operator reconcile, or routed write recovery. The identity in that env file must be a canister controller for controller-only methods.
Use `icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller.env --format table`
to verify the installed package CLI can load the same canister-only controller
env and run shard inventory, journal, and zero-action maintenance checks.
`persistIcpdbServiceDatabaseId("./service.env", await client.databaseId())`
updates a generated service env file after first database creation, so later
Server/CI runs reconnect to the same DB. It rewrites the env URL through
`formatIcpdbDatabaseUrl`, so `ICPDB_URL` keeps the same encoded connection value
as SDK `connectionUrl()`.
Whitespace-only database ids are rejected before the env file is rewritten.
`createIcpdbPersistedServiceSqlClientFromEnvFile("./service.env")` performs the
same persist step automatically when the env file does not yet contain a
database id, so the first successful SQL call does not leave a one-off DB
unrecorded. If writing the database id back to the env file fails, the helper
deletes the newly created DB before returning the error. After `close()` or
`reconnect()`, it rereads the env file and connects to the persisted DB instead
of creating a second DB.
`writeIcpdbServiceEnvFile` and `persistIcpdbServiceDatabaseId` write
`service.env` with mode 0600 because it can contain a private key.
`archiveIcpdbServiceDatabaseToFile` and
`restoreIcpdbServiceDatabaseFromFile` stream snapshots through the same bounded
Candid chunk lifecycle as the CLI. The `FromEnvFile` variants consume
`service.env` directly, so Server/CI backup jobs do not need shell sourcing or
in-memory snapshot buffers. Archive file export cancels the canister archive
state when the target file cannot be opened, transfer fails, or finalize fails,
so a failed Server/CI backup does not leave the DB in `archiving`. Pass
`{ envPath: "./other.env" }` when the env file is not cwd-local `service.env`.
`icpdb-service-env-check.mjs --format env` emits only non-secret check output
under `ICPDB_SERVICE_CHECK_*`, so CI jobs can capture the service principal,
caller role, connection URL, SQL/SDK smoke rows, archive/restore scratch DB ids,
archive/restore hash, shard canister ids, remote shard status canister/cycles,
shard available slots, and shard counts without printing the service private key. The reusable connection value is
reported as
`ICPDB_SERVICE_CHECK_CONNECTION_URL`.

Node setup scripts can grant the `.env` service identity to an existing
database in one call:

```ts
import {
  grantIcpdbServiceIdentityFromEnv,
  grantIcpdbServiceIdentityFromEnvFile,
  loadIcpdbServicePrincipalFromEnv
} from "@icpdb/client/service-identity";

const db = await connectIcpdbDatabase({ canisterId, identity, databaseId });
console.log(await loadIcpdbServicePrincipalFromEnv());
const servicePrincipal = await grantIcpdbServiceIdentityFromEnv(db);
await grantIcpdbServiceIdentityFromEnvFile(db, "./service.env");
```

`grantIcpdbServiceIdentityFromEnv` returns the granted principal, so setup
scripts can print the exact service identity that Server/CI will use.

## Package CLI

Server, CLI, and CI flows should use the installed package bin `icpdb` with a
dedicated service identity. The bin signs Candid calls with the principal stored
in `service.env` and does not require a database bearer token. Use
`icpdb help [command]` for focused command syntax before secrets exist.
Package CLI unknown-command proof: Unknown package CLI commands report `unknown command` before reading `service.env`, params files, or snapshot files, so command typos are not masked by missing CI secrets.

```bash
icpdb help quickstart
icpdb help init
icpdb help db
icpdb help identity
icpdb help sql
icpdb help exec
icpdb help inspect
icpdb help backup
icpdb help ops
icpdb help permissions
icpdb help shell
```

Create a new Server/CI-owned DB, run schema setup, persist `service.env`, and
verify the generated env before the first SQL call:

```bash
icpdb init \
  --canister-id <canister-id> \
  --network-url https://icp-api.io \
  --env-out service.env \
  --setup-file ./schema.sql \
  --format table

icpdb inspect-env --format table
icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table
```

`inspect-env` validates the env connection, resolved principal, and setup counts
locally and does not make a canister call. `check-env` adds canister-visible
role and smoke evidence.
`init`, `create-db`, `generate-identity`, `inspect-env --format env`,
`url --format env`, and `info --format env` print or write a complete reusable
env block containing
`ICPDB_CANISTER_ID`,
`ICPDB_NETWORK_URL`, `ICPDB_DATABASE_ID` when database-bearing, `ICPDB_URL`, the
derived `ICPDB_IDENTITY_PRINCIPAL`, and the selected identity secret reference.
Database-bearing handoff output also includes matching `ICPDB_CONNECTION_URL`;
written `service.env` files keep one canonical `ICPDB_URL`.
Do not redirect secret-bearing output to `service.env`; use `--env-out` so the
CLI writes the file with mode 0600. `init --env-out` and
`generate-identity --env-out` refuse to overwrite an existing env file.
`create-db --setup-file`, `create-db --setup-statements-file`, and
`create-db --setup-migrations-file` remain available for explicit canister-only
service env flows; `init` is the shortest create/setup/persist path.

For a one-table smoke without a schema file:

```bash
icpdb init \
  --canister-id <canister-id> \
  --network-url https://icp-api.io \
  --env-out service.env \
  --setup-sql "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)" \
  --format table
```

After `service.env` exists, run normal SQL, table/schema inspection, and URL
handoff commands pathlessly from the directory that contains the file:

```bash
icpdb execute "INSERT INTO notes(body) VALUES (?1)" \
  --params '["from-ci"]' \
  --idempotency-key ci-notes-insert-001 \
  --wait

icpdb query "SELECT id, body FROM notes ORDER BY id DESC" --format table
icpdb scalar "SELECT count(*) FROM notes" --format table
icpdb tables --format table
icpdb views --format table
icpdb stats --format table
icpdb schema notes --format table
icpdb describe notes --format table
icpdb columns notes --format table
icpdb indexes notes --format table
icpdb triggers notes --format table
icpdb foreign-keys notes --format table
icpdb preview notes --limit 25 --format table
icpdb inspect notes --format table
icpdb status --format table
icpdb url --format env
```

Use JSON files for repeatable CI statement groups and migrations:

```bash
icpdb dump ./dump.sql
icpdb load ./dump.sql --mode write --idempotency-key ci-load-001 --wait
icpdb batch ./read-statements.json --mode read --format table
icpdb transaction ./transaction.json \
  --mode write \
  --idempotency-key ci-notes-transaction-001 \
  --wait
icpdb script ./schema.sql --mode write --idempotency-key ci-schema-001 --wait
icpdb exec "CREATE TABLE inline_notes(id INTEGER); INSERT INTO inline_notes(id) VALUES (1)" --idempotency-key ci-exec-001 --wait
icpdb load - --mode read
icpdb script - --mode read
icpdb migrate ./migrations.json --idempotency-key ci-migrate-001 --wait
icpdb operation <operation-id> --format table
icpdb operation-reconcile <operation-id> --format table
```

For non-default env files such as `.env`, pass `--service-env-file <path>`; do
not shell-source private keys:

```bash
icpdb init \
  --canister-id <canister-id> \
  --network-url https://icp-api.io \
  --env-out .env \
  --setup-file ./schema.sql \
  --format table

icpdb check-env --service-env-file .env --require-role writer --smoke-sql --format table
icpdb query "SELECT id, body FROM notes" --service-env-file .env --format table
```

Browser Internet Identity and Server/CI service identities are intentionally
different principals. Do not share the browser principal's private key. For an
existing browser/II-owned DB, generate a database-bearing `service.env`, copy
the printed service principal into console Permissions while logged in as the
browser owner, paste it into `Member principal`, choose owner, click
`Grant member access`, then verify the service env:

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
icpdb tables --format table
icpdb views --format table
icpdb schema --format table
icpdb describe <table> --format table
icpdb preview <table> --limit 25 --format table
icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table
```

For an existing DB where an owner `service.env` is available, provision a
dedicated service env from the owner env:

```bash
icpdb provision-service <database-id> writer \
  --service-env-file owner.env \
  --env-out service.env \
  --format table

icpdb check-env --require-role writer --smoke-sql --format table
```

Archive/restore requires owner role. A writer `service.env` is for SQL
write/query CI only. Backup jobs should grant owner before running archive or
restore and should run the owner smoke before promoting snapshot artifacts:

```bash
icpdb provision-service <database-id> owner --service-env-file owner.env --env-out service.env --format table
icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table

icpdb archive ./backup.sqlite --format env
icpdb snapshot-info ./backup.sqlite --format env
export ICPDB_SNAPSHOT_HASH=<value-from-snapshot-info>
icpdb restore ./backup.sqlite --expect-snapshot-hash "$ICPDB_SNAPSHOT_HASH" --format table
icpdb status --format table
```

`restore` writes into the selected DB. Pin the SHA-256 from `snapshot-info`
before promoting a snapshot in CI. The owner `check-env` proof creates CLI and
SDK scratch archive/restore DBs, validates restored rows/scalars, and leaves
the configured DB intact.

Controller/shard operations use a canister-only `controller.env`; do not put
`ICPDB_DATABASE_ID` or a database-bearing `ICPDB_URL` in that file:

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

icpdb all-placements --service-env-file controller.env --format table
icpdb shards --service-env-file controller.env --format table
icpdb shard-maintain 0 0 0 0 0 0 --service-env-file controller.env --format table
icpdb shard-status <database-canister-id> --service-env-file controller.env --format table
icpdb shard-top-up <database-canister-id> 1000000 --service-env-file controller.env --format table
icpdb shard-maintain 1 0 0 0 8 0 --service-env-file controller.env --format table
icpdb shard-migrate <database-id> <database-canister-id> --service-env-file controller.env --format table
icpdb shard-ops --service-env-file controller.env --format table
icpdb shard-reconcile <operation-id> applied --service-env-file controller.env --format table
icpdb shard-reconcile <operation-id> failed "operator verified failure" --service-env-file controller.env --format table

# Routed DB writes are tracked with the database-bearing service.env.
icpdb operation <operation-id> --format table
icpdb operation-wait <operation-id> --reconcile-unknown --format table
icpdb operation-reconcile <operation-id> --format table
```

Use `applied` only for verified success. Use `failed` with a reason only after
operator verification.

The package CLI reads cwd-local `service.env` by default for normal commands.
It rejects group/world-readable service env files before reading private-key
identity values, and referenced `ICPDB_IDENTITY_JSON_FILE` /
`ICPDB_IDENTITY_PEM_FILE` files must also be owner-only and non-empty. Choose
exactly one identity secret source (`ICPDB_IDENTITY_JSON`,
`ICPDB_IDENTITY_JSON_FILE`, `ICPDB_IDENTITY_PEM`, or
`ICPDB_IDENTITY_PEM_FILE`); multiple sources are rejected instead of selecting a
principal by precedence. If `ICPDB_IDENTITY_PRINCIPAL` is present, the CLI
verifies the loaded private key derives the same principal before creating an
actor or printing `inspect-env`.

`sql` auto-routes read SQL to `sql_query` and write SQL to `sql_execute`,
ignoring leading SQL whitespace and comments for the read/write decision.
`--params` accepts positional JSON arrays or named JSON objects for `:name`,
`@name`, and `$name` placeholders; `--params-file <file>` reads the same JSON
shape from disk. `execute`, write-routed `sql`, `batch`, `transaction`, `load`,
`script`, and `migrate` accept `--idempotency-key <key>` for retry-safe remote
writes. Add `--wait` to poll that routed operation until it is no longer
pending.
In particular, write-mode `load` / `script` accept `--idempotency-key <key>`
and derive per-chunk keys for SQL file batches.
`migrate [database_id] <file|->` records applied versions in
`icpdb_schema_migrations`. `operation [database_id] <operation_id>` and
`operation-reconcile [database_id] <operation_id>` inspect and recover routed
writes when a caller must reconcile remote shard state.
Use `--idempotency-key` and `--wait` for retry-safe remote migration writes.
`url [database_id] --format env` prints the reusable
`ICPDB_CANISTER_ID`, `ICPDB_DATABASE_ID`, and `ICPDB_URL` connection block for
app, Server, CLI, or CI handoff.
Empty or whitespace-only database ids from positional args, `--database-id`,
`ICPDB_DATABASE_ID`, or `ICPDB_URL` path fail before a Candid request is built.
When `service.env` already selects a database, short-form commands use that configured database and reject extra positionals.
Package CLI fixed-argument proof. Non-SQL package CLI commands with fixed positional shapes reject extra arguments before loading env files or building Candid requests.
Package CLI table inspection commands and matching shell dot-commands reject
empty or whitespace-only table names before a Candid request is built.
Package CLI table name proof covers `describe`, `preview`, `columns`, `indexes`, `triggers`, `foreign-keys`, `inspect`, `schema`, and `dump`.
The dump/load/script/migrate commands accept files or `-` for stdin/stdout
where supported, so CI can pipe SQL without introducing database bearer tokens.
`script <file|-> --mode read` and `load <file|-> --mode read` return
per-statement query results; use write mode for mutating SQL. In short,
script/load --mode read is for SQL files whose statements are all reads.

`icpdb shell [sql|dot-command]` opens the same service-env SQL surface without
issuing a database bearer token. Shell write SQL auto-generates an idempotency
key and honors `--wait`. Use `.tables`, `.schema`, `.inspect`, `.dump`,
`.load`, `.script`, `.migrate`, `.archive`, `.snapshot-info`, `.restore`,
`.members`, `.grant-member`, `.revoke-member`, `.placement`, and `.operation`
for one-shot operator checks. Unknown or incomplete shell dot-commands fail in the shell parser instead of being sent as SQL.

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
load. Single-database canisters should use
`database_id = "default"` rather than changing the wire contract.
`SqlExecuteResponse.routed_operation_id` is optional and should be `null` for
direct/local execution. Hosted sharded implementations set it for routed writes
so SDK, CLI, and console callers can inspect the operation later.

`sql_query` must be read-only. `sql_execute` must require an authenticated
writer or admin. Canisters must reject anonymous callers, enforce SQL and
response bounds, and duplicate access checks in every protected update method.
`canister_inspect_message` is not an authorization boundary.

## Hosted Demo Deposit Flow

The hosted ICPDB reference canister still contains deposit APIs, but they are
not required by the SQLite Admin Protocol. Billing-specific implementation is
preserved on the `billing-hosted-demo` branch.

The hosted demo flow uses the existing canister APIs:

1. `get_deposit_quote(database_id, amount_e8s)`
2. wallet `icrc2_approve` for the ICP ledger
3. `deposit_with_approval(database_id, amount_e8s)`
4. refresh billing and payment history

Initial rate:

- `1 ICP = 100_000 billing units`
- minimum deposit: `0.01 ICP`
- default ICP transfer fee cache: `10_000 e8s`

`top_up_database_balance` remains an operator correction API and is not exposed in the normal UI.

## Hosted Demo Billing Model

Read-only `sql_query` calls are free update calls so remote shard databases can be routed through the control canister. They still enforce SQL mode, response limits, and role checks.

The hosted demo can charge write/update APIs after successful execution.
Protocol adapter canisters do not need billing, deposits, or payment history.

## Table Editor API

The protocol exposes read-only inspection calls for a Supabase-style table editor:

- `list_tables(database_id)`
- `describe_table(database_id, table_name)`
- `preview_table({ database_id, table_name, limit, offset })`

These calls require reader access and return SQLite schema objects, column metadata, indexes, triggers, foreign keys, and bounded preview rows.

The hosted ICPDB demo also exposes a bearer-token HTTP surface for curl,
external HTTP clients, browser token sessions, and short-lived sharing. Normal
Server/CI automation should use the package `icpdb` CLI, `@icpdb/client/server`,
or `@icpdb/client/service-identity` with principal ACLs instead of storing database
bearer tokens. Database bearer tokens are not the Server/CI path when
`service.env` can hold a service identity:

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

Hosted demo billing endpoints:

- `POST /v1/billing`
- `POST /v1/payments/list`

## HTTP CLI

The local helper uses the bearer-token HTTP surface without adding dependencies.
Use it for curl-compatible external HTTP flows or short-lived shared access.
For Server/CI jobs that can hold a service identity private key, prefer
the package `icpdb` CLI and `service.env`; keep database bearer tokens for
external HTTP flows, browser token sessions, or short-lived shared access:

```bash
node scripts/icpdb-http.mjs help shell sql

node scripts/icpdb-http.mjs \
  --network-url https://icp-api.io \
  --canister-id <canister-id> \
  create-db owner

# create-db calls Candid create_database and create_database_token, then prints the database_id and owner token.
# create-db --format table flattens database_id, owner_token_id, and owner_token.

node scripts/icpdb-http.mjs \
  --network-url https://icp-api.io \
  --canister-id <canister-id> \
  --env-out database.env \
  create-db owner

# create-db --env-out writes database.env with mode 0600 and deletes the new DB if env writing fails.
# create-db --format env prints ICPDB_CANISTER_ID, ICPDB_NETWORK_URL, ICPDB_DATABASE_ID, ICPDB_URL, and ICPDB_TOKEN.
# Env output rejects empty or whitespace-only canister id, network URL, database id, and owner token values.
# --env-file, --env-out, and setup/params file options reject empty or whitespace-only paths before file I/O.
# Add --base-url <custom-http-gateway> to include ICPDB_HTTP_BASE_URL for local gateways or custom domains.

node scripts/icpdb-http.mjs \
  --network-url https://icp-api.io \
  --canister-id <canister-id> \
  --base-url https://<canister-id>.icp0.io \
  --env-out database.env \
  --idempotency-key create-notes-001 \
  --statement "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)" \
  --statement "INSERT INTO notes(body) VALUES ('hello')" \
  create-db owner

# create-db --statement, --statements-file, and --setup-file <file|-> run setup SQL through the new owner token immediately after DB creation.
# If owner-token creation or setup fails after DB creation, create-db deletes the newly created DB before returning the error.
# Use --idempotency-key for setup writes, especially when the new DB is routed to a database canister.

node scripts/icpdb-http.mjs \
  --network-url https://icp-api.io \
  --canister-id <canister-id> \
  --base-url https://<canister-id>.icp0.io \
  --env-out database.env \
  --idempotency-key migrate-notes-001 \
  --setup-migrations-file ./migrations.json \
  create-db owner

# create-db --setup-migrations-file applies the same versioned migration JSON used by migrate.

node scripts/icpdb-http.mjs --env-file database.env query \
  "SELECT id, body FROM notes ORDER BY id DESC"

node scripts/icpdb-http.mjs --env-file database.env \
  --idempotency-key insert-note-001 \
  execute "INSERT INTO notes(body) VALUES ('from-ci')"

# --env-file reads create-db --env-out / --format env output without shell sourcing.
# Bearer-token env files must be owner-only because they contain ICPDB_TOKEN.
# Explicit flags such as --base-url, --token, and --database-id override file values.
# When ICPDB_DATABASE_ID or ICPDB_URL selects a DB, bearer-token HTTP CLI short forms reject extra positional args instead of reinterpreting them as another database id; pass --database-id <id> to select another DB explicitly.
# Bearer-token HTTP CLI fixed-form commands, including shard/controller ops, reject extra positional args instead of silently ignoring them.
# Unknown bearer-token HTTP CLI commands report unknown command before requiring HTTP env.
# create-db creates a new database; omit --database-id, ICPDB_DATABASE_ID, and ICPDB_URL.

node scripts/icpdb-http.mjs \
  --network-url https://icp-api.io \
  --canister-id <canister-id> \
  databases

# databases calls Candid list_databases and prints caller-visible database memberships.

ICPDB_URL=icpdb://<canister-id>/<database-id> \
ICPDB_TOKEN=<database-token> \
node scripts/icpdb-http.mjs query "SELECT id, body FROM notes ORDER BY id DESC"

# ICPDB_URL derives https://<canister-id>.icp0.io and ICPDB_DATABASE_ID for bearer-token DB commands.
# If ICPDB_URL is set with ICPDB_CANISTER_ID or ICPDB_DATABASE_ID, mismatches are rejected.
# Encoded database ids such as db%2Farchive are decoded like the SDK and identity CLI.
# Userinfo, query, and fragment components are rejected.
# Malformed database id encoding is rejected.
# Use ICPDB_HTTP_BASE_URL with ICPDB_DATABASE_ID for local gateways or custom domains.

ICPDB_HTTP_BASE_URL=https://<canister-id>.icp0.io \
ICPDB_TOKEN=<database-token> \
ICPDB_DATABASE_ID=<database-id> \
node scripts/icpdb-http.mjs tables

ICPDB_HTTP_BASE_URL=https://<canister-id>.icp0.io \
ICPDB_TOKEN=<database-token> \
ICPDB_DATABASE_ID=<database-id> \
node scripts/icpdb-http.mjs views

ICPDB_HTTP_BASE_URL=https://<canister-id>.icp0.io \
ICPDB_TOKEN=<database-token> \
ICPDB_DATABASE_ID=<database-id> \
node scripts/icpdb-http.mjs stats --format table

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
```

`help shell sql` prints the bearer-token shell SQL read/write routing and write
idempotency behavior without opening an interactive shell.

Add `--format table` to render SQL rows, preview rows with page metadata, schema details, index details, trigger details, foreign-key details, and status responses as terminal tables.
Add `--format csv` to export SQL rows, preview rows, schema DDL rows, inspect table preview rows, table summaries, columns, indexes, triggers, foreign keys, and record lists as CSV.
For `stats --format csv`, the first row is the database summary and later rows are per-table summaries.
The default non-interactive format remains JSON for scripting.
For bearer-token DB commands, `ICPDB_DATABASE_ID` or `--database-id` can replace
the positional `<database-id>`. `ICPDB_URL=icpdb://<canister-id>/<database-id>`
also sets the database id and derives the default mainnet HTTP gateway URL.
In command help, `[database_id]` means the value can come from
`ICPDB_DATABASE_ID`, `--database-id`, or `ICPDB_URL`; this covers SQL,
table/schema inspection, account commands, archive/restore, and `shell`.
Empty or whitespace-only database ids from positional args, `--database-id`, or
`ICPDB_DATABASE_ID` fail before an HTTP request is built.
Table inspection commands and matching shell dot-commands also reject empty or
whitespace-only table names before an HTTP request is built.
Routed operation lookup/reconcile helpers reject empty or whitespace-only
operation ids, and token creation helpers reject empty or whitespace-only token
names before an HTTP or Candid request is built. `revoke-token` also rejects
empty or whitespace-only token ids before an HTTP request is built.

### SQL through the HTTP CLI

Use `query` for read-only SQL, `execute` for one write statement, `batch` for multiple statements, and `shell` for an interactive Turso-like session.

```bash
node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  query <database-id> \
  "SELECT id, body FROM notes WHERE body = ?1 ORDER BY id DESC" \
  --params-file ./params.json \
  --max-rows 100

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  --idempotency-key notes-create-001 \
  --wait \
  execute <database-id> \
  "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)"

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  --idempotency-key notes-seed-001 \
  --wait \
  batch <database-id> \
  --statement "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)" \
  --statement "INSERT INTO notes(body) VALUES ('hello')"

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  batch <database-id> \
  --mode read \
  --statements-file ./read-statements.json

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  shell <database-id>

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  shell <database-id> "SELECT count(*) AS total FROM notes"
```

The CLI can run raw SQL, but protocol-compatible canisters must still enforce
safety bounds:

- `query` accepts only read-only SQL whose main statement is `SELECT`, read CTE `WITH ... SELECT`, read-only `PRAGMA`, or `EXPLAIN`; CTE-leading writes are rejected.
- `execute` accepts write SQL, but rejects file-affecting statements: `ATTACH`, `DETACH`, `VACUUM`, and unsafe `PRAGMA` settings. Hosted-safe `PRAGMA foreign_keys`, `PRAGMA defer_foreign_keys`, and `PRAGMA user_version` settings are allowed.
- SQL text is limited to 32 KiB, parameters to 128, batch statements to 32, returned rows to 500, and response size to about 1.5 MB.
- Write calls require a writer or admin. The hosted demo may also require billing balance.
- `batch --mode read` validates every statement as read-only and runs each one through `/v1/sql/query`; it does not accept `--idempotency-key` or `--wait`.
- `script <file|-> --mode read` and `load <file|-> --mode read` run SQL files through `/v1/sql/query`, return per-statement results, and reject write statements before sending a request.
- HTTP CLI `query` and `execute` accept positional JSON arrays or named JSON objects through `--params '[...]'` / `--params '{"name":"value"}'` or `--params-file <file>`, and repeated named placeholders bind once.
- Remote database-canister writes require an idempotency key. CLI `shell` write SQL also generates one automatically; non-shell `execute`, write-mode `batch`, `transaction`, and `load` calls should pass `--idempotency-key`. Add `--wait` to poll the returned routed operation until it is applied, failed, or unknown.
- Empty or whitespace-only `--idempotency-key` values are rejected before write requests are built.

```bash
node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  placement <database-id>

# placement shows whether the database is local or routed to a database canister.

# Controller placement and shard journal operations use Candid, not database bearer tokens.
# `scripts/icpdb-identity.mjs` exposes the same shard operations with a service identity.
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
  shard-maintain 1 0 0 0 8 0

node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  shard-migrate <database-id> <database-canister-id>

node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  shard-ops

node scripts/icpdb-http.mjs \
  --network-url http://localhost:8001 \
  --root-key <local-root-key> \
  --canister-id <canister-id> \
  shard-reconcile applied <operation-id>

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
Hosted demo owner-token inspect also includes billing.
Use `--access` with an owner token to include token, member, and hosted payment summaries.
Access summaries include token active/revoked status, last-used metadata, member grant time, and hosted payments.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  schema <database-id> [table-name]

# schema output includes table/view, index, and trigger DDL from the inspection metadata.
# schema --format csv emits one row per table/view, index, and trigger DDL.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  dump <database-id> [table-name] > dump.sql

# dump output is SQLite SQL text built from schema metadata and paginated table previews.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  load <database-id> dump.sql \
  --idempotency-key import-001 \
  --wait

cat dump.sql | node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  load <database-id> - \
  --idempotency-key import-stdin-001

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  script <database-id> ./schema.sql \
  --idempotency-key schema-001

cat schema.sql | node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  script <database-id> - \
  --idempotency-key schema-stdin-001

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <database-token> \
  migrate <database-id> ./migrations.json \
  --idempotency-key migrate-001

# load executes a SQL dump through the batch API, skipping dump PRAGMA and transaction wrappers.
# With --wait, each import batch records and polls its derived routed operation id.
# script executes semicolon-separated setup SQL without dump-specific filtering.
# migrate reads versioned migration JSON, records applied versions in icpdb_schema_migrations, and skips already-applied versions.

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

# Hosted demo billing helpers:

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

Hosted payment history and token create/list/revoke commands require an `owner` database token.
`create-token --format table` flattens the new token secret and metadata.
`tokens --format table` shows token active/revoked status and last-used metadata.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  archive <database-id> ./snapshot.sqlite3 \
  --format env

node scripts/icpdb-http.mjs \
  --env-file database.env \
  archive ./snapshot.sqlite3 \
  --format env

export ICPDB_SNAPSHOT_HASH=<value-from-snapshot-info>

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  restore <database-id> ./snapshot.sqlite3 \
  --expect-snapshot-hash "$ICPDB_SNAPSHOT_HASH"

node scripts/icpdb-http.mjs \
  --env-file database.env \
  restore ./snapshot.sqlite3 \
  --expect-snapshot-hash "$ICPDB_SNAPSHOT_HASH"

Archive/restore commands use the chunked HTTP API and require an `owner` database token. `snapshot-info` is offline and lets CI pin the expected SHA-256 before restore begins.

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
Membership changes always keep at least one owner principal on the database;
owner tokens cannot downgrade or revoke the last owner principal. Console grant/revoke controls also block last-owner downgrade/revoke before submit. The anonymous principal cannot be granted database access; SDK, identity CLI, II-backed console, and owner-token HTTP admin client grant paths reject it before sending the request. SDK, identity CLI, II-backed console, and owner-token HTTP admin member operations also reject empty principal strings before grant/revoke requests. Browser/HTTP admin token, member, and archive/restore helpers also reject invalid token scopes, empty token names/ids, invalid member roles, non-32-byte snapshot hashes, unsafe archive/restore numbers, and non-byte snapshot chunks before sending the request. Browser token SQL/table/operation helpers reject empty operation ids, table names, SQL text, database-id drift, and empty explicit idempotency keys before sending the request. Browser token writes use a generated idempotency key unless the request supplies a trimmed explicit key. Use read tokens for public read-only sharing.
Console/SDK Candid codecs and identity CLI output normalization reject unknown database role, database token scope, database status, and routed operation status variants instead of displaying reader/read/hot defaults.

node scripts/icpdb-http.mjs \
  --base-url https://<canister-id>.icp0.io \
  --token <owner-database-token> \
  delete-db <database-id>

Database delete requires an `owner` database token.
```

The shell renders grouped `.help`, focused `.help <command>`, `.help sql`, `.tables`, `.views`, `.stats`, `.usage`, hosted `.billing` / `.payments`, `.placement`, `.operation <operation_id>`, `.usage-events`, `.quota`, `.tokens`, `.create-token`, `.revoke-token`, `.members`, `.grant-member`, `.revoke-member`, `.delete-db`, `.describe`, `.columns`, `.indexes`, `.triggers`, `.foreign-keys`, `.schema`, `.dump`, `.load`, `.script`, `.migrate`, `.archive`, `.snapshot-info`, `.restore`, `.archive-cancel`, `.preview`, `.inspect [table] [limit] [offset]`, `.inspect --access`, `.quit`, and SQL result rows in table form by default. Dot-command table, operation, token, and file arguments support single quotes, double quotes, and backslash escaping. Unknown or incomplete dot-commands fail in the shell parser instead of being sent as SQL. File write dot-commands `.load`, `.script`, and `.migrate` auto-generate idempotency keys and honor shell `--wait`.
Passing SQL or a dot-command after `<database-id>` runs one shell command without opening interactive mode.
Passing `--format csv` to `shell` renders SQL and dot-command row output as CSV.

The browser console generates idempotency keys automatically for token-session execute / batch requests.

## Checks

```bash
node scripts/icpdb-release-check.mjs --with-rust
node scripts/icpdb-release-check.mjs --with-local-smoke
node scripts/icpdb-release-check.mjs --with-mainnet-sql-smoke
node scripts/icpdb-release-check.mjs --with-mainnet-sql-smoke --mainnet-canister-id <id>
node scripts/icpdb-release-check.mjs --with-mainnet-sql-smoke --service-env-file service.env
node scripts/icpdb-release-check.mjs --service-env-file service.env --with-service-env-sql-smoke
node scripts/icpdb-release-check.mjs --service-env-file service.env --with-service-env-archive-restore-smoke
node scripts/icpdb-release-check.mjs --controller-env-file controller.env --with-controller-env-shard-smoke
node scripts/icpdb-release-check.mjs --require-mainnet-canister-id
node scripts/icpdb-release-check.mjs --goal-readiness --format table
node scripts/icpdb-release-check.mjs --goal-complete
node scripts/icpdb-release-check.mjs --self-test
node scripts/icpdb-release-check.mjs --skip-build
node scripts/check-ci-workflow.mjs
node scripts/icpdb-mainnet-preflight.mjs
node scripts/icpdb-mainnet-postdeploy.mjs --skip-call

pnpm --dir icpdb-console test
pnpm --dir icpdb-console typecheck
pnpm --dir icpdb-console lint
pnpm --dir icpdb-console build
```

Live local goal smokes:

```bash
icp network start -d -e local-icpdb
icp deploy -e local-icpdb -y
node scripts/icpdb-local-goal-smoke.mjs
icp network stop -e local-icpdb
```

`icpdb-local-goal-smoke.mjs` runs `node scripts/icpdb-local-cli-smoke.mjs`,
`pnpm --dir icpdb-console build:sdk`, `node scripts/icpdb-local-sdk-smoke.mjs`,
`node scripts/icpdb-local-identity-quickstart-smoke.mjs`,
`node scripts/icpdb-local-service-env-owner-smoke.mjs`,
`node scripts/icpdb-local-controller-quickstart-smoke.mjs`,
`node scripts/icpdb-local-multicanister-smoke.mjs`,
`node scripts/icpdb-local-browser-smoke.mjs`, and
`node scripts/icpdb-local-ii-browser-smoke.mjs` by default. It tops up the local
`icpdb` canister and registered database shard canisters first; pass
`--skip-top-up` or set `ICPDB_SMOKE_SKIP_TOP_UP=1` to skip that step, and set
`ICPDB_SMOKE_TOP_UP_AMOUNT=10t` to change the amount. The broader identity CLI
coverage remains available as optional step `identity-cli-full`, which runs
`node scripts/icpdb-local-identity-cli-smoke.mjs`. Optional focused package
service-env steps include `service-query-only` for canister-only first SQL
create/persist and `service-owner-backup` for owner archive/restore checks.
The focused identity quickstart smoke passed on 2026-06-05 against local
canister `t63gs-up777-77776-aaaba-cai`, verifying package `.env` init/query/delete,
`provision-service-db --setup-file`, `provision-service-db --setup-migrations-file`,
and `service.env` SQL/SDK checks.
`service-query-only` passed on 2026-06-05 against local canister
`t63gs-up777-77776-aaaba-cai` and verified package `service.env` create,
execute, query, and check-env handoff. Use
`node scripts/icpdb-local-goal-smoke.mjs --top-up-only`
to run only the canister top-up preparation. Use `--list-steps` to print the
step ids, then `--only browser`, `--only ii-browser`, or a comma-separated list
such as `--only sdk-build,sdk` or `--only identity-cli-full` when rechecking one
heavy local proof without running the whole suite. Use `--only sdk-build,sdk-shortest`
when rechecking only the SDK shortest one-DB `CREATE TABLE` / `INSERT` /
`SELECT` / `scalar` / `connectionUrl()` handoff path. That focused SDK shortest
smoke passed on 2026-06-05 against local canister
`t63gs-up777-77776-aaaba-cai`. Use
`--only sdk-build,sdk-browser-shortest` for the same proof through the generated
`@icpdb/client/browser` package subpath; that focused browser-subpath smoke
passed on 2026-06-05 against local canister `t63gs-up777-77776-aaaba-cai`.
Use
`--only sdk-build,sdk-sqlite-shortest` for the explicit hosted SQLite subpath,
which passed on 2026-06-05 against local canister
`t63gs-up777-77776-aaaba-cai`, or
`--only sdk-build,sdk-libsql-shortest` for the libSQL-shaped `execute({ sql, args })`
variant of the same one-DB proof, which passed on 2026-06-05 against local
canister `t63gs-up777-77776-aaaba-cai`. Use `--only console-shortest` for the focused
console schema/table/SQL inspection proof without running the full browser archive,
token, and shard UI matrix; that step runs
`node scripts/icpdb-local-console-shortest-smoke.mjs` and passed on 2026-06-05
against local canister `t63gs-up777-77776-aaaba-cai` with DB
`db_uagr4lvqahe7`. Use
`--only postdeploy-sql-archive` before mainnet SQL/archive gates to replay the
postdeploy `create_database` / SQL / archive / restore / delete path against the
fresh local canister. On 2026-06-05, that focused smoke passed after
`icp network start -d -e local-icpdb` and `icp deploy -e local-icpdb -y`.
Use `--only browser` for the owner-token browser SQL/table/token/permission,
archive/restore, and remote shard UI proof; on 2026-06-05 it passed against
local canister `t63gs-up777-77776-aaaba-cai` with DB `db_foztxqlaq32v`,
table `browser_notes_1780597988063`, and shard
`tz2ag-zx777-77776-aaabq-cai`.

## Scope Limits

- Hosted demo billing is ICP-only; ckBTC, ckUSDC, and USD-denominated billing are future work on the hosted branch.
- Hosted demo deposit is prepaid top-up, not automatic recurring billing.
- The canister does not expose raw SQLite or Postgres wire protocols.
- Large responses still need pagination or chunking to fit IC response limits.
- Horizontal scaling uses controller-managed database-canister sharding; existing local DBs remain local until explicit migration.
