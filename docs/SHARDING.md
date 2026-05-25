# Database-Canister Sharding

This document describes ICPDB's controller-managed database-canister sharding.

## Goals

- Keep the local-shard product working.
- Add horizontal capacity by moving hosted SQLite databases into database canisters.
- Preserve the current SQL, table editor, archive, restore, token, role, usage, quota, and billing surface.
- Avoid implicit fallback paths and mixed ownership rules during migration.

## Current Shape

The control canister owns product metadata and can still execute local-shard databases:

- index DB: database metadata, members, tokens, quota, billing, payments, and usage events
- local user DB images: one `ic-sqlite-vfs` `MemoryId` per local SQLite database
- remote user DB images: one `ic-sqlite-vfs` `MemoryId` per SQLite database inside the assigned database canister
- shard placement catalog: `database_shard_placements` records `local` and `database:<canister-id>` placements, lifecycle status, and schema version for each database
- HTTP/Candid entrypoints: SQL, table inspection, archive/restore, token, member, usage, billing, and quota

Local placement is still useful for development and explicit migration. Remote placement is the
capacity path for normal sharded operation.

## Target Shape

Split ICPDB into one control canister and many database canisters.

```text
client / console / CLI
        |
        v
icpdb_control canister
  - database catalog
  - owner/member/token catalog
  - billing and quota policy
  - shard allocation
  - canister creation and upgrade orchestration
        |
        v
icpdb_database canister N
  - local index for assigned databases
  - DbHandle / MemoryId mapping
  - SQL and table inspection execution
  - archive / restore chunk execution
```

The control canister remains the public API. Database canisters are implementation details unless a direct low-latency data endpoint is explicitly added later.

## Routing Model

`database_id` remains the stable tenant key.

The control canister owns this catalog:

```text
database_id
owner_control_principal
database_canister_id
status
schema_version
created_at_ms
updated_at_ms
```

The controller keeps this routing catalog in `database_shard_placements`:

```text
database_id
shard_id: local | database:<canister-id>
canister_id: null | <database-canister-id>
mount_id: local mount id | null
status
schema_version
created_at_ms
updated_at_ms
```

Routing derives `database_id -> local mount` or `database_id -> database_canister_id` from this table instead of deriving placement only from `active_mount_id`.

For every routed operation:

1. Authenticate caller or bearer token in the control canister.
2. Check role, token scope, quota, and billing policy in the control canister.
3. Resolve `database_id -> database_canister_id` through a hot route resolver.
4. Call the database canister with a service token or signed internal request.
5. Record usage and billing outcome in the control canister.

The database canister must reject direct calls unless caller is the configured control canister.

The runtime now exposes hot route resolution for principal and bearer-token sessions. The resolver
returns the same `DatabaseShardPlacement` shape for local and remote DBs, rejects callers without
the required role, rejects tokens with insufficient scope, and rejects non-hot databases before a
control canister attempts a data-plane call.

HTTP bearer-token read endpoints now use this resolver before data-plane execution. Local
placements keep using the embedded service path. Remote placements call the database canister
internal read methods with bounded-wait inter-canister calls:

- `/v1/sql/query` -> `sql_query_internal`
- `/v1/tables/list` -> `list_tables_internal`
- `/v1/tables/describe` -> `describe_table_internal`
- `/v1/tables/preview` -> `preview_table_internal`

## API Boundary

Keep external request and response types in `icpdb_types`.

Control canister public methods:

- `create_database`
- `create_remote_database`
- `delete_database`
- `list_databases`
- `list_tables`
- `describe_table`
- `preview_table`
- `sql_query`
- `sql_execute`
- `sql_batch`
- `begin_database_archive`
- `read_database_archive_chunk`
- `finalize_database_archive`
- `cancel_database_archive`
- `begin_database_restore`
- `write_database_restore_chunk`
- `finalize_database_restore`
- token, member, usage, billing, quota methods

Database canister internal methods:

- `create_database_slot(database_id)`
- `delete_database_slot(database_id)`
- `list_tables_internal(database_id)`
- `describe_table_internal(database_id, table_name)`
- `preview_table_internal(request)`
- `sql_query_internal(request)`
- `sql_execute_internal(DataPlaneSqlExecuteRequest { operation_id, request })`
- `sql_batch_internal(DataPlaneSqlBatchRequest { operation_id, request })`
- `get_data_plane_operation_internal(database_id, operation_id)`
- `archive_*_internal`
- `restore_*_internal`
- `database_usage_internal(database_id)`

