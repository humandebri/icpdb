#!/usr/bin/env node
// Where: scripts/icpdb-local-cli-smoke.mjs
// What: Live local-network smoke for ICPDB HTTP CLI batch, shell, and inspect flows.
// Why: Turso-like CLI behavior must be verified against a deployed canister, not only request shaping.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { callIcpdbHttp, parseCliArgs } from "./icpdb-http.mjs";
import { recordLocalIcpdbPayment } from "./icpdb-local-deposit.mjs";
import { controllerCliArgs, localNetworkConfig } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);
const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const idempotencyRunId = process.env.ICPDB_SMOKE_IDEMPOTENCY_RUN_ID ?? `cli-smoke-${randomUUID()}`;

async function main() {
  const helpShellOutput = await spawnCommand(["scripts/icpdb-http.mjs", "help", "shell"]);
  assertIncludes(helpShellOutput, "Database inspection commands:");
  assertIncludes(helpShellOutput, ".help sql");
  assertIncludes(helpShellOutput, "Shell write SQL auto-generates an idempotency key");
  const helpInspectOutput = await spawnCommand(["scripts/icpdb-http.mjs", "help", "inspect"]);
  assertIncludes(helpInspectOutput, "inspect [database_id]");
  assertIncludes(helpInspectOutput, ".inspect [table_name]");
  const helpScriptOutput = await spawnCommand(["scripts/icpdb-http.mjs", "help", "script"]);
  assertIncludes(helpScriptOutput, "script [database_id] <file|->");
  const helpMigrateOutput = await spawnCommand(["scripts/icpdb-http.mjs", "help", "migrate"]);
  assertIncludes(helpMigrateOutput, "migrate [database_id] <file|->");

  const network = await localNetworkConfig(environment, canisterName);
  const primary = await runCreateDbCommand(network, "local-cli-smoke");
  const databaseId = primary.database_id;
  const token = primary.owner_token.token;
  await recordLocalIcpdbPayment(network, databaseId);
  const baseUrl = await workingBaseUrl(network, token, databaseId);
  const secondaryEnvFilePath = join(tmpdir(), `local-cli-smoke-secondary-${Date.now()}.env`);
  const secondary = await runCreateDbEnvCommand(network, baseUrl, "local-cli-smoke-secondary", [
    "CREATE TABLE cli_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
    "INSERT INTO cli_notes (body) VALUES ('from-secondary')"
  ], secondaryEnvFilePath);
  const secondaryDatabaseId = secondary.database_id;
  const secondaryToken = secondary.owner_token.token;
  const envFileQueryOutput = await spawnCommand([
    "scripts/icpdb-http.mjs",
    "--env-file",
    secondaryEnvFilePath,
    "query",
    "SELECT body FROM cli_notes"
  ]);
  assertIncludes(envFileQueryOutput, "from-secondary");
  const createSetupMigrationsPath = join(tmpdir(), `${secondaryDatabaseId}-create-setup-migrations.json`);
  await writeFile(createSetupMigrationsPath, JSON.stringify([{
    version: "http-create-setup-001",
    name: "create_cli_created_migrated",
    sql: "CREATE TABLE cli_created_migrated (id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO cli_created_migrated (body) VALUES ('from-create-setup-migration');"
  }]));
  const createdMigrated = await runCreateDbEnvMigrationCommand(network, baseUrl, "local-cli-smoke-created-migrated", createSetupMigrationsPath);
  const createdMigratedDatabaseId = createdMigrated.database_id;
  const createdMigratedToken = createdMigrated.owner_token.token;
  const imported = await runCreateDbCommand(network, "local-cli-smoke-imported");
  const importedDatabaseId = imported.database_id;
  const importedToken = imported.owner_token.token;
  const databasesOutput = await runDatabasesCommand(network);
  assertIncludes(databasesOutput, databaseId);
  assertIncludes(databasesOutput, secondaryDatabaseId);
  assertIncludes(databasesOutput, createdMigratedDatabaseId);
  assertIncludes(databasesOutput, importedDatabaseId);

  await callIcpdbHttp(
    parseCliArgs(
      [
        "--base-url",
        baseUrl,
        "--token",
        token,
        "--idempotency-key",
        `cli-primary-batch-${databaseId}`,
        "batch",
        databaseId,
        "--statement",
        "CREATE TABLE cli_parents (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        "--statement",
        "CREATE TABLE cli_notes (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES cli_parents(id) ON UPDATE CASCADE ON DELETE RESTRICT, body TEXT NOT NULL)",
        "--statement",
        "CREATE UNIQUE INDEX cli_notes_body_idx ON cli_notes(body)",
        "--statement",
        "CREATE TRIGGER cli_notes_guard BEFORE INSERT ON cli_notes BEGIN SELECT 1; END",
        "--statement",
        "CREATE VIEW cli_note_bodies AS SELECT body FROM cli_notes",
        "--statement",
        "INSERT INTO cli_parents (name) VALUES ('root')",
        "--statement",
        "INSERT INTO cli_notes (parent_id, body) VALUES (1, 'from-batch')",
        "--statement",
        "SELECT body FROM cli_notes"
      ],
      {}
    )
  );
  const inspectOutput = await runCliCommand(baseUrl, token, [
    "inspect",
    databaseId,
    "cli_notes",
    "--format",
    "table",
    "--limit",
    "5"
  ]);
  assertIncludes(inspectOutput, "cli_notes");
  assertIncludes(inspectOutput, "cli_notes_body_idx");
  assertIncludes(inspectOutput, "cli_notes_guard");
  assertIncludes(inspectOutput, "cli_parents.id");
  assertIncludes(inspectOutput, "CASCADE");
  assertIncludes(inspectOutput, "RESTRICT");
  assertIncludes(inspectOutput, "cli_notes (1 rows;");
  assertIncludes(inspectOutput, "showing 1-1; limit 5; offset 0; next -");

  const columnsOutput = await runCliCommand(baseUrl, token, ["columns", databaseId, "cli_notes", "--format", "table"]);
  assertIncludes(columnsOutput, "columns cli_notes");
  assertIncludes(columnsOutput, "body");
  assertIncludes(columnsOutput, "TEXT");

  const indexesOutput = await runCliCommand(baseUrl, token, ["indexes", databaseId, "cli_notes", "--format", "table"]);
  assertIncludes(indexesOutput, "indexes cli_notes");
  assertIncludes(indexesOutput, "cli_notes_body_idx");

  const triggersOutput = await runCliCommand(baseUrl, token, ["triggers", databaseId, "cli_notes", "--format", "table"]);
  assertIncludes(triggersOutput, "triggers cli_notes");
  assertIncludes(triggersOutput, "cli_notes_guard");

  const foreignKeysOutput = await runCliCommand(baseUrl, token, ["foreign-keys", databaseId, "cli_notes", "--format", "table"]);
  assertIncludes(foreignKeysOutput, "foreign keys cli_notes");
  assertIncludes(foreignKeysOutput, "cli_parents.id");

  const databaseInspectOutput = await runCliCommand(baseUrl, token, [
    "inspect",
    databaseId,
    "--format",
    "table"
  ]);
  assertIncludes(databaseInspectOutput, "table summary");
  assertIncludes(databaseInspectOutput, "placement");
  assertIncludes(databaseInspectOutput, "database:");
  assertIncludes(databaseInspectOutput, "usage events");
  assertIncludes(databaseInspectOutput, "cli_notes");
  assertIncludes(databaseInspectOutput, "column_names");
  assertIncludes(databaseInspectOutput, "cli_notes_body_idx");

  const viewsOutput = await runCliCommand(baseUrl, token, ["views", databaseId, "--format", "table"]);
  assertIncludes(viewsOutput, "cli_note_bodies");
  assertIncludes(viewsOutput, "view");

  const statsOutput = await runCliCommand(baseUrl, token, ["stats", databaseId, "--format", "table"]);
  assertIncludes(statsOutput, "table_count");
  assertIncludes(statsOutput, "view_count");
  assertIncludes(statsOutput, "cli_notes");
  assertIncludes(statsOutput, "cli_note_bodies");
  const statsCsvOutput = await runCliCommand(baseUrl, token, ["stats", databaseId, "--format", "csv"]);
  assertIncludes(statsCsvOutput, "section,name,type,rows,tables,views,columns,indexes,triggers,foreign_keys,column_names");
  assertIncludes(statsCsvOutput, "database," + databaseId);
  assertIncludes(statsCsvOutput, "table,cli_notes,table");

  const placementOutput = await runCliCommand(baseUrl, token, ["placement", databaseId]);
  assertIncludes(placementOutput, "shard_id");
  assertIncludes(placementOutput, "database:");
  assertIncludes(placementOutput, databaseId);

  const usageEventsOutput = await runCliCommand(baseUrl, token, [
    "usage-events",
    databaseId,
    "--format",
    "table"
  ]);
  assertIncludes(usageEventsOutput, "sql_batch");
  assertIncludes(usageEventsOutput, "CREATE+INSERT+SELECT");
  assertIncludes(usageEventsOutput, "affected");

  const usageOutput = await runCliCommand(baseUrl, token, ["usage", databaseId]);
  assertIncludes(usageOutput, "logical_size_bytes");
  assertIncludes(usageOutput, databaseId);

  const billingOutput = await runCliCommand(baseUrl, token, ["billing", databaseId]);
  assertIncludes(billingOutput, "balance_units");
  assertIncludes(billingOutput, databaseId);

  const paymentsOutput = await runCliCommand(baseUrl, token, ["payments", databaseId, "--format", "table"]);
  assertIncludes(paymentsOutput, "payment_id");
  assertIncludes(paymentsOutput, "1000000");
  assertIncludes(paymentsOutput, "1000");

  const quotaOutput = await runCliCommand(baseUrl, token, ["quota", databaseId, "134217728"]);
  assertIncludes(quotaOutput, "max_logical_size_bytes");
  assertIncludes(quotaOutput, "134217728");

  const createdTokenOutput = await runCliCommand(baseUrl, token, [
    "create-token",
    databaseId,
    "local-cli-smoke-read",
    "read"
  ]);
  const readToken = JSON.parse(createdTokenOutput);
  if (!readToken.info?.token_id || !readToken.token) {
    throw new Error(`create-token did not return token and token_id: ${createdTokenOutput}`);
  }
  const createdWriteTokenOutput = await runCliCommand(baseUrl, token, [
    "create-token",
    databaseId,
    "local-cli-smoke-write",
    "write"
  ]);
  const writeToken = JSON.parse(createdWriteTokenOutput);
  if (!writeToken.info?.token_id || !writeToken.token) {
    throw new Error(`create-token did not return write token and token_id: ${createdWriteTokenOutput}`);
  }

  const readTokenQueryOutput = await runCliCommand(baseUrl, readToken.token, [
    "query",
    databaseId,
    "SELECT body FROM cli_notes"
  ]);
  assertIncludes(readTokenQueryOutput, "from-batch");
  const readTokenExecuteFailure = await runCliCommandExpectFailure(baseUrl, readToken.token, [
    "--idempotency-key",
    `cli-read-token-write-denied-${databaseId}`,
    "execute",
    databaseId,
    "INSERT INTO cli_notes (parent_id, body) VALUES (1, 'from-read-token')"
  ]);
  assertIncludes(readTokenExecuteFailure, "api token scope does not allow this operation");
  const readTokenBillingFailure = await runCliCommandExpectFailure(baseUrl, readToken.token, [
    "billing",
    databaseId
  ]);
  assertIncludes(readTokenBillingFailure, "api token scope does not allow this operation");
  const readTokenMembersFailure = await runCliCommandExpectFailure(baseUrl, readToken.token, [
    "members",
    databaseId
  ]);
  assertIncludes(readTokenMembersFailure, "api token scope does not allow this operation");

  const writeTokenQueryOutput = await runCliCommand(baseUrl, writeToken.token, [
    "query",
    databaseId,
    "SELECT body FROM cli_notes"
  ]);
  assertIncludes(writeTokenQueryOutput, "from-batch");
  const writeTokenExecuteOutput = await runCliCommand(baseUrl, writeToken.token, [
    "--idempotency-key",
    `cli-write-token-write-${databaseId}`,
    "execute",
    databaseId,
    "UPDATE cli_notes SET body = body WHERE body = 'from-batch'"
  ]);
  assertIncludes(writeTokenExecuteOutput, "rows_affected");
  const writeTokenBillingFailure = await runCliCommandExpectFailure(baseUrl, writeToken.token, [
    "billing",
    databaseId
  ]);
  assertIncludes(writeTokenBillingFailure, "api token scope does not allow this operation");
  const writeTokenMembersFailure = await runCliCommandExpectFailure(baseUrl, writeToken.token, [
    "members",
    databaseId
  ]);
  assertIncludes(writeTokenMembersFailure, "api token scope does not allow this operation");

  const tokensOutput = await runCliCommand(baseUrl, token, ["tokens", databaseId]);
  assertIncludes(tokensOutput, "local-cli-smoke");
  assertIncludes(tokensOutput, "local-cli-smoke-read");
  assertIncludes(tokensOutput, "local-cli-smoke-write");

  const revokeOutput = await runCliCommand(baseUrl, token, ["revoke-token", databaseId, readToken.info.token_id]);
  assertIncludes(revokeOutput, readToken.info.token_id);
  assertIncludes(revokeOutput, "revoked_at_ms");
  const revokeWriteOutput = await runCliCommand(baseUrl, token, ["revoke-token", databaseId, writeToken.info.token_id]);
  assertIncludes(revokeWriteOutput, writeToken.info.token_id);
  assertIncludes(revokeWriteOutput, "revoked_at_ms");

  const ownerMembersOutput = await runCliCommand(baseUrl, token, ["members", databaseId]);
  const ownerPrincipal = JSON.parse(ownerMembersOutput).find((member) => member.role === "owner")?.principal;
  if (typeof ownerPrincipal !== "string" || ownerPrincipal.length === 0) {
    throw new Error(`members did not include an owner principal: ${ownerMembersOutput}`);
  }
  const lastOwnerDowngradeFailure = await runCliCommandExpectFailure(baseUrl, token, [
    "grant-member",
    databaseId,
    ownerPrincipal,
    "reader"
  ]);
  assertIncludes(lastOwnerDowngradeFailure, "at least one owner principal");
  const lastOwnerRevokeFailure = await runCliCommandExpectFailure(baseUrl, token, [
    "revoke-member",
    databaseId,
    ownerPrincipal
  ]);
  assertIncludes(lastOwnerRevokeFailure, "at least one owner principal");

  const anonymousGrantFailure = await runCliCommandExpectFailure(baseUrl, token, ["grant-member", databaseId, "2vxsx-fae", "reader"]);
  assertIncludes(anonymousGrantFailure, "anonymous principal cannot be granted database access");

  const memberPrincipal = "aaaaa-aa";
  const grantMemberOutput = await runCliCommand(baseUrl, token, ["grant-member", databaseId, memberPrincipal, "reader"]);
  assertIncludes(grantMemberOutput, "null");

  const membersOutput = await runCliCommand(baseUrl, token, ["members", databaseId]);
  assertIncludes(membersOutput, memberPrincipal);
  assertIncludes(membersOutput, "reader");

  const accessInspectOutput = await runCliCommand(baseUrl, token, ["inspect", databaseId, "--access", "--format", "table"]);
  assertIncludes(accessInspectOutput, "access");
  assertIncludes(accessInspectOutput, "local-cli-smoke-read");
  assertIncludes(accessInspectOutput, "local-cli-smoke-write");
  assertIncludes(accessInspectOutput, memberPrincipal);
  assertIncludes(accessInspectOutput, "payments");
  assertIncludes(accessInspectOutput, "1000000");

  const shellOutput = await runCliShell(baseUrl, token, databaseId, [
    ".help",
    ".help sql",
    ".tables",
    ".views",
    ".stats",
    ".usage",
    ".billing",
    ".payments",
    ".placement",
    ".usage-events",
    ".tokens",
    ".members",
    ".describe cli_notes",
    ".columns cli_notes",
    ".indexes cli_notes",
    ".triggers cli_notes",
    ".foreign-keys cli_notes",
    ".schema cli_notes",
    ".dump cli_notes",
    ".preview cli_notes 5 0",
    ".inspect cli_notes 5 0",
    ".inspect --access",
    "SELECT body FROM cli_notes",
    ".quit"
  ]);
  assertIncludes(shellOutput, "Shell commands:");
  assertIncludes(shellOutput, "Database inspection commands:");
  assertIncludes(shellOutput, "Shell write SQL auto-generates an idempotency key");
  assertIncludes(shellOutput, "cli_notes");
  assertIncludes(shellOutput, "cli_note_bodies");
  assertIncludes(shellOutput, "table_count");
  assertIncludes(shellOutput, "logical_size_bytes");
  assertIncludes(shellOutput, "balance_units");
  assertIncludes(shellOutput, "payment_id");
  assertIncludes(shellOutput, "shard_id");
  assertIncludes(shellOutput, "CREATE+INSERT+SELECT");
  assertIncludes(shellOutput, "local-cli-smoke-read");
  assertIncludes(shellOutput, "local-cli-smoke-write");
  assertIncludes(shellOutput, memberPrincipal);
  assertIncludes(shellOutput, "CREATE TABLE cli_notes");
  assertIncludes(shellOutput, "INSERT INTO \"cli_notes\"");
  assertIncludes(shellOutput, "cli_notes_body_idx");
  assertIncludes(shellOutput, "cli_parents.id");
  assertIncludes(shellOutput, "from-batch");

  const revokeMemberOutput = await runCliCommand(baseUrl, token, ["revoke-member", databaseId, memberPrincipal]);
  assertIncludes(revokeMemberOutput, "null");

  const shellSqlOutput = await runCliCommand(baseUrl, token, [
    "shell",
    databaseId,
    "SELECT count(*) AS total FROM cli_notes"
  ]);
  assertIncludes(shellSqlOutput, "total");
  assertIncludes(shellSqlOutput, "1");

  const shellInspectOutput = await runCliCommand(baseUrl, token, [
    "shell",
    databaseId,
    ".inspect cli_notes 5 0"
  ]);
  assertIncludes(shellInspectOutput, "cli_notes");
  assertIncludes(shellInspectOutput, "cli_notes_body_idx");
  assertIncludes(shellInspectOutput, "cli_parents.id");

  const schemaOutput = await runCliCommand(baseUrl, token, ["schema", databaseId, "cli_notes"]);
  assertIncludes(schemaOutput, "CREATE TABLE cli_notes");
  assertIncludes(schemaOutput, "CREATE UNIQUE INDEX cli_notes_body_idx");

  const databaseSchemaOutput = await runCliCommand(baseUrl, token, ["schema", databaseId, "--format", "table"]);
  assertIncludes(databaseSchemaOutput, "table cli_notes");
  assertIncludes(databaseSchemaOutput, "view cli_note_bodies");
  assertIncludes(databaseSchemaOutput, "CREATE VIEW cli_note_bodies");
  const envSchemaOutput = await runCliCommandWithDatabaseEnv(baseUrl, token, databaseId, ["schema", "cli_notes"]);
  assertIncludes(envSchemaOutput, "CREATE TABLE cli_notes");
  const envQueryOutput = await runCliCommandWithDatabaseEnv(baseUrl, token, databaseId, [
    "query",
    "SELECT body FROM cli_notes"
  ]);
  assertIncludes(envQueryOutput, "from-batch");

  const scriptPath = join(tmpdir(), `${databaseId}-script.sql`);
  await writeFile(scriptPath, [
    "CREATE TABLE cli_scripted (id INTEGER PRIMARY KEY, body TEXT NOT NULL);",
    "INSERT INTO cli_scripted (body) VALUES ('from-script-file');"
  ].join("\n"));
  const scriptOutput = await runCliCommand(baseUrl, token, [
    "--idempotency-key",
    `cli-script-${databaseId}`,
    "script",
    databaseId,
    scriptPath
  ]);
  assertIncludes(scriptOutput, "statement_count");
  const scriptedOutput = await runCliCommand(baseUrl, token, [
    "query",
    databaseId,
    "SELECT body FROM cli_scripted"
  ]);
  assertIncludes(scriptedOutput, "from-script-file");
  const stdinScriptOutput = await runCliCommandWithInput(baseUrl, token, [
    "--idempotency-key",
    `cli-script-stdin-${databaseId}`,
    "script",
    databaseId,
    "-"
  ], "CREATE TABLE cli_stdin_scripted (id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO cli_stdin_scripted (body) VALUES ('from-script-stdin');");
  assertIncludes(stdinScriptOutput, "statement_count");
  assertIncludes(stdinScriptOutput, "-");
  const stdinScriptedOutput = await runCliCommand(baseUrl, token, [
    "query",
    databaseId,
    "SELECT body FROM cli_stdin_scripted"
  ]);
  assertIncludes(stdinScriptedOutput, "from-script-stdin");
  const envScriptOutput = await runCliCommandWithDatabaseEnv(baseUrl, token, databaseId, [
    "--idempotency-key",
    `cli-script-env-${databaseId}`,
    "script",
    "-"
  ], "CREATE TABLE cli_env_scripted (id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO cli_env_scripted (body) VALUES ('from-script-env');");
  assertIncludes(envScriptOutput, "statement_count");
  const envScriptedOutput = await runCliCommandWithDatabaseEnv(baseUrl, token, databaseId, [
    "query",
    "SELECT body FROM cli_env_scripted"
  ]);
  assertIncludes(envScriptedOutput, "from-script-env");
  const migrationsPath = join(tmpdir(), `${databaseId}-migrations.json`);
  await writeFile(migrationsPath, JSON.stringify([{
    version: "http-cli-001",
    name: "create_cli_migrated",
    sql: "CREATE TABLE cli_migrated (id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO cli_migrated (body) VALUES ('from-http-migration');"
  }]));
  const migrateOutput = await runCliCommand(baseUrl, token, [
    "--idempotency-key",
    `cli-migrate-${databaseId}`,
    "migrate",
    databaseId,
    migrationsPath
  ]);
  assertIncludes(migrateOutput, "http-cli-001");
  assertIncludes(migrateOutput, "applied");
  const migratedOutput = await runCliCommand(baseUrl, token, [
    "query",
    databaseId,
    "SELECT body FROM cli_migrated"
  ]);
  assertIncludes(migratedOutput, "from-http-migration");
  const skippedMigrateOutput = await runCliCommandWithInput(baseUrl, token, [
    "--idempotency-key",
    `cli-migrate-stdin-${databaseId}`,
    "migrate",
    databaseId,
    "-"
  ], await readFile(migrationsPath, "utf8"));
  assertIncludes(skippedMigrateOutput, "skipped");
  assertIncludes(skippedMigrateOutput, "http-cli-001");
  const envUsageOutput = await runCliCommandWithDatabaseEnv(baseUrl, token, databaseId, ["usage"]);
  assertIncludes(envUsageOutput, databaseId);

  const dumpOutput = await runCliCommand(baseUrl, token, ["dump", databaseId, "cli_notes"]);
  assertIncludes(dumpOutput, "BEGIN TRANSACTION");
  assertIncludes(dumpOutput, "INSERT INTO \"cli_notes\"");
  assertIncludes(dumpOutput, "from-batch");

  const dumpPath = join(tmpdir(), `${databaseId}.sql`);
  const fullDumpOutput = await runCliCommand(baseUrl, token, ["dump", databaseId]);
  await writeFile(dumpPath, fullDumpOutput);
  const loadOutput = await runCliCommand(baseUrl, importedToken, [
    "--idempotency-key",
    `cli-load-${importedDatabaseId}`,
    "load",
    importedDatabaseId,
    dumpPath
  ]);
  assertIncludes(loadOutput, "statement_count");
  const stdinImported = await runCreateDbCommand(network, "local-cli-smoke-stdin-imported");
  const stdinImportedDatabaseId = stdinImported.database_id;
  const stdinImportedToken = stdinImported.owner_token.token;
  const stdinLoadOutput = await runCliCommandWithInput(baseUrl, stdinImportedToken, [
    "--idempotency-key",
    `cli-load-stdin-${stdinImportedDatabaseId}`,
    "load",
    stdinImportedDatabaseId,
    "-"
  ], fullDumpOutput);
  assertIncludes(stdinLoadOutput, "statement_count");
  assertIncludes(stdinLoadOutput, "-");
  const stdinImportedOutput = await runCliCommand(baseUrl, stdinImportedToken, [
    "query",
    stdinImportedDatabaseId,
    "SELECT body FROM cli_notes"
  ]);
  assertIncludes(stdinImportedOutput, "from-batch");
  const importedOutput = await runCliCommand(baseUrl, importedToken, [
    "query",
    importedDatabaseId,
    "SELECT body FROM cli_notes"
  ]);
  assertIncludes(importedOutput, "from-batch");

  const archivePath = join(tmpdir(), `${databaseId}.sqlite3`);
  const archiveOutput = await runCliCommand(baseUrl, token, ["archive", databaseId, archivePath]);
  assertIncludes(archiveOutput, "snapshot_hash");
  assertIncludes(archiveOutput, archivePath);
  const archiveSnapshotHash = JSON.parse(archiveOutput).snapshot_hash;
  if (typeof archiveSnapshotHash !== "string" || archiveSnapshotHash.length !== 64) {
    throw new Error(`archive did not return a SHA-256 snapshot hash: ${archiveOutput}`);
  }
  const snapshotInfoOutput = await spawnCommand(["scripts/icpdb-http.mjs", "snapshot-info", archivePath]);
  assertIncludes(snapshotInfoOutput, "snapshot_hash");
  assertIncludes(snapshotInfoOutput, archiveSnapshotHash);
  assertIncludes(snapshotInfoOutput, archivePath);
  const mismatchedRestoreOutput = await runCliCommandExpectFailure(baseUrl, token, [
    "restore",
    databaseId,
    archivePath,
    "--expect-snapshot-hash",
    "00".repeat(32)
  ]);
  assertIncludes(mismatchedRestoreOutput, "snapshot hash mismatch");

  const restoreOutput = await runCliCommand(baseUrl, token, [
    "restore",
    databaseId,
    archivePath,
    "--expect-snapshot-hash",
    archiveSnapshotHash
  ]);
  assertIncludes(restoreOutput, "snapshot_hash");
  assertIncludes(restoreOutput, archiveSnapshotHash);
  assertIncludes(restoreOutput, archivePath);

  const restoredOutput = await runCliCommand(baseUrl, token, [
    "query",
    databaseId,
    "SELECT body FROM cli_notes"
  ]);
  assertIncludes(restoredOutput, "from-batch");
  const secondaryOutput = await runCliCommand(baseUrl, secondaryToken, [
    "query",
    secondaryDatabaseId,
    "SELECT body FROM cli_notes"
  ]);
  assertIncludes(secondaryOutput, "from-secondary");
  assertNotIncludes(secondaryOutput, "from-batch");
  const createdMigratedOutput = await runCliCommand(baseUrl, createdMigratedToken, [
    "query",
    createdMigratedDatabaseId,
    "SELECT body FROM cli_created_migrated"
  ]);
  assertIncludes(createdMigratedOutput, "from-create-setup-migration");

  await upgradeCanister(network);
  const upgradedOutput = await runCliCommand(baseUrl, token, [
    "query",
    databaseId,
    "SELECT body FROM cli_notes"
  ]);
  assertIncludes(upgradedOutput, "from-batch");
  const upgradedSecondaryOutput = await runCliCommand(baseUrl, secondaryToken, [
    "query",
    secondaryDatabaseId,
    "SELECT body FROM cli_notes"
  ]);
  assertIncludes(upgradedSecondaryOutput, "from-secondary");
  assertNotIncludes(upgradedSecondaryOutput, "from-batch");
  const upgradedCreatedMigratedOutput = await runCliCommand(baseUrl, createdMigratedToken, [
    "query",
    createdMigratedDatabaseId,
    "SELECT body FROM cli_created_migrated"
  ]);
  assertIncludes(upgradedCreatedMigratedOutput, "from-create-setup-migration");

  const deleteOutput = await runCliCommand(baseUrl, token, ["delete-db", databaseId]);
  assertIncludes(deleteOutput, "null");
  const deleteSecondaryOutput = await runCliCommand(baseUrl, secondaryToken, ["delete-db", secondaryDatabaseId]);
  assertIncludes(deleteSecondaryOutput, "null");
  const deleteCreatedMigratedOutput = await runCliCommand(baseUrl, createdMigratedToken, ["delete-db", createdMigratedDatabaseId]);
  assertIncludes(deleteCreatedMigratedOutput, "null");
  const deleteImportedOutput = await runCliCommand(baseUrl, importedToken, ["delete-db", importedDatabaseId]);
  assertIncludes(deleteImportedOutput, "null");
  const deleteStdinImportedOutput = await runCliCommand(baseUrl, stdinImportedToken, ["delete-db", stdinImportedDatabaseId]);
  assertIncludes(deleteStdinImportedOutput, "null");

  const deletedUsageOutput = await runCliCommand(baseUrl, token, ["usage", databaseId]);
  assertIncludes(deletedUsageOutput, "deleted");
  const deletedSecondaryUsageOutput = await runCliCommand(baseUrl, secondaryToken, ["usage", secondaryDatabaseId]);
  assertIncludes(deletedSecondaryUsageOutput, "deleted");
  const deletedCreatedMigratedUsageOutput = await runCliCommand(baseUrl, createdMigratedToken, ["usage", createdMigratedDatabaseId]);
  assertIncludes(deletedCreatedMigratedUsageOutput, "deleted");
  const deletedImportedUsageOutput = await runCliCommand(baseUrl, importedToken, ["usage", importedDatabaseId]);
  assertIncludes(deletedImportedUsageOutput, "deleted");
  const deletedStdinImportedUsageOutput = await runCliCommand(baseUrl, stdinImportedToken, ["usage", stdinImportedDatabaseId]);
  assertIncludes(deletedStdinImportedUsageOutput, "deleted");

  console.log(`ICPDB local CLI smoke OK: ${databaseId}, ${secondaryDatabaseId}, ${createdMigratedDatabaseId}, ${importedDatabaseId}, ${stdinImportedDatabaseId} via ${baseUrl}`);
}

