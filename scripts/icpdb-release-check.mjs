#!/usr/bin/env node
// Where: scripts/icpdb-release-check.mjs
// What: Run release checks for SDK, CLI, goal coverage, deploy preflight, and optional live gates.
// Why: Release readiness should be reproducible locally, with live canister checks only when explicitly requested.
import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAINNET_NETWORK_URL = "https://icp-api.io";
const DEFAULT_SERVICE_ENV_FILE = "service.env";
const DEFAULT_CONTROLLER_ENV_FILE = "controller.env";
const SERVICE_ENV_BACKUP_FILE = "./readiness-backup.sqlite";
const GOAL_COMPLETE_LOCAL_SMOKE_STEPS = [
  "sdk-build",
  "sdk-shortest",
  "sdk-browser-shortest",
  "sdk-sqlite-shortest",
  "sdk-libsql-shortest",
  "identity-quickstart",
  "service-owner",
  "controller-quickstart",
  "shards",
  "browser",
  "ii-browser"
].join(",");
const SERVICE_ENV_PROVISION_SETUP_SQL = [
  "CREATE TABLE note_groups(id INTEGER PRIMARY KEY, label TEXT NOT NULL)",
  "CREATE TABLE notes(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES note_groups(id), body TEXT NOT NULL)",
  "CREATE INDEX notes_body_idx ON notes(body)",
  "CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN UPDATE note_groups SET label = label WHERE id = NEW.group_id; END",
  "INSERT INTO note_groups(label) VALUES ('readiness')",
  "INSERT INTO notes(group_id, body) VALUES (1, 'readiness-setup')",
  "CREATE VIEW notes_view AS SELECT id, body FROM notes"
].join("; ");

function usage() {
  return [
    "Usage:",
    "  node scripts/icpdb-release-check.mjs [options]",
    "",
    "Options:",
    "  --skip-build",
    "  --skip-console",
    "  --goal-complete  # full completion gate: console test/typecheck, rust, local smoke, mainnet SQL/scalar/archive smoke, service env SQL/archive smoke, controller shard smoke",
    "  --goal-readiness  # dry-run final gate prerequisites",
    "  --format json|env|table  # only applies to --goal-readiness",
    "  --self-test",
    "  --with-rust",
    "  --with-local-smoke",
    "  --with-mainnet-sql-smoke  # postdeploy SQL-only smoke, then archive/restore smoke",
    "  --mainnet-canister-id <id>",
    "  --require-mainnet-canister-id",
    "  --service-env-file <file>  # defaults to service.env with --goal-readiness/--goal-complete",
    "  --controller-env-file <file>  # defaults to controller.env with --goal-readiness/--goal-complete",
    "  --with-service-env-sql-smoke",
    "  --with-service-env-archive-restore-smoke",
    "  --with-controller-env-shard-smoke",
    "  --service-env-skip-call"
  ].join("\n");
}