Internal methods must include `database_id` and must not infer tenant identity from caller.

## Payload Limits

Ingress and cross-subnet inter-canister payloads are limited to 2 MiB. Same-subnet calls can have different limits, but ICPDB must assume 2 MiB for portable shard placement.

Implications:

- Archive and restore stay chunked at 1 MiB or less.
- SQL result pages stay bounded by existing row and response-byte limits.
- Table preview remains paginated.
- `sql_batch` must keep statement count and parameter payload bounded.
- No single control-to-database call may carry a full database snapshot.

## Async Safety

Inter-canister calls split execution into pre-await and post-await commits. The control canister must treat routed updates as sagas.

Rules:

- Capture caller before `await`.
- Use bounded-wait calls for reads where a retry is safe.
- Use idempotent request IDs for mutating routed operations.
- Keep mutation state machine records in the control canister before calling a database canister.
- Expose operation status queries for operations that can return unknown outcome. Current routed write status is available through Candid `get_routed_operation`, HTTP `/v1/operations/get`, CLI `operation`, and shell `.operation`.
- Do not charge billing as final until the database canister reports success.

For mutating operations, the control canister should record:

```text
operation_id
database_id
database_canister_id
method
request_hash
status: pending | applied | failed | unknown
created_at_ms
updated_at_ms
```

Database canisters store applied data-plane `operation_id` values with the request hash. Duplicate
applied IDs are rejected before SQLite is mutated again, and the control canister can query
`get_data_plane_operation_internal` when it needs proof for a routed write whose response was lost.

Database canister SQL writes use data-plane runtime entrypoints that execute SQLite changes and
refresh local logical size without charging the shard's local billing ledger. The control canister
remains the billing authority and can read remote logical size through `database_usage_internal`
after routed writes.

HTTP bearer-token write endpoints now have the first routed write path:

- `/v1/sql/execute` routes remote placements to `sql_execute_internal`
- `/v1/sql/batch` routes remote placements to `sql_batch_internal`
- remote writes require an `Idempotency-Key` header
- the same idempotency key is passed to the database canister as the data-plane `operation_id`
- the control canister records `routed_operations` before the inter-canister call
- on success, the control canister reads `database_usage_internal`, charges billing, syncs
  logical size, and marks the operation `applied`
- on call failure, the control canister marks the operation `failed`; if the write succeeds but
  post-write usage cannot be read, it marks the operation `unknown`

Shard management and migration calls also use a control-side journal. `shard_operations` records
high-level `create_shard`, `allocate_remote_database`, `create_remote_database`, `top_up_shard`,
`maintain_shards`, and `migrate_database` operations before bounded-wait management or database
canister calls. Successful operations are marked `applied`; failed calls are marked `unknown` so
operators can inspect the operation instead of silently retrying a non-idempotent action. The
controller-only `list_shard_operations` endpoint exposes the latest journal entries.
`reconcile_shard_operation` lets a controller mark an `unknown` shard operation as `applied` or
`failed` after operator verification; it refuses pending/applied/failed rows and requires a failure
reason for `failed`. The console surfaces searchable database placement and shard journal panels beside
usage, backup, token, and quota controls, including controller reconcile actions for unknown journal
rows. The placement panel can also refresh controller-only global placement inventory through
`list_all_database_placements`, and the journal panel can filter operations by target, status, hash,
or timestamp before reconciliation.
The control canister exposes controller-only `list_all_database_placements` for global placement
inventory. The CLI maps Candid `placements` to that method, and also exposes controller-only
`shards`, `shard-status`, `shard-top-up`, `shard-maintain`, `shard-ops`, and `shard-reconcile`
commands for operators that use `icp canister call` identity instead of a browser Internet Identity
session.

Unknown routed writes use a separate recovery path. `reconcile_routed_operation` is controller-only:
it loads the control-side `routed_operations` row, checks matching database-canister
`get_data_plane_operation_internal` proof, reads `database_usage_internal`, charges the stored
`billing_units`, syncs logical size, and marks the operation `applied`. The CLI exposes this as
`operation-reconcile <database_id> <operation_id>`.

The control canister also exposes controller-only `create_remote_database`. It validates the
database canister id, calls `create_database_slot` on that canister, then registers the remote DB in
the control catalog with `mount_id = null` and `shard_id = database:<canister_id>`. This gives the
current control API one concrete path to attach a detached database canister without exposing the
database canister as a public user API.