async function upgradeCanister(network) {
  await execFileAsync("icp", [
    "deploy",
    "-e",
    network.environment,
    "--mode",
    "upgrade",
    "-y",
    network.canisterName
  ]);
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
      // Try the next local gateway host form.
    }
  }
  throw new Error(`no local HTTP gateway host worked for canister ${network.canisterId}\n${errors.join("\n")}`);
}

async function runCliShell(baseUrl, token, databaseId, lines) {
  const child = spawn(
    process.execPath,
    [
      "scripts/icpdb-http.mjs",
      "--base-url",
      baseUrl,
      "--token",
      token,
      "shell",
      databaseId
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.end(`${lines.join("\n")}\n`);
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`CLI shell failed with ${code}: ${stderr || stdout}`);
  }
  return stdout;
}

async function runCreateDbCommand(network, tokenName) {
  const output = await spawnCommand([
    "scripts/icpdb-http.mjs",
    ...controllerCliArgs(network, ["create-db", tokenName])
  ]);
  const created = JSON.parse(output);
  if (!created.database_id || !created.owner_token?.token || !created.owner_token?.token_id) {
    throw new Error(`create-db did not return database id and owner token: ${output}`);
  }
  return created;
}

async function runCreateDbEnvCommand(network, baseUrl, tokenName, setupStatements = [], envOutPath = null) {
  const output = await spawnCommand([
    "scripts/icpdb-http.mjs",
    "--base-url",
    baseUrl,
    "--format",
    "env",
    ...(envOutPath ? ["--env-out", envOutPath] : []),
    "--idempotency-key",
    `${idempotencyRunId}-create-setup-${tokenName}`,
    ...setupStatements.flatMap((statement) => ["--statement", statement]),
    ...controllerCliArgs(network, ["create-db", tokenName])
  ]);
  const envText = envOutPath ? await readFile(envOutPath, "utf8") : output;
  const env = parseEnvLines(envText);
  if (!env.ICPDB_DATABASE_ID || !env.ICPDB_TOKEN || !env.ICPDB_URL) {
    throw new Error(`create-db --format env did not return database env: ${envText}`);
  }
  if (env.ICPDB_CANISTER_ID !== network.canisterId || !env.ICPDB_NETWORK_URL || env.ICPDB_HTTP_BASE_URL !== baseUrl) {
    throw new Error(`create-db --format env returned mismatched connection env: ${envText}`);
  }
  if (env.ICPDB_URL !== `icpdb://${network.canisterId}/${env.ICPDB_DATABASE_ID}`) {
    throw new Error(`create-db --format env returned mismatched ICPDB_URL: ${envText}`);
  }
  if (envOutPath && ((await stat(envOutPath)).mode & 0o777) !== 0o600) {
    throw new Error(`create-db --env-out did not write mode 0600: ${envOutPath}`);
  }
  return {
    database_id: env.ICPDB_DATABASE_ID,
    owner_token: { token: env.ICPDB_TOKEN },
    env
  };
}

