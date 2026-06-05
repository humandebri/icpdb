// Where: scripts/icpdb-http-wait.mjs
// What: Routed write wait helpers for the bearer-token HTTP CLI.
// Why: Server/CI scripts need one-command proof that remote shard writes are no longer pending.

const DEFAULT_WAIT_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_INTERVAL_MS = 500;

export async function maybeWaitForRoutedResponse(command, value, fetchImpl, callHttp) {
  if (!command.waitForRoutedOperation) return value;
  const operations = await waitForResponseOperations(command, value, fetchImpl, callHttp);
  if (Array.isArray(value)) {
    return { results: value, routed_operations: operations };
  }
  return { ...value, routed_operation: operations[0] };
}

export async function waitForResponseOperations(command, value, fetchImpl, callHttp) {
  const operationIds = routedOperationIds(value);
  if (operationIds.length === 0) {
    throw new Error("--wait requires a remote routed write result");
  }
  const operations = [];
  for (const operationId of operationIds) {
    operations.push(await waitForRoutedOperation(command, operationId, fetchImpl, callHttp));
  }
  return operations;
}

export async function waitForRoutedOperation(command, operationId, fetchImpl, callHttp) {
  const startedAt = Date.now();
  while (true) {
    const operation = await callHttp(operationCommand(command, operationId), fetchImpl);
    if (routedOperationStatus(operation) !== "pending") return operation;
    if (Date.now() - startedAt >= DEFAULT_WAIT_TIMEOUT_MS) {
      throw new Error(`timed out waiting for routed operation: ${operationId}`);
    }
    await delay(DEFAULT_WAIT_INTERVAL_MS);
  }
}

function routedOperationIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(routedOperationId).filter((operationId) => operationId.length > 0))];
}

function routedOperationId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return typeof value.routed_operation_id === "string" ? value.routed_operation_id : "";
}

function operationCommand(command, operationId) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/operations/get",
    body: {
      database_id: databaseId(command),
      operation_id: operationId
    }
  };
}

function databaseId(command) {
  if (typeof command.databaseId === "string" && command.databaseId.length > 0) return command.databaseId;
  if (command.body && typeof command.body.database_id === "string" && command.body.database_id.length > 0) {
    return command.body.database_id;
  }
  throw new Error("--wait requires a database_id");
}

function routedOperationStatus(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return "pending";
  const status = String(operation.status ?? "").toLowerCase();
  return status === "applied" || status === "failed" || status === "unknown" ? status : "pending";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