The control canister can now create and register database canisters as allocation shards through
controller-only `create_database_shard`. It creates an empty canister, uploads the embedded database
canister Wasm in chunks, installs it with the current control canister id, and registers the shard.
Controller-only `register_database_shard` still exists for attaching an externally managed detached
database canister. Once at least one active shard has capacity, normal `create_database` generates a
database id, calls the selected shard's `create_database_slot`, then registers the remote placement
in the control catalog. If no registered shard has free capacity, wasm canisters create and install
a new database shard before allocating the database.

Controller-only `top_up_database_shard` deposits cycles from the control canister into a registered
database canister through the management canister's `deposit_cycles` endpoint. This keeps shard
funding under the same control plane as shard creation and allocation.

Controller-only `get_database_shard_status` calls the management canister's `canister_status`
endpoint for a registered database canister and returns its running state, cycles balance, memory
size, idle burn rate, and module hash alongside the control-plane shard metadata.

Controller-only `maintain_database_shards` is the production autoscale/threshold check entrypoint.
It inspects registered database canisters with `canister_status`, tops up shards below
`min_cycles_balance` when `top_up_cycles` is configured, and creates up to `max_new_shards` when
available database slots are below `min_available_slots`. The method returns inspected shard status,
performed actions, and final available slot count so an external scheduler can run the policy
without embedding policy state in user traffic.

Controller-only `migrate_database_to_shard` is the explicit local-to-remote migration path. It
marks the local hot DB as archiving, hashes the local archive in bounded chunks, creates and
restores the same `database_id` on the target database canister, then switches the control catalog
to `shard_id = database:<canister_id>` only after remote restore verification. On failure before
the final catalog switch, the control canister cancels the local archive and asks the database
canister to `discard_database_slot_internal` so no public fallback route is added.

HTTP bearer-token archive/restore endpoints now route remote placements to database canister
internal chunk methods:

- `/v1/archive/begin` -> `begin_database_archive_internal`
- `/v1/archive/read` -> `read_database_archive_chunk_internal`
- `/v1/archive/finalize` -> `finalize_database_archive_internal`
- `/v1/archive/cancel` -> `cancel_database_archive_internal`
- `/v1/restore/begin` -> `begin_database_restore_internal`
- `/v1/restore/write` -> `write_database_restore_chunk_internal`
- `/v1/restore/finalize` -> `finalize_database_restore_internal`

The control catalog updates its remote placement status after each successful remote lifecycle
transition, so routing rejects normal hot reads/writes while the database is archiving or restoring.

## Shard Allocation

Initial allocation can be simple:

- Create a database canister when no active shard has free `MemoryId` capacity.
- Assign new databases to the shard with the fewest assigned live databases.
- Do not move hot databases between shards in v1.

Later allocation can consider:

- subnet placement
- per-shard cycle balance
- logical size
- write rate
- backup/restore traffic

## Lifecycle

Create:

1. Control reserves `database_id` and creates a pending catalog row.
2. Control selects or creates a database canister.
3. Control calls `create_database_slot`.
4. Control commits catalog row as hot.

Delete:

1. Control verifies owner.
2. Control marks operation pending.
3. Control calls `delete_database_slot`.
4. Control marks database deleted and clears active shard assignment.

Archive:

1. Control verifies owner and marks archiving.
2. Control routes archive chunks to database canister.
3. Control finalizes hash and marks archived.

Restore:

1. Control verifies owner and selects target database canister.
2. Control begins restoring with expected hash and size.
3. Client uploads chunks through control.
4. Control finalizes restore and marks hot.

## Billing And Quota

Control canister remains billing authority.

Database canisters report:

- logical size
- bytes read/written for archive/restore
- SQL rows returned
- SQL mutation success

Control decides:

- whether a write is allowed
- how many units to charge
- whether a DB is suspended
- max logical size quota

This avoids divergent billing state across shards.

## Security

- Database canisters accept internal calls only from the configured control canister.
- Control canister is the only issuer and verifier of bearer tokens.
- Member roles live in control canister.
- Database canisters do not store user API tokens.
- All routed calls include `database_id`.
- Database canisters must verify the assigned database exists locally before executing.
- Chunk APIs must keep explicit size/hash checks.

## Implementation Phases

Phase 0: local shard baseline.

- Keep existing API stable.
- Keep docs and tests focused on `database_id` as tenant key.

Phase 1: routing catalog and data-plane trait.