async function runCreateDbEnvMigrationCommand(network, baseUrl, tokenName, setupMigrationsPath) {
  const output = await spawnCommand([
    "scripts/icpdb-http.mjs",
    "--base-url",
    baseUrl,
    "--format",
    "env",
    "--idempotency-key",
    `${idempotencyRunId}-create-setup-migrate-${tokenName}`,
    "--setup-migrations-file",
    setupMigrationsPath,
    ...controllerCliArgs(network, ["create-db", tokenName])
  ]);
  const env = parseEnvLines(output);
  if (!env.ICPDB_DATABASE_ID || !env.ICPDB_TOKEN || !env.ICPDB_URL) {
    throw new Error(`create-db --setup-migrations-file --format env did not return database env: ${output}`);
  }
  return {
    database_id: env.ICPDB_DATABASE_ID,
    owner_token: { token: env.ICPDB_TOKEN },
    env
  };
}

async function runDatabasesCommand(network) {
  return spawnCommand([
    "scripts/icpdb-http.mjs",
    ...controllerCliArgs(network, ["databases"])
  ]);
}

function parseEnvLines(output) {
  const env = {};
  for (const line of output.trim().split(/\n+/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`invalid env output line: ${line}`);
    env[line.slice(0, separator)] = JSON.parse(line.slice(separator + 1));
  }
  return env;
}

