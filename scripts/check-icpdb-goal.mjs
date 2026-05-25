// Where: scripts/check-icpdb-goal.mjs
// What: Verify ICPDB keeps the Turso-like CLI/API and Supabase-like table UI goal wired.
// Why: The product goal spans Rust, HTTP CLI, docs, and console files, so drift needs one root gate.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path) {
  assert.equal(existsSync(path), true, `${path} missing`);
  return readFileSync(path, "utf8");
}

function expectText(source, values, label) {
  for (const value of values) {
    assert.match(source, new RegExp(value), `${label} missing ${value}`);
  }
}

function expectRegex(source, patterns, label) {
  for (const pattern of patterns) {
    assert.match(source, pattern, `${label} missing ${pattern}`);
  }
}

function expectNotText(source, values, label) {
  for (const value of values) {
    assert.equal(source.includes(value), false, `${label} unexpectedly contains ${value}`);
  }
}

function uniqueMatches(source, pattern) {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
}

function expectBackendSurface(goalAuditSource, candidSource, mapping) {
  for (const [goalName, methods] of Object.entries(mapping)) {
    assert.match(goalAuditSource, new RegExp(`Backend: ${goalName}`), `goal audit missing backend ${goalName}`);
    for (const method of methods) {
      assert.match(goalAuditSource, new RegExp(`\\b${method}\\b`), `goal audit missing Candid method ${method}`);
      assert.match(candidSource, new RegExp(`\\b${method}\\b`), `Candid surface missing ${method}`);
    }
  }
}

function expectUiSurface(goalAuditSource, uiSource, mapping) {
  for (const [goalName, components] of Object.entries(mapping)) {
    assert.equal(goalAuditSource.includes(`UI: ${goalName}`), true, `goal audit missing UI ${goalName}`);
    for (const component of components) {
      assert.equal(goalAuditSource.includes(component), true, `goal audit missing UI component ${component}`);
      assert.equal(uiSource.includes(component), true, `console UI source missing ${component}`);
    }
  }
}

function expectStorageSurface(goalAuditSource, runtimeSource) {
  const required = [
    "mount_id",
    "memory_id",
    "MemoryId::new(memory_id)",
    "DbHandle::init(manager.get(MemoryId::new(memory_id)))",
    "sqlite_facade::register_local_path"
  ];
  for (const value of required) {
    assert.equal(goalAuditSource.includes(value), true, `goal audit missing storage evidence ${value}`);
    assert.equal(runtimeSource.includes(value), true, `runtime source missing storage evidence ${value}`);
  }
}

function expectShellSurface(sourceMap, commands) {
  for (const command of commands) {
    for (const [label, source] of Object.entries(sourceMap)) {
      assert.equal(source.includes(command), true, `${label} missing shell command ${command}`);
    }
  }
}

function expectChunkTransferSurface(sourceMap, values) {
  for (const value of values) {
    for (const [label, source] of Object.entries(sourceMap)) {
      assert.equal(source.includes(value), true, `${label} missing chunk archive/restore evidence ${value}`);
    }
  }
}

function expectAccessAdminSurface(sourceMap, values) {
  for (const value of values) {
    for (const [label, source] of Object.entries(sourceMap)) {
      assert.equal(source.includes(value), true, `${label} missing token/role/usage/quota evidence ${value}`);
    }
  }
}

function expectShardingSurface(sourceMap, values) {
  for (const value of values) {
    for (const [label, source] of Object.entries(sourceMap)) {
      assert.equal(source.includes(value), true, `${label} missing sharding evidence ${value}`);
    }
  }
}

function expectRemoteWriteSurface(sourceMap, values) {
  for (const value of values) {
    for (const [label, source] of Object.entries(sourceMap)) {
      assert.equal(source.includes(value), true, `${label} missing remote write evidence ${value}`);
    }
  }
}

const readme = read("README.md");
const goalAudit = read("docs/GOAL_AUDIT.md");
const sharding = read("docs/SHARDING.md");
const storageManifests =
  read("Cargo.toml") +
  read("Cargo.lock") +
  read("crates/icpdb_canister/Cargo.toml") +
  read("crates/icpdb_runtime/Cargo.toml") +
  read("crates/icpdb_database_canister/Cargo.toml");
const buildScripts =
  read("scripts/build-icpdb-canister.sh") +
  read("scripts/build-icpdb-database-canister.sh");
const runtime =
  read("crates/icpdb_runtime/src/lib.rs") +
  read("crates/icpdb_runtime/src/database_executor.rs") +
  read("crates/icpdb_runtime/src/sql.rs") +
  read("crates/icpdb_runtime/src/sql_guard.rs") +
  read("crates/icpdb_runtime/src/sql_identifier.rs") +
  read("crates/icpdb_runtime/src/sql_snapshot.rs") +
  read("crates/icpdb_runtime/src/table_inspection.rs") +
  read("crates/icpdb_runtime/src/sqlite_facade.rs");
const runtimeTests = read("crates/icpdb_runtime/tests/database_service.rs");
const canisterHttp = read("crates/icpdb_canister/src/http.rs");
const canisterDid = read("crates/icpdb_canister/icpdb.did");
const canister =
  read("crates/icpdb_canister/src/lib.rs") +
  canisterHttp +
  canisterDid +
  read("icpdb-console/scripts/candid-shapes.mjs");
const canisterTests = read("crates/icpdb_canister/src/tests.rs");
const databaseCanister =
  read("crates/icpdb_database_canister/src/lib.rs") +
  read("crates/icpdb_database_canister/src/state.rs") +
  read("crates/icpdb_database_canister/icpdb_database.did") +
  read("scripts/build-icpdb-database-canister.sh");
