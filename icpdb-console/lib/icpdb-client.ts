import { Actor, HttpAgent, type Identity } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import { ApiError, classifyApiError, invalidCanisterIdError } from "@/lib/api-errors";
import { idlFactory } from "@/lib/icpdb-idl";
import type {
  CanisterHealth,
  CreateDatabaseTokenResponse,
  DatabaseBilling,
  DatabaseRole,
  DatabaseStatus,
  DatabaseSummary,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DatabaseUsage,
  DepositQuote,
  DepositResult,
  PaymentRecord,
  SqlExecuteRequest,
  SqlExecuteResponse,
  SqlValue
} from "@/lib/types";

type Variant = Record<string, null>;

type RawCanisterHealth = {
  cycles_balance: bigint;
};

type RawDatabaseSummary = {
  status: Variant;
  role: Variant;
  logical_size_bytes: bigint;
  database_id: string;
  archived_at_ms: [] | [bigint];
  deleted_at_ms: [] | [bigint];
};

type RawDatabaseUsage = {
  database_id: string;
  status: Variant;
  logical_size_bytes: bigint;
  max_logical_size_bytes: bigint;
  usage_event_count: bigint;
};

type RawDatabaseBilling = {
  database_id: string;
  status: Variant;
  balance_units: bigint;
  spent_units: bigint;
  usage_event_count: bigint;
};

type RawDepositQuote = {
  database_id: string;
  amount_e8s: bigint;
  expected_fee_e8s: bigint;
  credited_units: bigint;
  ledger_canister_id: string;
  spender_principal: string;
};

type RawDepositResult = {
  database_id: string;
  amount_e8s: bigint;
  credited_units: bigint;
  block_index: bigint;
  balance_units: bigint;
};

type RawPaymentRecord = {
  payment_id: string;
  database_id: string;
  payer_principal: string;
  amount_e8s: bigint;
  credited_units: bigint;
  block_index: bigint;
  created_at_ms: bigint;
};

type RawDatabaseTokenInfo = {
  token_id: string;
  database_id: string;
  name: string;
  scope: Variant;
  created_at_ms: bigint;
  last_used_at_ms: [] | [bigint];
  revoked_at_ms: [] | [bigint];
};

type RawCreateDatabaseTokenResponse = {
  token: string;
  info: RawDatabaseTokenInfo;
};

type RawSqlValue =
  | { Null: null }
  | { Integer: bigint }
  | { Real: number }
  | { Text: string }
  | { Blob: number[] };

type RawSqlExecuteRequest = {
  database_id: string;
  sql: string;
  params: RawSqlValue[];
  max_rows: [] | [number];
};

type RawSqlExecuteResponse = {
  columns: string[];
  rows: RawSqlValue[][];
  rows_affected: bigint;
  last_insert_rowid: bigint;
  truncated: boolean;
};

type IcpdbActor = {
  canister_health: () => Promise<RawCanisterHealth>;
  create_database: () => Promise<{ Ok: string } | { Err: string }>;
  create_database_token: (request: { database_id: string; name: string; scope: Variant }) => Promise<
    { Ok: RawCreateDatabaseTokenResponse } | { Err: string }
  >;
  deposit_with_approval: (databaseId: string, amountE8s: bigint) => Promise<{ Ok: RawDepositResult } | { Err: string }>;
  get_deposit_quote: (databaseId: string, amountE8s: bigint) => Promise<{ Ok: RawDepositQuote } | { Err: string }>;
  get_billing: (databaseId: string) => Promise<{ Ok: RawDatabaseBilling } | { Err: string }>;
  get_usage: (databaseId: string) => Promise<{ Ok: RawDatabaseUsage } | { Err: string }>;
  list_databases: () => Promise<{ Ok: RawDatabaseSummary[] } | { Err: string }>;
  list_database_tokens: (databaseId: string) => Promise<{ Ok: RawDatabaseTokenInfo[] } | { Err: string }>;
  list_payments: (databaseId: string) => Promise<{ Ok: RawPaymentRecord[] } | { Err: string }>;
  sql_execute: (request: RawSqlExecuteRequest) => Promise<{ Ok: RawSqlExecuteResponse } | { Err: string }>;
  sql_query: (request: RawSqlExecuteRequest) => Promise<{ Ok: RawSqlExecuteResponse } | { Err: string }>;
};

export function validateCanisterId(canisterId: string): Principal | string {
  try {
    return Principal.fromText(canisterId);
  } catch (error) {
    return error instanceof Error ? error.message : "invalid canister id";
  }
}

const actorCache = new Map<string, Promise<IcpdbActor>>();
const healthCache = new Map<string, Promise<CanisterHealth>>();