function parseReleaseCheckArgs(rawArgs) {
  const command = {
    skipBuild: false,
    skipConsole: false,
    goalComplete: false,
    goalReadiness: false,
    selfTest: false,
    withRust: false,
    withLocalSmoke: false,
    withMainnetSqlSmoke: false,
    withServiceEnvSqlSmoke: false,
    withServiceEnvArchiveRestoreSmoke: false,
    withControllerEnvShardSmoke: false,
    mainnetCanisterId: "",
    requireMainnetCanisterId: false,
    serviceEnvFile: "",
    controllerEnvFile: "",
    serviceEnvFileExplicit: false,
    controllerEnvFileExplicit: false,
    serviceEnvSkipCall: false,
    outputFormat: "json",
    help: false
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--skip-build") {
      command.skipBuild = true;
    } else if (arg === "--skip-console") {
      command.skipConsole = true;
    } else if (arg === "--goal-complete") {
      command.goalComplete = true;
    } else if (arg === "--goal-readiness") {
      command.goalReadiness = true;
    } else if (arg === "--self-test") {
      command.selfTest = true;
    } else if (arg === "--with-rust") {
      command.withRust = true;
    } else if (arg === "--with-local-smoke") {
      command.withLocalSmoke = true;
    } else if (arg === "--with-mainnet-sql-smoke") {
      command.withMainnetSqlSmoke = true;
    } else if (arg === "--with-service-env-sql-smoke") {
      command.withServiceEnvSqlSmoke = true;
    } else if (arg === "--with-service-env-archive-restore-smoke") {
      command.withServiceEnvArchiveRestoreSmoke = true;
    } else if (arg === "--with-controller-env-shard-smoke") {
      command.withControllerEnvShardSmoke = true;
    } else if (arg === "--mainnet-canister-id") {
      command.mainnetCanisterId = canisterIdArg(requireValue(rawArgs, index, arg), "mainnet canister id");
      index += 1;
    } else if (arg === "--require-mainnet-canister-id") {
      command.requireMainnetCanisterId = true;
    } else if (arg === "--service-env-file") {
      command.serviceEnvFile = filePathArg(requireValue(rawArgs, index, arg), "service env file");
      command.serviceEnvFileExplicit = true;
      index += 1;
    } else if (arg === "--controller-env-file") {
      command.controllerEnvFile = filePathArg(requireValue(rawArgs, index, arg), "controller env file");
      command.controllerEnvFileExplicit = true;
      index += 1;
    } else if (arg === "--service-env-skip-call") {
      command.serviceEnvSkipCall = true;
    } else if (arg === "--format") {
      command.outputFormat = parseOutputFormat(requireValue(rawArgs, index, arg));
      index += 1;
    } else if (arg === "-h" || arg === "--help" || arg === "help") {
      command.help = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (command.goalReadiness || command.goalComplete) {
    command.serviceEnvFile ||= DEFAULT_SERVICE_ENV_FILE;
    command.controllerEnvFile ||= DEFAULT_CONTROLLER_ENV_FILE;
  }
  if (command.serviceEnvFile && command.controllerEnvFile && sameEnvFilePath(command.serviceEnvFile, command.controllerEnvFile)) {
    throw new Error("service env file and controller env file must be different paths");
  }
  if (command.goalComplete) {
    if (command.skipBuild) throw new Error("--goal-complete cannot be combined with --skip-build");
    if (command.skipConsole) throw new Error("--goal-complete cannot be combined with --skip-console");
    if (command.serviceEnvSkipCall) throw new Error("--goal-complete cannot be combined with --service-env-skip-call");
    command.withRust = true;
    command.withLocalSmoke = true;
    command.withMainnetSqlSmoke = true;
    command.withServiceEnvSqlSmoke = true;
    command.withServiceEnvArchiveRestoreSmoke = true;
    command.withControllerEnvShardSmoke = true;
    command.requireMainnetCanisterId = true;
  }
  if (command.serviceEnvSkipCall && !command.serviceEnvFile) {
    throw new Error("--service-env-skip-call requires --service-env-file <file>");
  }
  if ((command.withServiceEnvSqlSmoke || command.withServiceEnvArchiveRestoreSmoke) && !command.serviceEnvFile) {
    throw new Error("service env smoke checks require --service-env-file <file>");
  }
  if (command.withControllerEnvShardSmoke && !command.controllerEnvFile) {
    throw new Error("controller env shard smoke requires --controller-env-file <file>");
  }
  if (command.serviceEnvSkipCall && (command.withServiceEnvSqlSmoke || command.withServiceEnvArchiveRestoreSmoke)) {
    throw new Error("--service-env-skip-call cannot be combined with service env smoke checks");
  }
  if (command.outputFormat !== "json" && !command.goalReadiness) {
    throw new Error("--format is only valid with --goal-readiness");
  }
  return command;
}

function requireValue(rawArgs, index, flag) {
  const value = rawArgs[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function filePathArg(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} path must be a non-empty string`);
  }
  return value;
}

function sameEnvFilePath(first, second) {
  return normalize(first) === normalize(second);
}

function nonEmptyStringArg(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function canisterIdArg(value, label) {
  const canisterId = nonEmptyStringArg(value, label);
  if (!/^[a-z0-9-]+-cai$/.test(canisterId)) {
    throw new Error(`${label} must be a canister id ending in -cai`);
  }
  return canisterId;
}

function parseOutputFormat(value) {
  if (value === "json" || value === "env" || value === "table") return value;
  throw new Error("format must be json, env, or table");
}

let options;
try {
  options = parseReleaseCheckArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(1);
}

if (options.help) {
  console.log(usage());
  process.exit(0);
}

if (options.selfTest) {
  await runSelfTest();
  process.stdout.write("ICPDB release check self-test OK\n");
  process.exit(0);
}

if (options.goalReadiness) {
  const readiness = await goalReadiness(options);
  const output = formatGoalReadiness(readiness, options.outputFormat);
  process.stdout.write(`${output}\n`);
  process.exit(readiness.ready ? 0 : 1);
}

if (options.goalComplete) {
  await assertGoalCompleteReadiness(options);
}

if (options.serviceEnvFile) {
  await assertServiceEnvTargetsMainnet(options);
}
if (options.controllerEnvFile) {
  await assertControllerEnvTargetsMainnet(options);
}

const commands = releaseCommands(options);

for (const step of commands) {
  const label = [step.command, ...step.args].join(" ");
  process.stderr.write(`\n$ ${label}\n`);
  await execFileAsync(step.command, step.args, {
    env: { ...process.env, ...(step.env ?? {}) },
    maxBuffer: 16 * 1024 * 1024
  });
}

process.stdout.write("ICPDB release checks OK\n");

function releaseCommands(command) {
  return [
    ...(command.skipConsole ? [] : [
      { command: "pnpm", args: ["--dir", "icpdb-console", "test"] },
      ...(command.goalComplete ? [{ command: "pnpm", args: ["--dir", "icpdb-console", "typecheck"] }] : [])
    ]),
    { command: process.execPath, args: ["scripts/check-ci-workflow.mjs"] },
    { command: process.execPath, args: ["scripts/check-icpdb-http-cli.mjs"] },
    { command: process.execPath, args: ["scripts/check-icpdb-identity-cli.mjs"] },
    { command: process.execPath, args: ["scripts/check-icpdb-local-network.mjs"] },
    { command: process.execPath, args: ["scripts/check-icpdb-service-env-check.mjs"] },
    { command: process.execPath, args: ["scripts/check-icpdb-goal.mjs"] },
    { command: process.execPath, args: ["scripts/icpdb-release-check.mjs", "--self-test"] },
    { command: process.execPath, args: ["scripts/icpdb-mainnet-preflight.mjs", "--self-test"] },
    { command: process.execPath, args: ["scripts/icpdb-mainnet-postdeploy.mjs", "--self-test"] },
    ...(command.withRust
      ? [
          {
            command: "cargo",
            args: ["test", "-p", "icpdb-runtime", "-p", "icpdb-canister", "-p", "icpdb-database-canister", "--locked"],
            env: { RUST_TEST_THREADS: "1" }
          },
          {
            command: "cargo",
            args: ["clippy", "-p", "icpdb-runtime", "-p", "icpdb-canister", "-p", "icpdb-database-canister", "--all-targets", "--locked", "--", "-D", "warnings"]
          }
        ]
      : []),
    ...(command.withLocalSmoke
      ? [{ command: process.execPath, args: ["scripts/icpdb-local-goal-smoke.mjs", "--only", GOAL_COMPLETE_LOCAL_SMOKE_STEPS] }]
      : []),
    { command: process.execPath, args: ["scripts/icpdb-mainnet-preflight.mjs", ...(command.skipBuild ? ["--skip-build"] : []), ...(command.mainnetCanisterId ? ["--canister-id", command.mainnetCanisterId] : [])] },
    ...mainnetPostdeployReleaseCommands(command),
    ...(command.serviceEnvFile
      ? [
          {
            command: process.execPath,
            args: [
              "scripts/icpdb-service-env-check.mjs",
              "--env-file",
              command.serviceEnvFile,
              ...(command.withServiceEnvArchiveRestoreSmoke ? ["--require-role", "owner"] : command.withServiceEnvSqlSmoke ? ["--require-role", "writer"] : []),
              ...(command.withServiceEnvSqlSmoke ? ["--smoke-sql"] : []),
              ...(command.withServiceEnvSqlSmoke ? ["--smoke-sdk"] : []),
              ...(command.withServiceEnvArchiveRestoreSmoke ? ["--smoke-archive-restore"] : []),
              ...(command.withServiceEnvArchiveRestoreSmoke ? ["--smoke-sdk-archive-restore"] : []),
              ...(command.serviceEnvSkipCall ? ["--skip-call"] : [])
            ]
          }
        ]
      : []),
    ...(command.controllerEnvFile
      ? [
          {
            command: process.execPath,
            args: [
              "scripts/icpdb-service-env-check.mjs",
              "--env-file",
              command.controllerEnvFile,
              ...(command.withControllerEnvShardSmoke ? ["--smoke-shards", "--smoke-sdk-shards"] : ["--skip-call"])
            ]
          }
        ]
      : [])
  ];
}

function mainnetPostdeployReleaseCommands(command) {
  const baseArgs = [
    "scripts/icpdb-mainnet-postdeploy.mjs",
    ...(command.mainnetCanisterId ? ["--canister-id", command.mainnetCanisterId] : []),
    ...(command.requireMainnetCanisterId ? ["--require-canister-id"] : [])
  ];
  if (!command.withMainnetSqlSmoke) {
    return [{ command: process.execPath, args: [...baseArgs, "--skip-call"] }];
  }
  return [
    { command: process.execPath, args: [...baseArgs, "--smoke-sql"] },
    { command: process.execPath, args: [...baseArgs, "--smoke-sql", "--smoke-archive-restore"] }
  ];
}

async function runSelfTest() {
  const canisterId = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  const databaseId = "db_release_self";
  const identityJson = "[\"302a300506032b6570032100dbb3fa5e2d0eab2425dda6efeb9c5ffb195ab5a9208bc79762dd586bc8109220\",\"a616e9ac5acc1ac8ab6d3001d532b7be547770dcbaf040b750f523c2e2882d10\"]";
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-release-check-"));
  try {
    assertParseFailure(["--with-service-env-sql-smoke"], /require --service-env-file/);
    assertParseFailure(["--service-env-file", "service.env", "--service-env-skip-call", "--with-service-env-archive-restore-smoke"], /cannot be combined/);
    assertParseFailure(["--with-controller-env-shard-smoke"], /requires --controller-env-file/);
    assertParseFailure(["--mainnet-canister-id", "   "], /mainnet canister id must be a non-empty string/);
    assertParseFailure(["--mainnet-canister-id", "not-a-canister"], /mainnet canister id must be a canister id ending in -cai/);
    assertParseFailure(["--service-env-file", "   "], /service env file path must be a non-empty string/);
    assertParseFailure(["--controller-env-file", "   "], /controller env file path must be a non-empty string/);
    assertParseFailure(["--goal-readiness", "--service-env-file", "service.env", "--controller-env-file", "./service.env"], /service env file and controller env file must be different paths/);
    assertParseFailure(["--goal-complete", "--service-env-file", "ci.env", "--controller-env-file", "ci.env"], /service env file and controller env file must be different paths/);
    assertParseFailure(["--format", "env"], /only valid with --goal-readiness/);
    assertParseFailure(["--goal-readiness", "--format", "yaml"], /format must be json, env, or table/);
    assert.throws(() => mappedCanisterIdFromMapping({ icpdb: "   " }), /icpdb must be a non-empty string/);
    assert.throws(() => mappedCanisterIdFromMapping({ icpdb: "not-a-canister" }), /icpdb must be a canister id ending in -cai/);
    assert.equal(parseReleaseCheckArgs(["--goal-readiness"]).serviceEnvFile, DEFAULT_SERVICE_ENV_FILE);
    assert.equal(parseReleaseCheckArgs(["--goal-readiness"]).controllerEnvFile, DEFAULT_CONTROLLER_ENV_FILE);
    assert.equal(parseReleaseCheckArgs(["--goal-complete"]).serviceEnvFile, DEFAULT_SERVICE_ENV_FILE);
    assert.equal(parseReleaseCheckArgs(["--goal-complete"]).controllerEnvFile, DEFAULT_CONTROLLER_ENV_FILE);

    const noIdentityPath = join(tempDir, "no-identity.env");
    await writeOwnerOnlyEnv(noIdentityPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`
    });
    const noIdentity = await goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: noIdentityPath });
    if (
      noIdentity.ready ||
      noIdentity.checks.service_env_identity ||
      noIdentity.checks.service_env_inspect ||
      !noIdentity.next_steps.some((step) => step.includes("Add a service identity")) ||
      !noIdentity.next_steps.some((step) => step.includes("Move or remove the existing service.env before running --env-out service env generation commands"))
    ) {
      throw new Error("readiness self-test failed for missing service identity");
    }
    const dbBearingSetupEnvPath = join(tempDir, "db-bearing-setup.env");
    await writeOwnerOnlyEnv(dbBearingSetupEnvPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson,
      ICPDB_SETUP_SQL: "CREATE TABLE ignored_setup(id INTEGER)"
    });
    const dbBearingSetupEnv = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: dbBearingSetupEnvPath
    });
    if (
      dbBearingSetupEnv.ready ||
      dbBearingSetupEnv.checks.service_env_no_create_setup_env ||
      dbBearingSetupEnv.checks.service_env_inspect ||
      !dbBearingSetupEnv.service_env.db_bearing_create_setup_env ||
      !dbBearingSetupEnv.missing_evidence.some((item) => item.id === "service_env_no_create_setup_env") ||
      !dbBearingSetupEnv.next_steps.some((step) => step.includes("Remove ICPDB_SETUP_* from DB-bearing service.env"))
    ) {
      throw new Error("readiness self-test failed for DB-bearing setup env");
    }
    const emptyUrlPath = join(tempDir, "empty-url.env");
    await writeOwnerOnlyEnv(emptyUrlPath, {
      ICPDB_URL: "",
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: emptyUrlPath }),
      /ICPDB_URL must be a non-empty string/,
      "readiness self-test should reject empty ICPDB_URL"
    );
    const emptyDatabaseIdPath = join(tempDir, "empty-database-id.env");
    await writeOwnerOnlyEnv(emptyDatabaseIdPath, {
      ICPDB_CANISTER_ID: canisterId,
      ICPDB_DATABASE_ID: "",
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: emptyDatabaseIdPath }),
      /ICPDB_DATABASE_ID must be a non-empty string/,
      "readiness self-test should reject empty ICPDB_DATABASE_ID"
    );
    const whitespaceDatabaseIdPath = join(tempDir, "whitespace-database-id.env");
    await writeOwnerOnlyEnv(whitespaceDatabaseIdPath, {
      ICPDB_CANISTER_ID: canisterId,
      ICPDB_DATABASE_ID: "   ",
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: whitespaceDatabaseIdPath }),
      /ICPDB_DATABASE_ID must be a non-empty string/,
      "readiness self-test should reject whitespace ICPDB_DATABASE_ID"
    );
    const decodedEmptyUrlDatabaseIdPath = join(tempDir, "decoded-empty-url-database-id.env");
    await writeOwnerOnlyEnv(decodedEmptyUrlDatabaseIdPath, {
      ICPDB_URL: `icpdb://${canisterId}/%20%20`,
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: decodedEmptyUrlDatabaseIdPath }),
      /ICPDB_DATABASE_ID must be a non-empty string/,
      "readiness self-test should reject decoded empty ICPDB_URL database id"
    );
    const malformedUrlDatabaseIdPath = join(tempDir, "malformed-url-database-id.env");
    await writeOwnerOnlyEnv(malformedUrlDatabaseIdPath, {
      ICPDB_URL: `icpdb://${canisterId}/db%ZZ`,
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: malformedUrlDatabaseIdPath }),
      /invalid ICPDB_URL database id encoding/,
      "readiness self-test should reject malformed ICPDB_URL database id encoding"
    );
    const userinfoUrlPath = join(tempDir, "userinfo-url.env");
    await writeOwnerOnlyEnv(userinfoUrlPath, {
      ICPDB_URL: `icpdb://owner@${canisterId}/${databaseId}`,
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: userinfoUrlPath }),
      /ICPDB_URL must not include username or password/,
      "readiness self-test should reject ICPDB_URL userinfo"
    );
    const portUrlPath = join(tempDir, "port-url.env");
    await writeOwnerOnlyEnv(portUrlPath, {
      ICPDB_URL: `icpdb://${canisterId}:123/${databaseId}`,
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: portUrlPath }),
      /ICPDB_URL must not include a port/,
      "readiness self-test should reject ICPDB_URL port"
    );
    const queryUrlPath = join(tempDir, "query-url.env");
    await writeOwnerOnlyEnv(queryUrlPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}?mode=read`,
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: queryUrlPath }),
      /ICPDB_URL must not include query or fragment/,
      "readiness self-test should reject ICPDB_URL query"
    );
    const fragmentUrlPath = join(tempDir, "fragment-url.env");
    await writeOwnerOnlyEnv(fragmentUrlPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}#read`,
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: fragmentUrlPath }),
      /ICPDB_URL must not include query or fragment/,
      "readiness self-test should reject ICPDB_URL fragment"
    );
    const doubleSlashUrlPath = join(tempDir, "double-slash-url.env");
    await writeOwnerOnlyEnv(doubleSlashUrlPath, {
      ICPDB_URL: `icpdb://${canisterId}//${databaseId}`,
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: doubleSlashUrlPath }),
      /ICPDB_URL path must be \/<database-id>/,
      "readiness self-test should reject ambiguous ICPDB_URL path"
    );
    const emptyNetworkPath = join(tempDir, "empty-network.env");
    await writeOwnerOnlyEnv(emptyNetworkPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_NETWORK_URL: "",
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: emptyNetworkPath }),
      /ICPDB_NETWORK_URL must be a non-empty string/,
      "readiness self-test should reject empty ICPDB_NETWORK_URL"
    );
    const emptyRootKeyPath = join(tempDir, "empty-root-key.env");
    await writeOwnerOnlyEnv(emptyRootKeyPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_ROOT_KEY: "",
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: emptyRootKeyPath }),
      /ICPDB_ROOT_KEY must be a non-empty string/,
      "readiness self-test should reject empty ICPDB_ROOT_KEY"
    );
    const emptyIdentityPath = join(tempDir, "empty-identity.env");
    await writeOwnerOnlyEnv(emptyIdentityPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_IDENTITY_JSON: ""
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: emptyIdentityPath }),
      /ICPDB_IDENTITY_JSON must be a non-empty string/,
      "readiness self-test should reject empty ICPDB_IDENTITY_JSON"
    );
    const ambiguousIdentityPath = join(tempDir, "ambiguous-identity.env");
    await writeOwnerOnlyEnv(ambiguousIdentityPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_IDENTITY_JSON: identityJson,
      ICPDB_IDENTITY_JSON_FILE: "service-identity.json"
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: ambiguousIdentityPath }),
      /service env must use exactly one identity secret source: ICPDB_IDENTITY_JSON, ICPDB_IDENTITY_JSON_FILE/,
      "readiness self-test should reject ambiguous service identity secrets"
    );
    const invalidIdentityTypePath = join(tempDir, "invalid-identity-type.env");
    await writeOwnerOnlyEnv(invalidIdentityTypePath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_IDENTITY_TYPE: "rsa",
      ICPDB_IDENTITY_JSON: identityJson
    });
    await assertAsyncFailure(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: invalidIdentityTypePath }),
      /ICPDB_IDENTITY_TYPE must be auto, ed25519, or secp256k1/,
      "readiness self-test should reject invalid ICPDB_IDENTITY_TYPE"
    );
    const openIdentitySecretPath = join(tempDir, "open-service-identity.json");
    await writeFile(openIdentitySecretPath, identityJson, { mode: 0o644 });
    await chmod(openIdentitySecretPath, 0o644);
    const openIdentitySecretEnvPath = join(tempDir, "open-service-identity.env");
    await writeOwnerOnlyEnv(openIdentitySecretEnvPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON_FILE: openIdentitySecretPath
    });
    const openIdentitySecret = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: openIdentitySecretEnvPath
    });
    if (
      openIdentitySecret.ready ||
      openIdentitySecret.checks.service_env_identity ||
      openIdentitySecret.service_env.identity_secret_owner_only ||
      !openIdentitySecret.next_steps.some((step) => step.includes("service identity file"))
    ) {
      throw new Error("readiness self-test failed for non-owner-only service identity file");
    }
    const openControllerSecretEnvPath = join(tempDir, "open-controller-identity.env");
    await writeOwnerOnlyEnv(openControllerSecretEnvPath, {
      ICPDB_CANISTER_ID: canisterId,
      ICPDB_NETWORK_URL: MAINNET_NETWORK_URL,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON_FILE: openIdentitySecretPath
    });
    const openControllerSecret = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: noIdentityPath,
      controllerEnvFile: openControllerSecretEnvPath
    });
    if (
      openControllerSecret.ready ||
      openControllerSecret.checks.controller_env_identity ||
      openControllerSecret.controller_env.identity_secret_owner_only ||
      !openControllerSecret.next_steps.some((step) => step.includes("controller identity file")) ||
      !openControllerSecret.next_steps.some((step) => step.includes("Move or remove the existing controller.env before running --env-out controller env generation commands"))
    ) {
      throw new Error("readiness self-test failed for non-owner-only controller identity file");
    }

    const missingEnv = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: join(tempDir, "missing.env"),
      controllerEnvFile: join(tempDir, "missing-controller.env")
    });
    if (
      missingEnv.ready ||
      missingEnv.checks.service_env_file ||
      missingEnv.checks.controller_env_file ||
      !missingEnv.next_steps.some((step) => step.includes("Run mainnet_preflight_command before mainnet SQL/archive smoke")) ||
      !missingEnv.next_steps.some((step) => step.includes("If this is a first deploy and the explicit canister id is not live yet, run deploy_mainnet before mainnet_wiring_check_command; skip deploy_mainnet only when the canister is already deployed.")) ||
      !missingEnv.next_steps.some((step) => step.includes("Run mainnet_wiring_check_command before mainnet SQL/archive smoke")) ||
      !missingEnv.next_steps.some((step) => step.includes("Run local_postdeploy_sql_archive_smoke_command before the external mainnet SQL/archive gate")) ||
      !missingEnv.next_steps.some((step) => step.includes("Run mainnet_sql_smoke_command after wiring")) ||
      !missingEnv.next_steps.some((step) => step.includes("Run mainnet_sql_archive_restore_command after SQL smoke")) ||
      !missingEnv.next_steps.some((step) => step.includes("Create an owner-only service.env")) ||
      !missingEnv.next_steps.some((step) => step.includes("Create an owner-only controller.env"))
    ) {
      throw new Error("readiness self-test failed for missing service env");
    }
    const knownCanisterDeployStep = "If this is a first deploy and the explicit canister id is not live yet, run deploy_mainnet before mainnet_wiring_check_command; skip deploy_mainnet only when the canister is already deployed.";
    if (
      !formatGoalReadinessEnv(missingEnv).includes(knownCanisterDeployStep) ||
      !formatGoalReadinessEnv(missingEnv).includes('ICPDB_GOAL_COMPLETION_PLAN_2_REQUIREMENT="conditional"') ||
      !formatGoalReadinessEnv(missingEnv).includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_1_REQUIREMENT="conditional"') ||
      !formatGoalReadinessTable(missingEnv).includes(knownCanisterDeployStep) ||
      !formatGoalReadinessTable(missingEnv).includes("deploy_mainnet\tconditional\tunblocked\tapproval_required=true\texternal_action=mainnet_deploy")
    ) {
      throw new Error("readiness self-test failed to render known-canister deploy sequencing in env/table output");
    }
    const missingMainnet = await goalReadiness({
      ignoreMainnetMapping: true,
      serviceEnvFile: join(tempDir, "missing-mainnet.env"),
      controllerEnvFile: join(tempDir, "missing-mainnet-controller.env")
    });
    if (
      missingMainnet.mainnet_wiring_check_command !== `node scripts/icpdb-mainnet-postdeploy.mjs --skip-call --require-canister-id --canister-id ${shellArg("<id>")}` ||
      !missingMainnet.next_steps.some((step) => step.includes("mainnet_deploy_command")) ||
      !missingMainnet.next_steps.some((step) => step.includes("local_postdeploy_sql_archive_smoke_command")) ||
      !missingMainnet.next_steps.some((step) => step.includes("quoted '<id>' placeholder")) ||
      !missingMainnet.next_steps.some((step) => step.includes("run service_env_provision_command")) ||
      !missingMainnet.next_steps.some((step) => step.includes("browser_ii_service_env_generate_command")) ||
      !missingMainnet.next_steps.some((step) => step.includes("copy the console Response sidebar Connection URL")) ||
      !missingMainnet.next_steps.some((step) => step.includes("run controller_env_generate_command")) ||
      !missingMainnet.next_steps.some((step) => step.includes("Do not create database bearer tokens for goal completion")) ||
      !missingMainnet.service_env_provision_command?.includes(`--canister-id ${shellArg("<id>")}`) ||
      !missingMainnet.service_env_query_only_generate_command?.includes(`--canister-id ${shellArg("<id>")}`) ||
      !missingMainnet.service_env_query_only_scalar_command?.includes("SELECT 1 AS value") ||
      !missingMainnet.existing_db_service_env_command?.includes("--service-env-file 'owner.env'") ||
      !missingMainnet.browser_ii_service_env_generate_command?.includes(`--canister-id ${shellArg("<id>")}`) ||
      !missingMainnet.browser_ii_service_grant_step?.includes("Browser/II and Server/CI principals stay different") ||
      !missingMainnet.browser_ii_service_env_steps?.some((step) => step.includes(`--canister-id ${shellArg("<id>")}`)) ||
      !missingMainnet.controller_env_generate_command?.includes(`--canister-id ${shellArg("<id>")}`) ||
      !missingMainnet.controller_shard_smoke_command?.includes("--smoke-sdk-shards") ||
      !missingMainnet.controller_env_setup_steps?.some((step) => step.includes(`--canister-id ${shellArg("<id>")}`)) ||
      !missingMainnet.next_steps.some((step) => step.includes("Run mainnet_preflight_command before deploy")) ||
      !missingMainnet.completion_plan.some((step) => step.id === "verify_mainnet_preflight" && step.required === true && step.approval_required === false && step.external_action === "none" && step.command === missingMainnet.mainnet_preflight_command) ||
      !missingMainnet.completion_plan.some((step) => step.id === "deploy_mainnet" && step.required === true && step.approval_required === true && step.external_action === "mainnet_deploy") ||
      !missingMainnet.completion_plan.some((step) => step.id === "verify_mainnet_wiring" && step.blocked_by.includes("mainnet_canister_id")) ||
      !missingMainnet.completion_plan.some((step) => step.id === "verify_mainnet_sql_smoke" && step.blocked_by.includes("mainnet_canister_id") && step.approval_required === true && step.external_action === "mainnet_sql_mutation") ||
      !missingMainnet.completion_plan.some((step) => step.id === "verify_mainnet_sql_archive_restore" && step.blocked_by.includes("mainnet_canister_id") && step.approval_required === true && step.external_action === "mainnet_sql_archive_restore_mutation") ||
      missingMainnet.approval_required_actions.length !== 10 ||
      !missingMainnet.approval_required_actions.some((action) => action.id === "deploy_mainnet" && action.external_action === "mainnet_deploy" && action.blocked_by.length === 0 && action.items.includes("icp deploy -e ic -y icpdb")) ||
      !missingMainnet.approval_required_actions.some((action) => action.id === "verify_mainnet_sql_smoke" && action.external_action === "mainnet_sql_mutation" && action.blocked_by.includes("mainnet_canister_id") && action.items.includes(missingMainnet.mainnet_sql_smoke_command)) ||
      !missingMainnet.approval_required_actions.some((action) => action.id === "provision_owner_service_env_new_db" && action.choice_group === "provision_owner_service_env" && action.choice_required === true) ||
      !missingMainnet.approval_required_actions.some((action) => action.id === "provision_controller_env" && action.external_action === "mainnet_controller_grant" && action.blocked_by.includes("canister_controller_identity") && action.items.some((item) => item.includes("settings update"))) ||
      !missingMainnet.approval_required_actions.every((action) => action.id !== "verify_mainnet_wiring") ||
      !missingMainnet.missing_evidence.some((item) => item.id === "mainnet_canister_id") ||
      !missingMainnet.missing_evidence.some((item) => item.id === "service_env_file") ||
      !missingMainnet.missing_evidence.some((item) => item.id === "controller_env_file") ||
      !missingMainnet.evidence_manifest?.required_check_ids.includes("mainnet_canister_id") ||
      !missingMainnet.evidence_manifest?.missing_evidence_ids.includes("mainnet_canister_id") ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "sdk_package_artifact" && item.command === "node icpdb-console/scripts/check-sdk-package-artifact.mjs") ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "sdk_shortest_local" && item.command === missingMainnet.local_sdk_shortest_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "sdk_browser_shortest_local" && item.command === missingMainnet.local_sdk_browser_shortest_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "sdk_sqlite_shortest_local" && item.command === missingMainnet.local_sdk_sqlite_shortest_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "sdk_libsql_shortest_local" && item.command === missingMainnet.local_sdk_libsql_shortest_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "service_env_query_only_local" && item.command === missingMainnet.local_service_env_query_only_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "console_shortest_local" && item.command === missingMainnet.local_console_shortest_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "local_postdeploy_sql_archive_smoke" && item.command === missingMainnet.local_postdeploy_sql_archive_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "mainnet_preflight" && item.command === missingMainnet.mainnet_preflight_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "mainnet_sql_smoke" && item.command === missingMainnet.mainnet_sql_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "service_env_full_smoke" && item.command === missingMainnet.service_env_full_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "service_env_direct_archive_restore" && item.command.includes(missingMainnet.service_env_archive_command) && item.command.includes(missingMainnet.service_env_restore_command)) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "controller_env_full_shard_smoke" && item.command === missingMainnet.controller_env_full_shard_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "controller_env_shard_dry_run" && item.command === missingMainnet.controller_shard_maintain_dry_run_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "browser_ii_service_grant_manual" && item.command === missingMainnet.browser_ii_service_grant_step) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "browser_ii_service_acl_handoff" && item.command === missingMainnet.browser_ii_service_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "local_browser_smoke" && item.command === missingMainnet.local_browser_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "local_ii_browser_smoke" && item.command === missingMainnet.local_ii_browser_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "local_owner_service_env_smoke" && item.command === missingMainnet.local_owner_service_env_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "local_identity_quickstart_smoke" && item.command === missingMainnet.local_identity_quickstart_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "local_owner_service_env_backup_smoke" && item.command === missingMainnet.local_owner_service_env_backup_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "local_controller_quickstart_smoke" && item.command === missingMainnet.local_controller_quickstart_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "local_shards_smoke" && item.command === missingMainnet.local_shards_smoke_command) ||
      !missingMainnet.evidence_manifest?.commands.some((item) => item.id === "goal_complete_gate" && item.command === missingMainnet.completion_command)
    ) {
      throw new Error("readiness self-test failed for missing mainnet command hints");
    }
    const missingMainnetEnv = formatGoalReadinessEnv(missingMainnet);
    if (
      !missingMainnetEnv.includes('ICPDB_GOAL_READY="false"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_MAINNET_CANISTER_ID_SOURCE="missing"') ||
      !missingMainnetEnv.includes("ICPDB_GOAL_MISSING_EVIDENCE_IDS=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_MAINNET_PREFLIGHT_COMMAND=\"node scripts/icpdb-mainnet-preflight.mjs\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_MAINNET_SQL_ARCHIVE_RESTORE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_LOCAL_POSTDEPLOY_SQL_ARCHIVE_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("--smoke-archive-restore") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_GENERATE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_SCALAR_COMMAND=") ||
      !missingMainnetEnv.includes("SELECT 1 AS value") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_CREATE_TABLE_COMMAND=") ||
      !missingMainnetEnv.includes("CREATE TABLE readiness_query_only") ||
      !missingMainnetEnv.includes("readiness-query-only-create-table-001") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_WRITE_COMMAND=") ||
      !missingMainnetEnv.includes("readiness-query-only-write-001") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_READ_COMMAND=") ||
      !missingMainnetEnv.includes("SELECT body FROM readiness_query_only") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_URL_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_INFO_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_OWNER_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_INSPECT_ENV_COMMAND=") ||
      !missingMainnetEnv.includes("inspect-env --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_MEMBERS_COMMAND=") ||
      !missingMainnetEnv.includes("members --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_SCALAR_COMMAND=") ||
      !missingMainnetEnv.includes("scalar --service-env-file") ||
      !missingMainnetEnv.includes("SELECT count(*) FROM notes") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_COLUMNS_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_DESCRIBE_COMMAND=") ||
      !missingMainnetEnv.includes("describe --service-env-file") ||
      !missingMainnetEnv.includes("columns --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_PREVIEW_COMMAND=") ||
      !missingMainnetEnv.includes("preview --service-env-file") ||
      !missingMainnetEnv.includes("--limit 25") ||
      !missingMainnetEnv.includes("'notes' --format table") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_INFO_COMMAND=") ||
      !missingMainnetEnv.includes("info --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_OWNER_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_INSPECT_ENV_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_MEMBERS_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_SCALAR_COMMAND=") ||
      !missingMainnetEnv.includes("SELECT count(*) FROM sqlite_schema") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_COLUMNS_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_DESCRIBE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_PREVIEW_COMMAND=") ||
      !missingMainnetEnv.includes("'<table>' --format table") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_INFO_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_OWNER_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_OWNER_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("--require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_ARCHIVE_COMMAND=") ||
      !missingMainnetEnv.includes("icpdb archive --service-env-file") ||
      !missingMainnetEnv.includes("'./readiness-backup.sqlite' --format env") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_SNAPSHOT_INFO_COMMAND=") ||
      !missingMainnetEnv.includes("icpdb snapshot-info './readiness-backup.sqlite' --format env") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_RESTORE_COMMAND=") ||
      !missingMainnetEnv.includes("icpdb restore --service-env-file") ||
      !missingMainnetEnv.includes("'./readiness-backup.sqlite' --expect-snapshot-hash") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_PRINCIPAL_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_GRANT_STEP=") ||
      !missingMainnetEnv.includes("Copy the console Response sidebar Connection URL") ||
      !missingMainnetEnv.includes("grant the printed service principal as owner") ||
      !missingMainnetEnv.includes("Browser/II and Server/CI principals stay different and are joined through the DB ACL") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_MEMBERS_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_DESCRIBE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_PREVIEW_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_INFO_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_LOCAL_SDK_SHORTEST_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_LOCAL_SDK_SQLITE_SHORTEST_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_LOCAL_SDK_LIBSQL_SHORTEST_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_LOCAL_CONSOLE_SHORTEST_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_SERVICE_ENV_FULL_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("--smoke-sdk-archive-restore") ||
      !missingMainnetEnv.includes("--smoke-archive-restore") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_ENV_INSPECT_COMMAND=") ||
      !missingMainnetEnv.includes("inspect-env --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_ALL_PLACEMENTS_COMMAND=") ||
      !missingMainnetEnv.includes("all-placements --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARDS_COMMAND=") ||
      !missingMainnetEnv.includes("shards --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_OPS_COMMAND=") ||
      !missingMainnetEnv.includes("shard-ops --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_MAINTAIN_DRY_RUN_COMMAND=") ||
      !missingMainnetEnv.includes("shard-maintain 0 0 0 0 0 0 --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("--smoke-shards") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_CREATE_COMMAND=") ||
      !missingMainnetEnv.includes("shard-create 100000000000 8 --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_REGISTER_COMMAND=") ||
      !missingMainnetEnv.includes("shard-register '<database-canister-id>' 8 --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_STATUS_COMMAND=") ||
      !missingMainnetEnv.includes("shard-status '<database-canister-id>' --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_TOP_UP_COMMAND=") ||
      !missingMainnetEnv.includes("shard-top-up '<database-canister-id>' 1000000 --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_MAINTAIN_CREATE_COMMAND=") ||
      !missingMainnetEnv.includes("shard-maintain 1 0 0 0 8 0 --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_MIGRATE_COMMAND=") ||
      !missingMainnetEnv.includes("shard-migrate '<database-id>' '<database-canister-id>' --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_REMOTE_CREATE_DB_COMMAND=") ||
      !missingMainnetEnv.includes("remote-create-db '<database-id>' '<database-canister-id>' --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_RECONCILE_APPLIED_COMMAND=") ||
      !missingMainnetEnv.includes("shard-reconcile '<operation-id>' applied --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_RECONCILE_FAILED_COMMAND=") ||
      !missingMainnetEnv.includes("shard-reconcile '<operation-id>' failed 'operator verified failure' --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_FULL_SHARD_SMOKE_COMMAND=") ||
      !missingMainnetEnv.includes("--smoke-sdk-shards") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CONTROLLER_HEALTH_COMMAND=") ||
      !missingMainnetEnv.includes("health --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_MANIFEST_VERSION=\"1\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_COUNT=\"27\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_REQUIRED_CHECK_IDS=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_MISSING_IDS=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_1_ID=\"sdk_package_artifact\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_1_COMMAND=\"node icpdb-console/scripts/check-sdk-package-artifact.mjs\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_3_ID=\"sdk_shortest_local\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_4_ID=\"sdk_browser_shortest_local\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_4_COMMAND=\"node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-browser-shortest --skip-top-up\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_5_ID=\"sdk_sqlite_shortest_local\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_6_ID=\"sdk_libsql_shortest_local\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_7_ID=\"service_env_query_only_local\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_8_ID=\"console_shortest_local\"") ||
      !missingMainnetEnv.includes("console-shortest --skip-top-up") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_9_ID=\"local_postdeploy_sql_archive_smoke\"") ||
      !missingMainnetEnv.includes("postdeploy-sql-archive --skip-top-up") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_10_ID=\"mainnet_preflight\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_10_COMMAND=\"node scripts/icpdb-mainnet-preflight.mjs\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_10_EXPECTED=\"preflight runs Candid drift, builds control/database Wasm artifacts, and reports size plus SHA-256 without creating or upgrading a mainnet canister\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_12_ID=\"mainnet_sql_smoke\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_14_ID=\"service_env_full_smoke\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_15_ID=\"service_env_direct_archive_restore\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_15_COMMAND=") ||
      !missingMainnetEnv.includes("icpdb archive --service-env-file") ||
      !missingMainnetEnv.includes("icpdb restore --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_16_ID=\"controller_env_full_shard_smoke\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_17_ID=\"controller_env_shard_dry_run\"") ||
      !missingMainnetEnv.includes("shard-maintain 0 0 0 0 0 0 --service-env-file") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_18_ID=\"browser_ii_service_grant_manual\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_18_COMMAND=\"Copy the console Response sidebar Connection URL") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_19_ID=\"browser_ii_service_acl_handoff\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_19_COMMAND=\"icpdb check-env") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_20_ID=\"local_browser_smoke\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_20_COMMAND=\"node scripts/icpdb-local-goal-smoke.mjs --only browser --skip-top-up\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_21_ID=\"local_ii_browser_smoke\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_21_COMMAND=\"node scripts/icpdb-local-goal-smoke.mjs --only ii-browser --skip-top-up\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_22_ID=\"local_owner_service_env_smoke\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_22_COMMAND=\"node scripts/icpdb-local-goal-smoke.mjs --only service-owner --skip-top-up\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_23_ID=\"local_identity_quickstart_smoke\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_23_COMMAND=\"node scripts/icpdb-local-goal-smoke.mjs --only identity-quickstart --skip-top-up\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_24_ID=\"local_owner_service_env_backup_smoke\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_24_COMMAND=\"node scripts/icpdb-local-goal-smoke.mjs --only service-owner-backup --skip-top-up\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_25_ID=\"local_controller_quickstart_smoke\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_25_COMMAND=\"node scripts/icpdb-local-goal-smoke.mjs --only controller-quickstart --skip-top-up\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_26_ID=\"local_shards_smoke\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_26_COMMAND=\"node scripts/icpdb-local-goal-smoke.mjs --only shards --skip-top-up\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_EVIDENCE_COMMAND_27_ID=\"goal_complete_gate\"") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_NEXT_STEP_COUNT=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_NEXT_STEP_1=") ||
      !missingMainnetEnv.includes("Do not create database bearer tokens for goal completion") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_COMPLETION_PLAN_COUNT=") ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_COUNT="10"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_1_ID="deploy_mainnet"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_1_EXTERNAL_ACTION="mainnet_deploy"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_1_BLOCKED_BY="unblocked"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_1_ITEM_COUNT="1"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_1_ITEM_1_KIND="command"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_1_ITEM_1="icp deploy -e ic -y icpdb"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_2_ID="verify_mainnet_sql_smoke"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_2_EXTERNAL_ACTION="mainnet_sql_mutation"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_2_ITEM_COUNT="1"') ||
      !missingMainnetEnv.includes("ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_2_ITEM_1=") ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_4_CHOICE_GROUP="provision_owner_service_env"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_4_CHOICE_REQUIRED="true"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_7_ITEM_4_KIND="manual"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_10_ID="complete_goal_gate"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_10_EXTERNAL_ACTION="mainnet_goal_completion_gate"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_10_ITEM_COUNT="1"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_1_ID="verify_mainnet_preflight"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_1_REQUIREMENT="required"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_1_BLOCKED_BY="unblocked"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_1_APPROVAL_REQUIRED="false"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_1_EXTERNAL_ACTION="none"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_1_ITEM_COUNT="1"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_1_ITEM_1_KIND="command"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_1_ITEM_1="node scripts/icpdb-mainnet-preflight.mjs"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_2_ID="deploy_mainnet"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_2_EXTERNAL_ACTION="mainnet_deploy"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_4_ID="verify_mainnet_sql_smoke"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_4_APPROVAL_REQUIRED="true"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_4_EXTERNAL_ACTION="mainnet_sql_mutation"') ||
      !missingMainnetEnv.includes("ICPDB_GOAL_COMPLETION_PLAN_4_ITEM_1=") ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_5_ID="verify_mainnet_sql_archive_restore"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_5_APPROVAL_REQUIRED="true"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_5_EXTERNAL_ACTION="mainnet_sql_archive_restore_mutation"') ||
      !missingMainnetEnv.includes("ICPDB_GOAL_COMPLETION_PLAN_5_ITEM_1=") ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_6_CHOICE_GROUP="provision_owner_service_env"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_6_CHOICE_REQUIRED="true"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_6_BLOCKED_BY="mainnet_canister_id"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_6_APPROVAL_REQUIRED="true"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_6_EXTERNAL_ACTION="mainnet_service_env_db_create"') ||
      !missingMainnetEnv.includes("ICPDB_GOAL_COMPLETION_PLAN_9_ITEM_4_KIND=\"manual\"") ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_10_ID="verify_owner_service_env_package_smoke"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_10_REQUIREMENT="required"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_10_APPROVAL_REQUIRED="true"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_10_EXTERNAL_ACTION="mainnet_service_env_sql_archive_restore_mutation"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_10_ITEM_COUNT="3"') ||
      !missingMainnetEnv.includes("ICPDB_GOAL_COMPLETION_PLAN_10_ITEM_1=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_COMPLETION_PLAN_10_ITEM_2=") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_COMPLETION_PLAN_10_ITEM_3=") ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_12_ID="complete_goal_gate"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_12_APPROVAL_REQUIRED="true"') ||
      !missingMainnetEnv.includes('ICPDB_GOAL_COMPLETION_PLAN_12_EXTERNAL_ACTION="mainnet_goal_completion_gate"') ||
      !missingMainnetEnv.includes("ICPDB_GOAL_COMPLETION_PLAN_12_ITEM_1=") ||
      !missingMainnetEnv.includes("mainnet_canister_id") ||
      !missingMainnetEnv.includes("ICPDB_GOAL_CHECK_MAINNET_CANISTER_ID=\"false\"")
    ) {
      throw new Error("readiness self-test failed for env output");
    }
    const missingMainnetTable = formatGoalReadinessTable(missingMainnet);
    const requiredTableOutput = [
      "ready\tfalse",
      "missing_evidence\tmainnet_canister_id",
      "mainnet_deploy_command\ticp deploy -e ic -y icpdb",
      "mainnet_preflight_command\tnode scripts/icpdb-mainnet-preflight.mjs",
      "mainnet_wiring_check_command\tnode scripts/icpdb-mainnet-postdeploy.mjs --skip-call --require-canister-id --canister-id '<id>'",
      "mainnet_sql_smoke_command\tnode scripts/icpdb-mainnet-postdeploy.mjs --require-canister-id --canister-id '<id>' --smoke-sql",
      "mainnet_sql_archive_restore_command\tnode scripts/icpdb-mainnet-postdeploy.mjs --require-canister-id --canister-id '<id>' --smoke-sql --smoke-archive-restore",
      "local_postdeploy_sql_archive_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only postdeploy-sql-archive --skip-top-up",
      "Evidence manifest:",
      "version\t1",
      "required_check_ids\tmainnet_canister_id",
      "missing_evidence_ids\tmainnet_canister_id",
      "sdk_package_artifact\tSDK package can be installed and used as a normal SQL DB client",
      "sdk_package_artifact.command\tnode icpdb-console/scripts/check-sdk-package-artifact.mjs",
      "sdk_shortest_local\tfocused SDK create-to-query/execute shortest path",
      "sdk_shortest_local.command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-shortest --skip-top-up",
      "sdk_browser_shortest_local\tfocused browser SDK package subpath shortest path",
      "sdk_browser_shortest_local.command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-browser-shortest --skip-top-up",
      "sdk_sqlite_shortest_local\tfocused hosted SQLite subpath shortest path",
      "sdk_sqlite_shortest_local.command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-sqlite-shortest --skip-top-up",
      "sdk_libsql_shortest_local\tfocused libSQL-shaped shortest path",
      "sdk_libsql_shortest_local.command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-libsql-shortest --skip-top-up",
      "service_env_query_only_local\tfocused Server/CI service.env query-only first-call path",
      "service_env_query_only_local.command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,service-query-only --skip-top-up",
      "console_shortest_local\tfocused console schema/table/SQL inspection path",
      "console_shortest_local.command\tnode scripts/icpdb-local-goal-smoke.mjs --only console-shortest --skip-top-up",
      "local_postdeploy_sql_archive_smoke\tlocal postdeploy SQL/archive rehearsal",
      "local_postdeploy_sql_archive_smoke.command\tnode scripts/icpdb-local-goal-smoke.mjs --only postdeploy-sql-archive --skip-top-up",
      "mainnet_preflight\tmainnet release artifact preflight",
      "mainnet_preflight.command\tnode scripts/icpdb-mainnet-preflight.mjs",
      "mainnet_preflight.expected\tpreflight runs Candid drift, builds control/database Wasm artifacts, and reports size plus SHA-256 without creating or upgrading a mainnet canister",
      "mainnet_sql_smoke.command\tnode scripts/icpdb-mainnet-postdeploy.mjs --require-canister-id --canister-id '<id>' --smoke-sql",
      "service_env_full_smoke.command\tnode scripts/icpdb-service-env-check.mjs",
      "controller_env_full_shard_smoke.command\tnode scripts/icpdb-service-env-check.mjs",
      "service_env_direct_archive_restore\tdirect Server/CI archive, snapshot-info, and hash-pinned restore operator path",
      "service_env_direct_archive_restore.command\ticpdb archive --service-env-file ",
      "controller_env_shard_dry_run\tsafe controller.env shard operation preflight",
      "controller_env_shard_dry_run.command\ticpdb shard-maintain 0 0 0 0 0 0 --service-env-file ",
      "browser_ii_service_grant_manual\tBrowser/II-owned DB manual ACL grant for Server/CI service identity",
      "browser_ii_service_grant_manual.command\tCopy the console Response sidebar Connection URL",
      "browser_ii_service_acl_handoff\tBrowser/II-owned DB service-principal ACL handoff proof",
      "browser_ii_service_acl_handoff.command\ticpdb check-env",
      "local_browser_smoke\tlocal owner-token browser SQL, token, permission, archive, and shard proof",
      "local_browser_smoke.command\tnode scripts/icpdb-local-goal-smoke.mjs --only browser --skip-top-up",
      "local_ii_browser_smoke\tlocal Browser/II login and owner workflow proof",
      "local_ii_browser_smoke.command\tnode scripts/icpdb-local-goal-smoke.mjs --only ii-browser --skip-top-up",
      "local_owner_service_env_smoke\tfocused package init owner service.env SQL/setup proof",
      "local_owner_service_env_smoke.command\tnode scripts/icpdb-local-goal-smoke.mjs --only service-owner --skip-top-up",
      "local_identity_quickstart_smoke\tfocused Server/CI identity quickstart proof",
      "local_identity_quickstart_smoke.command\tnode scripts/icpdb-local-goal-smoke.mjs --only identity-quickstart --skip-top-up",
      "local_owner_service_env_backup_smoke\tfocused package owner service.env archive/restore proof",
      "local_owner_service_env_backup_smoke.command\tnode scripts/icpdb-local-goal-smoke.mjs --only service-owner-backup --skip-top-up",
      "local_controller_quickstart_smoke\tfocused controller identity and shard preflight proof",
      "local_controller_quickstart_smoke.command\tnode scripts/icpdb-local-goal-smoke.mjs --only controller-quickstart --skip-top-up",
      "local_shards_smoke\tfocused multi-canister shard operation proof",
      "local_shards_smoke.command\tnode scripts/icpdb-local-goal-smoke.mjs --only shards --skip-top-up",
      "goal_complete_gate.command\tnode scripts/icpdb-release-check.mjs --goal-complete",
      "service_env_provision_command\ticpdb init --canister-id '<id>'",
      "service_env_query_only_generate_command\ticpdb generate-identity --canister-id '<id>' --network-url 'https://icp-api.io'",
      "service_env_query_only_scalar_command\ticpdb scalar",
      "'SELECT 1 AS value' --format table",
      "service_env_query_only_create_table_command\ticpdb execute",
      "CREATE TABLE readiness_query_only",
      "readiness-query-only-create-table-001",
      "service_env_query_only_write_command\ticpdb execute",
      "readiness-query-only-write-001",
      "service_env_query_only_read_command\ticpdb query",
      "SELECT body FROM readiness_query_only",
      "service_env_query_only_url_command\ticpdb url",
      "service_env_query_only_info_command\ticpdb info",
      "service_env_query_only_owner_smoke_command\ticpdb check-env",
      "service_env_provision_inspect_env_command\ticpdb inspect-env",
      " inspect-env --service-env-file ",
      "service_env_provision_status_command\ticpdb status",
      "service_env_provision_members_command\ticpdb members",
      " members --service-env-file ",
      "service_env_provision_scalar_command\ticpdb scalar",
      " scalar --service-env-file ",
      " 'SELECT count(*) FROM notes' --format table",
      "service_env_provision_tables_command\ticpdb tables",
      "service_env_provision_views_command\ticpdb views",
      "service_env_provision_stats_command\ticpdb stats",
      "service_env_provision_schema_command\ticpdb schema",
      " schema --service-env-file ",
      "service_env_provision_describe_command\ticpdb describe",
      " describe --service-env-file ",
      "service_env_provision_columns_command\ticpdb columns",
      " columns --service-env-file ",
      "service_env_provision_indexes_command\ticpdb indexes",
      " indexes --service-env-file ",
      "service_env_provision_triggers_command\ticpdb triggers",
      " triggers --service-env-file ",
      "service_env_provision_foreign_keys_command\ticpdb foreign-keys",
      " foreign-keys --service-env-file ",
      "service_env_provision_preview_command\ticpdb preview",
      " preview --service-env-file ",
      "--limit 25",
      "service_env_provision_inspect_command\ticpdb inspect",
      " inspect --service-env-file ",
      "service_env_provision_info_command\ticpdb info",
      " info --service-env-file ",
      "service_env_provision_sql_write_command\ticpdb sql",
      "readiness-notes-sql-write-001",
      "service_env_provision_sql_read_command\ticpdb sql",
      "SELECT id, body FROM notes ORDER BY id DESC",
      "service_env_provision_owner_smoke_command\ticpdb check-env",
      "existing_db_service_env_command\ticpdb provision-service '<database-id>' owner --service-env-file 'owner.env' --env-out ",
      "existing_db_service_env_inspect_env_command\ticpdb inspect-env",
      "existing_db_service_env_status_command\ticpdb status",
      "existing_db_service_env_members_command\ticpdb members",
      " members --service-env-file ",
      "existing_db_service_env_scalar_command\ticpdb scalar",
      " 'SELECT count(*) FROM sqlite_schema' --format table",
      "existing_db_service_env_tables_command\ticpdb tables",
      "existing_db_service_env_views_command\ticpdb views",
      "existing_db_service_env_schema_command\ticpdb schema",
      " '<table>' --format table",
      "existing_db_service_env_describe_command\ticpdb describe",
      " describe --service-env-file ",
      "existing_db_service_env_columns_command\ticpdb columns",
      " columns --service-env-file ",
      "existing_db_service_env_indexes_command\ticpdb indexes",
      " indexes --service-env-file ",
      "existing_db_service_env_triggers_command\ticpdb triggers",
      " triggers --service-env-file ",
      "existing_db_service_env_foreign_keys_command\ticpdb foreign-keys",
      " foreign-keys --service-env-file ",
      "existing_db_service_env_preview_command\ticpdb preview",
      " preview --service-env-file ",
      "existing_db_service_env_inspect_command\ticpdb inspect",
      " inspect --service-env-file ",
      "existing_db_service_env_info_command\ticpdb info",
      "existing_db_service_env_stats_command\ticpdb stats",
      "existing_db_service_env_sql_read_command\ticpdb sql",
      "existing_db_service_env_owner_smoke_command\ticpdb check-env",
      "service_env_archive_command\ticpdb archive --service-env-file ",
      "'./readiness-backup.sqlite' --format env",
      "service_env_snapshot_info_command\ticpdb snapshot-info './readiness-backup.sqlite' --format env",
      "service_env_restore_command\teval \"$(icpdb snapshot-info './readiness-backup.sqlite' --format env)\" && icpdb restore --service-env-file ",
      "'./readiness-backup.sqlite' --expect-snapshot-hash \"$ICPDB_SNAPSHOT_HASH\" --format table",
      "local_owner_service_env_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only service-owner --skip-top-up",
      "local_owner_service_env_backup_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only service-owner-backup --skip-top-up",
      "local_identity_quickstart_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only identity-quickstart --skip-top-up",
      "local_service_env_query_only_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,service-query-only --skip-top-up",
      "local_sdk_shortest_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-shortest --skip-top-up",
      "local_sdk_browser_shortest_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-browser-shortest --skip-top-up",
      "local_sdk_sqlite_shortest_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-sqlite-shortest --skip-top-up",
      "local_sdk_libsql_shortest_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-libsql-shortest --skip-top-up",
      "local_console_shortest_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only console-shortest --skip-top-up",
      "local_controller_quickstart_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only controller-quickstart --skip-top-up",
      "local_shards_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only shards --skip-top-up",
      "local_browser_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only browser --skip-top-up",
      "local_ii_browser_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only ii-browser --skip-top-up",
      "service_env_full_smoke_command\tnode scripts/icpdb-service-env-check.mjs",
      "--smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
      "browser_ii_service_env_generate_command\ticpdb generate-identity --canister-id '<id>' --database-id '<database-id>'",
      "--env-out ",
      " --format table",
      "browser_ii_service_grant_step\tCopy the console Response sidebar Connection URL",
      "grant the printed service principal as owner",
      "Browser/II and Server/CI principals stay different and are joined through the DB ACL",
      "browser_ii_service_members_command\ticpdb members",
      "browser_ii_service_stats_command\ticpdb stats",
      " members --service-env-file ",
      "browser_ii_service_describe_command\ticpdb describe",
      "browser_ii_service_preview_command\ticpdb preview",
      "browser_ii_service_info_command\ticpdb info",
      "browser_ii_service_sql_read_command\ticpdb sql",
      "browser_ii_service_smoke_command\ticpdb check-env",
      "controller_env_generate_command\ticpdb generate-identity --canister-id '<id>' --network-url 'https://icp-api.io' --env-out ",
      "controller_env_inspect_command\ticpdb inspect-env --service-env-file ",
      " inspect-env --service-env-file ",
      "controller_health_command\ticpdb health --service-env-file ",
      'controller_add_command\teval "$(icpdb principal --service-env-file ',
      "icp canister settings update -n ic",
      '--add-controller "$ICPDB_SERVICE_PRINCIPAL" -f',
      "controller_all_placements_command\ticpdb all-placements --service-env-file ",
      "controller_shards_command\ticpdb shards --service-env-file ",
      "controller_shard_ops_command\ticpdb shard-ops --service-env-file ",
      "controller_shard_maintain_dry_run_command\ticpdb shard-maintain 0 0 0 0 0 0 --service-env-file ",
      "controller_shard_smoke_command\ticpdb check-env --service-env-file ",
      " --smoke-shards --smoke-sdk-shards --format table",
      "controller_shard_create_command\ticpdb shard-create 100000000000 8 --service-env-file ",
      "controller_shard_register_command\ticpdb shard-register '<database-canister-id>' 8 --service-env-file ",
      "controller_shard_status_command\ticpdb shard-status '<database-canister-id>' --service-env-file ",
      "controller_shard_top_up_command\ticpdb shard-top-up '<database-canister-id>' 1000000 --service-env-file ",
      "controller_shard_maintain_create_command\ticpdb shard-maintain 1 0 0 0 8 0 --service-env-file ",
      "controller_shard_migrate_command\ticpdb shard-migrate '<database-id>' '<database-canister-id>' --service-env-file ",
      "controller_remote_create_db_command\ticpdb remote-create-db '<database-id>' '<database-canister-id>' --service-env-file ",
      "controller_shard_reconcile_applied_command\ticpdb shard-reconcile '<operation-id>' applied --service-env-file ",
      "controller_shard_reconcile_failed_command\ticpdb shard-reconcile '<operation-id>' failed 'operator verified failure' --service-env-file ",
      "controller_full_shard_smoke_command\tnode scripts/icpdb-service-env-check.mjs --env-file ",
      "--smoke-shards --smoke-sdk-shards --format table",
      "Checks:",
      "check.mainnet_canister_id\tmissing",
      "Completion plan:",
      "verify_mainnet_preflight\trequired\tunblocked\tapproval_required=false\texternal_action=none",
      "verify_mainnet_preflight\trequired\tunblocked\tapproval_required=false\texternal_action=none\tchoice_group=none\tchoice_required=none",
      "verify_mainnet_preflight.command\tnode scripts/icpdb-mainnet-preflight.mjs",
      "deploy_mainnet\trequired\tunblocked\tapproval_required=true\texternal_action=mainnet_deploy",
      "deploy_mainnet\trequired\tunblocked\tapproval_required=true\texternal_action=mainnet_deploy\tchoice_group=none\tchoice_required=none",
      "verify_mainnet_sql_smoke\trequired\tblocked_by=mainnet_canister_id",
      "verify_mainnet_sql_smoke\trequired\tblocked_by=mainnet_canister_id\tapproval_required=true\texternal_action=mainnet_sql_mutation",
      "verify_mainnet_sql_smoke\trequired\tblocked_by=mainnet_canister_id\tapproval_required=true\texternal_action=mainnet_sql_mutation\tchoice_group=none\tchoice_required=none",
      "verify_mainnet_sql_smoke.command\tnode scripts/icpdb-mainnet-postdeploy.mjs",
      "verify_mainnet_sql_archive_restore\trequired\tblocked_by=mainnet_canister_id",
      "verify_mainnet_sql_archive_restore\trequired\tblocked_by=mainnet_canister_id\tapproval_required=true\texternal_action=mainnet_sql_archive_restore_mutation",
      "verify_mainnet_sql_archive_restore\trequired\tblocked_by=mainnet_canister_id\tapproval_required=true\texternal_action=mainnet_sql_archive_restore_mutation\tchoice_group=none\tchoice_required=none",
      "verify_mainnet_sql_archive_restore.command\tnode scripts/icpdb-mainnet-postdeploy.mjs",
      "service_env_owner_smoke_command\ticpdb check-env",
      "local_owner_service_env_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only service-owner --skip-top-up",
      "local_owner_service_env_backup_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only service-owner-backup --skip-top-up",
      "local_identity_quickstart_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only identity-quickstart --skip-top-up",
      "local_service_env_query_only_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only sdk-build,service-query-only --skip-top-up",
      "local_controller_quickstart_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only controller-quickstart --skip-top-up",
      "local_shards_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only shards --skip-top-up",
      "local_browser_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only browser --skip-top-up",
      "local_ii_browser_smoke_command\tnode scripts/icpdb-local-goal-smoke.mjs --only ii-browser --skip-top-up",
      "--require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
      "provision_owner_service_env_new_db\tchoice-required\tblocked_by=mainnet_canister_id",
      "provision_owner_service_env_new_db\tchoice-required\tblocked_by=mainnet_canister_id\tapproval_required=true\texternal_action=mainnet_service_env_db_create",
      "provision_owner_service_env_new_db\tchoice-required\tblocked_by=mainnet_canister_id\tapproval_required=true\texternal_action=mainnet_service_env_db_create\tchoice_group=provision_owner_service_env\tchoice_required=true",
      "provision_owner_service_env_query_only_db\tchoice-required\tblocked_by=mainnet_canister_id",
      "provision_owner_service_env_query_only_db\tchoice-required\tblocked_by=mainnet_canister_id\tapproval_required=true\texternal_action=mainnet_service_env_query_only_db_create",
      "provision_owner_service_env_query_only_db\tchoice-required\tblocked_by=mainnet_canister_id\tapproval_required=true\texternal_action=mainnet_service_env_query_only_db_create\tchoice_group=provision_owner_service_env\tchoice_required=true",
      "provision_owner_service_env_query_only_db.command.1\ticpdb generate-identity --canister-id '<id>' --network-url 'https://icp-api.io'",
      "provision_owner_service_env_query_only_db.command.2\ticpdb scalar",
      "provision_owner_service_env_query_only_db.command.3\ticpdb execute",
      "provision_owner_service_env_query_only_db.command.4\ticpdb execute",
      "provision_owner_service_env_query_only_db.command.5\ticpdb query",
      "provision_owner_service_env_query_only_db.command.6\ticpdb url",
      "provision_owner_service_env_query_only_db.command.7\ticpdb info",
      "provision_owner_service_env_query_only_db.command.8\ticpdb check-env",
      "--setup-sql 'CREATE TABLE note_groups",
      "CREATE TABLE notes",
      "notes_body_idx",
      "notes_ai",
      "notes_view",
      "provision_owner_service_env_browser_ii_db.command.1\ticpdb generate-identity --canister-id '<id>' --database-id '<database-id>' --network-url 'https://icp-api.io' --env-out ",
	      "provision_owner_service_env_browser_ii_db.manual.4\tCopy the console Response sidebar Connection URL",
	      "provision_owner_service_env_browser_ii_db.manual.4\tCopy the console Response sidebar Connection URL to identify the browser/II-owned database id, then grant the printed service principal as owner in console Permissions while logged in with the browser/II database owner; Browser/II and Server/CI principals stay different and are joined through the DB ACL.",
	      "verify_owner_service_env_package_smoke\trequired\tblocked_by=service_env_file,service_env_connection",
	      "verify_owner_service_env_package_smoke\trequired\tblocked_by=service_env_file,service_env_connection",
	      "approval_required=true\texternal_action=mainnet_service_env_sql_archive_restore_mutation",
      "Approval required actions:",
      "deploy_mainnet\trequired\tunblocked\texternal_action=mainnet_deploy\tchoice_group=none\tchoice_required=none",
      "deploy_mainnet.command.1\ticp deploy -e ic -y icpdb",
      "verify_mainnet_sql_smoke\trequired\tblocked_by=mainnet_canister_id\texternal_action=mainnet_sql_mutation\tchoice_group=none\tchoice_required=none",
      "verify_mainnet_sql_smoke.command.1\tnode scripts/icpdb-mainnet-postdeploy.mjs",
      "provision_owner_service_env_new_db\tchoice-required\tblocked_by=mainnet_canister_id\texternal_action=mainnet_service_env_db_create\tchoice_group=provision_owner_service_env\tchoice_required=true",
      "provision_controller_env\trequired\tblocked_by=mainnet_canister_id,canister_controller_identity\texternal_action=mainnet_controller_grant\tchoice_group=none\tchoice_required=none",
      "provision_controller_env.command.5\teval",
	      "verify_owner_service_env_package_smoke.command.1\ticpdb check-env",
	      "--require-role owner --smoke-sql --smoke-sdk --format table",
	      "verify_owner_service_env_package_smoke.command.2\ticpdb check-env",
	      "--require-role owner --smoke-sql --smoke-archive-restore --format table",
	      "verify_owner_service_env_package_smoke.command.3\ticpdb check-env",
	      "--require-role owner --smoke-sdk-archive-restore --format table",
	      "Next steps:",
	      "Do not create database bearer tokens for goal completion",
	      "For direct backup operation, run service_env_archive_command, service_env_snapshot_info_command, and service_env_restore_command",
	      "For direct shard operation, use controller_shard_create_command through controller_shard_reconcile_failed_command",
	      "Pass --mainnet-canister-id <id>"
	    ];
    const missingTableOutput = requiredTableOutput.filter((text) => !missingMainnetTable.includes(text));
    if (
      missingTableOutput.length > 0 ||
      missingMainnetTable.includes("schema_file") ||
      missingMainnetTable.includes(" && Grant the printed service principal")
    ) {
      throw new Error(`readiness self-test failed for table output: missing ${JSON.stringify(missingTableOutput)}`);
    }
    const defaultServiceEnv = await goalReadiness({
      serviceEnvFile: "service.env",
      controllerEnvFile: "controller.env"
    });
    const defaultServiceEnvOutput = formatGoalReadinessEnv(defaultServiceEnv);
    if (
      defaultServiceEnvOutput.includes("--env-file 'service.env'") ||
      !defaultServiceEnvOutput.includes('ICPDB_GOAL_BROWSER_II_SERVICE_PRINCIPAL_COMMAND="icpdb principal --format table"') ||
      !defaultServiceEnvOutput.includes('ICPDB_GOAL_BROWSER_II_SERVICE_STATUS_COMMAND="icpdb status --format table"') ||
      !defaultServiceEnvOutput.includes('ICPDB_GOAL_BROWSER_II_SERVICE_MEMBERS_COMMAND="icpdb members --format table"') ||
      !defaultServiceEnvOutput.includes('ICPDB_GOAL_BROWSER_II_SERVICE_SMOKE_COMMAND="icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table"')
    ) {
      throw new Error("readiness self-test failed for default service.env pathless browser/II commands");
    }
    await assertAsyncFailure(
      () => assertGoalCompleteReadiness({
        ignoreMainnetMapping: true,
        goalComplete: true,
        serviceEnvFile: join(tempDir, "missing-mainnet.env"),
        controllerEnvFile: join(tempDir, "missing-mainnet-controller.env")
      }),
      /goal-complete prerequisites are not ready[\s\S]*missing_evidence\tmainnet_canister_id[\s\S]*service_env_file[\s\S]*controller_env_file[\s\S]*complete_goal_gate\trequired\tblocked_by=mainnet_canister_id/,
      "goal-complete should fail before expensive checks when readiness prerequisites are missing"
    );

    const invalidIdentityPath = join(tempDir, "invalid-identity.env");
    await writeOwnerOnlyEnv(invalidIdentityPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_IDENTITY_JSON: "[]"
    });
    const invalidIdentity = await goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: invalidIdentityPath });
    if (invalidIdentity.ready || !invalidIdentity.checks.service_env_identity || invalidIdentity.checks.service_env_inspect) {
      throw new Error("readiness self-test failed for invalid service identity");
    }

    const validIdentityPath = join(tempDir, "valid-identity.env");
    await writeOwnerOnlyEnv(validIdentityPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson
    });
    const validControllerPath = join(tempDir, "valid-controller.env");
    await writeOwnerOnlyEnv(validControllerPath, {
      ICPDB_CANISTER_ID: canisterId,
      ICPDB_NETWORK_URL: MAINNET_NETWORK_URL,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson
    });
    const validIdentity = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: validIdentityPath,
      controllerEnvFile: validControllerPath
    });
    if (
      !validIdentity.ready ||
      !validIdentity.checks.service_env_inspect ||
      !validIdentity.checks.service_env_inspect_connection_match ||
      !validIdentity.checks.controller_env_inspect ||
      !validIdentity.checks.controller_env_inspect_connection_match ||
      !validIdentity.service_env.inspect_env?.principal ||
      !validIdentity.controller_env.inspect_env?.principal ||
      validIdentity.missing_evidence.length !== 0 ||
      !validIdentity.next_steps.some((step) => step.includes("--goal-complete"))
    ) {
      throw new Error("readiness self-test failed for valid service identity");
    }
    if (
      inspectEnvMatchesConfiguredConnection({
        status: "configured",
        canister_id: canisterId,
        database_id: databaseId,
        connection_url: `icpdb://${canisterId}/${databaseId}`,
        inspect_env: { ok: true, canister_id: canisterId, database_id: "db_other", connection_url: `icpdb://${canisterId}/db_other` }
      }) ||
      inspectEnvMatchesConfiguredConnection({
        status: "configured",
        canister_id: canisterId,
        database_id: "",
        connection_url: `icpdb://${canisterId}`,
        inspect_env: { ok: true, canister_id: canisterId, database_id: "db_unexpected", connection_url: `icpdb://${canisterId}/db_unexpected` }
      })
    ) {
      throw new Error("readiness self-test failed for inspect-env connection mismatch");
    }
    if (!validIdentity.completion_command.includes(`--mainnet-canister-id ${shellArg(canisterId)}`)) {
      throw new Error("readiness self-test failed to preserve explicit mainnet canister id in completion command");
    }
    const mainnetWiringEvidence = validIdentity.evidence_manifest.commands.find((entry) => entry.id === "mainnet_wiring");
    if (
      !mainnetWiringEvidence ||
      !mainnetWiringEvidence.expected_evidence.includes("selected canister id and HTTP URL wiring only") ||
      !mainnetWiringEvidence.expected_evidence.includes("live health, SQL, and archive/restore remain separate evidence")
    ) {
      throw new Error("readiness self-test failed to keep mainnet wiring evidence scoped to skip-call wiring only");
    }
    const validIdentityEnv = formatGoalReadinessEnv(validIdentity);
    if (
      !validIdentityEnv.includes('ICPDB_GOAL_READY="true"') ||
      !validIdentityEnv.includes(`ICPDB_GOAL_MAINNET_CANISTER_ID=${JSON.stringify(canisterId)}`) ||
      !validIdentityEnv.includes("ICPDB_GOAL_MAINNET_WIRING_CHECK_COMMAND=") ||
      !validIdentityEnv.includes(`ICPDB_GOAL_MAINNET_PREFLIGHT_COMMAND=${JSON.stringify(`node scripts/icpdb-mainnet-preflight.mjs --canister-id ${shellArg(canisterId)}`)}`) ||
      !validIdentityEnv.includes(`ICPDB_GOAL_EVIDENCE_COMMAND_10_COMMAND=${JSON.stringify(`node scripts/icpdb-mainnet-preflight.mjs --canister-id ${shellArg(canisterId)}`)}`) ||
      !validIdentityEnv.includes("selected canister id and HTTP URL wiring only") ||
      !validIdentityEnv.includes("live health, SQL, and archive/restore remain separate evidence") ||
      !validIdentityEnv.includes("ICPDB_GOAL_MAINNET_SQL_ARCHIVE_RESTORE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_LOCAL_POSTDEPLOY_SQL_ARCHIVE_SMOKE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_GENERATE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_SCALAR_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_CREATE_TABLE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_WRITE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_READ_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_URL_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_INFO_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_OWNER_SMOKE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_STATS_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_SERVICE_ENV_PROVISION_INFO_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_STATS_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_INFO_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_STATS_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_INFO_COMMAND=") ||
      !validIdentityEnv.includes("--smoke-archive-restore") ||
      !validIdentityEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_SMOKE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_BROWSER_II_SERVICE_GRANT_STEP=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_ENV_INSPECT_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_HEALTH_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_ADD_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_ALL_PLACEMENTS_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARDS_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_OPS_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_MAINTAIN_DRY_RUN_COMMAND=") ||
      !validIdentityEnv.includes("shard-maintain 0 0 0 0 0 0 --service-env-file") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_SMOKE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_CREATE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_REGISTER_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_STATUS_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_TOP_UP_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_MAINTAIN_CREATE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_MIGRATE_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_REMOTE_CREATE_DB_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_RECONCILE_APPLIED_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_CONTROLLER_SHARD_RECONCILE_FAILED_COMMAND=") ||
      !validIdentityEnv.includes("ICPDB_GOAL_LOCAL_CONTROLLER_QUICKSTART_SMOKE_COMMAND=") ||
      !validIdentityEnv.includes("--smoke-shards") ||
      !validIdentityEnv.includes("--smoke-shards") ||
      validIdentityEnv.includes("ICPDB_GOAL_MISSING_EVIDENCE_IDS=")
    ) {
      throw new Error("readiness self-test failed for ready env output");
    }
    const canisterUrlWithDatabasePath = join(tempDir, "canister-url-with-database.env");
    await writeOwnerOnlyEnv(canisterUrlWithDatabasePath, {
      ICPDB_URL: `icpdb://${canisterId}`,
      ICPDB_DATABASE_ID: databaseId,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson
    });
    const canisterUrlWithDatabase = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: canisterUrlWithDatabasePath,
      controllerEnvFile: validControllerPath
    });
    if (
      !canisterUrlWithDatabase.ready ||
      canisterUrlWithDatabase.service_env.connection_url !== `icpdb://${canisterId}/${databaseId}` ||
      canisterUrlWithDatabase.service_env.inspect_env?.connection_url !== `icpdb://${canisterId}/${databaseId}`
    ) {
      throw new Error("readiness self-test failed for canister-only ICPDB_URL plus ICPDB_DATABASE_ID");
    }
    const trailingSlashNetworkPath = join(tempDir, "trailing-slash-network.env");
    await writeOwnerOnlyEnv(trailingSlashNetworkPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_NETWORK_URL: `${MAINNET_NETWORK_URL}/`,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson
    });
    const trailingSlashControllerPath = join(tempDir, "trailing-slash-controller.env");
    await writeOwnerOnlyEnv(trailingSlashControllerPath, {
      ICPDB_CANISTER_ID: canisterId,
      ICPDB_NETWORK_URL: `${MAINNET_NETWORK_URL}/`,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson
    });
    const trailingSlashNetwork = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: trailingSlashNetworkPath,
      controllerEnvFile: trailingSlashControllerPath
    });
    if (
      !trailingSlashNetwork.ready ||
      !trailingSlashNetwork.checks.service_env_mainnet_network ||
      !trailingSlashNetwork.checks.controller_env_mainnet_network
    ) {
      throw new Error("readiness self-test failed for trailing-slash mainnet network URL");
    }
    const dbBearingControllerPath = join(tempDir, "db-bearing-controller.env");
    await writeOwnerOnlyEnv(dbBearingControllerPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_NETWORK_URL: MAINNET_NETWORK_URL,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson
    });
    const dbBearingController = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: validIdentityPath,
      controllerEnvFile: dbBearingControllerPath
    });
    if (
      dbBearingController.ready ||
      dbBearingController.checks.controller_env_canister_only ||
      !dbBearingController.missing_evidence.some((item) => item.id === "controller_env_canister_only") ||
      !dbBearingController.next_steps.some((step) => step.includes("Remove ICPDB_DATABASE_ID and database-bearing ICPDB_URL from controller.env"))
    ) {
      throw new Error("readiness self-test failed for DB-bearing controller env");
    }
    const singleQuotedEnvPath = join(tempDir, "single-quoted-service.env");
    await writeFile(singleQuotedEnvPath, [
      `ICPDB_URL='icpdb://${canisterId}/${databaseId}'`,
      "ICPDB_IDENTITY_TYPE='ed25519'",
      `ICPDB_IDENTITY_JSON='${identityJson}'`,
      ""
    ].join("\n"), { mode: 0o600 });
    await chmod(singleQuotedEnvPath, 0o600);
    const singleQuotedEnv = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: singleQuotedEnvPath,
      controllerEnvFile: validControllerPath
    });
    if (!singleQuotedEnv.ready || singleQuotedEnv.service_env.connection_url !== `icpdb://${canisterId}/${databaseId}`) {
      throw new Error("readiness self-test failed for single-quoted service env values");
    }
    const duplicateEnvPath = join(tempDir, "duplicate-service.env");
    await writeFile(duplicateEnvPath, [
      `ICPDB_URL="icpdb://${canisterId}/${databaseId}"`,
      `ICPDB_URL="icpdb://${canisterId}/db_other"`,
      ""
    ].join("\n"), { mode: 0o600 });
    await chmod(duplicateEnvPath, 0o600);
    await assert.rejects(
      () => goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: duplicateEnvPath }),
      /duplicate env key ICPDB_URL/
    );
    await assertGoalCompleteReadiness({
      goalComplete: true,
      mainnetCanisterId: canisterId,
      serviceEnvFile: validIdentityPath,
      controllerEnvFile: validControllerPath
    });
    if (
      validIdentity.mainnet_deploy_command !== "icp deploy -e ic -y icpdb" ||
      !validIdentity.mainnet_wiring_check_command?.includes(`--canister-id ${shellArg(canisterId)}`) ||
      !validIdentity.mainnet_sql_smoke_command?.includes("--smoke-sql") ||
      validIdentity.mainnet_sql_smoke_command.includes("--smoke-archive-restore") ||
      !validIdentity.mainnet_sql_archive_restore_command?.includes("--smoke-archive-restore") ||
      validIdentity.mainnet_sql_archive_restore_command === validIdentity.mainnet_sql_smoke_command ||
      !validIdentity.completion_plan.some((step) => step.id === "verify_mainnet_preflight" && step.command === validIdentity.mainnet_preflight_command && step.approval_required === false && step.external_action === "none") ||
      !validIdentity.completion_plan.some((step) => step.id === "verify_mainnet_sql_smoke" && step.command === validIdentity.mainnet_sql_smoke_command && step.approval_required === true && step.external_action === "mainnet_sql_mutation") ||
      !validIdentity.completion_plan.some((step) => step.id === "verify_mainnet_sql_archive_restore" && step.command === validIdentity.mainnet_sql_archive_restore_command && step.approval_required === true && step.external_action === "mainnet_sql_archive_restore_mutation") ||
      !validIdentity.completion_plan.some((step) =>
        step.id === "verify_owner_service_env_package_smoke" &&
        step.required === true &&
        step.blocked_by.length === 0 &&
        step.approval_required === true &&
        step.external_action === "mainnet_service_env_sql_archive_restore_mutation" &&
        Array.isArray(step.commands) &&
        step.commands.includes(validIdentity.service_env_owner_sql_sdk_smoke_command) &&
        step.commands.includes(validIdentity.service_env_owner_archive_restore_smoke_command) &&
        step.commands.includes(validIdentity.service_env_owner_sdk_archive_restore_smoke_command)
      ) ||
      !validIdentity.controller_env_setup_steps.some((step) => step.includes(`health --service-env-file ${shellArg(validControllerPath)} --format table`)) ||
      !validIdentity.controller_env_setup_steps.some((step) => step.includes("all-placements")) ||
      !validIdentity.controller_env_setup_steps.some((step) => step.includes("shards")) ||
      !validIdentity.controller_env_setup_steps.some((step) => step.includes("shard-ops")) ||
      !validIdentity.controller_env_setup_steps.some((step) => step.includes("shard-maintain 0 0 0 0 0 0")) ||
      !validIdentity.controller_env_setup_steps.some((step) => step.includes("--smoke-shards")) ||
      !validIdentity.completion_plan.some((step) => step.id === "complete_goal_gate" && step.command === validIdentity.completion_command) ||
      !validIdentity.completion_plan.some((step) => step.id === "complete_goal_gate" && step.blocked_by.length === 0 && step.approval_required === true && step.external_action === "mainnet_goal_completion_gate") ||
      !validIdentity.completion_plan.some((step) => step.choice_group === "provision_owner_service_env" && step.choice_required === false) ||
      validIdentity.approval_required_actions.length !== 10 ||
      !validIdentity.approval_required_actions.some((action) => action.id === "verify_mainnet_sql_smoke" && action.external_action === "mainnet_sql_mutation" && action.blocked_by.length === 0 && action.items.includes(validIdentity.mainnet_sql_smoke_command)) ||
      !validIdentity.approval_required_actions.some((action) => action.id === "provision_owner_service_env_new_db" && action.choice_group === "provision_owner_service_env" && action.choice_required === false) ||
      !validIdentity.approval_required_actions.some((action) => action.id === "complete_goal_gate" && action.external_action === "mainnet_goal_completion_gate" && action.blocked_by.length === 0 && action.items.includes(validIdentity.completion_command)) ||
      !validIdentity.approval_required_actions.every((action) => action.id !== "verify_mainnet_wiring")
    ) {
      throw new Error("readiness self-test failed to include mainnet deploy and smoke commands");
    }
    if (
      !validIdentity.service_env_provision_command?.includes("icpdb init") ||
      !validIdentity.service_env_provision_command.includes("--setup-sql") ||
      !validIdentity.service_env_provision_command.includes("CREATE TABLE note_groups(id INTEGER PRIMARY KEY, label TEXT NOT NULL)") ||
      !validIdentity.service_env_provision_command.includes("CREATE TABLE notes(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES note_groups(id), body TEXT NOT NULL)") ||
      !validIdentity.service_env_provision_command.includes("CREATE INDEX notes_body_idx ON notes(body)") ||
      !validIdentity.service_env_provision_command.includes("CREATE TRIGGER notes_ai AFTER INSERT ON notes") ||
      !validIdentity.service_env_provision_command.includes("CREATE VIEW notes_view AS SELECT id, body FROM notes") ||
      !validIdentity.service_env_provision_command.includes(shellArg(validIdentityPath)) ||
      !validIdentity.service_env_provision_steps.some((step) => step.includes(`info --service-env-file ${shellArg(validIdentityPath)} --format env`)) ||
      !validIdentity.service_env_provision_steps.some((step) => step.includes(`stats --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.service_env_provision_steps.some((step) => step.includes(`describe --service-env-file ${shellArg(validIdentityPath)} ${shellArg("notes")} --format table`)) ||
      !validIdentity.service_env_provision_steps.some((step) => step.includes(`sql --service-env-file ${shellArg(validIdentityPath)} ${shellArg("INSERT INTO notes(body) VALUES (?1)")} --params ${shellArg("[\"readiness-sql-write\"]")} --idempotency-key readiness-notes-sql-write-001 --wait --format table`)) ||
      !validIdentity.service_env_provision_steps.some((step) => step.includes(`sql --service-env-file ${shellArg(validIdentityPath)} ${shellArg("SELECT id, body FROM notes ORDER BY id DESC")} --format table`)) ||
      !validIdentity.service_env_query_only_steps.some((step) => step.includes(`icpdb generate-identity --canister-id ${shellArg(canisterId)} --network-url ${shellArg(MAINNET_NETWORK_URL)} --env-out ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.service_env_query_only_steps.some((step) => step.includes(`scalar --service-env-file ${shellArg(validIdentityPath)} ${shellArg("SELECT 1 AS value")} --format table`)) ||
      !validIdentity.service_env_query_only_steps.some((step) => step.includes(`execute --service-env-file ${shellArg(validIdentityPath)} ${shellArg("CREATE TABLE readiness_query_only(id INTEGER PRIMARY KEY, body TEXT NOT NULL)")} --idempotency-key readiness-query-only-create-table-001 --wait --format table`)) ||
      !validIdentity.service_env_query_only_steps.some((step) => step.includes(`execute --service-env-file ${shellArg(validIdentityPath)} ${shellArg("INSERT INTO readiness_query_only(body) VALUES (?1)")} --params ${shellArg("[\"readiness-query-only\"]")} --idempotency-key readiness-query-only-write-001 --wait --format table`)) ||
      !validIdentity.service_env_query_only_steps.some((step) => step.includes(`query --service-env-file ${shellArg(validIdentityPath)} ${shellArg("SELECT body FROM readiness_query_only ORDER BY id DESC LIMIT 1")} --format table`)) ||
      !validIdentity.service_env_query_only_steps.some((step) => step.includes(`url --service-env-file ${shellArg(validIdentityPath)} --format env`)) ||
      !validIdentity.service_env_query_only_steps.some((step) => step.includes(`info --service-env-file ${shellArg(validIdentityPath)} --format env`)) ||
      !validIdentity.service_env_query_only_steps.some((step) => step.includes(`check-env --service-env-file ${shellArg(validIdentityPath)} --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table`)) ||
      !validIdentity.service_env_owner_smoke_command?.includes(`--service-env-file ${shellArg(validIdentityPath)}`) ||
      !validIdentity.service_env_owner_smoke_command.includes("--require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table") ||
      validIdentity.local_owner_service_env_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only service-owner --skip-top-up" ||
      validIdentity.local_owner_service_env_backup_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only service-owner-backup --skip-top-up" ||
      validIdentity.local_identity_quickstart_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only identity-quickstart --skip-top-up" ||
      validIdentity.local_postdeploy_sql_archive_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only postdeploy-sql-archive --skip-top-up" ||
      validIdentity.local_service_env_query_only_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,service-query-only --skip-top-up" ||
      validIdentity.local_sdk_shortest_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-shortest --skip-top-up" ||
      validIdentity.local_sdk_browser_shortest_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-browser-shortest --skip-top-up" ||
      validIdentity.local_sdk_sqlite_shortest_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-sqlite-shortest --skip-top-up" ||
      validIdentity.local_sdk_libsql_shortest_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-libsql-shortest --skip-top-up" ||
      validIdentity.local_console_shortest_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only console-shortest --skip-top-up" ||
      validIdentity.local_controller_quickstart_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only controller-quickstart --skip-top-up" ||
      validIdentity.local_shards_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only shards --skip-top-up" ||
      validIdentity.local_browser_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only browser --skip-top-up" ||
      validIdentity.local_ii_browser_smoke_command !== "node scripts/icpdb-local-goal-smoke.mjs --only ii-browser --skip-top-up" ||
      !validIdentity.existing_db_service_env_command?.includes("icpdb provision-service '<database-id>' owner") ||
      !validIdentity.existing_db_service_env_command.includes("--service-env-file 'owner.env'") ||
      !validIdentity.existing_db_service_env_steps.some((step) => step.includes(`info --service-env-file ${shellArg(validIdentityPath)} --format env`)) ||
      !validIdentity.existing_db_service_env_steps.some((step) => step.includes(`stats --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.existing_db_service_env_steps.some((step) => step.includes(`describe --service-env-file ${shellArg(validIdentityPath)} ${shellArg("<table>")} --format table`)) ||
      !validIdentity.existing_db_service_env_steps.some((step) => step.includes(`sql --service-env-file ${shellArg(validIdentityPath)} ${shellArg("SELECT count(*) FROM sqlite_schema")} --format table`)) ||
      !Array.isArray(validIdentity.browser_ii_service_env_steps) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`icpdb generate-identity --canister-id ${shellArg(canisterId)} --database-id ${shellArg("<database-id>")} --network-url ${shellArg(MAINNET_NETWORK_URL)} --env-out ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`principal --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`inspect-env --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes("Copy the console Response sidebar Connection URL")) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes("grant the printed service principal as owner")) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes("Browser/II and Server/CI principals stay different and are joined through the DB ACL")) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`status --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`members --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`scalar --service-env-file ${shellArg(validIdentityPath)} ${shellArg("SELECT count(*) FROM sqlite_schema")} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`tables --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`views --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`stats --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`schema --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`describe --service-env-file ${shellArg(validIdentityPath)} ${shellArg("<table>")} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`columns --service-env-file ${shellArg(validIdentityPath)} ${shellArg("<table>")} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`indexes --service-env-file ${shellArg(validIdentityPath)} ${shellArg("<table>")} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`triggers --service-env-file ${shellArg(validIdentityPath)} ${shellArg("<table>")} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`foreign-keys --service-env-file ${shellArg(validIdentityPath)} ${shellArg("<table>")} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`inspect --service-env-file ${shellArg(validIdentityPath)} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`info --service-env-file ${shellArg(validIdentityPath)} --format env`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes(`sql --service-env-file ${shellArg(validIdentityPath)} ${shellArg("SELECT count(*) FROM sqlite_schema")} --format table`)) ||
      !validIdentity.browser_ii_service_env_steps.some((step) => step.includes("--smoke-archive-restore"))
    ) {
      throw new Error("readiness self-test failed to include owner service env provisioning commands");
    }
    const serviceSmokeOptions = parseReleaseCheckArgs([
      "--service-env-file",
      validIdentityPath,
      "--with-service-env-sql-smoke",
      "--with-service-env-archive-restore-smoke"
    ]);
    assertServiceEnvSmokeCommands(releaseCommands(serviceSmokeOptions), validIdentityPath);
    const controllerSmokeOptions = parseReleaseCheckArgs([
      "--controller-env-file",
      validControllerPath,
      "--with-controller-env-shard-smoke"
    ]);
    assertControllerEnvSmokeCommands(releaseCommands(controllerSmokeOptions), validControllerPath);

    const quotedPath = join(tempDir, "service env with ' quote.env");
    await writeOwnerOnlyEnv(quotedPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson
    });
    const quotedPathIdentity = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: quotedPath,
      controllerEnvFile: validControllerPath
    });
    if (!quotedPathIdentity.completion_command.includes(shellArg(quotedPath))) {
      throw new Error("readiness self-test failed to shell-quote service env path in completion command");
    }

    const mismatchedIdentityPath = join(tempDir, "mismatched-identity.env");
    await writeOwnerOnlyEnv(mismatchedIdentityPath, {
      ICPDB_URL: `icpdb://r7inp-6aaaa-aaaaa-aaabq-cai/${databaseId}`,
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson
    });
    const mismatchedIdentity = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: mismatchedIdentityPath,
      controllerEnvFile: validControllerPath
    });
    if (
      mismatchedIdentity.ready ||
      mismatchedIdentity.checks.service_env_mainnet_canister_match ||
      !mismatchedIdentity.checks.service_env_inspect ||
      !mismatchedIdentity.completion_plan.some((step) => step.choice_group === "provision_owner_service_env" && step.choice_required === true)
    ) {
      throw new Error("readiness self-test failed for mismatched service env canister");
    }

    const localNetworkIdentityPath = join(tempDir, "local-network-identity.env");
    await writeOwnerOnlyEnv(localNetworkIdentityPath, {
      ICPDB_URL: `icpdb://${canisterId}/${databaseId}`,
      ICPDB_NETWORK_URL: "http://localhost:8001",
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson
    });
    const localNetworkIdentity = await goalReadiness({ mainnetCanisterId: canisterId, serviceEnvFile: localNetworkIdentityPath });
    if (
      localNetworkIdentity.ready ||
      localNetworkIdentity.checks.service_env_mainnet_network ||
      !localNetworkIdentity.checks.service_env_inspect ||
      !localNetworkIdentity.completion_plan.some((step) => step.choice_group === "provision_owner_service_env" && step.choice_required === true)
    ) {
      throw new Error("readiness self-test failed for local-network service env");
    }
    await assertAsyncFailure(
      () => assertServiceEnvTargetsMainnet({ serviceEnvFile: localNetworkIdentityPath }),
      /does not target mainnet/,
      "release check should reject local-network service env without requiring a mapped mainnet canister id"
    );
    const localNetworkControllerPath = join(tempDir, "local-network-controller.env");
    await writeOwnerOnlyEnv(localNetworkControllerPath, {
      ICPDB_CANISTER_ID: canisterId,
      ICPDB_NETWORK_URL: "http://localhost:8001",
      ICPDB_IDENTITY_TYPE: "ed25519",
      ICPDB_IDENTITY_JSON: identityJson
    });
    const localNetworkController = await goalReadiness({
      mainnetCanisterId: canisterId,
      serviceEnvFile: validIdentityPath,
      controllerEnvFile: localNetworkControllerPath
    });
    if (
      localNetworkController.ready ||
      localNetworkController.checks.controller_env_mainnet_network ||
      !localNetworkController.checks.controller_env_inspect
    ) {
      throw new Error("readiness self-test failed for local-network controller env");
    }
    await assertAsyncFailure(
      () => assertControllerEnvTargetsMainnet({ controllerEnvFile: localNetworkControllerPath }),
      /does not target mainnet/,
      "release check should reject local-network controller env without requiring a mapped mainnet canister id"
    );
    const goalCompleteCommands = releaseCommands({
      skipBuild: false,
      skipConsole: false,
      goalComplete: true,
      withRust: true,
      withLocalSmoke: true,
      withMainnetSqlSmoke: true,
      withServiceEnvSqlSmoke: true,
      withServiceEnvArchiveRestoreSmoke: true,
      withControllerEnvShardSmoke: true,
      mainnetCanisterId: canisterId,
      requireMainnetCanisterId: true,
      serviceEnvFile: validIdentityPath,
      controllerEnvFile: validControllerPath,
      serviceEnvSkipCall: false
    });
    assertGoalCompleteCommands(goalCompleteCommands, canisterId, validIdentityPath, validControllerPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function assertParseFailure(args, pattern) {
  try {
    parseReleaseCheckArgs(args);
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
  throw new Error(`release check parse self-test unexpectedly accepted ${args.join(" ")}`);
}

async function assertAsyncFailure(fn, pattern, message) {
  try {
    await fn();
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
  throw new Error(message);
}

async function assertGoalCompleteReadiness(command) {
  const readiness = await goalReadiness(command);
  if (readiness.ready) return;
  throw new Error([
    "goal-complete prerequisites are not ready; run --goal-readiness --format table and complete the reported plan first",
    formatGoalReadinessTable(readiness)
  ].join("\n"));
}

function assertGoalCompleteCommands(commands, canisterId, serviceEnvFile, controllerEnvFile) {
  const consolePackageGate = commands.find((step) =>
    step.command === "pnpm" &&
    step.args.join("\0") === ["--dir", "icpdb-console", "test"].join("\0")
  );
  const consoleTypecheckGate = commands.find((step) =>
    step.command === "pnpm" &&
    step.args.join("\0") === ["--dir", "icpdb-console", "typecheck"].join("\0")
  );
  const localSmokeIndex = commandIndex(commands, "scripts/icpdb-local-goal-smoke.mjs");
  const mainnetPreflightIndex = commands.findIndex((step) =>
    step.args.includes("scripts/icpdb-mainnet-preflight.mjs") && !step.args.includes("--self-test")
  );
  const mainnetSqlSmokeIndex = commands.findIndex((step) =>
    step.args.includes("scripts/icpdb-mainnet-postdeploy.mjs") &&
    step.args.includes("--smoke-sql") &&
    !step.args.includes("--smoke-archive-restore")
  );
  const mainnetArchiveRestoreIndex = commands.findIndex((step) =>
    step.args.includes("scripts/icpdb-mainnet-postdeploy.mjs") &&
    step.args.includes("--smoke-sql") &&
    step.args.includes("--smoke-archive-restore")
  );
  const mainnetSqlSmoke = mainnetSqlSmokeIndex === -1 ? null : commands[mainnetSqlSmokeIndex];
  const mainnetArchiveRestore = mainnetArchiveRestoreIndex === -1 ? null : commands[mainnetArchiveRestoreIndex];
  const mainnetPreflight = mainnetPreflightIndex === -1 ? null : commands[mainnetPreflightIndex];
  const serviceEnvCheck = commands.find((step) =>
    step.args.includes("scripts/icpdb-service-env-check.mjs") &&
    step.args.includes("--smoke-sql") &&
    step.args.includes("--smoke-sdk") &&
    step.args.includes("--smoke-archive-restore") &&
    step.args.includes("--smoke-sdk-archive-restore") &&
    step.args.includes("--require-role") &&
    step.args.includes("owner")
  );
  const controllerEnvCheck = commands.find((step) =>
    step.args.includes("scripts/icpdb-service-env-check.mjs") &&
    step.args.includes("--smoke-shards") &&
    step.args.includes("--smoke-sdk-shards")
  );
  if (!consolePackageGate) {
    throw new Error("goal-complete command self-test failed: console package test gate must run SDK package artifact checks");
  }
  if (!consoleTypecheckGate) {
    throw new Error("goal-complete command self-test failed: console typecheck gate must run SDK and app type resolution");
  }
  if (localSmokeIndex === -1 || mainnetPreflightIndex === -1 || localSmokeIndex > mainnetPreflightIndex) {
    throw new Error("goal-complete command self-test failed: local goal smoke must run before mainnet preflight");
  }
  if (!mainnetPreflight?.args.includes("--canister-id") || !mainnetPreflight.args.includes(canisterId)) {
    throw new Error("goal-complete command self-test failed: mainnet preflight must use the explicit target canister id");
  }
  if (!mainnetSqlSmoke?.args.includes("--require-canister-id") || !mainnetSqlSmoke.args.includes(canisterId)) {
    throw new Error("goal-complete command self-test failed: mainnet SQL-only smoke must require the target canister id");
  }
  if (!mainnetArchiveRestore?.args.includes("--require-canister-id") || !mainnetArchiveRestore.args.includes(canisterId)) {
    throw new Error("goal-complete command self-test failed: mainnet archive/restore smoke must require the target canister id");
  }
  if (mainnetSqlSmokeIndex > mainnetArchiveRestoreIndex) {
    throw new Error("goal-complete command self-test failed: mainnet SQL-only smoke must run before archive/restore smoke");
  }
  if (!serviceEnvCheck?.args.includes(serviceEnvFile) || serviceEnvCheck.args.includes("--skip-call")) {
    throw new Error("goal-complete command self-test failed: service env SQL and archive/restore smokes must run live");
  }
  if (!controllerEnvCheck?.args.includes(controllerEnvFile) || controllerEnvCheck.args.includes("--skip-call")) {
    throw new Error("goal-complete command self-test failed: controller env shard smoke must run live");
  }
}

function formatGoalReadiness(readiness, format) {
  if (format === "env") return formatGoalReadinessEnv(readiness);
  if (format === "table") return formatGoalReadinessTable(readiness);
  return JSON.stringify(readiness, null, 2);
}

function formatGoalReadinessEnv(readiness) {
  const serviceEnvProvisionSteps = readiness.service_env_provision_steps ?? [];
  const serviceEnvQueryOnlySteps = readiness.service_env_query_only_steps ?? [];
  const existingDbServiceEnvSteps = readiness.existing_db_service_env_steps ?? [];
  const browserIiServiceEnvSteps = readiness.browser_ii_service_env_steps ?? [];
  const controllerEnvSetupSteps = readiness.controller_env_setup_steps ?? [];
  const entries = {
    ICPDB_GOAL_READY: readiness.ready ? "true" : "false",
    ICPDB_GOAL_MAINNET_CANISTER_ID: readiness.mainnet_canister_id ?? undefined,
    ICPDB_GOAL_MAINNET_CANISTER_ID_SOURCE: readiness.mainnet_canister_id_source,
    ICPDB_GOAL_REQUIRED_SERVICE_ENV_ROLE: readiness.required_service_env_role,
    ICPDB_GOAL_SERVICE_ENV_STATUS: readiness.service_env.status,
    ICPDB_GOAL_CONTROLLER_ENV_STATUS: readiness.controller_env.status,
    ICPDB_GOAL_MISSING_EVIDENCE_IDS: readiness.missing_evidence.map((item) => item.id).join(","),
    ICPDB_GOAL_MAINNET_DEPLOY_COMMAND: readiness.mainnet_deploy_command,
    ICPDB_GOAL_MAINNET_PREFLIGHT_COMMAND: readiness.mainnet_preflight_command,
    ICPDB_GOAL_MAINNET_WIRING_CHECK_COMMAND: readiness.mainnet_wiring_check_command,
    ICPDB_GOAL_MAINNET_SQL_SMOKE_COMMAND: readiness.mainnet_sql_smoke_command,
    ICPDB_GOAL_MAINNET_SQL_ARCHIVE_RESTORE_COMMAND: readiness.mainnet_sql_archive_restore_command,
    ICPDB_GOAL_LOCAL_POSTDEPLOY_SQL_ARCHIVE_SMOKE_COMMAND: readiness.local_postdeploy_sql_archive_smoke_command,
    ICPDB_GOAL_SERVICE_ENV_PROVISION_COMMAND: readiness.service_env_provision_command,
    ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_GENERATE_COMMAND: serviceEnvQueryOnlySteps[0],
    ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_SCALAR_COMMAND: serviceEnvQueryOnlySteps[1],
    ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_CREATE_TABLE_COMMAND: serviceEnvQueryOnlySteps[2],
    ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_WRITE_COMMAND: serviceEnvQueryOnlySteps[3],
    ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_READ_COMMAND: serviceEnvQueryOnlySteps[4],
    ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_URL_COMMAND: serviceEnvQueryOnlySteps[5],
    ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_INFO_COMMAND: serviceEnvQueryOnlySteps[6],
    ICPDB_GOAL_SERVICE_ENV_QUERY_ONLY_OWNER_SMOKE_COMMAND: serviceEnvQueryOnlySteps[7],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_INSPECT_ENV_COMMAND: serviceEnvProvisionSteps[1],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_STATUS_COMMAND: serviceEnvProvisionSteps[2],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_MEMBERS_COMMAND: serviceEnvProvisionSteps[3],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_SCALAR_COMMAND: serviceEnvProvisionSteps[4],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_TABLES_COMMAND: serviceEnvProvisionSteps[5],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_VIEWS_COMMAND: serviceEnvProvisionSteps[6],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_STATS_COMMAND: serviceEnvProvisionSteps[7],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_SCHEMA_COMMAND: serviceEnvProvisionSteps[8],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_DESCRIBE_COMMAND: serviceEnvProvisionSteps[9],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_COLUMNS_COMMAND: serviceEnvProvisionSteps[10],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_INDEXES_COMMAND: serviceEnvProvisionSteps[11],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_TRIGGERS_COMMAND: serviceEnvProvisionSteps[12],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_FOREIGN_KEYS_COMMAND: serviceEnvProvisionSteps[13],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_PREVIEW_COMMAND: serviceEnvProvisionSteps[14],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_INSPECT_COMMAND: serviceEnvProvisionSteps[15],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_URL_COMMAND: serviceEnvProvisionSteps[16],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_INFO_COMMAND: serviceEnvProvisionSteps[17],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_SQL_WRITE_COMMAND: serviceEnvProvisionSteps[18],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_SQL_READ_COMMAND: serviceEnvProvisionSteps[19],
    ICPDB_GOAL_SERVICE_ENV_PROVISION_OWNER_SMOKE_COMMAND: serviceEnvProvisionSteps[20],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_COMMAND: readiness.existing_db_service_env_command,
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_INSPECT_ENV_COMMAND: existingDbServiceEnvSteps[1],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_STATUS_COMMAND: existingDbServiceEnvSteps[2],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_MEMBERS_COMMAND: existingDbServiceEnvSteps[3],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_SCALAR_COMMAND: existingDbServiceEnvSteps[4],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_TABLES_COMMAND: existingDbServiceEnvSteps[5],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_VIEWS_COMMAND: existingDbServiceEnvSteps[6],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_STATS_COMMAND: existingDbServiceEnvSteps[7],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_SCHEMA_COMMAND: existingDbServiceEnvSteps[8],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_DESCRIBE_COMMAND: existingDbServiceEnvSteps[9],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_COLUMNS_COMMAND: existingDbServiceEnvSteps[10],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_INDEXES_COMMAND: existingDbServiceEnvSteps[11],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_TRIGGERS_COMMAND: existingDbServiceEnvSteps[12],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_FOREIGN_KEYS_COMMAND: existingDbServiceEnvSteps[13],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_PREVIEW_COMMAND: existingDbServiceEnvSteps[14],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_INSPECT_COMMAND: existingDbServiceEnvSteps[15],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_URL_COMMAND: existingDbServiceEnvSteps[16],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_INFO_COMMAND: existingDbServiceEnvSteps[17],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_SQL_READ_COMMAND: existingDbServiceEnvSteps[18],
    ICPDB_GOAL_EXISTING_DB_SERVICE_ENV_OWNER_SMOKE_COMMAND: existingDbServiceEnvSteps[19],
    ICPDB_GOAL_SERVICE_ENV_OWNER_SMOKE_COMMAND: readiness.service_env_owner_smoke_command,
    ICPDB_GOAL_SERVICE_ENV_OWNER_SQL_SDK_SMOKE_COMMAND: readiness.service_env_owner_sql_sdk_smoke_command,
    ICPDB_GOAL_SERVICE_ENV_OWNER_ARCHIVE_RESTORE_SMOKE_COMMAND: readiness.service_env_owner_archive_restore_smoke_command,
    ICPDB_GOAL_SERVICE_ENV_OWNER_SDK_ARCHIVE_RESTORE_SMOKE_COMMAND: readiness.service_env_owner_sdk_archive_restore_smoke_command,
    ICPDB_GOAL_SERVICE_ENV_ARCHIVE_COMMAND: readiness.service_env_archive_command,
    ICPDB_GOAL_SERVICE_ENV_SNAPSHOT_INFO_COMMAND: readiness.service_env_snapshot_info_command,
    ICPDB_GOAL_SERVICE_ENV_RESTORE_COMMAND: readiness.service_env_restore_command,
    ICPDB_GOAL_LOCAL_OWNER_SERVICE_ENV_SMOKE_COMMAND: readiness.local_owner_service_env_smoke_command,
    ICPDB_GOAL_LOCAL_OWNER_SERVICE_ENV_BACKUP_SMOKE_COMMAND: readiness.local_owner_service_env_backup_smoke_command,
    ICPDB_GOAL_LOCAL_IDENTITY_QUICKSTART_SMOKE_COMMAND: readiness.local_identity_quickstart_smoke_command,
    ICPDB_GOAL_LOCAL_SERVICE_ENV_QUERY_ONLY_SMOKE_COMMAND: readiness.local_service_env_query_only_smoke_command,
    ICPDB_GOAL_LOCAL_SDK_SHORTEST_SMOKE_COMMAND: readiness.local_sdk_shortest_smoke_command,
    ICPDB_GOAL_LOCAL_SDK_BROWSER_SHORTEST_SMOKE_COMMAND: readiness.local_sdk_browser_shortest_smoke_command,
    ICPDB_GOAL_LOCAL_SDK_SQLITE_SHORTEST_SMOKE_COMMAND: readiness.local_sdk_sqlite_shortest_smoke_command,
    ICPDB_GOAL_LOCAL_SDK_LIBSQL_SHORTEST_SMOKE_COMMAND: readiness.local_sdk_libsql_shortest_smoke_command,
    ICPDB_GOAL_LOCAL_CONSOLE_SHORTEST_SMOKE_COMMAND: readiness.local_console_shortest_smoke_command,
    ICPDB_GOAL_LOCAL_CONTROLLER_QUICKSTART_SMOKE_COMMAND: readiness.local_controller_quickstart_smoke_command,
    ICPDB_GOAL_LOCAL_SHARDS_SMOKE_COMMAND: readiness.local_shards_smoke_command,
    ICPDB_GOAL_LOCAL_BROWSER_SMOKE_COMMAND: readiness.local_browser_smoke_command,
    ICPDB_GOAL_LOCAL_II_BROWSER_SMOKE_COMMAND: readiness.local_ii_browser_smoke_command,
    ICPDB_GOAL_SERVICE_ENV_FULL_SMOKE_COMMAND: readiness.service_env_full_smoke_command,
    ICPDB_GOAL_BROWSER_II_SERVICE_ENV_GENERATE_COMMAND: browserIiServiceEnvSteps[0],
    ICPDB_GOAL_BROWSER_II_SERVICE_PRINCIPAL_COMMAND: browserIiServiceEnvSteps[1],
    ICPDB_GOAL_BROWSER_II_SERVICE_INSPECT_COMMAND: browserIiServiceEnvSteps[2],
    ICPDB_GOAL_BROWSER_II_SERVICE_GRANT_STEP: browserIiServiceEnvSteps[3],
    ICPDB_GOAL_BROWSER_II_SERVICE_STATUS_COMMAND: browserIiServiceEnvSteps[4],
    ICPDB_GOAL_BROWSER_II_SERVICE_MEMBERS_COMMAND: browserIiServiceEnvSteps[5],
    ICPDB_GOAL_BROWSER_II_SERVICE_SCALAR_COMMAND: browserIiServiceEnvSteps[6],
    ICPDB_GOAL_BROWSER_II_SERVICE_TABLES_COMMAND: browserIiServiceEnvSteps[7],
    ICPDB_GOAL_BROWSER_II_SERVICE_VIEWS_COMMAND: browserIiServiceEnvSteps[8],
    ICPDB_GOAL_BROWSER_II_SERVICE_STATS_COMMAND: browserIiServiceEnvSteps[9],
    ICPDB_GOAL_BROWSER_II_SERVICE_SCHEMA_COMMAND: browserIiServiceEnvSteps[10],
    ICPDB_GOAL_BROWSER_II_SERVICE_DESCRIBE_COMMAND: browserIiServiceEnvSteps[11],
    ICPDB_GOAL_BROWSER_II_SERVICE_COLUMNS_COMMAND: browserIiServiceEnvSteps[12],
    ICPDB_GOAL_BROWSER_II_SERVICE_INDEXES_COMMAND: browserIiServiceEnvSteps[13],
    ICPDB_GOAL_BROWSER_II_SERVICE_TRIGGERS_COMMAND: browserIiServiceEnvSteps[14],
    ICPDB_GOAL_BROWSER_II_SERVICE_FOREIGN_KEYS_COMMAND: browserIiServiceEnvSteps[15],
    ICPDB_GOAL_BROWSER_II_SERVICE_PREVIEW_COMMAND: browserIiServiceEnvSteps[16],
    ICPDB_GOAL_BROWSER_II_SERVICE_INSPECT_DB_COMMAND: browserIiServiceEnvSteps[17],
    ICPDB_GOAL_BROWSER_II_SERVICE_URL_COMMAND: browserIiServiceEnvSteps[18],
    ICPDB_GOAL_BROWSER_II_SERVICE_INFO_COMMAND: browserIiServiceEnvSteps[19],
    ICPDB_GOAL_BROWSER_II_SERVICE_SQL_READ_COMMAND: browserIiServiceEnvSteps[20],
    ICPDB_GOAL_BROWSER_II_SERVICE_SMOKE_COMMAND: browserIiServiceEnvSteps[21],
    ICPDB_GOAL_CONTROLLER_ENV_GENERATE_COMMAND: controllerEnvSetupSteps[0],
    ICPDB_GOAL_CONTROLLER_ENV_PRINCIPAL_COMMAND: controllerEnvSetupSteps[1],
    ICPDB_GOAL_CONTROLLER_ENV_INSPECT_COMMAND: controllerEnvSetupSteps[2],
    ICPDB_GOAL_CONTROLLER_HEALTH_COMMAND: controllerEnvSetupSteps[3],
    ICPDB_GOAL_CONTROLLER_ADD_COMMAND: controllerEnvSetupSteps[4],
    ICPDB_GOAL_CONTROLLER_ALL_PLACEMENTS_COMMAND: controllerEnvSetupSteps[5],
    ICPDB_GOAL_CONTROLLER_SHARDS_COMMAND: controllerEnvSetupSteps[6],
    ICPDB_GOAL_CONTROLLER_SHARD_OPS_COMMAND: controllerEnvSetupSteps[7],
    ICPDB_GOAL_CONTROLLER_SHARD_MAINTAIN_DRY_RUN_COMMAND: controllerEnvSetupSteps[8],
    ICPDB_GOAL_CONTROLLER_SHARD_SMOKE_COMMAND: controllerEnvSetupSteps[9],
    ICPDB_GOAL_CONTROLLER_SHARD_CREATE_COMMAND: readiness.controller_shard_create_command,
    ICPDB_GOAL_CONTROLLER_SHARD_REGISTER_COMMAND: readiness.controller_shard_register_command,
    ICPDB_GOAL_CONTROLLER_SHARD_STATUS_COMMAND: readiness.controller_shard_status_command,
    ICPDB_GOAL_CONTROLLER_SHARD_TOP_UP_COMMAND: readiness.controller_shard_top_up_command,
    ICPDB_GOAL_CONTROLLER_SHARD_MAINTAIN_CREATE_COMMAND: readiness.controller_shard_maintain_create_command,
    ICPDB_GOAL_CONTROLLER_SHARD_MIGRATE_COMMAND: readiness.controller_shard_migrate_command,
    ICPDB_GOAL_CONTROLLER_REMOTE_CREATE_DB_COMMAND: readiness.controller_remote_create_db_command,
    ICPDB_GOAL_CONTROLLER_SHARD_RECONCILE_APPLIED_COMMAND: readiness.controller_shard_reconcile_applied_command,
    ICPDB_GOAL_CONTROLLER_SHARD_RECONCILE_FAILED_COMMAND: readiness.controller_shard_reconcile_failed_command,
    ICPDB_GOAL_CONTROLLER_FULL_SHARD_SMOKE_COMMAND: readiness.controller_env_full_shard_smoke_command,
    ICPDB_GOAL_COMPLETION_COMMAND: readiness.completion_command,
    ICPDB_GOAL_EVIDENCE_MANIFEST_VERSION: String(readiness.evidence_manifest.version),
    ICPDB_GOAL_EVIDENCE_COMMAND_COUNT: String(readiness.evidence_manifest.commands.length),
    ICPDB_GOAL_EVIDENCE_REQUIRED_CHECK_IDS: readiness.evidence_manifest.required_check_ids.join(","),
    ICPDB_GOAL_EVIDENCE_MISSING_IDS: readiness.evidence_manifest.missing_evidence_ids.join(","),
    ICPDB_GOAL_NEXT_STEP_COUNT: String(readiness.next_steps.length),
    ICPDB_GOAL_COMPLETION_PLAN_COUNT: String(readiness.completion_plan.length),
    ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_COUNT: String(readiness.approval_required_actions.length)
  };
  const checkEntries = Object.fromEntries(
    Object.entries(readiness.checks).map(([key, value]) => [`ICPDB_GOAL_CHECK_${key.toUpperCase()}`, value ? "true" : "false"])
  );
  const nextStepEntries = Object.fromEntries(
    readiness.next_steps.map((step, index) => [`ICPDB_GOAL_NEXT_STEP_${index + 1}`, step])
  );
  return Object.entries({ ...entries, ...checkEntries, ...completionPlanEnvEntries(readiness.completion_plan), ...approvalRequiredActionEnvEntries(readiness.approval_required_actions), ...evidenceManifestEnvEntries(readiness.evidence_manifest), ...nextStepEntries })
    .filter(([_key, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join("\n");
}

function approvalRequiredActionEnvEntries(actions) {
  const entries = {};
  actions.forEach((action, index) => {
    const prefix = `ICPDB_GOAL_APPROVAL_REQUIRED_ACTION_${index + 1}`;
    const items = action.items ?? [];
    entries[`${prefix}_ID`] = action.id;
    entries[`${prefix}_REQUIREMENT`] = action.requirement;
    entries[`${prefix}_EXTERNAL_ACTION`] = action.external_action;
    entries[`${prefix}_BLOCKED_BY`] = action.blocked_by.length === 0 ? "unblocked" : action.blocked_by.join(",");
    entries[`${prefix}_CHOICE_GROUP`] = action.choice_group;
    entries[`${prefix}_CHOICE_REQUIRED`] = action.choice_required === undefined ? undefined : String(Boolean(action.choice_required));
    entries[`${prefix}_ITEM_COUNT`] = String(items.length);
    items.forEach((item, itemIndex) => {
      entries[`${prefix}_ITEM_${itemIndex + 1}_KIND`] = isShellCommand(item) ? "command" : "manual";
      entries[`${prefix}_ITEM_${itemIndex + 1}`] = item;
    });
  });
  return entries;
}

function evidenceManifestEnvEntries(manifest) {
  const entries = {};
  manifest.commands.forEach((command, index) => {
    const prefix = `ICPDB_GOAL_EVIDENCE_COMMAND_${index + 1}`;
    entries[`${prefix}_ID`] = command.id;
    entries[`${prefix}_REQUIREMENT`] = command.requirement;
    entries[`${prefix}_COMMAND`] = command.command;
    entries[`${prefix}_EXPECTED`] = command.expected_evidence;
  });
  return entries;
}

function completionPlanEnvEntries(plan) {
  const entries = {};
  plan.forEach((step, planIndex) => {
    const prefix = `ICPDB_GOAL_COMPLETION_PLAN_${planIndex + 1}`;
    const items = step.command ? [step.command] : step.commands ?? [];
    entries[`${prefix}_ID`] = step.id;
    entries[`${prefix}_REQUIREMENT`] = planRequirementLabel(step);
    entries[`${prefix}_BLOCKED_BY`] = step.blocked_by.length === 0 ? "unblocked" : step.blocked_by.join(",");
    entries[`${prefix}_APPROVAL_REQUIRED`] = String(Boolean(step.approval_required));
    entries[`${prefix}_EXTERNAL_ACTION`] = step.external_action ?? "none";
    entries[`${prefix}_CHOICE_GROUP`] = step.choice_group;
    entries[`${prefix}_CHOICE_REQUIRED`] = step.choice_required === undefined ? undefined : String(Boolean(step.choice_required));
    entries[`${prefix}_ITEM_COUNT`] = String(items.length);
    items.forEach((item, itemIndex) => {
      entries[`${prefix}_ITEM_${itemIndex + 1}_KIND`] = isShellCommand(item) ? "command" : "manual";
      entries[`${prefix}_ITEM_${itemIndex + 1}`] = item;
    });
  });
  return entries;
}

function formatGoalReadinessTable(readiness) {
  const serviceEnvProvisionSteps = readiness.service_env_provision_steps ?? [];
  const serviceEnvQueryOnlySteps = readiness.service_env_query_only_steps ?? [];
  const existingDbServiceEnvSteps = readiness.existing_db_service_env_steps ?? [];
  const browserIiServiceEnvSteps = readiness.browser_ii_service_env_steps ?? [];
  const controllerEnvSetupSteps = readiness.controller_env_setup_steps ?? [];
  return [
    ["ready", readiness.ready ? "true" : "false"],
    ["mainnet_canister_id", readiness.mainnet_canister_id ?? ""],
    ["mainnet_canister_id_source", readiness.mainnet_canister_id_source],
    ["service_env", `${readiness.service_env.status}${readiness.service_env.path ? ` ${readiness.service_env.path}` : ""}`],
    ["controller_env", `${readiness.controller_env.status}${readiness.controller_env.path ? ` ${readiness.controller_env.path}` : ""}`],
    ["required_service_env_role", readiness.required_service_env_role],
    ["missing_evidence", readiness.missing_evidence.map((item) => item.id).join(",")],
    ["mainnet_deploy_command", readiness.mainnet_deploy_command],
    ["mainnet_preflight_command", readiness.mainnet_preflight_command],
    ["mainnet_wiring_check_command", readiness.mainnet_wiring_check_command],
    ["mainnet_sql_smoke_command", readiness.mainnet_sql_smoke_command],
    ["mainnet_sql_archive_restore_command", readiness.mainnet_sql_archive_restore_command],
    ["local_postdeploy_sql_archive_smoke_command", readiness.local_postdeploy_sql_archive_smoke_command],
    ["service_env_provision_command", readiness.service_env_provision_command],
    ["service_env_query_only_generate_command", serviceEnvQueryOnlySteps[0] ?? ""],
    ["service_env_query_only_scalar_command", serviceEnvQueryOnlySteps[1] ?? ""],
    ["service_env_query_only_create_table_command", serviceEnvQueryOnlySteps[2] ?? ""],
    ["service_env_query_only_write_command", serviceEnvQueryOnlySteps[3] ?? ""],
    ["service_env_query_only_read_command", serviceEnvQueryOnlySteps[4] ?? ""],
    ["service_env_query_only_url_command", serviceEnvQueryOnlySteps[5] ?? ""],
    ["service_env_query_only_info_command", serviceEnvQueryOnlySteps[6] ?? ""],
    ["service_env_query_only_owner_smoke_command", serviceEnvQueryOnlySteps[7] ?? ""],
    ["service_env_provision_inspect_env_command", serviceEnvProvisionSteps[1] ?? ""],
    ["service_env_provision_status_command", serviceEnvProvisionSteps[2] ?? ""],
    ["service_env_provision_members_command", serviceEnvProvisionSteps[3] ?? ""],
    ["service_env_provision_scalar_command", serviceEnvProvisionSteps[4] ?? ""],
    ["service_env_provision_tables_command", serviceEnvProvisionSteps[5] ?? ""],
    ["service_env_provision_views_command", serviceEnvProvisionSteps[6] ?? ""],
    ["service_env_provision_stats_command", serviceEnvProvisionSteps[7] ?? ""],
    ["service_env_provision_schema_command", serviceEnvProvisionSteps[8] ?? ""],
    ["service_env_provision_describe_command", serviceEnvProvisionSteps[9] ?? ""],
    ["service_env_provision_columns_command", serviceEnvProvisionSteps[10] ?? ""],
    ["service_env_provision_indexes_command", serviceEnvProvisionSteps[11] ?? ""],
    ["service_env_provision_triggers_command", serviceEnvProvisionSteps[12] ?? ""],
    ["service_env_provision_foreign_keys_command", serviceEnvProvisionSteps[13] ?? ""],
    ["service_env_provision_preview_command", serviceEnvProvisionSteps[14] ?? ""],
    ["service_env_provision_inspect_command", serviceEnvProvisionSteps[15] ?? ""],
    ["service_env_provision_url_command", serviceEnvProvisionSteps[16] ?? ""],
    ["service_env_provision_info_command", serviceEnvProvisionSteps[17] ?? ""],
    ["service_env_provision_sql_write_command", serviceEnvProvisionSteps[18] ?? ""],
    ["service_env_provision_sql_read_command", serviceEnvProvisionSteps[19] ?? ""],
    ["service_env_provision_owner_smoke_command", serviceEnvProvisionSteps[20] ?? ""],
    ["existing_db_service_env_command", readiness.existing_db_service_env_command],
    ["existing_db_service_env_inspect_env_command", existingDbServiceEnvSteps[1] ?? ""],
    ["existing_db_service_env_status_command", existingDbServiceEnvSteps[2] ?? ""],
    ["existing_db_service_env_members_command", existingDbServiceEnvSteps[3] ?? ""],
    ["existing_db_service_env_scalar_command", existingDbServiceEnvSteps[4] ?? ""],
    ["existing_db_service_env_tables_command", existingDbServiceEnvSteps[5] ?? ""],
    ["existing_db_service_env_views_command", existingDbServiceEnvSteps[6] ?? ""],
    ["existing_db_service_env_stats_command", existingDbServiceEnvSteps[7] ?? ""],
    ["existing_db_service_env_schema_command", existingDbServiceEnvSteps[8] ?? ""],
    ["existing_db_service_env_describe_command", existingDbServiceEnvSteps[9] ?? ""],
    ["existing_db_service_env_columns_command", existingDbServiceEnvSteps[10] ?? ""],
    ["existing_db_service_env_indexes_command", existingDbServiceEnvSteps[11] ?? ""],
    ["existing_db_service_env_triggers_command", existingDbServiceEnvSteps[12] ?? ""],
    ["existing_db_service_env_foreign_keys_command", existingDbServiceEnvSteps[13] ?? ""],
    ["existing_db_service_env_preview_command", existingDbServiceEnvSteps[14] ?? ""],
    ["existing_db_service_env_inspect_command", existingDbServiceEnvSteps[15] ?? ""],
    ["existing_db_service_env_url_command", existingDbServiceEnvSteps[16] ?? ""],
    ["existing_db_service_env_info_command", existingDbServiceEnvSteps[17] ?? ""],
    ["existing_db_service_env_sql_read_command", existingDbServiceEnvSteps[18] ?? ""],
    ["existing_db_service_env_owner_smoke_command", existingDbServiceEnvSteps[19] ?? ""],
    ["service_env_owner_sql_sdk_smoke_command", readiness.service_env_owner_sql_sdk_smoke_command],
    ["service_env_owner_archive_restore_smoke_command", readiness.service_env_owner_archive_restore_smoke_command],
    ["service_env_owner_sdk_archive_restore_smoke_command", readiness.service_env_owner_sdk_archive_restore_smoke_command],
    ["service_env_archive_command", readiness.service_env_archive_command],
    ["service_env_snapshot_info_command", readiness.service_env_snapshot_info_command],
    ["service_env_restore_command", readiness.service_env_restore_command],
    ["local_owner_service_env_smoke_command", readiness.local_owner_service_env_smoke_command],
    ["local_owner_service_env_backup_smoke_command", readiness.local_owner_service_env_backup_smoke_command],
    ["local_identity_quickstart_smoke_command", readiness.local_identity_quickstart_smoke_command],
    ["local_service_env_query_only_smoke_command", readiness.local_service_env_query_only_smoke_command],
    ["local_sdk_shortest_smoke_command", readiness.local_sdk_shortest_smoke_command],
    ["local_sdk_browser_shortest_smoke_command", readiness.local_sdk_browser_shortest_smoke_command],
    ["local_sdk_sqlite_shortest_smoke_command", readiness.local_sdk_sqlite_shortest_smoke_command],
    ["local_sdk_libsql_shortest_smoke_command", readiness.local_sdk_libsql_shortest_smoke_command],
    ["local_console_shortest_smoke_command", readiness.local_console_shortest_smoke_command],
    ["local_controller_quickstart_smoke_command", readiness.local_controller_quickstart_smoke_command],
    ["local_shards_smoke_command", readiness.local_shards_smoke_command],
    ["local_browser_smoke_command", readiness.local_browser_smoke_command],
    ["local_ii_browser_smoke_command", readiness.local_ii_browser_smoke_command],
    ["service_env_full_smoke_command", readiness.service_env_full_smoke_command],
    ["browser_ii_service_env_generate_command", browserIiServiceEnvSteps[0] ?? ""],
    ["browser_ii_service_principal_command", browserIiServiceEnvSteps[1] ?? ""],
    ["browser_ii_service_inspect_command", browserIiServiceEnvSteps[2] ?? ""],
    ["browser_ii_service_grant_step", browserIiServiceEnvSteps[3] ?? ""],
    ["browser_ii_service_status_command", browserIiServiceEnvSteps[4] ?? ""],
    ["browser_ii_service_members_command", browserIiServiceEnvSteps[5] ?? ""],
    ["browser_ii_service_scalar_command", browserIiServiceEnvSteps[6] ?? ""],
    ["browser_ii_service_tables_command", browserIiServiceEnvSteps[7] ?? ""],
    ["browser_ii_service_views_command", browserIiServiceEnvSteps[8] ?? ""],
    ["browser_ii_service_stats_command", browserIiServiceEnvSteps[9] ?? ""],
    ["browser_ii_service_schema_command", browserIiServiceEnvSteps[10] ?? ""],
    ["browser_ii_service_describe_command", browserIiServiceEnvSteps[11] ?? ""],
    ["browser_ii_service_columns_command", browserIiServiceEnvSteps[12] ?? ""],
    ["browser_ii_service_indexes_command", browserIiServiceEnvSteps[13] ?? ""],
    ["browser_ii_service_triggers_command", browserIiServiceEnvSteps[14] ?? ""],
    ["browser_ii_service_foreign_keys_command", browserIiServiceEnvSteps[15] ?? ""],
    ["browser_ii_service_preview_command", browserIiServiceEnvSteps[16] ?? ""],
    ["browser_ii_service_inspect_db_command", browserIiServiceEnvSteps[17] ?? ""],
    ["browser_ii_service_url_command", browserIiServiceEnvSteps[18] ?? ""],
    ["browser_ii_service_info_command", browserIiServiceEnvSteps[19] ?? ""],
    ["browser_ii_service_sql_read_command", browserIiServiceEnvSteps[20] ?? ""],
    ["browser_ii_service_smoke_command", browserIiServiceEnvSteps[21] ?? ""],
    ["controller_env_generate_command", controllerEnvSetupSteps[0] ?? ""],
    ["controller_env_principal_command", controllerEnvSetupSteps[1] ?? ""],
    ["controller_env_inspect_command", controllerEnvSetupSteps[2] ?? ""],
    ["controller_health_command", controllerEnvSetupSteps[3] ?? ""],
    ["controller_add_command", controllerEnvSetupSteps[4] ?? ""],
    ["controller_all_placements_command", controllerEnvSetupSteps[5] ?? ""],
    ["controller_shards_command", controllerEnvSetupSteps[6] ?? ""],
    ["controller_shard_ops_command", controllerEnvSetupSteps[7] ?? ""],
    ["controller_shard_maintain_dry_run_command", controllerEnvSetupSteps[8] ?? ""],
    ["controller_shard_smoke_command", controllerEnvSetupSteps[9] ?? ""],
    ["controller_shard_create_command", readiness.controller_shard_create_command],
    ["controller_shard_register_command", readiness.controller_shard_register_command],
    ["controller_shard_status_command", readiness.controller_shard_status_command],
    ["controller_shard_top_up_command", readiness.controller_shard_top_up_command],
    ["controller_shard_maintain_create_command", readiness.controller_shard_maintain_create_command],
    ["controller_shard_migrate_command", readiness.controller_shard_migrate_command],
    ["controller_remote_create_db_command", readiness.controller_remote_create_db_command],
    ["controller_shard_reconcile_applied_command", readiness.controller_shard_reconcile_applied_command],
    ["controller_shard_reconcile_failed_command", readiness.controller_shard_reconcile_failed_command],
    ["controller_full_shard_smoke_command", readiness.controller_env_full_shard_smoke_command],
    ["completion_command", readiness.completion_command],
    ["service_env_owner_smoke_command", readiness.service_env_owner_smoke_command],
    "",
    "Checks:",
    ...Object.entries(readiness.checks).map(([key, value]) => [`check.${key}`, value ? "ok" : "missing"]),
    "",
    "Completion plan:",
    ...tableCompletionPlanRows(readiness.completion_plan),
    "",
    "Approval required actions:",
    ...tableApprovalRequiredActionRows(readiness.approval_required_actions),
    "",
    "Evidence manifest:",
    ...tableEvidenceManifestRows(readiness.evidence_manifest),
    "",
    "Next steps:",
    ...readiness.next_steps.map((step, index) => [`${index + 1}.`, step])
  ].map((row) => Array.isArray(row) ? row.join("\t") : row).join("\n");
}

function tableApprovalRequiredActionRows(actions) {
  return actions.flatMap((action) => {
    const rows = [[
      action.id,
      action.requirement,
      action.blocked_by.length === 0 ? "unblocked" : `blocked_by=${action.blocked_by.join(",")}`,
      `external_action=${action.external_action}`,
      action.choice_group ? `choice_group=${action.choice_group}` : "choice_group=none",
      action.choice_required === undefined ? "choice_required=none" : `choice_required=${Boolean(action.choice_required)}`
    ]];
    const items = action.items ?? [];
    items.forEach((item, index) => {
      rows.push([`${action.id}.${isShellCommand(item) ? "command" : "manual"}.${index + 1}`, item]);
    });
    return rows;
  });
}

function tableEvidenceManifestRows(manifest) {
  return [
    ["version", String(manifest.version)],
    ["required_check_ids", manifest.required_check_ids.join(",")],
    ["missing_evidence_ids", manifest.missing_evidence_ids.join(",")],
    ...manifest.commands.flatMap((command) => [
      [command.id, command.requirement],
      [`${command.id}.command`, command.command],
      [`${command.id}.expected`, command.expected_evidence]
    ])
  ];
}

function tableCompletionPlanRows(plan) {
  return plan.flatMap((step) => {
    const rows = [[
      step.id,
      planRequirementLabel(step),
      step.blocked_by.length === 0 ? "unblocked" : `blocked_by=${step.blocked_by.join(",")}`,
      `approval_required=${Boolean(step.approval_required)}`,
      `external_action=${step.external_action ?? "none"}`,
      step.choice_group ? `choice_group=${step.choice_group}` : "choice_group=none",
      step.choice_required === undefined ? "choice_required=none" : `choice_required=${Boolean(step.choice_required)}`
    ]];
    if (step.command) {
      rows.push([`${step.id}.command`, step.command]);
      return rows;
    }
    const commands = step.commands ?? [];
    commands.forEach((command, index) => {
      rows.push([`${step.id}.${isShellCommand(command) ? "command" : "manual"}.${index + 1}`, command]);
    });
    return rows;
  });
}

function planRequirementLabel(step) {
  if (step.required) return "required";
  if (step.choice_required) return "choice-required";
  if (step.conditional) return "conditional";
  return "optional";
}

function isShellCommand(value) {
  return /^(node|icp|icpdb|pnpm|npm|cargo|bash|sh|eval)\s/.test(value);
}

function assertServiceEnvSmokeCommands(commands, serviceEnvFile) {
  const serviceEnvCheck = commands.find((step) => step.args.includes("scripts/icpdb-service-env-check.mjs"));
  if (
    !serviceEnvCheck?.args.includes(serviceEnvFile) ||
    !serviceEnvCheck.args.includes("--smoke-sql") ||
    !serviceEnvCheck.args.includes("--smoke-sdk") ||
    !serviceEnvCheck.args.includes("--smoke-archive-restore") ||
    !serviceEnvCheck.args.includes("--smoke-sdk-archive-restore") ||
    !serviceEnvCheck.args.includes("--require-role") ||
    !serviceEnvCheck.args.includes("owner") ||
    serviceEnvCheck.args.includes("--skip-call")
  ) {
    throw new Error("release command self-test failed: service env smoke flags must run live SQL and archive/restore checks");
  }
}

function assertControllerEnvSmokeCommands(commands, controllerEnvFile) {
  const controllerEnvCheck = commands.find((step) =>
    step.args.includes("scripts/icpdb-service-env-check.mjs") &&
    step.args.includes(controllerEnvFile)
  );
  if (
    !controllerEnvCheck ||
    !controllerEnvCheck.args.includes("--smoke-shards") ||
    !controllerEnvCheck.args.includes("--smoke-sdk-shards") ||
    controllerEnvCheck.args.includes("--skip-call")
  ) {
    throw new Error("release command self-test failed: controller env shard smoke must run live");
  }
}

function commandIndex(commands, scriptPath) {
  return commands.findIndex((step) => step.args.includes(scriptPath));
}

async function writeOwnerOnlyEnv(path, env) {
  await writeFile(path, `${Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function goalReadiness(command) {
  const mapping = command.ignoreMainnetMapping === true ? {} : await readMainnetMapping();
  const mappedCanisterId = mappedCanisterIdFromMapping(mapping);
  const canisterId = command.mainnetCanisterId || mappedCanisterId;
  const serviceEnv = command.serviceEnvFile
    ? await inspectServiceEnvFile(command.serviceEnvFile)
    : { status: "missing", path: null, owner_only: false, mode_octal: null };
  const controllerEnv = command.controllerEnvFile
    ? await inspectServiceEnvFile(command.controllerEnvFile)
    : { status: "missing", path: null, owner_only: false, mode_octal: null };
  const checks = {
    mainnet_canister_id: Boolean(canisterId && /^[a-z0-9-]+-cai$/.test(canisterId)),
    service_env_file: serviceEnv.status === "configured" && serviceEnv.owner_only,
    service_env_connection: Boolean(serviceEnv.canister_id && serviceEnv.database_id),
    service_env_no_create_setup_env: serviceEnv.status !== "configured" || !serviceEnv.db_bearing_create_setup_env,
    service_env_mainnet_canister_match: Boolean(canisterId && serviceEnv.canister_id && serviceEnv.canister_id === canisterId),
    service_env_mainnet_network: serviceEnv.status === "configured" && serviceEnv.mainnet_network === true,
    service_env_identity: Boolean(serviceEnv.has_identity),
    service_env_inspect: serviceEnv.inspect_env?.ok === true,
    service_env_inspect_connection_match: inspectEnvMatchesConfiguredConnection(serviceEnv),
    controller_env_file: controllerEnv.status === "configured" && controllerEnv.owner_only,
    controller_env_canister: Boolean(controllerEnv.canister_id),
    controller_env_canister_only: controllerEnv.status !== "configured" || !controllerEnv.database_id,
    controller_env_mainnet_canister_match: Boolean(canisterId && controllerEnv.canister_id && controllerEnv.canister_id === canisterId),
    controller_env_mainnet_network: controllerEnv.status === "configured" && controllerEnv.mainnet_network === true,
    controller_env_identity: Boolean(controllerEnv.has_identity),
    controller_env_inspect: controllerEnv.inspect_env?.ok === true,
    controller_env_inspect_connection_match: inspectEnvMatchesConfiguredConnection(controllerEnv)
  };
  const serviceEnvProvisionStepsValue = serviceEnvProvisionSteps(command, canisterId);
  const serviceEnvQueryOnlyStepsValue = serviceEnvQueryOnlySteps(command, canisterId);
  const existingDbServiceEnvStepsValue = existingDbServiceEnvSteps(command, canisterId);
  const browserIiServiceEnvStepsValue = browserIiServiceEnvSteps(command, canisterId);
  const controllerEnvSetupStepsValue = controllerEnvSetupSteps(command, canisterId);
  const completionPlan = goalCompletionPlan(command, checks, canisterId);
  const missingEvidence = goalMissingEvidence(checks);
  const nextSteps = goalReadinessNextSteps(command, checks, canisterId, serviceEnv, controllerEnv);
  const readiness = {
    ready: Object.values(checks).every(Boolean),
    checks,
    mainnet_mapping: mappedCanisterId
      ? { status: "configured", canister_id: mappedCanisterId }
      : { status: "missing", canister_id: null },
    mainnet_canister_id: canisterId || null,
    mainnet_canister_id_source: command.mainnetCanisterId ? "argument" : mappedCanisterId ? "mapping" : "missing",
    mainnet_deploy_command: mainnetDeployCommand(),
    mainnet_preflight_command: mainnetPreflightCommand(canisterId),
    mainnet_wiring_check_command: mainnetWiringCheckCommand(canisterId),
    mainnet_sql_smoke_command: mainnetSqlSmokeCommand(canisterId),
    mainnet_sql_archive_restore_command: mainnetArchiveRestoreSmokeCommand(canisterId),
    service_env: serviceEnv,
    controller_env: controllerEnv,
    required_service_env_role: "owner",
    service_env_provision_command: serviceEnvProvisionCommand(command, canisterId),
    service_env_provision_steps: serviceEnvProvisionStepsValue,
    service_env_query_only_steps: serviceEnvQueryOnlyStepsValue,
    service_env_query_only_generate_command: serviceEnvQueryOnlyStepsValue[0],
    service_env_query_only_scalar_command: serviceEnvQueryOnlyStepsValue[1],
    service_env_query_only_create_table_command: serviceEnvQueryOnlyStepsValue[2],
    service_env_query_only_write_command: serviceEnvQueryOnlyStepsValue[3],
    service_env_query_only_read_command: serviceEnvQueryOnlyStepsValue[4],
    service_env_query_only_url_command: serviceEnvQueryOnlyStepsValue[5],
    service_env_query_only_info_command: serviceEnvQueryOnlyStepsValue[6],
    service_env_query_only_owner_smoke_command: serviceEnvQueryOnlyStepsValue[7],
    existing_db_service_env_command: existingDbServiceEnvCommand(command, canisterId),
    existing_db_service_env_steps: existingDbServiceEnvStepsValue,
    service_env_owner_smoke_command: serviceEnvOwnerSmokeCommand(command),
    service_env_owner_sql_sdk_smoke_command: serviceEnvOwnerSqlSdkSmokeCommand(command),
    service_env_owner_archive_restore_smoke_command: serviceEnvOwnerArchiveRestoreSmokeCommand(command),
    service_env_owner_sdk_archive_restore_smoke_command: serviceEnvOwnerSdkArchiveRestoreSmokeCommand(command),
    service_env_archive_command: serviceEnvArchiveCommand(command),
    service_env_snapshot_info_command: serviceEnvSnapshotInfoCommand(),
    service_env_restore_command: serviceEnvRestoreCommand(command),
    local_owner_service_env_smoke_command: localOwnerServiceEnvSmokeCommand(),
    local_owner_service_env_backup_smoke_command: localOwnerServiceEnvBackupSmokeCommand(),
    local_identity_quickstart_smoke_command: localIdentityQuickstartSmokeCommand(),
    local_postdeploy_sql_archive_smoke_command: localPostdeploySqlArchiveSmokeCommand(),
    local_service_env_query_only_smoke_command: localServiceEnvQueryOnlySmokeCommand(),
    local_sdk_shortest_smoke_command: localSdkShortestSmokeCommand(),
    local_sdk_browser_shortest_smoke_command: localSdkBrowserShortestSmokeCommand(),
    local_sdk_sqlite_shortest_smoke_command: localSdkSqliteShortestSmokeCommand(),
    local_sdk_libsql_shortest_smoke_command: localSdkLibsqlShortestSmokeCommand(),
    local_console_shortest_smoke_command: localConsoleShortestSmokeCommand(),
    local_controller_quickstart_smoke_command: localControllerQuickstartSmokeCommand(),
    local_shards_smoke_command: localShardsSmokeCommand(),
    local_browser_smoke_command: localBrowserSmokeCommand(),
    local_ii_browser_smoke_command: localIiBrowserSmokeCommand(),
    service_env_full_smoke_command: serviceEnvFullSmokeCommand(command),
    browser_ii_service_env_steps: browserIiServiceEnvStepsValue,
    browser_ii_service_env_generate_command: browserIiServiceEnvStepsValue[0],
    browser_ii_service_principal_command: browserIiServiceEnvStepsValue[1],
    browser_ii_service_inspect_command: browserIiServiceEnvStepsValue[2],
    browser_ii_service_grant_step: browserIiServiceEnvStepsValue[3],
    browser_ii_service_status_command: browserIiServiceEnvStepsValue[4],
    browser_ii_service_members_command: browserIiServiceEnvStepsValue[5],
    browser_ii_service_scalar_command: browserIiServiceEnvStepsValue[6],
    browser_ii_service_tables_command: browserIiServiceEnvStepsValue[7],
    browser_ii_service_views_command: browserIiServiceEnvStepsValue[8],
    browser_ii_service_stats_command: browserIiServiceEnvStepsValue[9],
    browser_ii_service_schema_command: browserIiServiceEnvStepsValue[10],
    browser_ii_service_describe_command: browserIiServiceEnvStepsValue[11],
    browser_ii_service_columns_command: browserIiServiceEnvStepsValue[12],
    browser_ii_service_indexes_command: browserIiServiceEnvStepsValue[13],
    browser_ii_service_triggers_command: browserIiServiceEnvStepsValue[14],
    browser_ii_service_foreign_keys_command: browserIiServiceEnvStepsValue[15],
    browser_ii_service_preview_command: browserIiServiceEnvStepsValue[16],
    browser_ii_service_inspect_db_command: browserIiServiceEnvStepsValue[17],
    browser_ii_service_url_command: browserIiServiceEnvStepsValue[18],
    browser_ii_service_info_command: browserIiServiceEnvStepsValue[19],
    browser_ii_service_sql_read_command: browserIiServiceEnvStepsValue[20],
    browser_ii_service_smoke_command: browserIiServiceEnvStepsValue[21],
    controller_env_setup_steps: controllerEnvSetupStepsValue,
    controller_env_generate_command: controllerEnvSetupStepsValue[0],
    controller_env_principal_command: controllerEnvSetupStepsValue[1],
    controller_env_inspect_command: controllerEnvSetupStepsValue[2],
    controller_health_command: controllerEnvSetupStepsValue[3],
    controller_add_command: controllerEnvSetupStepsValue[4],
    controller_all_placements_command: controllerEnvSetupStepsValue[5],
    controller_shards_command: controllerEnvSetupStepsValue[6],
    controller_shard_ops_command: controllerEnvSetupStepsValue[7],
    controller_shard_maintain_dry_run_command: controllerEnvSetupStepsValue[8],
    controller_shard_smoke_command: controllerEnvSetupStepsValue[9],
    controller_shard_create_command: controllerShardCreateCommand(command),
    controller_shard_register_command: controllerShardRegisterCommand(command),
    controller_shard_status_command: controllerShardStatusCommand(command),
    controller_shard_top_up_command: controllerShardTopUpCommand(command),
    controller_shard_maintain_create_command: controllerShardMaintainCreateCommand(command),
    controller_shard_migrate_command: controllerShardMigrateCommand(command),
    controller_remote_create_db_command: controllerRemoteCreateDbCommand(command),
    controller_shard_reconcile_applied_command: controllerShardReconcileAppliedCommand(command),
    controller_shard_reconcile_failed_command: controllerShardReconcileFailedCommand(command),
    controller_env_full_shard_smoke_command: controllerEnvFullShardSmokeCommand(command),
    completion_command: goalCompleteCommand(command),
    completion_plan: completionPlan,
    approval_required_actions: approvalRequiredActions(completionPlan),
    missing_evidence: missingEvidence,
    next_steps: nextSteps
  };
  return {
    ...readiness,
    evidence_manifest: goalEvidenceManifest(readiness)
  };
}

function approvalRequiredActions(plan) {
  return plan
    .filter((step) => step.approval_required)
    .map((step) => ({
      id: step.id,
      requirement: planRequirementLabel(step),
      external_action: step.external_action ?? "none",
      blocked_by: step.blocked_by,
      choice_group: step.choice_group,
      choice_required: step.choice_required,
      items: step.command ? [step.command] : step.commands ?? []
    }));
}

function goalMissingEvidence(checks) {
  const labels = {
    mainnet_canister_id: "mainnet icpdb canister id from --mainnet-canister-id or .icp/data/mappings/ic.ids.json",
    service_env_file: "owner-only service.env file",
    service_env_connection: "database-bearing service.env connection",
    service_env_no_create_setup_env: "service.env does not combine a database connection with ICPDB_SETUP_* create-time setup",
    service_env_mainnet_canister_match: "service.env points at the target mainnet canister",
    service_env_mainnet_network: "service.env targets the mainnet network",
    service_env_identity: "service.env contains exactly one usable service identity secret",
    service_env_inspect: "local inspect-env can derive the service principal",
    service_env_inspect_connection_match: "service.env inspect-env output matches the parsed canister, database, and connection URL",
    controller_env_file: "owner-only controller.env file",
    controller_env_canister: "controller.env contains a target canister id",
    controller_env_canister_only: "controller.env is canister-only and does not contain ICPDB_DATABASE_ID or a database-bearing ICPDB_URL",
    controller_env_mainnet_canister_match: "controller.env points at the target mainnet canister",
    controller_env_mainnet_network: "controller.env targets the mainnet network",
    controller_env_identity: "controller.env contains exactly one usable controller identity secret",
    controller_env_inspect: "local controller inspect-env can derive the controller principal",
    controller_env_inspect_connection_match: "controller.env inspect-env output matches the parsed canister target"
  };
  return Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([id]) => ({ id, evidence: labels[id] ?? id }));
}

function goalEvidenceManifest(readiness) {
  const requiredCheckIds = Object.keys(readiness.checks);
  return {
    version: 1,
    ready: readiness.ready,
    mainnet_canister_id: readiness.mainnet_canister_id,
    required_check_ids: requiredCheckIds,
    missing_evidence_ids: readiness.missing_evidence.map((item) => item.id),
    commands: [
      {
        id: "sdk_package_artifact",
        requirement: "SDK package can be installed and used as a normal SQL DB client",
        command: "node icpdb-console/scripts/check-sdk-package-artifact.mjs",
        expected_evidence: "prints ICPDB SDK package artifact checks OK"
      },
      {
        id: "local_goal_smoke",
        requirement: "local DB creation, query/execute, console, archive/restore, shard, and II browser proof",
        command: "node scripts/icpdb-local-goal-smoke.mjs --skip-top-up",
        expected_evidence: "local goal smoke completes all default steps"
      },
      {
        id: "sdk_shortest_local",
        requirement: "focused SDK create-to-query/execute shortest path",
        command: readiness.local_sdk_shortest_smoke_command,
        expected_evidence: "focused SDK smoke verifies CREATE TABLE, INSERT, SELECT, scalar, and connectionUrl handoff"
      },
      {
        id: "sdk_browser_shortest_local",
        requirement: "focused browser SDK package subpath shortest path",
        command: readiness.local_sdk_browser_shortest_smoke_command,
        expected_evidence: "focused browser SDK smoke verifies package browser import, CREATE TABLE, INSERT, SELECT, scalar, and connectionUrl handoff"
      },
      {
        id: "sdk_sqlite_shortest_local",
        requirement: "focused hosted SQLite subpath shortest path",
        command: readiness.local_sdk_sqlite_shortest_smoke_command,
        expected_evidence: "focused SQLite subpath smoke verifies execute, query, scalar, reconnect, and URL handoff"
      },
      {
        id: "sdk_libsql_shortest_local",
        requirement: "focused libSQL-shaped shortest path",
        command: readiness.local_sdk_libsql_shortest_smoke_command,
        expected_evidence: "focused libSQL-shaped smoke verifies execute({ sql, args }), read execute, scalar, and URL handoff"
      },
      {
        id: "service_env_query_only_local",
        requirement: "focused Server/CI service.env query-only first-call path",
        command: readiness.local_service_env_query_only_smoke_command,
        expected_evidence: "focused service-env smoke verifies scalar first-call DB creation, execute, query, URL/info, and owner smoke"
      },
      {
        id: "console_shortest_local",
        requirement: "focused console schema/table/SQL inspection path",
        command: readiness.local_console_shortest_smoke_command,
        expected_evidence: "focused console smoke verifies setup SQL, table list, row read, catalog shortcuts, schema SQL, and schema lookup"
      },
      {
        id: "local_postdeploy_sql_archive_smoke",
        requirement: "local postdeploy SQL/archive rehearsal",
        command: readiness.local_postdeploy_sql_archive_smoke_command,
        expected_evidence: "local postdeploy smoke replays DB create, SQL execute, query, scalar, archive, restore, and delete before the external mainnet gate"
      },
      {
        id: "mainnet_preflight",
        requirement: "mainnet release artifact preflight",
        command: readiness.mainnet_preflight_command,
        expected_evidence: "preflight runs Candid drift, builds control/database Wasm artifacts, and reports size plus SHA-256 without creating or upgrading a mainnet canister"
      },
      {
        id: "mainnet_wiring",
        requirement: "mainnet canister deploy wiring",
        command: readiness.mainnet_wiring_check_command,
        expected_evidence: "skip-call postdeploy check proves selected canister id and HTTP URL wiring only; live health, SQL, and archive/restore remain separate evidence"
      },
      {
        id: "mainnet_sql_smoke",
        requirement: "mainnet hosted DB create, SQL execute, query, scalar, and cleanup",
        command: readiness.mainnet_sql_smoke_command,
        expected_evidence: "mainnet postdeploy smoke creates a DB, runs SQL, reads data, and deletes the DB"
      },
      {
        id: "mainnet_archive_restore_smoke",
        requirement: "mainnet archive/restore",
        command: readiness.mainnet_sql_archive_restore_command,
        expected_evidence: "mainnet postdeploy archive/restore smoke preserves snapshot hash and restored SQL reads"
      },
      {
        id: "service_env_full_smoke",
        requirement: "Server/CI service.env SQL, SDK, archive, and restore proof",
        command: readiness.service_env_full_smoke_command,
        expected_evidence: "service env check reports SQL, SDK, archive/restore, and SDK archive/restore checks"
      },
      {
        id: "service_env_direct_archive_restore",
        requirement: "direct Server/CI archive, snapshot-info, and hash-pinned restore operator path",
        command: [
          readiness.service_env_archive_command,
          readiness.service_env_snapshot_info_command,
          readiness.service_env_restore_command
        ].join(" && "),
        expected_evidence: "archive emits snapshot hash, snapshot-info re-reads it, and restore uses the pinned hash"
      },
      {
        id: "controller_env_full_shard_smoke",
        requirement: "controller.env shard inventory, journal, maintenance, and SDK shard proof",
        command: readiness.controller_env_full_shard_smoke_command,
        expected_evidence: "controller env check reports shard and SDK shard checks"
      },
      {
        id: "controller_env_shard_dry_run",
        requirement: "safe controller.env shard operation preflight",
        command: readiness.controller_shard_maintain_dry_run_command,
        expected_evidence: "zero-action shard maintenance reports current shard capacity without mutating state"
      },
      {
        id: "browser_ii_service_grant_manual",
        requirement: "Browser/II-owned DB manual ACL grant for Server/CI service identity",
        command: readiness.browser_ii_service_grant_step,
        expected_evidence: "console Permissions grants the generated service principal while Browser/II and Server/CI principals remain distinct"
      },
      {
        id: "browser_ii_service_acl_handoff",
        requirement: "Browser/II-owned DB service-principal ACL handoff proof",
        command: readiness.browser_ii_service_smoke_command,
        expected_evidence: "package check-env verifies owner role, SQL, SDK, archive/restore, and SDK archive/restore through the granted service identity"
      },
      {
        id: "local_browser_smoke",
        requirement: "local owner-token browser SQL, token, permission, archive, and shard proof",
        command: readiness.local_browser_smoke_command,
        expected_evidence: "local browser smoke verifies owner-token connection, remote placement, token/member admin, SQL/table UI, archive/restore, and deletion"
      },
      {
        id: "local_ii_browser_smoke",
        requirement: "local Browser/II login and owner workflow proof",
        command: readiness.local_ii_browser_smoke_command,
        expected_evidence: "local II browser smoke verifies login, DB creation, schema/table/SQL inspection, archive/restore, and deletion"
      },
      {
        id: "local_owner_service_env_smoke",
        requirement: "focused package init owner service.env SQL/setup proof",
        command: readiness.local_owner_service_env_smoke_command,
        expected_evidence: "focused owner service.env smoke verifies package init, seeded SQL, inspect-env, check-env, setup-file, migrations, and cleanup"
      },
      {
        id: "local_identity_quickstart_smoke",
        requirement: "focused Server/CI identity quickstart proof",
        command: readiness.local_identity_quickstart_smoke_command,
        expected_evidence: "focused identity quickstart smoke verifies package init, provision-service setup-file, migrations, query/execute, and service-env checks"
      },
      {
        id: "local_owner_service_env_backup_smoke",
        requirement: "focused package owner service.env archive/restore proof",
        command: readiness.local_owner_service_env_backup_smoke_command,
        expected_evidence: "focused owner service.env backup smoke verifies package SQL archive/restore, SDK archive/restore, direct owner archive/restore, and cleanup"
      },
      {
        id: "local_controller_quickstart_smoke",
        requirement: "focused controller identity and shard preflight proof",
        command: readiness.local_controller_quickstart_smoke_command,
        expected_evidence: "focused controller quickstart smoke verifies controller.env generation, controller health, shard inventory, zero-action maintenance, and SDK shard preflight"
      },
      {
        id: "local_shards_smoke",
        requirement: "focused multi-canister shard operation proof",
        command: readiness.local_shards_smoke_command,
        expected_evidence: "focused shard smoke verifies multi-canister routed SQL, shard operation journal, remote shard status, archive/restore, and reconciliation"
      },
      {
        id: "goal_complete_gate",
        requirement: "single final completion gate",
        command: readiness.completion_command,
        expected_evidence: "release check exits successfully with no missing evidence"
      }
    ]
  };
}

function goalReadinessNextSteps(command, checks, canisterId, serviceEnv, controllerEnv) {
  const completionCommand = goalCompleteCommand(command);
  if (Object.values(checks).every(Boolean)) return [`Run ${completionCommand}`];

  const steps = [];
  steps.push("Do not create database bearer tokens for goal completion; use service.env service identity for Server/CI and controller.env service identity for shard/controller proof.");
  steps.push("For heavy owner verification, run service_env_owner_sql_sdk_smoke_command, then service_env_owner_archive_restore_smoke_command, then service_env_owner_sdk_archive_restore_smoke_command; service_env_owner_smoke_command remains the one-shot equivalent.");
  steps.push("For direct backup operation, run service_env_archive_command, service_env_snapshot_info_command, and service_env_restore_command after owner service.env is configured.");
  steps.push("For direct shard operation, use controller_shard_create_command through controller_shard_reconcile_failed_command after controller.env is configured and granted as a canister controller.");
  if (!checks.mainnet_canister_id) {
    steps.push("Pass --mainnet-canister-id <id> or commit .icp/data/mappings/ic.ids.json with the icpdb canister id.");
    steps.push("Run mainnet_preflight_command before deploy to verify Candid drift plus control/database Wasm size and SHA-256 without a mainnet mutation.");
    steps.push("Use mainnet_deploy_command for a first deploy, then run mainnet_wiring_check_command with the deployed canister id.");
    steps.push("Before the external mainnet SQL/archive gate, run local_postdeploy_sql_archive_smoke_command against a fresh local-icpdb deploy.");
    steps.push("Run mainnet_sql_smoke_command after wiring to prove DB create, SQL execute, query, scalar, and delete on mainnet.");
    steps.push("Run mainnet_sql_archive_restore_command after SQL smoke to prove archive and restore on mainnet.");
    steps.push("Readiness still prints service env setup commands with a quoted '<id>' placeholder; replace it with the deployed canister id.");
    steps.push("After replacing '<id>', run service_env_provision_command for a setup-backed Server/CI DB, service_env_query_only_generate_command through service_env_query_only_owner_smoke_command for the shortest empty DB smoke plus immediate execute/query and owner smoke, existing_db_service_env_command with owner.env for an existing owner-key DB, or browser_ii_service_env_generate_command through browser_ii_service_smoke_command for a browser/II-owned DB.");
    steps.push("For a browser/II-owned DB, copy the console Response sidebar Connection URL and use its database id when replacing '<database-id>' in browser_ii_service_env_generate_command.");
    steps.push("For browser/II DB detail checks, replace '<table>' in browser_ii_service_describe_command through browser_ii_service_preview_command with a real table name from browser_ii_service_tables_command.");
    steps.push("After replacing '<id>', run controller_env_generate_command through controller_shard_smoke_command to create controller.env, add its principal as a canister controller, inspect shard state, run zero-action shard maintenance, and run shard smoke.");
  } else {
    steps.push("Run mainnet_preflight_command before mainnet SQL/archive smoke to verify Candid drift plus control/database Wasm size and SHA-256 without a mainnet mutation.");
    steps.push("If this is a first deploy and the explicit canister id is not live yet, run deploy_mainnet before mainnet_wiring_check_command; skip deploy_mainnet only when the canister is already deployed.");
    steps.push("Run mainnet_wiring_check_command before mainnet SQL/archive smoke to verify the selected canister id and postdeploy wiring.");
    steps.push("Run local_postdeploy_sql_archive_smoke_command before the external mainnet SQL/archive gate against a fresh local-icpdb deploy.");
    steps.push("Run mainnet_sql_smoke_command after wiring to prove DB create, SQL execute, query, scalar, and delete on mainnet.");
    steps.push("Run mainnet_sql_archive_restore_command after SQL smoke to prove archive and restore on mainnet.");
  }
  if (!checks.service_env_file) {
    steps.push("Create an owner-only service.env and chmod it to 0600.");
  }
  if (!checks.controller_env_file) {
    steps.push("Create an owner-only controller.env and chmod it to 0600.");
  }
  if (!checks.service_env_connection) {
    steps.push("Set ICPDB_URL=icpdb://<canister-id>/<database-id>, or set both ICPDB_CANISTER_ID and ICPDB_DATABASE_ID.");
  }
  if (!checks.service_env_no_create_setup_env) {
    steps.push("Remove ICPDB_SETUP_* from DB-bearing service.env; use script, batch, or migrate for existing database setup.");
  }
  if (!checks.controller_env_canister) {
    steps.push("Set ICPDB_CANISTER_ID=<canister-id> in controller.env, or set ICPDB_URL=icpdb://<canister-id>.");
  }
  if (!checks.controller_env_canister_only) {
    steps.push("Remove ICPDB_DATABASE_ID and database-bearing ICPDB_URL from controller.env; shard smoke uses canister-only controller env.");
  }
  if (canisterId && (!checks.service_env_file || !checks.service_env_connection || !checks.service_env_identity)) {
    steps.push("Use service_env_provision_command for a setup-backed Server/CI DB, service_env_query_only_generate_command through service_env_query_only_owner_smoke_command for the shortest empty DB smoke plus immediate execute/query and owner smoke, or existing_db_service_env_command for an existing DB when an owner service env is available.");
    steps.push("Use browser_ii_service_env_generate_command through browser_ii_service_smoke_command when the existing DB owner is a browser Internet Identity principal.");
    steps.push("For a browser/II-owned DB, copy the console Response sidebar Connection URL and use its database id when replacing '<database-id>' in browser_ii_service_env_generate_command.");
    steps.push("Replace '<table>' in browser_ii_service_describe_command through browser_ii_service_preview_command with a real table name from browser_ii_service_tables_command before running table detail checks.");
    if (serviceEnv.status === "configured") {
      steps.push("Move or remove the existing service.env before running --env-out service env generation commands; package icpdb refuses to overwrite existing env files.");
    }
  }
  if (canisterId && (!checks.controller_env_file || !checks.controller_env_canister || !checks.controller_env_identity)) {
    steps.push("Use controller_env_generate_command through controller_shard_smoke_command to create controller.env, add its principal as a canister controller, inspect shard state, run zero-action shard maintenance, and run shard smoke.");
    if (controllerEnv.status === "configured") {
      steps.push("Move or remove the existing controller.env before running --env-out controller env generation commands; package icpdb refuses to overwrite existing env files.");
    }
  }
  if (!checks.service_env_mainnet_canister_match && canisterId && serviceEnv.canister_id) {
    steps.push(`Point service.env at the mainnet canister ${canisterId}.`);
  }
  if (!checks.service_env_mainnet_network && serviceEnv.status === "configured") {
    steps.push(`Set ICPDB_NETWORK_URL=${MAINNET_NETWORK_URL}, or omit ICPDB_NETWORK_URL for mainnet.`);
  }
  if (!checks.controller_env_mainnet_canister_match && canisterId && controllerEnv.canister_id) {
    steps.push(`Point controller.env at the mainnet canister ${canisterId}.`);
  }
  if (!checks.controller_env_mainnet_network && controllerEnv.status === "configured") {
    steps.push(`Set controller.env ICPDB_NETWORK_URL=${MAINNET_NETWORK_URL}, or omit ICPDB_NETWORK_URL for mainnet.`);
  }
  if (!checks.service_env_identity) {
    if (serviceEnv.identity_secret_source && serviceEnv.identity_secret_owner_only === false) {
      steps.push("Set the referenced service identity file to owner-only mode 0600, then rerun readiness.");
    } else {
      steps.push("Add a service identity with ICPDB_IDENTITY_JSON, ICPDB_IDENTITY_JSON_FILE, ICPDB_IDENTITY_PEM, or ICPDB_IDENTITY_PEM_FILE.");
    }
  } else if (!checks.service_env_inspect) {
    steps.push("Fix the service identity so inspect-env can load its principal locally.");
  } else if (!checks.service_env_inspect_connection_match) {
    steps.push("Fix service.env so inspect-env reports the same canister, database id, and connection URL as the env file.");
  }
  if (!checks.controller_env_identity) {
    if (controllerEnv.identity_secret_source && controllerEnv.identity_secret_owner_only === false) {
      steps.push("Set the referenced controller identity file to owner-only mode 0600, then rerun readiness.");
    } else {
      steps.push("Add a controller identity with ICPDB_IDENTITY_JSON, ICPDB_IDENTITY_JSON_FILE, ICPDB_IDENTITY_PEM, or ICPDB_IDENTITY_PEM_FILE.");
    }
  } else if (!checks.controller_env_inspect) {
    steps.push("Fix the controller identity so inspect-env can load its principal locally.");
  } else if (!checks.controller_env_inspect_connection_match) {
    steps.push("Fix controller.env so inspect-env reports the same canister target as the env file.");
  }
  return steps;
}

function inspectEnvMatchesConfiguredConnection(envInfo) {
  if (envInfo.status !== "configured") return false;
  const inspect = envInfo.inspect_env;
  if (!inspect?.ok) return false;
  if (!envInfo.canister_id || inspect.canister_id !== envInfo.canister_id) return false;
  const expectedDatabaseId = envInfo.database_id || null;
  const actualDatabaseId = inspect.database_id || null;
  if (actualDatabaseId !== expectedDatabaseId) return false;
  if (!expectedDatabaseId) return !inspect.connection_url;
  return inspect.connection_url === envInfo.connection_url;
}

function goalCompleteCommand(command) {
  const includeServiceEnvFile = command.serviceEnvFile && command.serviceEnvFileExplicit !== false;
  const includeControllerEnvFile = command.controllerEnvFile && command.controllerEnvFileExplicit !== false;
  return [
    "node",
    "scripts/icpdb-release-check.mjs",
    "--goal-complete",
    ...(command.mainnetCanisterId ? ["--mainnet-canister-id", shellArg(command.mainnetCanisterId)] : []),
    ...(includeServiceEnvFile ? ["--service-env-file", shellArg(command.serviceEnvFile)] : []),
    ...(includeControllerEnvFile ? ["--controller-env-file", shellArg(command.controllerEnvFile)] : [])
  ].join(" ");
}

function mainnetDeployCommand() {
  return "icp deploy -e ic -y icpdb";
}

function mainnetPreflightCommand(canisterId) {
  return [
    "node",
    "scripts/icpdb-mainnet-preflight.mjs",
    ...(canisterId ? ["--canister-id", shellArg(canisterId)] : [])
  ].join(" ");
}

function mainnetWiringCheckCommand(canisterId) {
  return [
    "node",
    "scripts/icpdb-mainnet-postdeploy.mjs",
    "--skip-call",
    "--require-canister-id",
    "--canister-id",
    shellArg(canisterId || "<id>")
  ].join(" ");
}

function mainnetSqlSmokeCommand(canisterId) {
  return [
    "node",
    "scripts/icpdb-mainnet-postdeploy.mjs",
    "--require-canister-id",
    "--canister-id",
    shellArg(canisterId || "<id>"),
    "--smoke-sql"
  ].join(" ");
}

function mainnetArchiveRestoreSmokeCommand(canisterId) {
  return [
    mainnetSqlSmokeCommand(canisterId),
    "--smoke-archive-restore"
  ].join(" ");
}

function goalCompletionPlan(command, checks, canisterId) {
  const serviceEnvChoiceRequired = needsOwnerServiceEnvProvision(checks);
  const controllerEnvRequired = needsControllerEnvProvision(checks);
  return [
    {
      id: "verify_mainnet_preflight",
      required: true,
      blocked_by: [],
      approval_required: false,
      external_action: "none",
      command: mainnetPreflightCommand(canisterId)
    },
    {
      id: "deploy_mainnet",
      required: !checks.mainnet_canister_id,
      conditional: checks.mainnet_canister_id,
      blocked_by: [],
      approval_required: true,
      external_action: "mainnet_deploy",
      command: mainnetDeployCommand()
    },
    {
      id: "verify_mainnet_wiring",
      required: true,
      blocked_by: checks.mainnet_canister_id ? [] : ["mainnet_canister_id"],
      approval_required: false,
      external_action: "none",
      command: mainnetWiringCheckCommand(canisterId)
    },
    {
      id: "verify_mainnet_sql_smoke",
      required: true,
      blocked_by: checks.mainnet_canister_id ? [] : ["mainnet_canister_id"],
      approval_required: true,
      external_action: "mainnet_sql_mutation",
      command: mainnetSqlSmokeCommand(canisterId)
    },
    {
      id: "verify_mainnet_sql_archive_restore",
      required: true,
      blocked_by: checks.mainnet_canister_id ? [] : ["mainnet_canister_id"],
      approval_required: true,
      external_action: "mainnet_sql_archive_restore_mutation",
      command: mainnetArchiveRestoreSmokeCommand(canisterId)
    },
    {
      id: "provision_owner_service_env_new_db",
      required: false,
      choice_group: "provision_owner_service_env",
      choice_required: serviceEnvChoiceRequired,
      blocked_by: checks.mainnet_canister_id ? [] : ["mainnet_canister_id"],
      approval_required: true,
      external_action: "mainnet_service_env_db_create",
      commands: serviceEnvProvisionSteps(command, canisterId)
    },
    {
      id: "provision_owner_service_env_query_only_db",
      required: false,
      choice_group: "provision_owner_service_env",
      choice_required: serviceEnvChoiceRequired,
      blocked_by: checks.mainnet_canister_id ? [] : ["mainnet_canister_id"],
      approval_required: true,
      external_action: "mainnet_service_env_query_only_db_create",
      commands: serviceEnvQueryOnlySteps(command, canisterId)
    },
    {
      id: "provision_owner_service_env_existing_db",
      required: false,
      choice_group: "provision_owner_service_env",
      choice_required: serviceEnvChoiceRequired,
      blocked_by: checks.mainnet_canister_id ? ["owner_env_file", "database_id"] : ["mainnet_canister_id", "owner_env_file", "database_id"],
      approval_required: true,
      external_action: "mainnet_service_acl_grant",
      commands: existingDbServiceEnvSteps(command, canisterId)
    },
    {
      id: "provision_owner_service_env_browser_ii_db",
      required: false,
      choice_group: "provision_owner_service_env",
      choice_required: serviceEnvChoiceRequired,
      blocked_by: checks.mainnet_canister_id ? ["browser_ii_owner_console", "database_id"] : ["mainnet_canister_id", "browser_ii_owner_console", "database_id"],
      approval_required: true,
      external_action: "mainnet_browser_ii_acl_grant",
      commands: browserIiServiceEnvSteps(command, canisterId)
    },
    {
      id: "verify_owner_service_env_package_smoke",
      required: true,
      blocked_by: ownerServiceEnvSmokeBlockedBy(checks),
      approval_required: true,
      external_action: "mainnet_service_env_sql_archive_restore_mutation",
      commands: serviceEnvOwnerSmokeSteps(command)
    },
    {
      id: "provision_controller_env",
      required: controllerEnvRequired,
      blocked_by: checks.mainnet_canister_id ? ["canister_controller_identity"] : ["mainnet_canister_id", "canister_controller_identity"],
      approval_required: true,
      external_action: "mainnet_controller_grant",
      commands: controllerEnvSetupSteps(command, canisterId)
    },
    {
      id: "complete_goal_gate",
      required: true,
      blocked_by: Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
      approval_required: true,
      external_action: "mainnet_goal_completion_gate",
      command: goalCompleteCommand(command)
    }
  ];
}

function needsOwnerServiceEnvProvision(checks) {
  return [
    checks.service_env_file,
    checks.service_env_connection,
    checks.service_env_no_create_setup_env,
    checks.service_env_mainnet_canister_match,
    checks.service_env_mainnet_network,
    checks.service_env_identity,
    checks.service_env_inspect,
    checks.service_env_inspect_connection_match
  ].some((ok) => !ok);
}

function ownerServiceEnvSmokeBlockedBy(checks) {
  return [
    ["service_env_file", checks.service_env_file],
    ["service_env_connection", checks.service_env_connection],
    ["service_env_no_create_setup_env", checks.service_env_no_create_setup_env],
    ["service_env_mainnet_canister_match", checks.service_env_mainnet_canister_match],
    ["service_env_mainnet_network", checks.service_env_mainnet_network],
    ["service_env_identity", checks.service_env_identity],
    ["service_env_inspect", checks.service_env_inspect],
    ["service_env_inspect_connection_match", checks.service_env_inspect_connection_match]
  ].filter(([, ok]) => !ok).map(([key]) => key);
}

function needsControllerEnvProvision(checks) {
  return [
    checks.controller_env_file,
    checks.controller_env_canister,
    checks.controller_env_canister_only,
    checks.controller_env_mainnet_canister_match,
    checks.controller_env_mainnet_network,
    checks.controller_env_identity,
    checks.controller_env_inspect,
    checks.controller_env_inspect_connection_match
  ].some((ok) => !ok);
}

function serviceEnvProvisionCommand(command, canisterId) {
  const targetCanisterId = canisterId || "<id>";
  return [
    "icpdb",
    "init",
    "--canister-id",
    shellArg(targetCanisterId),
    "--network-url",
    shellArg(MAINNET_NETWORK_URL),
    "--env-out",
    shellArg(command.serviceEnvFile || "service.env"),
    "--setup-sql",
    shellArg(SERVICE_ENV_PROVISION_SETUP_SQL),
    "--format",
    "table"
  ].join(" ");
}

function serviceEnvQueryOnlyCommand(command, canisterId) {
  const targetCanisterId = canisterId || "<id>";
  return [
    "icpdb",
    "generate-identity",
    "--canister-id",
    shellArg(targetCanisterId),
    "--network-url",
    shellArg(MAINNET_NETWORK_URL),
    "--env-out",
    shellArg(command.serviceEnvFile || "service.env"),
    "--format",
    "table"
  ].join(" ");
}

function existingDbServiceEnvCommand(command, canisterId) {
  void canisterId;
  return [
    "icpdb",
    "provision-service",
    shellArg("<database-id>"),
    "owner",
    "--service-env-file",
    shellArg("owner.env"),
    "--env-out",
    shellArg(command.serviceEnvFile || "service.env"),
    "--format",
    "table"
  ].join(" ");
}

function serviceEnvProvisionSteps(command, canisterId) {
  const envFileArgs = packageServiceEnvFileArgs(command.serviceEnvFile || "service.env");
  return [
    serviceEnvProvisionCommand(command, canisterId),
    ...serviceEnvShapeCheckSteps(envFileArgs, "notes"),
    serviceEnvProvisionSqlWriteCommand(envFileArgs),
    serviceEnvProvisionSqlReadCommand(envFileArgs),
    serviceEnvOwnerSmokeCommand(command)
  ];
}

function serviceEnvQueryOnlySteps(command, canisterId) {
  const envFileArgs = packageServiceEnvFileArgs(command.serviceEnvFile || "service.env");
  return [
    serviceEnvQueryOnlyCommand(command, canisterId),
    [
      "icpdb",
      "scalar",
      ...envFileArgs,
      shellArg("SELECT 1 AS value"),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "execute",
      ...envFileArgs,
      shellArg("CREATE TABLE readiness_query_only(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"),
      "--idempotency-key",
      "readiness-query-only-create-table-001",
      "--wait",
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "execute",
      ...envFileArgs,
      shellArg("INSERT INTO readiness_query_only(body) VALUES (?1)"),
      "--params",
      shellArg("[\"readiness-query-only\"]"),
      "--idempotency-key",
      "readiness-query-only-write-001",
      "--wait",
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "query",
      ...envFileArgs,
      shellArg("SELECT body FROM readiness_query_only ORDER BY id DESC LIMIT 1"),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "url",
      ...envFileArgs,
      "--format",
      "env"
    ].join(" "),
    [
      "icpdb",
      "info",
      ...envFileArgs,
      "--format",
      "env"
    ].join(" "),
    serviceEnvOwnerSmokeCommand(command)
  ];
}

function existingDbServiceEnvSteps(command, canisterId) {
  const envFileArgs = packageServiceEnvFileArgs(command.serviceEnvFile || "service.env");
  return [
    existingDbServiceEnvCommand(command, canisterId),
    ...serviceEnvShapeCheckSteps(envFileArgs, "<table>"),
    existingDbServiceEnvSqlReadCommand(envFileArgs),
    serviceEnvOwnerSmokeCommand(command)
  ];
}

function serviceEnvProvisionSqlWriteCommand(envFileArgs) {
  return [
    "icpdb",
    "sql",
    ...envFileArgs,
    shellArg("INSERT INTO notes(body) VALUES (?1)"),
    "--params",
    shellArg("[\"readiness-sql-write\"]"),
    "--idempotency-key",
    "readiness-notes-sql-write-001",
    "--wait",
    "--format",
    "table"
  ].join(" ");
}

function serviceEnvProvisionSqlReadCommand(envFileArgs) {
  return [
    "icpdb",
    "sql",
    ...envFileArgs,
    shellArg("SELECT id, body FROM notes ORDER BY id DESC"),
    "--format",
    "table"
  ].join(" ");
}

function existingDbServiceEnvSqlReadCommand(envFileArgs) {
  return [
    "icpdb",
    "sql",
    ...envFileArgs,
    shellArg("SELECT count(*) FROM sqlite_schema"),
    "--format",
    "table"
  ].join(" ");
}

function serviceEnvShapeCheckSteps(envFileArgs, tableName) {
  return [
    [
      "icpdb",
      "inspect-env",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "status",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "members",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "scalar",
      ...envFileArgs,
      serviceEnvShapeScalarSql(tableName),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "tables",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "views",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "stats",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "schema",
      ...envFileArgs,
      shellArg(tableName),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "describe",
      ...envFileArgs,
      shellArg(tableName),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "columns",
      ...envFileArgs,
      shellArg(tableName),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "indexes",
      ...envFileArgs,
      shellArg(tableName),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "triggers",
      ...envFileArgs,
      shellArg(tableName),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "foreign-keys",
      ...envFileArgs,
      shellArg(tableName),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "preview",
      ...envFileArgs,
      shellArg(tableName),
      "--limit",
      "25",
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "inspect",
      ...envFileArgs,
      shellArg(tableName),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "url",
      ...envFileArgs,
      "--format",
      "env"
    ].join(" "),
    [
      "icpdb",
      "info",
      ...envFileArgs,
      "--format",
      "env"
    ].join(" ")
  ];
}

function serviceEnvShapeScalarSql(tableName) {
  return shellArg(tableName === "notes" ? "SELECT count(*) FROM notes" : "SELECT count(*) FROM sqlite_schema");
}

function serviceEnvOwnerSmokeCommand(command) {
  return serviceEnvOwnerCheckEnvCommand(command, [
    "--smoke-sql",
    "--smoke-sdk",
    "--smoke-archive-restore",
    "--smoke-sdk-archive-restore"
  ]);
}

function serviceEnvOwnerSqlSdkSmokeCommand(command) {
  return serviceEnvOwnerCheckEnvCommand(command, [
    "--smoke-sql",
    "--smoke-sdk"
  ]);
}

function serviceEnvOwnerArchiveRestoreSmokeCommand(command) {
  return serviceEnvOwnerCheckEnvCommand(command, [
    "--smoke-sql",
    "--smoke-archive-restore"
  ]);
}

function serviceEnvOwnerSdkArchiveRestoreSmokeCommand(command) {
  return serviceEnvOwnerCheckEnvCommand(command, [
    "--smoke-sdk-archive-restore"
  ]);
}

function serviceEnvArchiveCommand(command) {
  return [
    "icpdb",
    "archive",
    ...packageServiceEnvFileArgs(command.serviceEnvFile || "service.env"),
    shellArg(SERVICE_ENV_BACKUP_FILE),
    "--format",
    "env"
  ].join(" ");
}

function serviceEnvSnapshotInfoCommand() {
  return [
    "icpdb",
    "snapshot-info",
    shellArg(SERVICE_ENV_BACKUP_FILE),
    "--format",
    "env"
  ].join(" ");
}

function serviceEnvRestoreCommand(command) {
  return [
    `eval "$(${serviceEnvSnapshotInfoCommand()})"`,
    "&&",
    [
      "icpdb",
      "restore",
      ...packageServiceEnvFileArgs(command.serviceEnvFile || "service.env"),
      shellArg(SERVICE_ENV_BACKUP_FILE),
      "--expect-snapshot-hash",
      '"$ICPDB_SNAPSHOT_HASH"',
      "--format",
      "table"
    ].join(" ")
  ].join(" ");
}

function serviceEnvOwnerSmokeSteps(command) {
  return [
    serviceEnvOwnerSqlSdkSmokeCommand(command),
    serviceEnvOwnerArchiveRestoreSmokeCommand(command),
    serviceEnvOwnerSdkArchiveRestoreSmokeCommand(command)
  ];
}

function serviceEnvOwnerCheckEnvCommand(command, smokeFlags) {
  const serviceEnvFile = command.serviceEnvFile || "service.env";
  return [
    "icpdb",
    "check-env",
    ...packageServiceEnvFileArgs(serviceEnvFile),
    "--require-role",
    "owner",
    ...smokeFlags,
    "--format",
    "table"
  ].join(" ");
}

function localOwnerServiceEnvSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only service-owner --skip-top-up";
}

function localOwnerServiceEnvBackupSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only service-owner-backup --skip-top-up";
}

function localIdentityQuickstartSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only identity-quickstart --skip-top-up";
}

function localPostdeploySqlArchiveSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only postdeploy-sql-archive --skip-top-up";
}

function localServiceEnvQueryOnlySmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,service-query-only --skip-top-up";
}

function localSdkShortestSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-shortest --skip-top-up";
}

function localSdkBrowserShortestSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-browser-shortest --skip-top-up";
}

function localSdkSqliteShortestSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-sqlite-shortest --skip-top-up";
}

function localSdkLibsqlShortestSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only sdk-build,sdk-libsql-shortest --skip-top-up";
}

function localConsoleShortestSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only console-shortest --skip-top-up";
}

function localControllerQuickstartSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only controller-quickstart --skip-top-up";
}

function localShardsSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only shards --skip-top-up";
}

function localBrowserSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only browser --skip-top-up";
}

function localIiBrowserSmokeCommand() {
  return "node scripts/icpdb-local-goal-smoke.mjs --only ii-browser --skip-top-up";
}

function serviceEnvFullSmokeCommand(command) {
  const envFileArgs = command.serviceEnvFile && (command.serviceEnvFileExplicit === true || command.serviceEnvFile !== DEFAULT_SERVICE_ENV_FILE)
    ? ["--env-file", shellArg(command.serviceEnvFile)]
    : [];
  return [
    "node",
    "scripts/icpdb-service-env-check.mjs",
    ...envFileArgs,
    "--require-role",
    "owner",
    "--smoke-sql",
    "--smoke-sdk",
    "--smoke-archive-restore",
    "--smoke-sdk-archive-restore",
    "--format",
    "table"
  ].join(" ");
}

function browserIiServiceEnvSteps(command, canisterId) {
  const targetCanisterId = canisterId || "<id>";
  const serviceEnvFile = command.serviceEnvFile || "service.env";
  const envFileArgs = packageServiceEnvFileArgs(serviceEnvFile);
  return [
    [
      "icpdb",
      "generate-identity",
      "--canister-id",
      shellArg(targetCanisterId),
      "--database-id",
      shellArg("<database-id>"),
      "--network-url",
      shellArg(MAINNET_NETWORK_URL),
      "--env-out",
      shellArg(serviceEnvFile),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "principal",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "inspect-env",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    "Copy the console Response sidebar Connection URL to identify the browser/II-owned database id, then grant the printed service principal as owner in console Permissions while logged in with the browser/II database owner; Browser/II and Server/CI principals stay different and are joined through the DB ACL.",
    [
      "icpdb",
      "status",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "members",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "scalar",
      ...envFileArgs,
      serviceEnvShapeScalarSql("<table>"),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "tables",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "views",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "stats",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "schema",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "describe",
      ...envFileArgs,
      shellArg("<table>"),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "columns",
      ...envFileArgs,
      shellArg("<table>"),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "indexes",
      ...envFileArgs,
      shellArg("<table>"),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "triggers",
      ...envFileArgs,
      shellArg("<table>"),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "foreign-keys",
      ...envFileArgs,
      shellArg("<table>"),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "preview",
      ...envFileArgs,
      shellArg("<table>"),
      "--limit",
      "25",
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "inspect",
      ...envFileArgs,
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "url",
      ...envFileArgs,
      "--format",
      "env"
    ].join(" "),
    [
      "icpdb",
      "info",
      ...envFileArgs,
      "--format",
      "env"
    ].join(" "),
    existingDbServiceEnvSqlReadCommand(envFileArgs),
    serviceEnvOwnerSmokeCommand(command)
  ];
}

function serviceEnvFileArgs(filePath) {
  return filePath === "service.env" || filePath === "./service.env"
    ? []
    : ["--env-file", shellArg(filePath)];
}

function packageServiceEnvFileArgs(filePath) {
  return filePath === "service.env" || filePath === "./service.env"
    ? []
    : ["--service-env-file", shellArg(filePath)];
}

function controllerEnvSetupSteps(command, canisterId) {
  const targetCanisterId = canisterId || "<id>";
  const controllerEnvFile = command.controllerEnvFile || "controller.env";
  return [
    [
      "icpdb",
      "generate-identity",
      "--canister-id",
      shellArg(targetCanisterId),
      "--network-url",
      shellArg(MAINNET_NETWORK_URL),
      "--env-out",
      shellArg(controllerEnvFile),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "principal",
      "--service-env-file",
      shellArg(controllerEnvFile),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "inspect-env",
      "--service-env-file",
      shellArg(controllerEnvFile),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "health",
      "--service-env-file",
      shellArg(controllerEnvFile),
      "--format",
      "table"
    ].join(" "),
    [
      "eval",
      `"$(icpdb principal --service-env-file ${shellArg(controllerEnvFile)} --format env)"`,
      "&&",
      "icp",
      "canister",
      "settings",
      "update",
      "-n",
      "ic",
      shellArg(targetCanisterId),
      "--add-controller",
      '"$ICPDB_SERVICE_PRINCIPAL"',
      "-f"
    ].join(" "),
    [
      "icpdb",
      "all-placements",
      "--service-env-file",
      shellArg(controllerEnvFile),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "shards",
      "--service-env-file",
      shellArg(controllerEnvFile),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "shard-ops",
      "--service-env-file",
      shellArg(controllerEnvFile),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "shard-maintain",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "--service-env-file",
      shellArg(controllerEnvFile),
      "--format",
      "table"
    ].join(" "),
    [
      "icpdb",
      "check-env",
      "--service-env-file",
      shellArg(controllerEnvFile),
      "--smoke-shards",
      "--smoke-sdk-shards",
      "--format",
      "table"
    ].join(" ")
  ];
}

function controllerShardCommand(command, args) {
  return [
    "icpdb",
    ...args,
    "--service-env-file",
    shellArg(command.controllerEnvFile || "controller.env"),
    "--format",
    "table"
  ].join(" ");
}

function controllerShardCreateCommand(command) {
  return controllerShardCommand(command, ["shard-create", "100000000000", "8"]);
}

function controllerShardRegisterCommand(command) {
  return controllerShardCommand(command, ["shard-register", shellArg("<database-canister-id>"), "8"]);
}

function controllerShardStatusCommand(command) {
  return controllerShardCommand(command, ["shard-status", shellArg("<database-canister-id>")]);
}

function controllerShardTopUpCommand(command) {
  return controllerShardCommand(command, ["shard-top-up", shellArg("<database-canister-id>"), "1000000"]);
}

function controllerShardMaintainCreateCommand(command) {
  return controllerShardCommand(command, ["shard-maintain", "1", "0", "0", "0", "8", "0"]);
}

function controllerShardMigrateCommand(command) {
  return controllerShardCommand(command, ["shard-migrate", shellArg("<database-id>"), shellArg("<database-canister-id>")]);
}

function controllerRemoteCreateDbCommand(command) {
  return controllerShardCommand(command, ["remote-create-db", shellArg("<database-id>"), shellArg("<database-canister-id>")]);
}

function controllerShardReconcileAppliedCommand(command) {
  return controllerShardCommand(command, ["shard-reconcile", shellArg("<operation-id>"), "applied"]);
}

function controllerShardReconcileFailedCommand(command) {
  return controllerShardCommand(command, ["shard-reconcile", shellArg("<operation-id>"), "failed", shellArg("operator verified failure")]);
}

function controllerEnvFullShardSmokeCommand(command) {
  return [
    "node",
    "scripts/icpdb-service-env-check.mjs",
    "--env-file",
    shellArg(command.controllerEnvFile || "controller.env"),
    "--smoke-shards",
    "--smoke-sdk-shards",
    "--format",
    "table"
  ].join(" ");
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function assertServiceEnvTargetsMainnet(command) {
  const readiness = await goalReadiness(command);
  if (readiness.service_env.status === "configured" && !readiness.checks.service_env_mainnet_network) {
    throw new Error(
      `service env network ${readiness.service_env.network_url ?? MAINNET_NETWORK_URL} does not target mainnet ${MAINNET_NETWORK_URL}`
    );
  }
  if (
    readiness.checks.mainnet_canister_id &&
    readiness.checks.service_env_connection &&
    (!readiness.checks.service_env_mainnet_canister_match || !readiness.checks.service_env_mainnet_network)
  ) {
    if (!readiness.checks.service_env_mainnet_canister_match) {
      throw new Error(
        `service env canister ${readiness.service_env.canister_id} does not match mainnet target ${readiness.mainnet_canister_id}`
      );
    }
    throw new Error(
      `service env network ${readiness.service_env.network_url ?? MAINNET_NETWORK_URL} does not target mainnet ${MAINNET_NETWORK_URL}`
    );
  }
}

async function assertControllerEnvTargetsMainnet(command) {
  const readiness = await goalReadiness(command);
  if (readiness.controller_env.status === "configured" && !readiness.checks.controller_env_mainnet_network) {
    throw new Error(
      `controller env network ${readiness.controller_env.network_url ?? MAINNET_NETWORK_URL} does not target mainnet ${MAINNET_NETWORK_URL}`
    );
  }
  if (
    readiness.checks.mainnet_canister_id &&
    readiness.checks.controller_env_canister &&
    (!readiness.checks.controller_env_mainnet_canister_match || !readiness.checks.controller_env_mainnet_network)
  ) {
    if (!readiness.checks.controller_env_mainnet_canister_match) {
      throw new Error(
        `controller env canister ${readiness.controller_env.canister_id} does not match mainnet target ${readiness.mainnet_canister_id}`
      );
    }
    throw new Error(
      `controller env network ${readiness.controller_env.network_url ?? MAINNET_NETWORK_URL} does not target mainnet ${MAINNET_NETWORK_URL}`
    );
  }
}

async function readMainnetMapping() {
  const text = await readOptionalFile(".icp/data/mappings/ic.ids.json");
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(".icp/data/mappings/ic.ids.json must be a JSON object");
  }
  return parsed;
}

function mappedCanisterIdFromMapping(mapping) {
  if (!Object.hasOwn(mapping, "icpdb")) return "";
  const value = mapping.icpdb;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(".icp/data/mappings/ic.ids.json icpdb must be a non-empty string");
  }
  if (!/^[a-z0-9-]+-cai$/.test(value)) {
    throw new Error(".icp/data/mappings/ic.ids.json icpdb must be a canister id ending in -cai");
  }
  return value;
}

async function inspectServiceEnvFile(path) {
  try {
    const stats = await stat(path);
    const mode = stats.mode & 0o777;
    const env = parseEnvFile(await readFile(path, "utf8"), path);
    const connection = serviceEnvConnection(env);
    validateServiceEnvOptionalValues(env);
    const hasCreateSetupEnv = serviceEnvHasCreateSetup(env);
    const networkUrl = optionalNonEmptyEnvValue(env, "ICPDB_NETWORK_URL");
    const identitySecret = await inspectIdentitySecret(env);
    return {
      status: "configured",
      path,
      owner_only: (mode & 0o077) === 0,
      mode_octal: modeToOctal(mode),
      canister_id: connection.canisterId,
      database_id: connection.databaseId,
      has_create_setup_env: hasCreateSetupEnv,
      db_bearing_create_setup_env: Boolean(connection.databaseId && hasCreateSetupEnv),
      connection_url: connection.canisterId && connection.databaseId
        ? formatIcpdbUrl(connection.canisterId, connection.databaseId)
        : env.ICPDB_URL ?? null,
      network_url: networkUrl ?? null,
      mainnet_network: isMainnetNetworkUrl(networkUrl),
      has_identity: identitySecret.configured && identitySecret.owner_only,
      identity_secret_source: identitySecret.source,
      identity_secret_owner_only: identitySecret.owner_only,
      ...(identitySecret.error ? { identity_secret_error: identitySecret.error } : {}),
      inspect_env: await inspectServiceEnvLocally(path)
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { status: "missing", path, owner_only: false, mode_octal: null };
    }
    throw error;
  }
}

function serviceEnvHasCreateSetup(env) {
  return [
    "ICPDB_SETUP_SQL",
    "ICPDB_SETUP_SQL_FILE",
    "ICPDB_SETUP_STATEMENTS",
    "ICPDB_SETUP_STATEMENTS_FILE",
    "ICPDB_SETUP_MIGRATIONS",
    "ICPDB_SETUP_MIGRATIONS_FILE"
  ].some((key) => Object.hasOwn(env, key) && String(env[key]).trim().length > 0);
}

async function inspectServiceEnvLocally(path) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/icpdb-service-env-check.mjs",
      "--env-file",
      path,
      "--skip-call"
    ], { maxBuffer: 8 * 1024 * 1024 });
    const parsed = JSON.parse(stdout);
    return {
      ok: true,
      principal: parsed.inspect?.principal ?? null,
      canister_id: parsed.inspect?.canister_id ?? null,
      database_id: parsed.inspect?.database_id ?? null,
      connection_url: parsed.inspect?.connection_url ?? null
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseEnvFile(source, path) {
  const parsed = {};
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) throw new Error(`${path}:${index + 1}: invalid env line`);
    const key = match[1];
    if (Object.hasOwn(parsed, key)) throw new Error(`duplicate env key ${key} at ${path}:${index + 1}`);
    parsed[key] = parseEnvValue(match[2].trim(), path, index + 1);
  }
  return parsed;
}

function parseEnvValue(source, path, lineNumber) {
  if (source.startsWith("\"")) {
    try {
      const parsed = JSON.parse(source);
      if (typeof parsed !== "string") throw new Error("env value must be a string");
      return parsed;
    } catch (error) {
      throw new Error(`${path}:${lineNumber}: invalid quoted env value: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (source.startsWith("'")) {
    if (!source.endsWith("'")) throw new Error(`${path}:${lineNumber}: invalid single-quoted env value`);
    return source.slice(1, -1);
  }
  return source;
}

function serviceEnvConnection(env) {
  const envUrl = optionalNonEmptyEnvValue(env, "ICPDB_URL");
  const envCanisterId = optionalNonEmptyEnvValue(env, "ICPDB_CANISTER_ID");
  const envDatabaseId = optionalNonEmptyEnvValue(env, "ICPDB_DATABASE_ID");
  const parsedUrl = envUrl ? parseIcpdbUrl(envUrl) : null;
  if (parsedUrl && envCanisterId && envCanisterId !== parsedUrl.canisterId) {
    throw new Error("ICPDB_CANISTER_ID does not match ICPDB_URL");
  }
  if (parsedUrl?.databaseId && envDatabaseId && envDatabaseId !== parsedUrl.databaseId) {
    throw new Error("ICPDB_DATABASE_ID does not match ICPDB_URL");
  }
  const canisterId = envCanisterId ?? parsedUrl?.canisterId ?? "";
  const databaseId = envDatabaseId ?? parsedUrl?.databaseId ?? "";
  return { canisterId, databaseId };
}

function optionalNonEmptyEnvValue(env, key) {
  if (!Object.hasOwn(env, key) || env[key] === undefined) return undefined;
  const value = String(env[key]);
  if (value.trim().length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function validateServiceEnvOptionalValues(env) {
  for (const key of [
    "ICPDB_NETWORK_URL",
    "ICPDB_ROOT_KEY",
    "ICPDB_IDENTITY_JSON",
    "ICPDB_IDENTITY_JSON_FILE",
    "ICPDB_IDENTITY_PEM",
    "ICPDB_IDENTITY_PEM_FILE",
    "ICPDB_IDENTITY_TYPE"
  ]) {
    optionalNonEmptyEnvValue(env, key);
  }
  const identityType = optionalNonEmptyEnvValue(env, "ICPDB_IDENTITY_TYPE");
  const identitySources = serviceIdentitySecretSources(env);
  if (identitySources.length > 1) {
    throw new Error(`service env must use exactly one identity secret source: ${identitySources.join(", ")}`);
  }
  if (
    identityType !== undefined &&
    identityType !== "auto" &&
    identityType !== "ed25519" &&
    identityType !== "secp256k1"
  ) {
    throw new Error("ICPDB_IDENTITY_TYPE must be auto, ed25519, or secp256k1");
  }
}

function parseIcpdbUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`invalid ICPDB_URL: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.protocol !== "icpdb:") throw new Error("ICPDB_URL must be icpdb://<canister-id>/<database-id>");
  if (parsed.username || parsed.password) throw new Error("ICPDB_URL must not include username or password");
  if (parsed.port) throw new Error("ICPDB_URL must not include a port");
  if (parsed.search || parsed.hash) throw new Error("ICPDB_URL must not include query or fragment");
  const hasDatabasePath = parsed.pathname !== "" && parsed.pathname !== "/";
  if (hasDatabasePath && !/^\/[^/]+$/.test(parsed.pathname)) throw new Error("ICPDB_URL path must be /<database-id>");
  const canisterId = parsed.hostname;
  if (canisterId.trim().length === 0) throw new Error("ICPDB_CANISTER_ID must be a non-empty string");
  const databaseId = hasDatabasePath ? decodeIcpdbUrlPart(parsed.pathname.slice(1), "database id") : "";
  if (hasDatabasePath && databaseId.trim().length === 0) throw new Error("ICPDB_DATABASE_ID must be a non-empty string");
  return {
    canisterId,
    databaseId
  };
}

function decodeIcpdbUrlPart(value, label) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw new Error(`invalid ICPDB_URL ${label} encoding: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function formatIcpdbUrl(canisterId, databaseId) {
  return `icpdb://${canisterId}/${encodeURIComponent(databaseId)}`;
}

async function inspectIdentitySecret(env) {
  const sources = serviceIdentitySecretSources(env);
  if (sources.length !== 1) {
    return { configured: false, source: null, owner_only: false };
  }
  const source = sources[0];
  if (source !== "ICPDB_IDENTITY_JSON_FILE" && source !== "ICPDB_IDENTITY_PEM_FILE") {
    return { configured: true, source, owner_only: true };
  }
  const path = optionalNonEmptyEnvValue(env, source);
  try {
    const stats = await stat(path);
    const mode = stats.mode & 0o777;
    return {
      configured: true,
      source,
      path,
      mode_octal: modeToOctal(mode),
      owner_only: (mode & 0o077) === 0
    };
  } catch (error) {
    return {
      configured: true,
      source,
      path,
      owner_only: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function serviceIdentitySecretSources(env) {
  return [
    "ICPDB_IDENTITY_JSON",
    "ICPDB_IDENTITY_JSON_FILE",
    "ICPDB_IDENTITY_PEM",
    "ICPDB_IDENTITY_PEM_FILE"
  ].filter((key) => optionalNonEmptyEnvValue(env, key) !== undefined);
}

function isMainnetNetworkUrl(networkUrl) {
  return !networkUrl || normalizeNetworkUrl(networkUrl) === MAINNET_NETWORK_URL;
}

function normalizeNetworkUrl(networkUrl) {
  const trimmed = String(networkUrl).trim();
  try {
    const parsed = new URL(trimmed);
    if (!parsed.pathname || parsed.pathname === "/") {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    // Fall through to slash trimming for the same user-facing comparison.
  }
  return trimmed.replace(/\/+$/, "");
}

async function readOptionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

function modeToOctal(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}