const cli =
  read("scripts/icpdb-http.mjs") +
  read("scripts/icpdb-http-account-command.mjs") +
  read("scripts/icpdb-http-account-output.mjs") +
  read("scripts/icpdb-http-canister-command.mjs") +
  read("scripts/icpdb-http-canister.mjs") +
  read("scripts/icpdb-http-command-builder.mjs") +
  read("scripts/icpdb-http-command-utils.mjs") +
  read("scripts/icpdb-http-csv-output.mjs") +
  read("scripts/icpdb-http-data-command.mjs") +
  read("scripts/icpdb-http-dispatch.mjs") +
  read("scripts/icpdb-http-dump.mjs") +
  read("scripts/icpdb-http-inspect.mjs") +
  read("scripts/icpdb-http-output.mjs") +
  read("scripts/icpdb-http-schema-output.mjs") +
  read("scripts/icpdb-http-shell.mjs") +
  read("scripts/icpdb-http-table-format.mjs") +
  read("scripts/icpdb-http-transfer.mjs") +
  read("scripts/check-icpdb-http-cli.mjs");
const localNetworkSmoke = read("scripts/icpdb-local-network.mjs");
const localDepositSmoke = read("scripts/icpdb-local-deposit.mjs");
const localSmoke = localNetworkSmoke + localDepositSmoke + read("scripts/icpdb-local-cli-smoke.mjs");
const multiCanisterSmoke = localNetworkSmoke + read("scripts/icpdb-local-multicanister-smoke.mjs");
const browserSmoke = localNetworkSmoke + localDepositSmoke + read("scripts/icpdb-local-browser-smoke.mjs");
const iiBrowserSmoke = localNetworkSmoke + read("scripts/icpdb-local-ii-browser-smoke.mjs");
const mainnetPreflight = read("scripts/icpdb-mainnet-preflight.mjs");
const rowMutationCheck = read("icpdb-console/scripts/check-row-mutations.mjs");
const httpClient = read("icpdb-console/lib/icpdb-http-client.ts") + read("icpdb-console/lib/icpdb-http-admin-client.ts");
const httpClientCheck = read("icpdb-console/scripts/check-http-client.mjs") + read("icpdb-console/scripts/check-http-admin-client.mjs");
const tokenActions =
  read("icpdb-console/lib/use-icpdb-token-actions.ts") +
  read("icpdb-console/lib/use-icpdb-token-admin-actions.ts") +
  read("icpdb-console/lib/use-icpdb-token-backup-actions.ts");
const consoleUi =
  read("icpdb-console/lib/icpdb-client.ts") +
  read("icpdb-console/lib/icpdb-actor.ts") +
  read("icpdb-console/lib/icpdb-raw-types.ts") +
  read("icpdb-console/lib/icpdb-database-codec.ts") +
  read("icpdb-console/lib/icpdb-table-codec.ts") +
  read("icpdb-console/lib/icpdb-database-api.ts") +
  read("icpdb-console/lib/icpdb-account-api.ts") +
  read("icpdb-console/lib/icpdb-transfer-api.ts") +
  read("icpdb-console/lib/icpdb-table-api.ts") +
  read("icpdb-console/lib/workbench-state.ts") +
  read("icpdb-console/lib/icpdb-token-session.ts") +
  read("icpdb-console/lib/result-grid-helpers.ts") +
  read("icpdb-console/lib/table-data-helpers.ts") +
  read("icpdb-console/lib/use-icpdb-workbench-controller.ts") +
  read("icpdb-console/lib/use-icpdb-workbench-state.ts") +
  read("icpdb-console/lib/use-icpdb-operation-actions.ts") +
  read("icpdb-console/lib/use-icpdb-token-actions.ts") +
  read("icpdb-console/lib/use-icpdb-shard-actions.ts") +
  read("icpdb-console/components/icpdb-workbench.tsx") +
  read("icpdb-console/components/icpdb-data-grid.tsx") +
  read("icpdb-console/components/icpdb-database-list-panel.tsx") +
  read("icpdb-console/components/icpdb-navigation-panels.tsx") +
  read("icpdb-console/components/icpdb-operation-panel.tsx") +
  read("icpdb-console/components/icpdb-permission-panel.tsx") +
  read("icpdb-console/components/icpdb-token-session-panel.tsx") +
  read("icpdb-console/components/icpdb-token-panel.tsx") +
  read("icpdb-console/components/icpdb-result-grid.tsx") +
  read("icpdb-console/components/icpdb-shard-panels.tsx") +
  read("icpdb-console/components/icpdb-table-data-panel.tsx") +
  read("icpdb-console/components/icpdb-table-editor-panel.tsx") +
  read("icpdb-console/components/icpdb-table-list-panel.tsx") +
  read("icpdb-console/components/icpdb-table-overview-panel.tsx") +
  read("icpdb-console/components/icpdb-table-schema-panel.tsx") +
  read("icpdb-console/components/icpdb-row-editor-panel.tsx") +
  read("icpdb-console/components/icpdb-schema-viewers.tsx") +
  read("icpdb-console/components/icpdb-usage-events-panel.tsx") +
  read("icpdb-console/components/icpdb-sql-editor-panel.tsx") +
  read("icpdb-console/components/icpdb-response-admin-panels.tsx") +
  read("icpdb-console/components/icpdb-response-metrics-panel.tsx") +
  read("icpdb-console/components/icpdb-response-sidebar.tsx") +
  read("icpdb-console/components/icpdb-account-panels.tsx") +
  read("icpdb-console/components/icpdb-backup-billing-panels.tsx") +
  read("icpdb-console/components/icpdb-display-panels.tsx");

const backendSurface = {
  create_database: ["create_database"],
  delete_database: ["delete_database"],
  list_tables: ["list_tables"],
  describe_table: ["describe_table"],
  preview_table: ["preview_table"],
  execute_sql: ["sql_execute"],
  query_sql: ["sql_query"],
  batch_sql: ["sql_batch"],
  archive_database: ["begin_database_archive", "read_database_archive_chunk", "finalize_database_archive"],
  restore_database: ["begin_database_restore", "write_database_restore_chunk", "finalize_database_restore"],
  create_token: ["create_database_token"],
  check_usage: ["get_usage", "get_billing", "get_usage_event_summaries", "set_database_quota"]
};

