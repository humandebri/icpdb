#!/usr/bin/env node
// Where: scripts/icpdb-local-cli-smoke.mjs
// What: Live local-network smoke for ICPDB HTTP CLI batch, shell, and inspect flows.
// Why: Turso-like CLI behavior must be verified against a deployed canister, not only request shaping.
import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
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

async function main() {
  const helpShellOutput = await spawnCommand(["scripts/icpdb-http.mjs", "help", "shell"]);
  assertIncludes(helpShellOutput, "Database inspection commands:");
  assertIncludes(helpShellOutput, ".help sql");
  assertIncludes(helpShellOutput, "Shell write SQL auto-generates an idempotency key");
  const helpInspectOutput = await spawnCommand(["scripts/icpdb-http.mjs", "help", "inspect"]);
  assertIncludes(helpInspectOutput, "inspect <database_id>");
  assertIncludes(helpInspectOutput, ".inspect [table_name]");

  const network = await localNetworkConfig(environment, canisterName);
  const primary = await runCreateDbCommand(network, "local-cli-smoke");
  const databaseId = primary.database_id;
  const token = primary.owner_token.token;
  await recordLocalIcpdbPayment(network, databaseId);
  const baseUrl = await workingBaseUrl(network, token, databaseId);
  const secondary = await runCreateDbCommand(network, "local-cli-smoke-secondary");
  const secondaryDatabaseId = secondary.database_id;
  const secondaryToken = secondary.owner_token.token;
  const imported = await runCreateDbCommand(network, "local-cli-smoke-imported");
  const importedDatabaseId = imported.database_id;
  const importedToken = imported.owner_token.token;
  const databasesOutput = await runDatabasesCommand(network);
  assertIncludes(databasesOutput, databaseId);
  assertIncludes(databasesOutput, secondaryDatabaseId);
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
  await callIcpdbHttp(
    parseCliArgs(
      [
        "--base-url",
        baseUrl,
        "--token",
        secondaryToken,
        "--idempotency-key",
        `cli-secondary-batch-${secondaryDatabaseId}`,
        "batch",
        secondaryDatabaseId,
        "--statement",
        "CREATE TABLE cli_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
        "--statement",
        "INSERT INTO cli_notes (body) VALUES ('from-secondary')"
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

  const tokensOutput = await runCliCommand(baseUrl, token, ["tokens", databaseId]);
  assertIncludes(tokensOutput, "local-cli-smoke");
  assertIncludes(tokensOutput, "local-cli-smoke-read");

  const revokeOutput = await runCliCommand(baseUrl, token, ["revoke-token", databaseId, readToken.info.token_id]);
  assertIncludes(revokeOutput, readToken.info.token_id);
  assertIncludes(revokeOutput, "revoked_at_ms");

  const grantMemberOutput = await runCliCommand(baseUrl, token, ["grant-member", databaseId, "2vxsx-fae", "reader"]);
  assertIncludes(grantMemberOutput, "null");

  const membersOutput = await runCliCommand(baseUrl, token, ["members", databaseId]);
  assertIncludes(membersOutput, "2vxsx-fae");
  assertIncludes(membersOutput, "reader");

  const accessInspectOutput = await runCliCommand(baseUrl, token, ["inspect", databaseId, "--access", "--format", "table"]);
  assertIncludes(accessInspectOutput, "access");
  assertIncludes(accessInspectOutput, "local-cli-smoke-read");
  assertIncludes(accessInspectOutput, "2vxsx-fae");
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
  assertIncludes(shellOutput, "2vxsx-fae");
  assertIncludes(shellOutput, "CREATE TABLE cli_notes");
  assertIncludes(shellOutput, "INSERT INTO \"cli_notes\"");
  assertIncludes(shellOutput, "cli_notes_body_idx");
  assertIncludes(shellOutput, "cli_parents.id");
  assertIncludes(shellOutput, "from-batch");

  const revokeMemberOutput = await runCliCommand(baseUrl, token, ["revoke-member", databaseId, "2vxsx-fae"]);
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

  const restoreOutput = await runCliCommand(baseUrl, token, ["restore", databaseId, archivePath]);
  assertIncludes(restoreOutput, "snapshot_hash");
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

  const deleteOutput = await runCliCommand(baseUrl, token, ["delete-db", databaseId]);
  assertIncludes(deleteOutput, "null");
  const deleteSecondaryOutput = await runCliCommand(baseUrl, secondaryToken, ["delete-db", secondaryDatabaseId]);
  assertIncludes(deleteSecondaryOutput, "null");
  const deleteImportedOutput = await runCliCommand(baseUrl, importedToken, ["delete-db", importedDatabaseId]);
  assertIncludes(deleteImportedOutput, "null");

  const deletedUsageOutput = await runCliCommand(baseUrl, token, ["usage", databaseId]);
  assertIncludes(deletedUsageOutput, "deleted");
  const deletedSecondaryUsageOutput = await runCliCommand(baseUrl, secondaryToken, ["usage", secondaryDatabaseId]);
  assertIncludes(deletedSecondaryUsageOutput, "deleted");
  const deletedImportedUsageOutput = await runCliCommand(baseUrl, importedToken, ["usage", importedDatabaseId]);
  assertIncludes(deletedImportedUsageOutput, "deleted");

  console.log(`ICPDB local CLI smoke OK: ${databaseId}, ${secondaryDatabaseId}, ${importedDatabaseId} via ${baseUrl}`);
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

async function runDatabasesCommand(network) {
  return spawnCommand([
    "scripts/icpdb-http.mjs",
    ...controllerCliArgs(network, ["databases"])
  ]);
}

async function runCliCommand(baseUrl, token, args) {
  return spawnCommand(["scripts/icpdb-http.mjs", "--base-url", baseUrl, "--token", token, ...args]);
}

async function spawnCommand(args) {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
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
