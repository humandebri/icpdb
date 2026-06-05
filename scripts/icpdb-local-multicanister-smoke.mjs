#!/usr/bin/env node
// Where: scripts/icpdb-local-multicanister-smoke.mjs
// What: Live local-network smoke for control -> database canister routed SQL/table flows.
// Why: Sharding needs proof that routed writes, operation guards, and archive flows work through real inter-canister calls.
import { execFile, spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { Ed25519KeyIdentity } from "../icpdb-console/node_modules/@icp-sdk/core/lib/esm/identity/index.js";
import { callIcpdbHttp, parseCliArgs } from "./icpdb-http.mjs";
import { createIdentityActor, executeIdentityCommand, loadServiceIdentity, parseIdentityCliArgs } from "./icpdb-identity.mjs";
import { controllerCliArgs, localNetworkConfig } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);
const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const controlCanisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const smokeProgress = process.env.ICPDB_SMOKE_PROGRESS === "1";

async function main() {
  const network = await localNetworkConfig(environment, controlCanisterName);
  progress(`network ${network.networkUrl} canister ${network.canisterId}`);
  const controllerIdentity = Ed25519KeyIdentity.generate();
  const controllerEnv = identityEnv(network, controllerIdentity);

  // create_database_shard is the manual controller path; normal create_database auto-provisions, chunk-installs, and calls create_database_slot.
  const databaseId = parseOkText(
    await callCanister(network, network.canisterId, "create_database", "()"),
    "create_database"
  );
  const tokenOutput = await callCanister(
    network,
    network.canisterId,
    "create_database_token",
    `(record { database_id = ${candidText(databaseId)}; name = "remote-smoke-owner"; scope = variant { Owner } })`
  );
  const ownerToken = parseOwnerToken(tokenOutput);
  const baseUrl = await workingBaseUrl(network, ownerToken.token, databaseId);
  const placement = await runCliCommand(baseUrl, ownerToken.token, ["placement", databaseId]);
  const databaseCanisterId = parsePlacementCanisterId(placement);
  progress(`remote database ${databaseId} placed on ${databaseCanisterId}`);
  const runSuffix = Date.now().toString(36);
  const remoteTableName = `remote_notes_${runSuffix}`;
  const sdkRemoteSlotDatabaseId = `sdk_remote_slot_${runSuffix}`;
  const sdkRemoteSlotTableName = `sdk_remote_slot_notes_${runSuffix}`;
  const sdkRemoteTableName = `sdk_remote_notes_${runSuffix}`;
  const identityRemoteTableName = `identity_remote_notes_${runSuffix}`;

  const shardTopUp = await callCanister(
    network,
    network.canisterId,
    "top_up_database_shard",
    `(record { database_canister_id = ${candidText(databaseCanisterId)}; cycles = 1_000_000 : nat })`
  );
  assertIncludes(shardTopUp, databaseCanisterId);
  const shardStatus = await callCanister(
    network,
    network.canisterId,
    "get_database_shard_status",
    `(record { database_canister_id = ${candidText(databaseCanisterId)} })`
  );
  assertIncludes(shardStatus, "cycles_balance");
  assertIncludes(shardStatus, "running");
  const shardMaintenance = await callCanister(
    network,
    network.canisterId,
    "maintain_database_shards",
    "(record { min_available_slots = 1 : nat64; min_cycles_balance = 0 : nat; top_up_cycles = 0 : nat; max_new_shards = 1 : nat16; new_shard_max_databases = 8 : nat16; new_shard_initial_cycles = 1 : nat })"
  );
  assertIncludes(shardMaintenance, "available_slots");
  assertIncludes(shardMaintenance, "inspected_shards");
  const placementsCli = await runControllerCliCommand(network, ["placements"]);
  assertIncludes(placementsCli, databaseId);
  assertIncludes(placementsCli, databaseCanisterId);
  const shardsCli = await runControllerCliCommand(network, ["shards"]);
  assertIncludes(shardsCli, databaseCanisterId);
  const shardStatusCli = await runControllerCliCommand(network, ["shard-status", databaseCanisterId]);
  assertIncludes(shardStatusCli, "cycles_balance");
  const shardMaintainCli = await runControllerCliCommand(network, ["shard-maintain", "0", "0", "0", "0", "0", "0"]);
  assertIncludes(shardMaintainCli, "available_slots");
  const shardOperations = await callCanister(
    network,
    network.canisterId,
    "list_shard_operations",
    "()"
  );
  assertIncludes(shardOperations, "maintain_shards");
  assertIncludes(shardOperations, "top_up_shard");
  const shardOpsCli = await runControllerCliCommand(network, ["shard-ops"]);
  assertIncludes(shardOpsCli, "maintain_shards");
  assertIncludes(shardOpsCli, "top_up_shard");
  await assertDirectDatabaseCanisterCallRejected(network, databaseCanisterId, databaseId);
  assertIncludes(placement, databaseCanisterId);
  assertIncludes(placement, "database:");
  progress("shard inventory and controller CLI verified");

  const batchOperationId = `remote-batch-${databaseId}`;
  const batch = await runCliCommand(baseUrl, ownerToken.token, [
    "--idempotency-key",
    batchOperationId,
    "--wait",
    "batch",
    databaseId,
    "--statement",
    `CREATE TABLE ${remoteTableName} (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`,
    "--statement",
    `INSERT INTO ${remoteTableName} (body) VALUES ('from-remote-shard')`,
    "--statement",
    `SELECT body FROM ${remoteTableName}`
  ]);
  assertIncludes(batch, "from-remote-shard");
  assertIncludes(batch, batchOperationId);
  assertIncludes(batch, "routed_operations");
  assertIncludes(batch, "applied");
  const operation = await runCliCommand(baseUrl, ownerToken.token, [
    "operation",
    databaseId,
    batchOperationId
  ]);
  assertIncludes(operation, batchOperationId);
  assertIncludes(operation, "applied");
  assertIncludes(operation, "sql_batch_internal");
  const appliedReconcile = await runControllerCliCommandExpectFailure(network, [
    "operation-reconcile",
    databaseId,
    batchOperationId
  ]);
  assertIncludes(appliedReconcile, "routed operation is not unknown");

  const query = await runCliCommand(baseUrl, ownerToken.token, [
    "query",
    databaseId,
    `SELECT body FROM ${remoteTableName}`
  ]);
  assertIncludes(query, "from-remote-shard");

  const preview = await runCliCommand(baseUrl, ownerToken.token, [
    "preview",
    databaseId,
    remoteTableName
  ]);
  assertIncludes(preview, "from-remote-shard");

  const describe = await runCliCommand(baseUrl, ownerToken.token, [
    "describe",
    databaseId,
    remoteTableName
  ]);
  assertIncludes(describe, remoteTableName);

  const usage = await runCliCommand(baseUrl, ownerToken.token, ["usage", databaseId]);
  assertIncludes(usage, "logical_size_bytes");
  assertNotIncludes(usage, "\"logical_size_bytes\":0");

  const billing = await runCliCommand(baseUrl, ownerToken.token, ["billing", databaseId]);
  assertIncludes(billing, "spent_units");
  assertNotIncludes(billing, "\"spent_units\":0");

  const archivePath = `${tmpdir()}/icpdb-${databaseId}.sqlite3`;
  const archive = await runCliCommand(baseUrl, ownerToken.token, [
    "archive",
    databaseId,
    archivePath
  ]);
  assertIncludes(archive, "snapshot_hash");
  const archiveSnapshotHash = JSON.parse(archive).snapshot_hash;
  const snapshotInfo = await runLocalHttpCliCommand(["snapshot-info", archivePath]);
  assertIncludes(snapshotInfo, archiveSnapshotHash);
  const archivedPlacement = await runCliCommand(baseUrl, ownerToken.token, [
    "placement",
    databaseId
  ]);
  assertIncludes(archivedPlacement, "archived");

  const restore = await runCliCommand(baseUrl, ownerToken.token, [
    "restore",
    databaseId,
    archivePath,
    "--expect-snapshot-hash",
    archiveSnapshotHash
  ]);
  assertIncludes(restore, "snapshot_hash");
  assertIncludes(restore, archiveSnapshotHash);
  const restoredQuery = await runCliCommand(baseUrl, ownerToken.token, [
    "query",
    databaseId,
    `SELECT body FROM ${remoteTableName}`
  ]);
  assertIncludes(restoredQuery, "from-remote-shard");
  await unlink(archivePath).catch(() => {});
  progress("HTTP token remote SQL archive restore verified");

  await addLocalCanisterController(network, controllerIdentity.getPrincipal().toText());
  const controllerPrincipal = controllerIdentity.getPrincipal().toText();
  const grantControllerAccess = await callCanister(
    network,
    network.canisterId,
    "grant_database_access",
    `(${candidText(databaseId)}, ${candidText(controllerPrincipal)}, variant { Owner })`
  );
  assertIncludes(grantControllerAccess, "Ok");
  const sdkClientOptions = {
    canisterId: network.canisterId,
    host: network.networkUrl,
    identity: controllerIdentity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
  };
  const { createClient, createIcpdbClient, snapshotInfo: sdkSnapshotInfo } = await import("../icpdb-console/dist-sdk/icpdb-sdk.js");
  const { createIcpdbServiceClientFromEnvFile, writeIcpdbServiceEnvFile } = await import("../icpdb-console/dist-sdk/icpdb-service-identity.js");
  const controllerServiceEnvPath = `${tmpdir()}/icpdb-controller-${runSuffix}.env`;
  try {
    await writeIcpdbServiceEnvFile(controllerServiceEnvPath, {
      ICPDB_CANISTER_ID: network.canisterId,
      ICPDB_NETWORK_URL: network.networkUrl,
      ICPDB_ROOT_KEY: network.rootKey,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: JSON.stringify(controllerIdentity.toJSON())
    });
    const serviceControllerClient = await createIcpdbServiceClientFromEnvFile(controllerServiceEnvPath);
    const serviceControllerHealth = await serviceControllerClient.health();
    assertIncludes(stableJson(serviceControllerHealth), "cyclesBalance");
    const serviceControllerShards = await serviceControllerClient.listShards();
    assertIncludes(stableJson(serviceControllerShards), databaseCanisterId);
    const serviceControllerShardStatus = await serviceControllerClient.getShardStatus(databaseCanisterId);
    assertIncludes(stableJson(serviceControllerShardStatus), "cyclesBalance");
    const serviceControllerPlacements = await serviceControllerClient.listAllPlacements();
    assertIncludes(stableJson(serviceControllerPlacements), databaseId);
    const serviceControllerShardOps = await serviceControllerClient.listShardOperations();
    assertIncludes(stableJson(serviceControllerShardOps), "top_up_shard");
    const serviceControllerRoutedOperation = await serviceControllerClient.getRoutedOperation(databaseId, batchOperationId);
    assertIncludes(stableJson(serviceControllerRoutedOperation), batchOperationId);
    const packageControllerCheck = JSON.parse((await execFileAsync(process.execPath, [
      "icpdb-console/dist-sdk/icpdb-cli.js",
      "check-env",
      "--smoke-shards",
      "--service-env-file",
      controllerServiceEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assertIncludes(stableJson(packageControllerCheck), "shard_maintain_zero_action");
    assertIncludes(stableJson(packageControllerCheck), databaseCanisterId);
  } finally {
    await unlink(controllerServiceEnvPath).catch(() => {});
  }
  progress("SDK service env and package check-env controller shard operations verified");
  const sdkOperations = createIcpdbClient(sdkClientOptions);
  const sdkRoutedOperation = await sdkOperations.getRoutedOperation(databaseId, batchOperationId);
  assertIncludes(stableJson(sdkRoutedOperation), batchOperationId);
  assertIncludes(stableJson(sdkRoutedOperation), "applied");
  assertIncludes(stableJson(sdkRoutedOperation), "sql_batch_internal");
  const sdkAppliedReconcile = await expectFailure(() => sdkOperations.reconcileRoutedOperation(databaseId, batchOperationId));
  assertIncludes(sdkAppliedReconcile, "routed operation is not unknown");
  progress("SDK routed operation lookup verified");
  const sdkRemoteDatabase = await sdkOperations.createRemoteDatabase({
    databaseId: sdkRemoteSlotDatabaseId,
    databaseCanisterId
  });
  assertIncludes(stableJson(sdkRemoteDatabase), sdkRemoteSlotDatabaseId);
  assertIncludes(stableJson(sdkRemoteDatabase), "hot");
  const sdkRemoteSlot = sdkOperations.database(sdkRemoteSlotDatabaseId);
  const sdkRemoteSlotPlacement = await sdkRemoteSlot.placement();
  assertIncludes(stableJson(sdkRemoteSlotPlacement), databaseCanisterId);
  const sdkRemoteSlotCreate = await sdkRemoteSlot.execute(`CREATE TABLE ${sdkRemoteSlotTableName}(id INTEGER PRIMARY KEY, body TEXT NOT NULL)`);
  if (!sdkRemoteSlotCreate.routedOperationId) throw new Error("SDK createRemoteDatabase slot write did not return routedOperationId");
  await sdkRemoteSlot.run(`INSERT INTO ${sdkRemoteSlotTableName}(body) VALUES (:body)`, { body: "from-sdk-create-remote-database" });
  const sdkRemoteSlotRow = await sdkRemoteSlot.get(`SELECT body FROM ${sdkRemoteSlotTableName} WHERE body = :body`, { body: "from-sdk-create-remote-database" });
  assertIncludes(stableJson(sdkRemoteSlotRow), "from-sdk-create-remote-database");
  await sdkRemoteSlot.delete();
  const sdkRemoteSlotDeletedPlacement = await sdkOperations.database(sdkRemoteSlotDatabaseId).placement();
  assertIncludes(stableJson(sdkRemoteSlotDeletedPlacement), "deleted");
  progress("SDK createRemoteDatabase create_remote_database remote slot verified");
  const shardMigrateRemoteFailure = await runControllerCliCommandExpectFailure(network, [
    "shard-migrate",
    databaseId,
    databaseCanisterId
  ]);
  assertIncludes(shardMigrateRemoteFailure, "database is already remote");
  const deleteOutput = await runCliCommand(baseUrl, ownerToken.token, ["delete-db", databaseId]);
  assertIncludes(deleteOutput, "null");
  const deletedUsage = await runCliCommand(baseUrl, ownerToken.token, ["usage", databaseId]);
  assertIncludes(deletedUsage, "deleted");
  const deletedPlacement = await runCliCommand(baseUrl, ownerToken.token, ["placement", databaseId]);
  assertIncludes(deletedPlacement, "deleted");
  const deletedShardOps = await runControllerCliCommand(network, ["shard-ops"]);
  assertIncludes(deletedShardOps, "delete_remote_database");
  assertIncludes(deletedShardOps, "Applied");
  progress("HTTP token remote delete verified");
  const sdkSqlClient = createClient(sdkClientOptions);
  const sdkCreateResult = await sdkSqlClient.execute(`CREATE TABLE ${sdkRemoteTableName}(id INTEGER PRIMARY KEY, body TEXT NOT NULL)`);
  if (!sdkCreateResult.routedOperationId) throw new Error("SDK remote write did not return routedOperationId");
  assertIncludes(sdkCreateResult.routedOperationId, "icpdb-candid-sql_execute");
  const sdkDatabaseId = await sdkSqlClient.databaseId();
  const sdkPlacement = await sdkSqlClient.placement();
  assertIncludes(stableJson(sdkPlacement), databaseCanisterId);
  const sdkCreatedOperation = await sdkSqlClient.getRoutedOperation(sdkCreateResult.routedOperationId);
  assertIncludes(stableJson(sdkCreatedOperation), sdkCreateResult.routedOperationId);
  assertIncludes(stableJson(sdkCreatedOperation), "applied");
  assertIncludes(stableJson(sdkCreatedOperation), "sql_execute_internal");
  const sdkInsertResult = await sdkSqlClient.run(`INSERT INTO ${sdkRemoteTableName}(body) VALUES (:body)`, { body: "from-sdk-remote-shard" });
  if (!sdkInsertResult.routedOperationId) throw new Error("SDK remote insert did not return routedOperationId");
  const sdkInsertedRow = await sdkSqlClient.get(`SELECT body FROM ${sdkRemoteTableName} WHERE body = :body`, { body: "from-sdk-remote-shard" });
  assertIncludes(stableJson(sdkInsertedRow), "from-sdk-remote-shard");
  const sdkRemoteSnapshot = await sdkSqlClient.archive();
  if (sdkRemoteSnapshot.byteLength === 0) throw new Error("SDK remote archive snapshot should contain bytes");
  const sdkRemoteSnapshotInfo = await sdkSnapshotInfo(sdkRemoteSnapshot);
  await sdkSqlClient.restore(sdkRemoteSnapshot, { expectedSha256: sdkRemoteSnapshotInfo.sha256 });
  const sdkRestoredRows = await sdkSqlClient.all(`SELECT body FROM ${sdkRemoteTableName} ORDER BY id`);
  assertIncludes(stableJson(sdkRestoredRows), "from-sdk-remote-shard");
  await sdkSqlClient.run(`INSERT INTO ${sdkRemoteTableName}(body) VALUES (:body)`, { body: "after-sdk-restore" });
  const sdkPostRestoreRows = await sdkSqlClient.all(`SELECT body FROM ${sdkRemoteTableName} ORDER BY id`);
  const sdkPostRestoreJson = stableJson(sdkPostRestoreRows);
  assertIncludes(sdkPostRestoreJson, "from-sdk-remote-shard");
  assertIncludes(sdkPostRestoreJson, "after-sdk-restore");
  await sdkSqlClient.delete();
  const sdkDeletedPlacement = await runIdentityCli(controllerEnv, ["all-placements"]);
  assertIncludes(sdkDeletedPlacement, sdkDatabaseId);
  assertIncludes(sdkDeletedPlacement, "deleted");
  progress("SDK remote create SQL archive restore delete verified");
  const databaseControllerEnv = { ...controllerEnv, ICPDB_DATABASE_ID: databaseId };
  const identityRoutedOperation = await runIdentityCli(databaseControllerEnv, [
    "operation",
    batchOperationId
  ]);
  assertIncludes(identityRoutedOperation, batchOperationId);
  assertIncludes(identityRoutedOperation, "applied");
  assertIncludes(identityRoutedOperation, "sql_batch_internal");
  const identityPlacements = await runIdentityCli(controllerEnv, ["all-placements"]);
  assertIncludes(identityPlacements, databaseId);
  assertIncludes(identityPlacements, databaseCanisterId);
  const identityShards = await runIdentityCli(controllerEnv, ["shards"]);
  assertIncludes(identityShards, databaseCanisterId);
  const identityShardStatus = await runIdentityCli(controllerEnv, ["shard-status", databaseCanisterId]);
  assertIncludes(identityShardStatus, "cycles_balance");
  const identityShardTopUp = await runIdentityCli(controllerEnv, ["shard-top-up", databaseCanisterId, "1"]);
  assertIncludes(identityShardTopUp, databaseCanisterId);
  const identityShardMaintain = await runIdentityCli(controllerEnv, ["shard-maintain", "0", "0", "0", "0", "0", "0"]);
  assertIncludes(identityShardMaintain, "available_slots");
  const identityShardOps = await runIdentityCli(controllerEnv, ["shard-ops"]);
  assertIncludes(identityShardOps, "maintain_shards");
  assertIncludes(identityShardOps, "top_up_shard");
  progress("identity controller shard commands verified");
  const identityCreateOutput = await runIdentityCli(controllerEnv, ["create-db"]);
  const identityDatabaseId = JSON.parse(identityCreateOutput).database_id;
  const identityPlacement = await runIdentityCli(controllerEnv, ["placement", identityDatabaseId]);
  assertIncludes(identityPlacement, databaseCanisterId);
  assertIncludes(identityPlacement, "database:");
  const identityCreateKey = `identity_retry_create_${identityDatabaseId}`;
  const identityCreateTable = await runIdentityCli(controllerEnv, [
    "execute",
    identityDatabaseId,
    `CREATE TABLE ${identityRemoteTableName}(id INTEGER PRIMARY KEY, body TEXT NOT NULL)`,
    "--idempotency-key",
    identityCreateKey
  ]);
  assertIncludes(identityCreateTable, identityCreateKey);
  const identityCreateOperation = await runIdentityCli(controllerEnv, ["operation", identityDatabaseId, identityCreateKey]);
  assertIncludes(identityCreateOperation, identityCreateKey);
  assertIncludes(identityCreateOperation, "applied");
  const identityInsertKey = `identity_retry_insert_${identityDatabaseId}`;
  const identityInsert = await runIdentityCli(controllerEnv, [
    "execute",
    identityDatabaseId,
    `INSERT INTO ${identityRemoteTableName}(body) VALUES ('from-identity-remote-shard')`,
    "--idempotency-key",
    identityInsertKey,
    "--wait"
  ]);
  assertIncludes(identityInsert, identityInsertKey);
  assertIncludes(identityInsert, "routed_operation");
  assertIncludes(identityInsert, "applied");
  const identityInsertOperation = await runIdentityCli(controllerEnv, ["operation", identityDatabaseId, identityInsertKey]);
  assertIncludes(identityInsertOperation, identityInsertKey);
  assertIncludes(identityInsertOperation, "applied");
  const identityBatchKey = `identity_retry_batch_${identityDatabaseId}`;
  const identityBatch = await runIdentityCli(controllerEnv, [
    "batch",
    identityDatabaseId,
    "--statement",
    `INSERT INTO ${identityRemoteTableName}(body) VALUES ('from-identity-idempotent-batch')`,
    "--idempotency-key",
    identityBatchKey,
    "--wait"
  ]);
  assertIncludes(identityBatch, identityBatchKey);
  assertIncludes(identityBatch, "routed_operation");
  assertIncludes(identityBatch, "applied");
  const identityBatchOperation = await runIdentityCli(controllerEnv, ["operation", identityDatabaseId, identityBatchKey]);
  assertIncludes(identityBatchOperation, identityBatchKey);
  assertIncludes(identityBatchOperation, "applied");
  const identityRemoteQuery = await runIdentityCli(controllerEnv, [
    "query",
    identityDatabaseId,
    `SELECT body FROM ${identityRemoteTableName}`
  ]);
  assertIncludes(identityRemoteQuery, "from-identity-remote-shard");
  assertIncludes(identityRemoteQuery, "from-identity-idempotent-batch");
  const identityArchivePath = `${tmpdir()}/icpdb-${identityDatabaseId}-identity.sqlite3`;
  const identityArchive = await runIdentityCli(controllerEnv, ["archive", identityDatabaseId, identityArchivePath]);
  assertIncludes(identityArchive, "snapshot_hash");
  const identityArchiveHash = JSON.parse(identityArchive).snapshot_hash;
  const identitySnapshotInfo = await runIdentityCli(controllerEnv, ["snapshot-info", identityArchivePath]);
  assertIncludes(identitySnapshotInfo, identityArchiveHash);
  const identityArchivedPlacement = await runIdentityCli(controllerEnv, ["placement", identityDatabaseId]);
  assertIncludes(identityArchivedPlacement, "archived");
  const identityRestore = await runIdentityCli(controllerEnv, ["restore", identityDatabaseId, identityArchivePath, "--expect-snapshot-hash", identityArchiveHash]);
  assertIncludes(identityRestore, "snapshot_hash");
  assertIncludes(identityRestore, identityArchiveHash);
  const identityRestoredQuery = await runIdentityCli(controllerEnv, [
    "query",
    identityDatabaseId,
    `SELECT body FROM ${identityRemoteTableName}`
  ]);
  assertIncludes(identityRestoredQuery, "from-identity-remote-shard");
  assertIncludes(identityRestoredQuery, "from-identity-idempotent-batch");
  await unlink(identityArchivePath).catch(() => {});
  progress("identity remote SQL archive restore verified");
  const identityShardMigrateRemoteFailure = await runIdentityCliExpectFailure(controllerEnv, [
    "shard-migrate",
    identityDatabaseId,
    databaseCanisterId
  ]);
  assertIncludes(identityShardMigrateRemoteFailure, "database is already remote");
  await runIdentityCli(controllerEnv, ["delete-db", identityDatabaseId]);
  const unknownTarget = "not-a-principal";
  const unknownTopUp = await callCanister(
    network,
    network.canisterId,
    "top_up_database_shard",
    `(record { database_canister_id = ${candidText(unknownTarget)}; cycles = 1 : nat })`
  );
  assertIncludes(unknownTopUp, "Err");
  const unknownOps = await runControllerCliCommand(network, ["shard-ops"]);
  const unknownOperationId = parseUnknownShardOperationId(unknownOps, unknownTarget);
  const reconciledUnknown = await runIdentityCli(controllerEnv, [
    "shard-reconcile",
    "failed",
    unknownOperationId,
    "operator verified by smoke"
  ]);
  assertIncludes(reconciledUnknown, "failed");
  const identityAppliedReconcile = await runIdentityCliExpectFailure(databaseControllerEnv, [
    "operation-reconcile",
    batchOperationId
  ]);
  assertIncludes(identityAppliedReconcile, "routed operation is not unknown");
  progress("shard and routed operation reconcile paths verified");

  console.log(
    `ICPDB local multi-canister smoke OK: ${databaseId} routed to ${databaseCanisterId}`
  );
}

function progress(message) {
  if (smokeProgress) console.error(`[icpdb-multicanister-smoke] ${message}`);
}

async function callCanister(network, canisterId, method, args) {
  const { stdout } = await execFileAsync("icp", [
    "canister",
    "call",
    "-n",
    network.canisterNetwork,
    canisterId,
    method,
    args,
    "-o",
    "candid"
  ]);
  return stdout.trim();
}

async function addLocalCanisterController(network, principal) {
  await execFileAsync("icp", [
    "canister",
    "settings",
    "update",
    network.canisterName,
    "-e",
    network.environment,
    "--add-controller",
    principal,
    "-f"
  ]);
}

async function assertDirectDatabaseCanisterCallRejected(network, canisterId, databaseId) {
  const output = await callCanister(
    network,
    canisterId,
    "list_tables_internal",
    `(${candidText(databaseId)})`
  );
  assertIncludes(output, "caller is not the configured control canister");
}

async function workingBaseUrl(network, token, databaseId) {
  const candidates = [
    process.env.ICPDB_SMOKE_BASE_URL ?? "",
    `http://${network.canisterName}.${network.environment}.localhost:${network.gatewayPort}`,
    `http://${network.canisterId}.localhost:${network.gatewayPort}`,
    `http://${network.canisterId}.raw.localhost:${network.gatewayPort}`
  ].filter((value) => value.length > 0);
  const errors = [];
  for (const baseUrl of candidates) {
    try {
      await callIcpdbHttp(
        parseCliArgs(["--base-url", baseUrl, "--token", token, "tables", databaseId], {})
      );
      return baseUrl;
    } catch (error) {
      errors.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`no local HTTP gateway host worked\n${errors.join("\n")}`);
}

function identityEnv(network, identity) {
  return {
    ...process.env,
    ICPDB_CANISTER_ID: network.canisterId,
    ICPDB_NETWORK_URL: network.networkUrl,
    ICPDB_IDENTITY_JSON: JSON.stringify(identity.toJSON()),
    ICPDB_IDENTITY_PEM: "",
    ICPDB_IDENTITY_PEM_FILE: "",
    ICPDB_IDENTITY_JSON_FILE: "",
    ICPDB_IDENTITY_TYPE: "ed25519",
    ICPDB_ROOT_KEY: network.rootKey
  };
}

async function runIdentityCli(env, args) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const command = parseIdentityCliArgs(args, env);
      const identity = command.snapshotInfo ? null : await loadServiceIdentity(command);
      const actor = command.principal || command.snapshotInfo ? null : await createIdentityActor(command, identity);
      return stableJson(await executeIdentityCommand(command, actor, identity));
    } catch (error) {
      lastError = error;
      if (!isTransientLocalFetchError(error) || attempt === 3) break;
      await waitForLocalGateway(env.ICPDB_NETWORK_URL, `before retrying identity CLI ${args[0]}`);
    }
  }
  throw new Error(`identity CLI failed for ${args.join(" ")}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForLocalGateway(networkUrl, label) {
  if (typeof networkUrl !== "string" || networkUrl.length === 0) return;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(`${networkUrl}/api/v2/status`);
      if (response.ok) return;
    } catch {
      // Local PocketIC gateway may briefly stop accepting requests during long shard smokes.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`local ICP gateway did not become ready ${label}`);
}

function isTransientLocalFetchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("fetch failed") || message.includes("Cannot reach IC host");
}

async function runIdentityCliExpectFailure(env, args) {
  try {
    await runIdentityCli(env, args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`identity CLI command should have failed: ${args.join(" ")}`);
}

async function expectFailure(action) {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("action should have failed");
}

async function runCliCommand(baseUrl, token, args) {
  const child = spawn(process.execPath, ["scripts/icpdb-http.mjs", "--base-url", baseUrl, "--token", token, ...args], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`CLI command failed with ${code} for ${args.join(" ")}: ${stderr || stdout}`);
  return stdout;
}

async function runLocalHttpCliCommand(args) {
  const child = spawn(process.execPath, ["scripts/icpdb-http.mjs", ...args], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`local HTTP CLI command failed with ${code} for ${args.join(" ")}: ${stderr || stdout}`);
  return stdout;
}

async function runControllerCliCommand(network, args) {
  const child = spawn(process.execPath, [
    "scripts/icpdb-http.mjs",
    ...controllerCliArgs(network, args)
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`controller CLI command failed with ${code} for ${args.join(" ")}: ${stderr || stdout}`);
  return stdout;
}

async function runControllerCliCommandExpectFailure(network, args) {
  const child = spawn(process.execPath, [
    "scripts/icpdb-http.mjs",
    ...controllerCliArgs(network, args)
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  const output = `${stderr}${stdout}`;
  if (code === 0) throw new Error(`controller CLI command should have failed for ${args.join(" ")}: ${output}`);
  return output;
}

function parseOwnerToken(output) {
  const token = output.match(/token\s*=\s*"([^"]+)"/)?.[1];
  const tokenId = output.match(/token_id\s*=\s*"([^"]+)"/)?.[1];
  if (!token || !tokenId) {
    throw new Error(`create_database_token did not return token info: ${output}`);
  }
  return { token, token_id: tokenId };
}

function parseOkText(output, label) {
  const value = output.match(/Ok\s*=\s*"([^"]+)"/)?.[1];
  if (!value) {
    throw new Error(`${label} did not return Ok text: ${output}`);
  }
  return value;
}

function parsePlacementCanisterId(output) {
  const canisterId = output.match(/"canister_id"\s*:\s*"([^"]+)"/)?.[1];
  if (!canisterId) {
    throw new Error(`placement did not include canister_id: ${output}`);
  }
  return canisterId;
}

function parseUnknownShardOperationId(output, target) {
  const normalized = output.replace(/\\"/g, "\"");
  const targetIndex = normalized.indexOf(`target = opt "${target}"`);
  if (targetIndex < 0) {
    throw new Error(`unknown shard operation target not found: ${output}`);
  }
  const recordPrefix = normalized.slice(Math.max(0, targetIndex - 900), targetIndex);
  if (!recordPrefix.includes("Unknown")) {
    throw new Error(`shard operation for ${target} is not unknown: ${recordPrefix}`);
  }
  const matches = [...recordPrefix.matchAll(/operation_id\s*=\s*"([^"]+)"/g)];
  const match = matches.at(-1);
  if (!match) {
    throw new Error(`operation_id not found for ${target}: ${recordPrefix}`);
  }
  return match[1];
}

function candidText(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function hexToBytes(value) {
  if (value.length % 2 !== 0) throw new Error("hex string must have even length");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function assertIncludes(source, expected) {
  if (!source.includes(expected)) {
    throw new Error(`expected output to include ${expected}: ${source}`);
  }
}

function assertNotIncludes(source, forbidden) {
  if (source.includes(forbidden)) {
    throw new Error(`expected output not to include ${forbidden}: ${source}`);
  }
}

function stableJson(value) {
  return JSON.stringify(value, (_key, nextValue) => typeof nextValue === "bigint" ? nextValue.toString() : nextValue, 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