const uiSurface = {
  "Database 一覧": ["DatabaseList"],
  "Table 一覧": ["TableList"],
  "spreadsheet 風 table viewer": ["DataGrid"],
  "column / index / foreign key viewer": ["TableSchemaPanel", "IndexViewer", "ForeignKeyViewer"],
  "SQL editor": ["SqlEditorPanel", "ResultTable", "BatchResultList"],
  "query result grid": ["ResultTable"],
  "backup / restore 画面": ["BackupRestorePanel"],
  "token / permission 画面": ["TokenPanel", "PermissionPanel"],
  "usage / storage 画面": ["UsageEventSummaryPanel", "StorageUsageMeter", "quotaUsagePercent"]
};

const shellSurface = [
  ".help",
  ".tables",
  ".views",
  ".stats",
  ".usage",
  ".billing",
  ".payments",
  ".placement",
  ".operation",
  ".usage-events",
  ".tokens",
  ".members",
  ".describe",
  ".columns",
  ".indexes",
  ".triggers",
  ".foreign-keys",
  ".schema",
  ".preview",
  ".inspect",
  ".inspect --access",
  ".dump",
  ".quit"
];

const archiveRestoreCandidSurface = [
  "begin_database_archive",
  "read_database_archive_chunk",
  "finalize_database_archive",
  "begin_database_restore",
  "write_database_restore_chunk",
  "finalize_database_restore"
];

const archiveRestoreHttpSurface = [
  "/v1/archive/begin",
  "/v1/archive/read",
  "/v1/archive/finalize",
  "/v1/archive/cancel",
  "/v1/restore/begin",
  "/v1/restore/write",
  "/v1/restore/finalize"
];

const accessAdminCandidSurface = [
  "create_database_token",
  "list_database_tokens",
  "revoke_database_token",
  "list_database_members",
  "grant_database_access",
  "revoke_database_access",
  "get_usage",
  "get_usage_event_summaries",
  "get_billing",
  "set_database_quota"
];

const accessAdminHttpSurface = [
  "/v1/tokens/create",
  "/v1/tokens/list",
  "/v1/tokens/revoke",
  "/v1/members/list",
  "/v1/members/grant",
  "/v1/members/revoke",
  "/v1/usage",
  "/v1/usage/events",
  "/v1/billing",
  "/v1/operations/get",
  "/v1/quota/set",
  "/v1/payments/list"
];

const accessAdminCliSurface = [
  "create-token",
  "tokens",
  "revoke-token",
  "members",
  "grant-member",
  "revoke-member",
  "usage",
  "usage-events",
  "billing",
  "quota",
  "payments",
  "inspect --access"
];

const accessAdminTokenActionSurface = [
  "createTokenWithToken",
  "listTokensWithToken",
  "revokeTokenWithToken",
  "listMembersWithToken",
  "grantMemberWithToken",
  "revokeMemberWithToken",
  "setQuotaWithToken",
  "listPaymentsWithToken"
];

const shardingControlSurface = [
  "list_database_placements",
  "list_all_database_placements",
  "list_database_shards",
  "create_database_shard",
  "create_remote_database",
  "register_database_shard",
  "top_up_database_shard",
  "get_database_shard_status",
  "maintain_database_shards",
  "migrate_database_to_shard",
  "reconcile_routed_operation",
  "list_shard_operations",
  "reconcile_shard_operation"
];

const shardingDatabaseCanisterSurface = [
  "create_database_slot",
  "delete_database_slot",
  "discard_database_slot_internal",
  "list_tables_internal",
  "describe_table_internal",
  "preview_table_internal",
  "database_usage_internal",
  "get_data_plane_operation_internal",
  "DataPlaneSqlExecuteRequest",
  "DataPlaneSqlBatchRequest",
  "sql_query_internal",
  "sql_execute_internal",
  "sql_batch_internal",
  "begin_database_archive_internal",
  "read_database_archive_chunk_internal",
  "finalize_database_archive_internal",
  "begin_database_restore_internal",
  "write_database_restore_chunk_internal",
  "finalize_database_restore_internal"
];

const shardingCliSurface = [
  "placement",
  "placements",
  "shards",
  "shard-status",
  "shard-top-up",
  "shard-maintain",
  "shard-ops",
  "shard-reconcile",
  "operation-reconcile"
];

const shardingUiSurface = [
  "ShardPlacementPanel",
  "ShardOperationJournalPanel",
  "useIcpdbShardActions",
  "list_all_database_placements",
  "list_shard_operations",
  "reconcile_shard_operation",
  "Search shard placements",
  "Search shard operations"
];

const shardingSmokeSurface = [
  "create_database_shard",
  "top_up_database_shard",
  "get_database_shard_status",
  "maintain_database_shards",
  "placements",
  "shards",
  "shard-status",
  "shard-maintain",
  "list_shard_operations",
  "shard-ops",
  "shard-reconcile",
  "create_database_slot",
  "list_tables_internal",
  "archive",
  "restore",
  "delete-db"
];

const remoteWriteCanisterSurface = [
  "idempotency_key(headers)",
  "missing idempotency-key header",
  "remote_sql_write_with_token",
  "get_routed_operation",
  "reconcile_routed_operation",
  "/v1/operations/get",
  "begin_routed_write_with_token",
  "complete_routed_write_with_token",
  "reconcile_routed_write_from_data_plane",
  "database_usage_internal",
  "DataPlaneSqlExecuteRequest",
  "DataPlaneSqlBatchRequest",
  "update_routed_operation_status",
  "RoutedOperationStatus::Unknown",
  "RoutedOperationStatus::Failed",
  "routed operation already applied",
  "routed operation outcome is unknown"
];

const remoteWriteRuntimeSurface = [
  "routed_operations",
  "routed_operation_for_caller",
  "routed_operation_with_token",
  "begin_routed_operation",
  "begin_routed_write_with_token",
  "complete_routed_write_with_token",
  "update_routed_operation_status",
  "data_plane_operations",
  "record_data_plane_operation",
  "data_plane_operation",
  "load_routed_operation_billing_units",
  "validate_routed_operation_replay",
  "validate_data_plane_operation_replay",
  "routed operation request mismatch",
  "same routed operation should replay"
];