export async function createIcpdbActor(canisterId: string): Promise<IcpdbActor> {
  const principal = validateCanisterId(canisterId);
  if (typeof principal === "string") {
    const error = invalidCanisterIdError(principal);
    throw new ApiError(error.error, 400, error.hint, error.code);
  }
  const host = process.env.NEXT_PUBLIC_ICPDB_IC_HOST ?? "https://icp0.io";
  const cacheKey = `${host}\n${canisterId}`;
  const cached = actorCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const actorPromise = createActor(principal, host);
  actorCache.set(cacheKey, actorPromise);
  return actorPromise;
}

async function createActor(principal: Principal, host: string): Promise<IcpdbActor> {
  const agent = HttpAgent.createSync({ host });
  if (isLocalHost(host)) {
    await agent.fetchRootKey();
  }
  return Actor.createActor<IcpdbActor>((idl) => idlFactory(idl), {
    agent,
    canisterId: principal
  });
}

async function createAuthenticatedActor(canisterId: string, identity: Identity): Promise<IcpdbActor> {
  const principal = validateCanisterId(canisterId);
  if (typeof principal === "string") {
    const error = invalidCanisterIdError(principal);
    throw new ApiError(error.error, 400, error.hint, error.code);
  }
  const host = process.env.NEXT_PUBLIC_ICPDB_IC_HOST ?? "https://icp0.io";
  const agent = HttpAgent.createSync({ host, identity });
  if (isLocalHost(host)) {
    await agent.fetchRootKey();
  }
  return Actor.createActor<IcpdbActor>((idl) => idlFactory(idl), {
    agent,
    canisterId: principal
  });
}

async function callIcpdb<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const host = process.env.NEXT_PUBLIC_ICPDB_IC_HOST ?? "https://icp0.io";
    const publicError = classifyApiError(error, host);
    throw new ApiError(publicError.error, 502, publicError.hint, publicError.code);
  }
}

function throwCanisterError(message: string): never {
  throw new ApiError(message, 400);
}

export function canisterHealth(canisterId: string): Promise<CanisterHealth> {
  const cached = healthCache.get(canisterId);
  if (cached) {
    return cached;
  }
  const request = callIcpdb(async () => {
    const actor = await createIcpdbActor(canisterId);
    return normalizeCanisterHealth(await actor.canister_health());
  }).catch((error) => {
    healthCache.delete(canisterId);
    throw error;
  });
  healthCache.set(canisterId, request);
  return request;
}

export async function listDatabasesAuthenticated(canisterId: string, identity: Identity): Promise<DatabaseSummary[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_databases();
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return result.Ok.map(normalizeDatabaseSummary);
  });
}

export async function createDatabaseAuthenticated(canisterId: string, identity: Identity): Promise<string> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.create_database();
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return result.Ok;
  });
}

export async function getUsageAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseUsage> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.get_usage(databaseId);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return normalizeDatabaseUsage(result.Ok);
  });
}

export async function getBillingAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseBilling> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.get_billing(databaseId);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return normalizeDatabaseBilling(result.Ok);
  });
}

export async function getDepositQuoteAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  amountE8s: string
): Promise<DepositQuote> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.get_deposit_quote(databaseId, BigInt(amountE8s));
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return normalizeDepositQuote(result.Ok);
  });
}

export async function depositWithApprovalAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  amountE8s: string
): Promise<DepositResult> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.deposit_with_approval(databaseId, BigInt(amountE8s));
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return normalizeDepositResult(result.Ok);
  });
}

export async function listPaymentsAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<PaymentRecord[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_payments(databaseId);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return result.Ok.map(normalizePaymentRecord);
  });
}

export async function createDatabaseTokenAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  name: string,
  scope: DatabaseTokenScope
): Promise<CreateDatabaseTokenResponse> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.create_database_token({
      database_id: databaseId,
      name,
      scope: databaseTokenScopeVariant(scope)
    });
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return {
      token: result.Ok.token,
      info: normalizeDatabaseTokenInfo(result.Ok.info)
    };
  });
}

export async function listDatabaseTokensAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseTokenInfo[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_database_tokens(databaseId);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return result.Ok.map(normalizeDatabaseTokenInfo);
  });
}

export async function sqlQueryAuthenticated(canisterId: string, identity: Identity, request: SqlExecuteRequest): Promise<SqlExecuteResponse> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.sql_query(rawSqlRequest(request));
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return normalizeSqlResponse(result.Ok);
  });
}

export async function sqlExecuteAuthenticated(canisterId: string, identity: Identity, request: SqlExecuteRequest): Promise<SqlExecuteResponse> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.sql_execute(rawSqlRequest(request));
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return normalizeSqlResponse(result.Ok);
  });
}

function normalizeCanisterHealth(raw: RawCanisterHealth): CanisterHealth {
  return {
    cyclesBalance: raw.cycles_balance
  };
}

function normalizeDatabaseSummary(raw: RawDatabaseSummary): DatabaseSummary {
  return {
    databaseId: raw.database_id,
    role: normalizeDatabaseRole(raw.role),
    status: normalizeDatabaseStatus(raw.status),
    logicalSizeBytes: raw.logical_size_bytes.toString(),
    archivedAtMs: raw.archived_at_ms[0]?.toString() ?? null,
    deletedAtMs: raw.deleted_at_ms[0]?.toString() ?? null
  };
}