- Public control-plane placement inspection exists through Candid `list_database_placements`, HTTP `/v1/placements/get`, CLI `placement`, and shell `.placement`.
- Controller Candid CLI `placements` calls `list_all_database_placements` and lists the full placement catalog without requiring a database bearer token.
- SQL/table/archive/restore execution is now behind the runtime `DatabaseExecutor` boundary.
- Single-canister implementation uses `LocalDatabaseExecutor`.
- Sharded implementation calls database canister.

Phase 2: database canister crate.

- `icpdb-database-canister` exists as the first database-canister crate.
- It reuses `icpdb_runtime` and `icpdb_types`.
- It exposes checked internal Candid in `crates/icpdb_database_canister/icpdb_database.did`.
- It enforces the configured `control_canister_id` for direct calls.
- Current internal surface: `create_database_slot`, `delete_database_slot`, `list_tables_internal`, `describe_table_internal`, `preview_table_internal`, `sql_query_internal`, `sql_execute_internal`, `sql_batch_internal`, `get_data_plane_operation_internal`, `begin_database_archive_internal`, `read_database_archive_chunk_internal`, `finalize_database_archive_internal`, `cancel_database_archive_internal`, `begin_database_restore_internal`, `write_database_restore_chunk_internal`, and `finalize_database_restore_internal`.

Phase 3: control routing.

- Add shard catalog.
- Control-side `routed_operations` log exists for idempotent mutating calls.
- Routed write status is inspectable through Candid `get_routed_operation`, HTTP `/v1/operations/get`, CLI `operation`, and shell `.operation`.
- Control-side `shard_operations` log exists for bounded-wait shard management and migration calls.
- Controller shard inventory, status, top-up, maintenance, journal, and routed-write recovery operations are available through CLI `shards`, `shard-status`, `shard-top-up`, `shard-maintain`, `shard-ops`, `shard-reconcile`, and `operation-reconcile`.
- Runtime exposes `begin_routed_operation`, `update_routed_operation_status`, and `routed_operation`.
- Database canister runtime stores `data_plane_operations` through `record_data_plane_operation`
  and exposes applied operation proof through `data_plane_operation`.
- Controller-only `reconcile_routed_operation` can recover `unknown` routed writes from matching
  database-canister data-plane proof.
- Remote DBs can be registered through controller-only `create_remote_database`.
- Database canisters can be registered as allocation shards through controller-only
  `register_database_shard`.
- Database canisters can be created, chunk-installed, and registered through controller-only
  `create_database_shard`.
- Registered database canisters can be topped up through controller-only `top_up_database_shard`.
- Registered database canister cycles and status can be inspected through controller-only
  `get_database_shard_status`.
- `maintain_database_shards` applies the controller-only threshold policy for cycles top-up and
  shard creation.
- Normal `create_database` selects the least-assigned active registered shard with capacity before
  auto-provisioning a new database shard from embedded Wasm.
- HTTP bearer-token read endpoints route remote placements to database canister internal methods.
- HTTP bearer-token write endpoints require `Idempotency-Key`, route through `routed_operations`,
  call remote SQL data-plane methods, sync remote logical size, and charge in the control canister.
- HTTP bearer-token archive/restore endpoints route remote placements to database canister chunk
  methods and keep control placement status synchronized.
- `scripts/icpdb-local-multicanister-smoke.mjs` provisions a detached local database canister and
  verifies remote batch/query/preview/describe/usage/billing/archive/restore through the control
  HTTP API.

Phase 4: database canister creation orchestration.

- Control creates and installs a new database canister when no registered shard has capacity.
- `create_database_shard` exposes the controller-only manual orchestration path.
- `create_database` auto-provisions a database shard from embedded Wasm when no registered shard has
  capacity.
- `maintain_database_shards` lets an external scheduler keep cycle balance and free slot thresholds
  ahead of user traffic.
- Existing single-canister DBs remain local until explicit migration.

Phase 5: explicit migration.

- `migrate_database_to_shard` archives an existing local DB.
- It restores the archive into the assigned database canister.
- It switches catalog assignment after remote restore verification.
- No automatic fallback to the old location.

## Non-Goals For First Sharded Version

- Transparent hot migration between shards.
- Cross-database SQL transactions.
- SQLite wire protocol.
- Automatic old-schema absorption.
- Reusing archived or deleted `MemoryId` slots without explicit versioned design.

## References

- Internet Computer canister resource limits: https://internetcomputer.org/docs/building-apps/canister-management/resource-limits
- Internet Computer async/inter-canister semantics: https://internetcomputer.org/docs/references/async-code
- Rust inter-canister calls: https://internetcomputer.org/docs/building-apps/developer-tools/cdks/rust/intercanister