const remoteWriteClientSurface = [
  "sqlExecuteWithToken",
  "sqlBatchWithToken",
  "IcpdbWriteOptions",
  "onIdempotencyKey",
  "capturedIdempotencyKeys",
  "getRoutedOperationWithToken",
  "idempotency-key",
  "nextIdempotencyKey",
  "crypto.randomUUID",
  "icpdb-web-sql_execute-db_alpha-uuid-1",
  "icpdb-web-sql_batch-db_alpha-uuid-2"
];

const remoteWriteCliSurface = [
  "help [command]",
  "commandUsage",
  ".help <command>",
  ".help sql",
  "operation",
  ".operation <operation_id>",
  "/v1/operations/get",
  "--idempotency-key",
  "headers[\"idempotency-key\"]",
  "idempotencyKeyPrefix",
  "randomUUID",
  "shellWriteCalls"
];

const remoteWriteUiSurface = [
  "RoutedOperationPanel",
  "Operation status",
  "Lookup routed operation",
  "Last write operation",
  "useIcpdbOperationActions",
  "recordIdempotencyKey",
  "loadRoutedOperation",
  "getRoutedOperationWithToken",
  "canLoadRoutedOperation"
];

const remoteWriteCanisterTestSurface = [
  "access-control-allow-headers",
  "idempotency-key",
  "idempotency_key(&idempotency_headers)"
];

expectBackendSurface(goalAudit, canisterDid, backendSurface);
expectUiSurface(goalAudit, consoleUi, uiSurface);
expectStorageSurface(goalAudit, runtime);
expectShellSurface({ README: readme, "goal audit": goalAudit, "shell source": cli }, shellSurface);
expectChunkTransferSurface({ "goal audit": goalAudit, Candid: canisterDid }, archiveRestoreCandidSurface);
expectChunkTransferSurface({ README: readme, "goal audit": goalAudit, "HTTP route source": canisterHttp, "CLI transfer source": cli }, archiveRestoreHttpSurface);
expectChunkTransferSurface({ "token backup actions": tokenActions }, [
  "archiveDatabaseToSnapshotWithToken",
  "restoreArchiveSnapshotWithToken",
  "cancelArchiveWithToken"
]);
expectAccessAdminSurface({ "goal audit": goalAudit, Candid: canisterDid }, accessAdminCandidSurface);
expectAccessAdminSurface({ README: readme, "goal audit": goalAudit, "HTTP route source": canisterHttp, "HTTP admin client": httpClient }, accessAdminHttpSurface);
expectAccessAdminSurface({ README: readme, "goal audit": goalAudit, "CLI source": cli }, accessAdminCliSurface);
expectAccessAdminSurface({ "goal audit": goalAudit, "token admin actions": tokenActions, "HTTP admin client": httpClient }, accessAdminTokenActionSurface);
expectShardingSurface({ "goal audit": goalAudit, Candid: canisterDid, "control canister source": canister }, shardingControlSurface);
expectShardingSurface({ "goal audit": goalAudit, "database canister source": databaseCanister }, shardingDatabaseCanisterSurface);
expectShardingSurface({ README: readme, "goal audit": goalAudit, "CLI source": cli }, shardingCliSurface);
expectShardingSurface({ "goal audit": goalAudit, "console UI source": consoleUi }, shardingUiSurface);
expectShardingSurface({ "goal audit": goalAudit, "multi-canister smoke": multiCanisterSmoke }, shardingSmokeSurface);
expectRemoteWriteSurface({ "goal audit": goalAudit, "control canister source": canister }, remoteWriteCanisterSurface);
expectRemoteWriteSurface({ "goal audit": goalAudit, "runtime source/tests": runtime + runtimeTests }, remoteWriteRuntimeSurface);
expectRemoteWriteSurface({ "goal audit": goalAudit, "browser client/check": httpClient + httpClientCheck }, remoteWriteClientSurface);
expectRemoteWriteSurface({ "goal audit": goalAudit, "CLI source/check": cli }, remoteWriteCliSurface);
expectRemoteWriteSurface({ "goal audit": goalAudit, "console UI source": consoleUi }, remoteWriteUiSurface);
expectRemoteWriteSurface({ "goal audit": goalAudit, "canister tests": canisterTests }, remoteWriteCanisterTestSurface);

expectText(readme, [
  "ic-sqlite-vfs",
  "MemoryId",
  "multiple isolated SQLite databases",
  "control canister hosting multiple isolated SQLite databases locally",
  "crates/icpdb_database_canister",
  "Supabase-style",
  "SQL query / update runner",
  "searchable and sortable row-numbered result grid",
  "POST /v1/session",
  "POST /v1/placements/get",
  "placement <database-id>",
  "whether the database is local or routed to a database canister",
  "chunked archive / restore",
  "snapshot download/load",
  "SQL dump download / load",
  "index column metadata",
  "controller-managed database-canister sharding",
  "Remote database-canister writes require an idempotency key",
  "CLI `shell` write SQL also generates one automatically",
  "usage is the backend check_usage surface",
  "Candid get_usage and HTTP /v1/usage",
  "--idempotency-key",
  "execute <database-id>",
  "notes-create-001",
  "Live local goal smokes",
  "node scripts/icpdb-local-multicanister-smoke.mjs",
  "node scripts/icpdb-local-browser-smoke.mjs",
  "node scripts/icpdb-local-ii-browser-smoke.mjs"
], "README goal");