function normalizeDatabaseUsage(raw: RawDatabaseUsage): DatabaseUsage {
  return {
    databaseId: raw.database_id,
    status: normalizeDatabaseStatus(raw.status),
    logicalSizeBytes: raw.logical_size_bytes.toString(),
    maxLogicalSizeBytes: raw.max_logical_size_bytes.toString(),
    usageEventCount: raw.usage_event_count.toString()
  };
}

function normalizeDatabaseBilling(raw: RawDatabaseBilling): DatabaseBilling {
  return {
    databaseId: raw.database_id,
    status: "Suspended" in raw.status ? "suspended" : "active",
    balanceUnits: raw.balance_units.toString(),
    spentUnits: raw.spent_units.toString(),
    usageEventCount: raw.usage_event_count.toString()
  };
}

function normalizeDepositQuote(raw: RawDepositQuote): DepositQuote {
  return {
    databaseId: raw.database_id,
    amountE8s: raw.amount_e8s.toString(),
    expectedFeeE8s: raw.expected_fee_e8s.toString(),
    creditedUnits: raw.credited_units.toString(),
    ledgerCanisterId: raw.ledger_canister_id,
    spenderPrincipal: raw.spender_principal
  };
}

function normalizeDepositResult(raw: RawDepositResult): DepositResult {
  return {
    databaseId: raw.database_id,
    amountE8s: raw.amount_e8s.toString(),
    creditedUnits: raw.credited_units.toString(),
    blockIndex: raw.block_index.toString(),
    balanceUnits: raw.balance_units.toString()
  };
}

function normalizePaymentRecord(raw: RawPaymentRecord): PaymentRecord {
  return {
    paymentId: raw.payment_id,
    databaseId: raw.database_id,
    payerPrincipal: raw.payer_principal,
    amountE8s: raw.amount_e8s.toString(),
    creditedUnits: raw.credited_units.toString(),
    blockIndex: raw.block_index.toString(),
    createdAtMs: raw.created_at_ms.toString()
  };
}

function normalizeDatabaseTokenInfo(raw: RawDatabaseTokenInfo): DatabaseTokenInfo {
  return {
    tokenId: raw.token_id,
    databaseId: raw.database_id,
    name: raw.name,
    scope: "Write" in raw.scope ? "write" : "read",
    createdAtMs: raw.created_at_ms.toString(),
    lastUsedAtMs: raw.last_used_at_ms[0]?.toString() ?? null,
    revokedAtMs: raw.revoked_at_ms[0]?.toString() ?? null
  };
}

function rawSqlRequest(request: SqlExecuteRequest): RawSqlExecuteRequest {
  return {
    database_id: request.databaseId,
    sql: request.sql,
    params: request.params.map(rawSqlValue),
    max_rows: request.maxRows === null ? [] : [request.maxRows]
  };
}

function rawSqlValue(value: SqlValue): RawSqlValue {
  if (value.kind === "null") return { Null: null };
  if (value.kind === "integer") return { Integer: BigInt(value.value) };
  if (value.kind === "real") return { Real: value.value };
  if (value.kind === "text") return { Text: value.value };
  return { Blob: value.value };
}

function normalizeSqlResponse(raw: RawSqlExecuteResponse): SqlExecuteResponse {
  return {
    columns: raw.columns,
    rows: raw.rows.map((row) => row.map(normalizeSqlValue)),
    rowsAffected: raw.rows_affected.toString(),
    lastInsertRowId: raw.last_insert_rowid.toString(),
    truncated: raw.truncated
  };
}

function normalizeSqlValue(value: RawSqlValue): SqlValue {
  if ("Null" in value) return { kind: "null" };
  if ("Integer" in value) return { kind: "integer", value: value.Integer.toString() };
  if ("Real" in value) return { kind: "real", value: value.Real };
  if ("Text" in value) return { kind: "text", value: value.Text };
  return { kind: "blob", value: value.Blob };
}

function normalizeDatabaseRole(role: Variant): DatabaseRole {
  if ("Owner" in role) {
    return "owner";
  }
  if ("Writer" in role) {
    return "writer";
  }
  return "reader";
}

function databaseTokenScopeVariant(scope: DatabaseTokenScope): Variant {
  return scope === "write" ? { Write: null } : { Read: null };
}

function normalizeDatabaseStatus(status: Variant): DatabaseStatus {
  if ("Restoring" in status) {
    return "restoring";
  }
  if ("Archiving" in status) {
    return "archiving";
  }
  if ("Archived" in status) {
    return "archived";
  }
  if ("Deleted" in status) {
    return "deleted";
  }
  return "hot";
}

function isLocalHost(host: string): boolean {
  return host.includes("127.0.0.1") || host.includes("localhost");
}