async function runCliCommand(baseUrl, token, args) {
  return spawnCommand(["scripts/icpdb-http.mjs", "--base-url", baseUrl, "--token", token, ...args]);
}

async function runCliCommandWithInput(baseUrl, token, args, input) {
  return spawnCommand(["scripts/icpdb-http.mjs", "--base-url", baseUrl, "--token", token, ...args], input);
}

async function runCliCommandWithDatabaseEnv(baseUrl, token, databaseId, args, input = null) {
  return spawnCommand(["scripts/icpdb-http.mjs", ...args], input, {
    ICPDB_HTTP_BASE_URL: baseUrl,
    ICPDB_TOKEN: token,
    ICPDB_DATABASE_ID: databaseId
  });
}

async function runCliCommandExpectFailure(baseUrl, token, args) {
  try {
    await runCliCommand(baseUrl, token, args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`CLI command unexpectedly succeeded: ${args.join(" ")}`);
}

async function spawnCommand(args, input = null, env = {}) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  if (input !== null) child.stdin.end(input);
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`CLI command failed with ${code} (${args.join(" ")}): ${stderr || stdout}`);
  }
  return stdout;
}

function assertIncludes(source, expected) {
  if (!source.includes(expected)) {
    throw new Error(`expected shell output to include ${expected}: ${source}`);
  }
}

function assertNotIncludes(source, forbidden) {
  if (source.includes(forbidden)) {
    throw new Error(`expected shell output not to include ${forbidden}: ${source}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