assert.deepEqual(
  uniqueMatches(readme, /`POST (\/v1\/[^`]+)`/g),
  uniqueMatches(canisterHttp, /"(\/v1\/[^"]+)"/g),
  "README HTTP endpoint list must match canister HTTP routes"
);

expectNotText(readme, [
  "future database-canister sharding plan",
  "future database-canister control plane",
  "v1 remains single-canister",
  "dfx"
], "stale README sharding language");

expectText(storageManifests, [
  "ic-sqlite-vfs",
  "sqlite-precompiled",
  "sqlite-bundled",
  "default-features = false"
], "storage dependency goal");

expectNotText(storageManifests, [
  "stable-fs",
  "ic-wasi-polyfill",
  "wasi2ic"
], "retired storage dependencies");

expectText(buildScripts, [
  "scripts/build-icpdb-canister.sh",
  "scripts/build-icpdb-database-canister.sh",
  "wasm32-unknown-unknown",
  "ic-wasm",
  "metadata candid:service"
], "wasm build path");

assert.equal(existsSync("scripts/wasi-env.sh"), false, "retired scripts/wasi-env.sh must stay deleted");

expectText(goalAudit, [
  "Current Evidence",
  "Requirement Checklist",
  "Live Proof Coverage",
  "Database-canister sharding",
  "IC canister 上に複数 SQLite DB を作成",
  "DB ごとに MemoryId を割当",
  "DbHandle 経由で永続化",
  "SQL query / execute / batch",
  "table / schema / index / foreign key を閲覧",
  "Supabase 風 Table Editor で行を閲覧・編集",
  "SQL Editor で任意 SQL を実行",
  "archive / restore を chunk API で実行",
  "API token / role / usage / quota を管理",
  "database canister を shard して水平拡張",
  "Backend: create_database",
  "Backend: delete_database",
  "Backend: list_tables",
  "Backend: describe_table",
  "Backend: preview_table",
  "Backend: execute_sql",
  "Backend: query_sql",
  "Backend: batch_sql",
  "Backend: archive_database",
  "Backend: restore_database",
  "Backend: create_token",
  "Backend: check_usage",
  "Goal-level `check_usage` is implemented as Candid `get_usage`",
  "HTTP `POST /v1/usage`",
  "CLI `usage <database-id>`",
  "shell `.usage`",
  "browser token `getUsageWithToken`",
  "local and remote shards",
  "\\.inspect \\[table\\] \\[limit\\] \\[offset\\]",
  "CLI `databases`",
  "`views`",
  "`stats`",
  "\\.stats",
  "stats --format csv",
  "full token list",
  "inspect --access",
  "limit/offset/range/next offset page metadata",
  "--format csv",
  "shell --format csv",
  "shell write SQL auto-generates an `idempotency-key`",
  "RoutedOperationPanel",
  "Lookup routed operation",
  "create-token --format table",
  "tokens --format table",
  "payments --format table",
  "members --format table",
  "flattened token secrets",
  "read/write/owner scope filters",
  "reader/writer/owner role filters",
  "last-used metadata",
  "clipboard copy controls",
  "storage used as a progress meter",
  "object type",
  "column count",
  "index column metadata",
  "foreign key group/seq/match metadata",
  "sticky row-number gutter",
  "current-page table row search",
  "full-value cell hover titles",
  "column search",
  "searchable Database list",
  "selected/available database badges",
  "lifecycle filters",
  "selected/available table badges",
  "database lifecycle label",
  "row and column counts",
  "per-statement row and column counts",
  "response sidebar SQL/batch shape metrics",
  "batch affected total",
  "Authenticated browser workflow",
  "owner-token DB deletion",
  "database_shard_placements",
  "multi-canister control/data plane",
  "check-row-mutations.mjs",
  "check-http-client.mjs",
  "TokenSessionPanel",
  "list_all_database_placements",
  "listPaymentsWithToken",
  "shard inventory/status/maintenance",
  "useIcpdbTokenActions",
  "useIcpdbTokenAdminActions",
  "useIcpdbTokenBackupActions",
  "icpdb-local-browser-smoke.mjs",
  "icpdb-local-multicanister-smoke.mjs",
  "icpdb-local-ii-browser-smoke.mjs",
  "node scripts/icpdb-local-cli-smoke.mjs",
  "node scripts/icpdb-mainnet-preflight.mjs",
  "playwright-cli console error"
], "goal audit");

expectNotText(goalAudit, [
  "Remaining Proof Gaps"
], "goal audit stale proof section");

expectText(sharding, [
  "Database-Canister Sharding",
  "controller-managed database-canister sharding",
  "local-shard product",
  "control canister",
  "database canisters",
  "database_id",
  "DbHandle / MemoryId mapping",
  "database_shard_placements",
  "list_all_database_placements",
  "list_database_placements",
  "SQL and table inspection execution",
  "create_database_slot",
  "Archive and restore stay chunked",
  "billing authority"
], "sharding goal");

expectNotText(sharding, [
  "current single-canister ICPDB MVP",
  "current single-canister MVP already keeps",
  "When the database canister split starts",
  "dfx"
], "stale sharding plan language");

expectNotText(consoleUi, ["dfx"], "legacy console CLI hints");

expectText(consoleUi, [
  "Search table rows",
  "TableObjectTypeFilter",
  "tableObjectTypeFilters",
  "countTableObjectTypes",
  "Views",
  "Download table CSV",
  "downloadSqlRowsCsv",
  "tableCsvFileName",
  "sanitizeCsvFilePart",
  "current-page column sort",
  "Refresh table rows",
  "Previous table page",
  "Next table page",
  "No matching table rows",
  "filterPreviewRows",
  "sortPreviewRows",
  "nextColumnSort",
  "rowMatchesPreviewSearch",
  "visibleRowEntries",
  "columns\\[index\\]",
  "formatSqlValue\\(value\\)",
  "rowNumbers",
  "rowEditorStatus",
  "Views are read-only",
  "Row editing enabled",
  "disabled={!canEditRows}",
  "disabled:cursor-not-allowed"
], "console table row search goal");

expectText(runtime, [
  "ic_sqlite_vfs",
  "DbHandle",
  "MemoryId",
  "INDEX_SCHEMA_VERSION_SHARD_PLACEMENTS",
  "record_shard_placement",
  "database_shard_placements",
  "list_all_database_shard_placements",
  "list_database_shard_placements_for_caller",
  "hot_database_route",
  "hot_database_route_with_token",
  "sql_execute_data_plane",
  "sql_batch_data_plane",
  "routed_operations",
  "shard_operations",
  "begin_routed_operation",
  "update_routed_operation_status",
  "begin_shard_operation",
  "update_shard_operation_status",
  "reconcile_shard_operation",
  "RoutedOperationStatus",
  "begin_local_database_migration",
  "complete_local_database_migration",
  "DatabaseExecutor",
  "LocalDatabaseExecutor",
  "create_database",
  "delete_database",
  "list_tables",
  "describe_table",
  "preview_table",
  "DatabaseIndexColumn",
  "PRAGMA index_xinfo",
  "sql_query",
  "sql_execute",
  "sql_batch",
  "archive",
  "restore",
  "quota",
  "usage",
  "billing"
], "runtime goal");

expectText(canister, [
  "create_database",
  "delete_database",
  "list_databases",
  "list_database_placements",
  "call_database_canister_with_arg",
  "hot_route_for_token",
  "remote_sql_write_with_token",
  "migrate_database_to_shard",
  "migrate_local_archive_to_database_canister",
  "route_http_query_request",
  "HttpUpdateRoute",
  "parse_update_route",
  "handle_http_sql_json",
  "handle_http_table_json",
  "handle_http_transfer_json",
  "handle_http_account_json",
  "idempotency_key",
  "list_tables",
  "describe_table",
  "preview_table",
  "sql_query",
  "sql_execute",
  "sql_batch",
  "begin_database_archive",
  "read_database_archive_chunk",
  "finalize_database_archive",
  "begin_database_restore",
  "write_database_restore_chunk",
  "finalize_database_restore",
  "create_database_token",
  "reconcile_routed_operation",
  "reconcile_shard_operation",
  "/v1/session",
  "/v1/usage",
  "/v1/usage/events",
  "/v1/billing",
  "/v1/quota/set",
  "get_usage",
  "get_usage_event_summaries",
  "get_billing",
  "set_database_quota",
  "grant_database_access",
  "revoke_database_access"
], "canister surface");

expectText(databaseCanister, [
  "icpdb-database-canister",
  "DatabaseCanisterInitArgs",
  "control_canister_id",
  "create_database_slot",
  "delete_database_slot",
  "discard_database_slot_internal",
  "list_tables_internal",
  "describe_table_internal",
  "preview_table_internal",
  "database_usage_internal",
  "get_data_plane_operation_internal",
  "DataPlaneSqlExecuteRequest",
  "DataPlaneSqlBatchRequest",
  "sql_query_internal",
  "sql_execute_internal",
  "sql_batch_internal",
  "begin_database_archive_internal",
  "read_database_archive_chunk_internal",
  "finalize_database_archive_internal",
  "cancel_database_archive_internal",
  "begin_database_restore_internal",
  "write_database_restore_chunk_internal",
  "finalize_database_restore_internal",
  "caller is not the configured control canister",
  "icpdb_database.did"
], "database canister surface");

expectRegex(cli, [
  /create-db/,
  /databases/,
  /tables/,
  /views/,
  /databaseViewsIcpdb/,
  /stats/,
  /statsIcpdb/,
  /formatStatsCsv/,
  /help \[command\]/,
  /commandUsage/,
  /Control-plane commands/,
  /Database inspection commands/,
  /describe/,
  /preview/,
  /formatTablePreviewPage/,
  /formatTablePreviewNextOffset/,
  /columns/,
  /indexes/,
  /indexColumnsLabel/,
  /triggers/,
  /tableTriggersIcpdb/,
  /foreign-keys/,
  /inspect/,
  /schema/,
  /object_type/,
  /view/,
  /dump/,
  /load/,
  /placements/,
  /shards/,
  /shard-status/,
  /shard-top-up/,
  /shard-maintain/,
  /shell/,
  /commandUsage\("shell"\)/,
  /commandUsage\("inspect"\)/,
  /\.views/,
  /\.help <command>/,
  /\.help sql/,
  /Shell write SQL auto-generates an idempotency key/,
  /Database inspection commands/,
  /Account and lifecycle commands/,
  /\.stats/,
  /\.columns <table_name>/,
  /\.indexes <table_name>/,
  /\.triggers <table_name>/,
  /\.foreign-keys <table_name>/,
  /\.inspect \[table_name\] \[limit\] \[offset\]/,
  /shard-ops/,
  /shard-reconcile/,
  /usage-events/,
  /placement/,
  /payments/,
  /quota/,
  /create-token/,
  /formatCreatedDatabase/,
  /formatCreatedToken/,
  /formatCsvOutput/,
  /escapeCsvField/,
  /format must be json, table, or csv/,
  /owner_token_id/,
  /archive/,
  /restore/,
  /members/,
  /grant-member/,
  /revoke-member/
], "HTTP CLI surface");

expectRegex(localSmoke, [
  /create-db/,
  /runDatabasesCommand/,
  /shell/,
  /"help",\s*"shell"/,
  /"help",\s*"inspect"/,
  /views/,
  /cli_note_bodies/,
  /columns/,
  /indexes/,
  /triggers/,
  /foreign-keys/,
  /\.columns cli_notes/,
  /\.views/,
  /\.indexes cli_notes/,
  /\.triggers cli_notes/,
  /\.foreign-keys cli_notes/,
  /\.inspect cli_notes 5 0/,
  /showing 1-1; limit 5; offset 0; next -/,
  /column_names/,
  /archive/,
  /restore/,
  /usage-events/,
  /placement/,
  /payments/,
  /recordLocalIcpdbPayment/,
  /payment_id/,
  /1000000/,
  /quota/,
  /create-token/
], "local smoke coverage");

expectText(multiCanisterSmoke, [
  "create_database_shard",
  "top_up_database_shard",
  "get_database_shard_status",
  "maintain_database_shards",
  "placements",
  "shards",
  "shard-status",
  "shard-maintain",
  "list_shard_operations",
  "shard-ops",
  "shard-reconcile",
  "available_slots",
  "cycles_balance",
  "install",
  "create_database",
  "create_database_token",
  "create_database_slot",
  "list_tables_internal",
  "caller is not the configured control canister",
  "--idempotency-key",
  "operation",
  "operation-reconcile",
  "routed operation is not unknown",
  "from-remote-shard",
  "remote_notes",
  "archive",
  "restore",
  "snapshot_hash",
  "delete-db",
  "deleted"
], "multi-canister smoke coverage");

expectText(browserSmoke, [
  "playwright-cli",
  "icpdb-local-network.mjs",
  "localNetworkConfig",
  "gatewayPortFromStatus",
  "controllerCliArgs",
  "canisterNetwork",
  "assertRemotePlacement",
  "databaseCanisterId",
  "routed to",
  "api token",
  "Connect",
  "grantPermissions",
  "clickCopyButton",
  "assertSearchNoMatch",
  "recordLocalIcpdbPayment",
  "icrc2_approve",
  "deposit_with_approval",
  "expected_fee_e8s",
  "verifyLastWriteOperation",
  "Last write operation",
  "Lookup routed operation",
  "Operation applied",
  "icpdb-web-",
  "Databases",
  "current",
  "selected",
  "Current",
  "Tables",
  "No tables",
  "Set quota",
  "browser-write",
  "Copy Canister",
  "Copy Principal",
  "Copy Database",
  "Copy issued token",
  "Search tokens",
  "No matching tokens",
  "title=\"Copied\"",
  "Write",
  "Revoke",
  "Grant",
  "Reader",
  "Search members",
  "No matching members",
  "Revoke access",
  "Create table",
  "Search tables",
  "No matching tables",
  "browser_view_filter",
  "Views are read-only",
  "browser_parents",
  "REFERENCES browser_parents",
  "_body_idx",
  "_guard",
  "Columns",
  "Search columns",
  "No matching columns",
  "Table overview",
  "Row editing enabled",
  "Selected row",
  "parent_id",
  "primary",
  "regular",
  "CASCADE",
  "RESTRICT",
  "Search indexes",
  "No matching indexes",
  "Search triggers",
  "No matching triggers",
  "Search foreign keys",
  "No matching foreign keys",
  "Rows 1-25 of 26",
  "Refresh table rows",
  "Next table page",
  "Previous table page",
  "Rows 26-26 of 26",
  "page-row-26",
  "Sort body ascending",
  "Sort body descending",
  "from-row-editor",
  "from-cell-editor",
  "from-row-update",
  "delete-me",
  "Save cell",
  "deleted_total",
  "Batch",
  "Run batch",
  "Batch results",
  "from-batch-editor",
  "Load SQL dump",
  "Loaded 2 statements",
  "Download SQL dump",
  "dump_body",
  "from-sql-dump-load",
  "1 payments",
  "0.01 ICP",
  "1000 units",
  "Search payments",
  "No matching payments",
  "Usage events",
  "Search usage events",
  "No matching usage events",
  "sql_batch",
  "CREATE\\+INSERT\\+SELECT",
  "Balance units",
  "Spent units",
  "Max rows",
  "Run statement",
  "SQL result",
  "No matching result rows",
  "Sort body ascending",
  "Sort body descending",
  "Download schema SQL",
  "Download table CSV",
  "Download result CSV",
  "Archive current DB",
  "Snapshot DB",
  "Restore snapshot",
  "restored_total",
  "Delete database",
  "No databases",
  "delete-db"
], "browser token smoke coverage");

expectText(iiBrowserSmoke, [
  "playwright-cli",
  "Login",
  "Continue with passkey",
  "Create new identity",
  "settings",
  "update",
  "--add-controller",
  "Create database",
  "Databases",
  "Tables",
  "No tables",
  "Shard placement",
  "Search shard placements",
  "All placements:",
  "top_up_database_shard",
  "Shard journal",
  "Search shard operations",
  "Mark applied",
  "Mark failed",
  "Reconciled",
  "browser-applied-",
  "Create table",
  "from-ii-login",
  "ii_body",
  "Delete database"
], "browser II smoke coverage");

expectText(mainnetPreflight, [
  "icpdb-mainnet-preflight.mjs",
  "Non-destructive mainnet readiness check",
  "icp.yaml",
  ".icp/data/mappings/ic.ids.json",
  "scripts/build-icpdb-database-canister.sh",
  "scripts/build-icpdb-canister.sh",
  "ICP_WASM_OUTPUT_PATH",
  "icp deploy -e ic -y icpdb",
  "icp0.io",
  "--skip-build"
], "mainnet preflight coverage");

expectText(consoleUi, [
  "DatabaseNavigator",
  "DatabaseList",
  "WorkbenchToolbar",
  "Search databases",
  "No matching databases",
  "filterDatabases",
  "DatabaseLifecycleFilter",
  "databaseLifecycleFilters",
  "countDatabaseLifecycles",
  "databaseLifecycleFilterValue",
  "databaseLifecycleLabel",
  "formatDatabaseLifecycleTimestamp",
  "archivedAtMs",
  "deletedAtMs",
  "Search tables",
  "No matching tables",
  "filterTables",
  "tableSelectionLabel",
  "selectedTableBadgeClass",
  "TableEditorPanel",
  "TokenSessionPanel",
  "TableDataPanel",
  "Download table CSV",
  "downloadSqlRowsCsv",
  "tableCsvFileName",
  "sanitizeCsvFilePart",
  "sortPreviewRows",
  "nextColumnSort",
  "compareSqlValues",
  "TableOverviewPanel",
  "rowEditorStatus",
  "Views are read-only",
  "Row editing enabled",
  "TableSchemaPanel",
  "Search columns",
  "filterColumns",
  "Download schema SQL",
  "buildTableSchemaSql",
  "tableSchemaFileName",
  "sanitizeSchemaFilePart",
  "DataGrid",
  "GridColumnSort",
  "onToggleColumnSort",
  "columnSortLabel",
  "cellDisplayValue",
  "title={cellDisplayValue}",
  "export function formatSqlValue",
  "columnDetails",
  "columnHeaderMeta",
  "rowNumberOffset",
  "sticky left-0 z-20",
  "sticky left-0 z-10",
  "(no rows)",
  "editableColumnNames",
  "onCommitEdit",
  "autoFocus",
  "event.key === \"Enter\"",
  "Selected cell",
  "Selected value",
  "Selected type",
  "Selected kind",
  "formatSelectedCellValue",
  "IndexViewer",
  "Search indexes",
  "No matching indexes",
  "filterIndexes",
  "indexColumnsLabel",
  "expressionIndexColumnLabel",
  "TriggerViewer",
  "Search triggers",
  "No matching triggers",
  "filterTriggers",
  "ForeignKeyViewer",
  "Search foreign keys",
  "No matching foreign keys",
  "filterForeignKeys",
  "key.matchClause",
  "key.seq",
  "RowEditorPanel",
  "Column inputs",
  "Fix row JSON",
  "SqlEditorPanel",
  "Max rows",
  "event.metaKey",
  "event.ctrlKey",
  "parseSqlMaxRows",
  "SqlResultSummary",
  "Search result rows",
  "Download result CSV",
  "downloadResultCsv",
  "downloadTextFile",
  "buildResultCsv",
  "escapeCsvField",
  "No matching result rows",
  "filterResultRows",
  "sortResultRows",
  "nextColumnSort",
  "compareSqlValues",
  "rowMatchesResultSearch",
  "ResultRowEntry",
  "visibleRowEntries",
  "visibleRowNumbers",
  "rowNumbers={visibleRowNumbers}",
  "label=\"Columns\"",
  "response.columns.length",
  "ResultTable",
  "BatchResultList",
  "Batch result grids",
  "Search batch rows",
  "icpdb-batch-statement-",
  "Batch row sets",
  "batchRowSetCount",
  "No batch rows",
  "No matching batch rows",
  "nextResponse.columns.length",
  "ResponseSidebar",
  "response?.columns.length",
  "Batch rows",
  "batchRowCount",
  "Batch affected",
  "batchAffectedCount",
  "BigInt\\(nextResponse\\.rowsAffected\\)",
  "tokenBackupActions.downloadSqlDump",
  "tokenBackupActions.loadSqlDumpFile",
  "ShardPlacementPanel",
  "listAllDatabasePlacementsAuthenticated",
  "shardPlacementStatus",
  "onRefreshAll",
  "Search shard placements",
  "filterShardPlacements",
  "No matching shard placements",
  "visiblePlacements.map",
  "ShardOperationJournalPanel",
  "Search shard operations",
  "filterShardOperations",
  "No matching shard operations",
  "visibleOperations.map",
  "Mark applied",
  "Mark failed",
  "UsageEventSummaryPanel",
  "Search usage events",
  "filterUsageEvents",
  "No matching usage events",
  "visibleEvents.map",
  "lastCreatedAtMs",
  "StorageQuotaPanel",
  "ResponseAccessPanel",
  "ResponseLifecyclePanel",
  "StorageUsageMeter",
  "quotaUsagePercent",
  "Copy \\$\\{label\\}",
  "copyValue",
  "Copy issued token",
  "navigator.clipboard.writeText",
  "TokenPanel",
  "last used",
  "formatTimestamp",
  "Search tokens",
  "TokenScopeFilter",
  "tokenScopeFilters",
  "countTokenScopes",
  "filterTokens",
  "No matching tokens",
  "visibleTokens.map",
  "PermissionPanel",
  "Search members",
  "MemberRoleFilter",
  "memberRoleFilters",
  "countMemberRoles",
  "filterMembers",
  "No matching members",
  "visibleMembers.map",
  "granted",
  "BackupRestorePanel",
  "DB status",
  "Snapshot DB",
  "DepositPanel",
  "Search payments",
  "filterPayments",
  "No matching payments",
  "visiblePayments.map",
  "payerPrincipal"
], "console UI goal");

expectText(rowMutationCheck, [
  "buildSelectedCellMutationRequest",
  "buildSelectedRowMutationRequest",
  "buildInsertRequest",
  "ICPDB row mutation checks OK"
], "row mutation smoke");

expectText(httpClient, [
  "IcpdbTokenSession",
  "Bearer",
  "getSessionInfoWithToken",
  "createTokenWithToken",
  "grantMemberWithToken",
  "setQuotaWithToken",
  "deleteDatabaseWithToken",
  "listTablesWithToken",
  "describeTableWithToken",
  "collation",
  "descending",
  "previewTableWithToken",
  "listPaymentsWithToken",
  "getRoutedOperationWithToken",
  "sqlQueryWithToken",
  "sqlExecuteWithToken",
  "sqlBatchWithToken",
  "idempotency-key",
  "nextIdempotencyKey",
  "crypto.randomUUID"
], "browser token client");

expectText(tokenActions, [
  "useIcpdbTokenActions",
  "connectTokenSession",
  "refreshTokenDetails",
  "listPaymentsWithToken",
  "previewTableWithToken",
  "deleteDatabaseWithToken",
  "sqlExecuteWithToken",
  "sqlBatchWithToken",
  "archiveDatabaseToSnapshotWithToken",
  "cancelArchiveWithToken",
  "downloadSqlDumpFileWithToken",
  "loadSqlDumpFromFileWithToken",
  "restoreArchiveSnapshotWithToken",
  "downloadSqlDump",
  "loadSqlDumpFile",
  "buildSelectedCellMutationRequest"
], "browser token action wiring");

expectText(httpClientCheck, [
  "describeTableWithToken",
  "createTokenWithToken",
  "listPaymentsWithToken",
  "deleteDatabaseWithToken",
  "cancelArchiveWithToken",
  "beginArchiveWithToken",
  "finalizeRestoreWithToken",
  "getRoutedOperationWithToken",
  "sqlExecuteWithToken",
  "idempotency-key",
  "ICPDB HTTP client checks OK",
  "ICPDB HTTP admin client checks OK"
], "browser token client smoke");

console.log("ICPDB goal coverage OK");
