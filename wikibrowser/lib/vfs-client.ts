import { Actor, HttpAgent, type Identity } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import { classifyApiError, invalidCanisterIdError } from "@/lib/api-errors";
import { sortChildNodes } from "@/lib/child-sort";
import { normalizeSearchHit, type RawSearchHit } from "@/lib/search-normalizer";
import { idlFactory } from "@/lib/vfs-idl";
import type {
  CanisterHealth,
  ChildNode,
  CreateDatabaseTokenResponse,
  DatabaseBilling,
  DatabaseMember,
  DatabaseRole,
  DatabaseStatus,
  DatabaseSummary,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DatabaseUsage,
  DepositQuote,
  DepositResult,
  LinkEdge,
  NodeContext,
  NodeEntryKind,
  NodeKind,
  PaymentRecord,
  RecentNode,
  SearchNodeHit,
  SqlExecuteRequest,
  SqlExecuteResponse,
  SqlValue,
  WikiNode,
  WriteNodeRequest,
  WriteNodeResult
} from "@/lib/types";
import { ApiError } from "@/lib/wiki-helpers";

type Variant = Record<string, null>;

type RawNode = {
  path: string;
  kind: Variant;
  content: string;
  created_at: bigint;
  updated_at: bigint;
  etag: string;
  metadata_json: string;
};

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

type RawDatabaseMember = {
  database_id: string;
  principal: string;
  role: Variant;
  created_at_ms: bigint;
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

type RawChild = {
  path: string;
  name: string;
  kind: Variant;
  updated_at: [] | [bigint];
  etag: [] | [string];
  size_bytes: [] | [bigint];
  is_virtual: boolean;
  has_children: boolean;
};

type RawRecent = {
  path: string;
  kind: Variant;
  updated_at: bigint;
  etag: string;
};

type RawWriteNodeRequest = {
  database_id: string;
  path: string;
  kind: Variant;
  content: string;
  metadata_json: string;
  expected_etag: [] | [string];
};

type RawWriteNodeResult = {
  created: boolean;
  node: RawRecent;
};

type RawLinkEdge = {
  source_path: string;
  target_path: string;
  raw_href: string;
  link_text: string;
  link_kind: string;
  updated_at: bigint;
};

type RawNodeContext = {
  node: RawNode;
  incoming_links: RawLinkEdge[];
  outgoing_links: RawLinkEdge[];
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

type VfsActor = {
  canister_health: () => Promise<RawCanisterHealth>;
  create_database: () => Promise<{ Ok: string } | { Err: string }>;
  create_database_token: (request: { database_id: string; name: string; scope: Variant }) => Promise<
    { Ok: RawCreateDatabaseTokenResponse } | { Err: string }
  >;
  deposit_with_approval: (databaseId: string, amountE8s: bigint) => Promise<{ Ok: RawDepositResult } | { Err: string }>;
  get_deposit_quote: (databaseId: string, amountE8s: bigint) => Promise<{ Ok: RawDepositQuote } | { Err: string }>;
  grant_database_access: (databaseId: string, principal: string, role: Variant) => Promise<{ Ok: null } | { Err: string }>;
  get_billing: (databaseId: string) => Promise<{ Ok: RawDatabaseBilling } | { Err: string }>;
  get_usage: (databaseId: string) => Promise<{ Ok: RawDatabaseUsage } | { Err: string }>;
  list_databases: () => Promise<{ Ok: RawDatabaseSummary[] } | { Err: string }>;
  list_database_members: (databaseId: string) => Promise<{ Ok: RawDatabaseMember[] } | { Err: string }>;
  list_database_tokens: (databaseId: string) => Promise<{ Ok: RawDatabaseTokenInfo[] } | { Err: string }>;
  list_payments: (databaseId: string) => Promise<{ Ok: RawPaymentRecord[] } | { Err: string }>;
  revoke_database_access: (databaseId: string, principal: string) => Promise<{ Ok: null } | { Err: string }>;
  revoke_database_token: (databaseId: string, tokenId: string) => Promise<{ Ok: RawDatabaseTokenInfo } | { Err: string }>;
  set_database_quota: (request: { database_id: string; max_logical_size_bytes: bigint }) => Promise<{ Ok: RawDatabaseUsage } | { Err: string }>;
  top_up_database_balance: (request: { database_id: string; units: bigint }) => Promise<{ Ok: RawDatabaseBilling } | { Err: string }>;
  read_node: (databaseId: string, path: string) => Promise<{ Ok: [] | [RawNode] } | { Err: string }>;
  list_children: (request: { database_id: string; path: string }) => Promise<{ Ok: RawChild[] } | { Err: string }>;
  recent_nodes: (request: { database_id: string; path: [] | [string]; limit: number }) => Promise<
    { Ok: RawRecent[] } | { Err: string }
  >;
  incoming_links: (request: { database_id: string; path: string; limit: number }) => Promise<{ Ok: RawLinkEdge[] } | { Err: string }>;
  outgoing_links: (request: { database_id: string; path: string; limit: number }) => Promise<{ Ok: RawLinkEdge[] } | { Err: string }>;
  graph_links: (request: { database_id: string; prefix: string; limit: number }) => Promise<{ Ok: RawLinkEdge[] } | { Err: string }>;
  graph_neighborhood: (request: { database_id: string; center_path: string; depth: number; limit: number }) => Promise<{ Ok: RawLinkEdge[] } | { Err: string }>;
  read_node_context: (request: { database_id: string; path: string; link_limit: number }) => Promise<{ Ok: [] | [RawNodeContext] } | { Err: string }>;
  search_node_paths: (request: {
    database_id: string;
    query_text: string;
    prefix: [] | [string];
    top_k: number;
    preview_mode: [] | [Variant];
  }) => Promise<{ Ok: RawSearchHit[] } | { Err: string }>;
  search_nodes: (request: {
    database_id: string;
    query_text: string;
    prefix: [] | [string];
    top_k: number;
    preview_mode: [] | [Variant];
  }) => Promise<{ Ok: RawSearchHit[] } | { Err: string }>;
  sql_execute: (request: RawSqlExecuteRequest) => Promise<{ Ok: RawSqlExecuteResponse } | { Err: string }>;
  sql_query: (request: RawSqlExecuteRequest) => Promise<{ Ok: RawSqlExecuteResponse } | { Err: string }>;
  write_node: (request: RawWriteNodeRequest) => Promise<{ Ok: RawWriteNodeResult } | { Err: string }>;
};

export function validateCanisterId(canisterId: string): Principal | string {
  try {
    return Principal.fromText(canisterId);
  } catch (error) {
    return error instanceof Error ? error.message : "invalid canister id";
  }
}

const actorCache = new Map<string, Promise<VfsActor>>();
const healthCache = new Map<string, Promise<CanisterHealth>>();
export async function createVfsActor(canisterId: string): Promise<VfsActor> {
  const principal = validateCanisterId(canisterId);
  if (typeof principal === "string") {
    const error = invalidCanisterIdError(principal);
    throw new ApiError(error.error, 400, error.hint, error.code);
  }
  const host = process.env.NEXT_PUBLIC_WIKI_IC_HOST ?? "https://icp0.io";
  const cacheKey = `${host}\n${canisterId}`;
  const cached = actorCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const actorPromise = createActor(principal, host);
  actorCache.set(cacheKey, actorPromise);
  return actorPromise;
}

async function createActor(principal: Principal, host: string): Promise<VfsActor> {
  const agent = HttpAgent.createSync({ host });
  if (isLocalHost(host)) {
    await agent.fetchRootKey();
  }
  return Actor.createActor<VfsActor>((idl) => idlFactory(idl), {
    agent,
    canisterId: principal
  });
}

async function createAuthenticatedActor(canisterId: string, identity: Identity): Promise<VfsActor> {
  const principal = validateCanisterId(canisterId);
  if (typeof principal === "string") {
    const error = invalidCanisterIdError(principal);
    throw new ApiError(error.error, 400, error.hint, error.code);
  }
  const host = process.env.NEXT_PUBLIC_WIKI_IC_HOST ?? "https://icp0.io";
  const agent = HttpAgent.createSync({ host, identity });
  if (isLocalHost(host)) {
    await agent.fetchRootKey();
  }
  return Actor.createActor<VfsActor>((idl) => idlFactory(idl), {
    agent,
    canisterId: principal
  });
}

async function createReadActor(canisterId: string, identity?: Identity): Promise<VfsActor> {
  return identity ? createAuthenticatedActor(canisterId, identity) : createVfsActor(canisterId);
}

async function callVfs<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const host = process.env.NEXT_PUBLIC_WIKI_IC_HOST ?? "https://icp0.io";
    const publicError = classifyApiError(error, host);
    throw new ApiError(publicError.error, 502, publicError.hint, publicError.code);
  }
}

function throwCanisterError(message: string): never {
  throw new ApiError(message, 400);
}

export async function readNode(canisterId: string, databaseId: string, path: string, identity?: Identity): Promise<WikiNode | null> {
  return callVfs(async () => {
    const actor = await createReadActor(canisterId, identity);
    const result = await actor.read_node(databaseId, path);
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    const raw = result.Ok[0];
    return raw ? normalizeNode(raw) : null;
  });
}

export function canisterHealth(canisterId: string): Promise<CanisterHealth> {
  const cached = healthCache.get(canisterId);
  if (cached) {
    return cached;
  }
  const request = callVfs(async () => {
    const actor = await createVfsActor(canisterId);
    return normalizeCanisterHealth(await actor.canister_health());
  }).catch((error) => {
    healthCache.delete(canisterId);
    throw error;
  });
  healthCache.set(canisterId, request);
  return request;
}

export async function listDatabasesAuthenticated(canisterId: string, identity: Identity): Promise<DatabaseSummary[]> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_databases();
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return result.Ok.map(normalizeDatabaseSummary);
  });
}

export async function createDatabaseAuthenticated(canisterId: string, identity: Identity): Promise<string> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.create_database();
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return result.Ok;
  });
}

export async function getUsageAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseUsage> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.get_usage(databaseId);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return normalizeDatabaseUsage(result.Ok);
  });
}

export async function getBillingAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseBilling> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.get_billing(databaseId);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return normalizeDatabaseBilling(result.Ok);
  });
}

export async function topUpDatabaseBalanceAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  units: string
): Promise<DatabaseBilling> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.top_up_database_balance({
      database_id: databaseId,
      units: BigInt(units)
    });
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
  return callVfs(async () => {
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
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.deposit_with_approval(databaseId, BigInt(amountE8s));
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return normalizeDepositResult(result.Ok);
  });
}

export async function listPaymentsAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<PaymentRecord[]> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_payments(databaseId);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return result.Ok.map(normalizePaymentRecord);
  });
}

export async function setDatabaseQuotaAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  maxLogicalSizeBytes: string
): Promise<DatabaseUsage> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.set_database_quota({
      database_id: databaseId,
      max_logical_size_bytes: BigInt(maxLogicalSizeBytes)
    });
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return normalizeDatabaseUsage(result.Ok);
  });
}

export async function createDatabaseTokenAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  name: string,
  scope: DatabaseTokenScope
): Promise<CreateDatabaseTokenResponse> {
  return callVfs(async () => {
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
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_database_tokens(databaseId);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return result.Ok.map(normalizeDatabaseTokenInfo);
  });
}

export async function revokeDatabaseTokenAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  tokenId: string
): Promise<DatabaseTokenInfo> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.revoke_database_token(databaseId, tokenId);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return normalizeDatabaseTokenInfo(result.Ok);
  });
}

export async function writeNodeAuthenticated(canisterId: string, identity: Identity, request: WriteNodeRequest): Promise<WriteNodeResult> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.write_node({
      database_id: request.databaseId,
      path: request.path,
      kind: nodeKindVariant(request.kind),
      content: request.content,
      metadata_json: request.metadataJson,
      expected_etag: request.expectedEtag ? [request.expectedEtag] : []
    });
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return {
      created: result.Ok.created,
      node: normalizeRecentNode(result.Ok.node)
    };
  });
}

export async function listDatabaseMembersAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseMember[]> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_database_members(databaseId);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
    return result.Ok.map(normalizeDatabaseMember);
  });
}

export async function grantDatabaseAccessAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  principal: string,
  role: DatabaseRole
): Promise<void> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.grant_database_access(databaseId, principal, databaseRoleVariant(role));
    if ("Err" in result) {
      throw new Error(result.Err);
    }
  });
}

export async function revokeDatabaseAccessAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  principal: string
): Promise<void> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.revoke_database_access(databaseId, principal);
    if ("Err" in result) {
      throw new Error(result.Err);
    }
  });
}

export async function readNodeContext(canisterId: string, databaseId: string, path: string, linkLimit: number, identity?: Identity): Promise<NodeContext | null> {
  return callVfs(async () => {
    const actor = await createReadActor(canisterId, identity);
    const result = await actor.read_node_context({ database_id: databaseId, path, link_limit: linkLimit });
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    const raw = result.Ok[0];
    return raw ? normalizeNodeContext(raw) : null;
  });
}

export async function listChildren(canisterId: string, databaseId: string, path: string, identity?: Identity): Promise<ChildNode[]> {
  return callVfs(async () => {
    const actor = await createReadActor(canisterId, identity);
    const result = await actor.list_children({ database_id: databaseId, path });
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return sortChildNodes(result.Ok.map(normalizeChild));
  });
}

export async function recentNodes(canisterId: string, databaseId: string, limit: number, identity?: Identity): Promise<RecentNode[]> {
  return callVfs(async () => {
    const actor = await createReadActor(canisterId, identity);
    const result = await actor.recent_nodes({ database_id: databaseId, path: [], limit });
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return result.Ok.map((node) => ({
      ...normalizeRecentNode(node)
    }));
  });
}

export async function incomingLinks(canisterId: string, databaseId: string, path: string, limit: number, identity?: Identity): Promise<LinkEdge[]> {
  return callVfs(async () => {
    const actor = await createReadActor(canisterId, identity);
    const result = await actor.incoming_links({ database_id: databaseId, path, limit });
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return result.Ok.map(normalizeLinkEdge);
  });
}

export async function outgoingLinks(canisterId: string, databaseId: string, path: string, limit: number, identity?: Identity): Promise<LinkEdge[]> {
  return callVfs(async () => {
    const actor = await createReadActor(canisterId, identity);
    const result = await actor.outgoing_links({ database_id: databaseId, path, limit });
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return result.Ok.map(normalizeLinkEdge);
  });
}

export async function graphLinks(canisterId: string, databaseId: string, prefix: string, limit: number, identity?: Identity): Promise<LinkEdge[]> {
  return callVfs(async () => {
    const actor = await createReadActor(canisterId, identity);
    const result = await actor.graph_links({ database_id: databaseId, prefix, limit });
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return result.Ok.map(normalizeLinkEdge);
  });
}

export async function graphNeighborhood(canisterId: string, databaseId: string, centerPath: string, depth: number, limit: number, identity?: Identity): Promise<LinkEdge[]> {
  return callVfs(async () => {
    const actor = await createReadActor(canisterId, identity);
    const result = await actor.graph_neighborhood({ database_id: databaseId, center_path: centerPath, depth, limit });
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return result.Ok.map(normalizeLinkEdge);
  });
}

export async function searchNodePaths(
  canisterId: string,
  databaseId: string,
  queryText: string,
  limit: number,
  prefix: string | null,
  identity?: Identity
): Promise<SearchNodeHit[]> {
  return callVfs(async () => {
    const actor = await createReadActor(canisterId, identity);
    const result = await actor.search_node_paths({
      database_id: databaseId,
      query_text: queryText,
      prefix: prefix ? [prefix] : [],
      top_k: limit,
      preview_mode: [{ ContentStart: null }]
    });
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return result.Ok.map(normalizeSearchHit);
  });
}

export async function searchNodes(
  canisterId: string,
  databaseId: string,
  queryText: string,
  limit: number,
  prefix: string | null,
  identity?: Identity
): Promise<SearchNodeHit[]> {
  return callVfs(async () => {
    const actor = await createReadActor(canisterId, identity);
    const result = await actor.search_nodes({
      database_id: databaseId,
      query_text: queryText,
      prefix: prefix ? [prefix] : [],
      top_k: limit,
      preview_mode: [{ ContentStart: null }]
    });
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return result.Ok.map(normalizeSearchHit);
  });
}

export async function sqlQueryAuthenticated(canisterId: string, identity: Identity, request: SqlExecuteRequest): Promise<SqlExecuteResponse> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.sql_query(rawSqlRequest(request));
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return normalizeSqlResponse(result.Ok);
  });
}

export async function sqlExecuteAuthenticated(canisterId: string, identity: Identity, request: SqlExecuteRequest): Promise<SqlExecuteResponse> {
  return callVfs(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.sql_execute(rawSqlRequest(request));
    if ("Err" in result) {
      throwCanisterError(result.Err);
    }
    return normalizeSqlResponse(result.Ok);
  });
}

function normalizeNode(raw: RawNode): WikiNode {
  return {
    path: raw.path,
    kind: normalizeNodeKind(raw.kind),
    content: raw.content,
    createdAt: raw.created_at.toString(),
    updatedAt: raw.updated_at.toString(),
    etag: raw.etag,
    metadataJson: raw.metadata_json
  };
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

function normalizeDatabaseMember(raw: RawDatabaseMember): DatabaseMember {
  return {
    databaseId: raw.database_id,
    principal: raw.principal,
    role: normalizeDatabaseRole(raw.role),
    createdAtMs: raw.created_at_ms.toString()
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

function normalizeRecentNode(raw: RawRecent): RecentNode {
  return {
    path: raw.path,
    kind: normalizeNodeKind(raw.kind),
    updatedAt: raw.updated_at.toString(),
    etag: raw.etag
  };
}

function normalizeChild(raw: RawChild): ChildNode {
  return {
    path: raw.path,
    name: raw.name,
    kind: normalizeEntryKind(raw.kind),
    updatedAt: raw.updated_at[0]?.toString() ?? null,
    etag: raw.etag[0] ?? null,
    sizeBytes: raw.size_bytes[0]?.toString() ?? null,
    isVirtual: raw.is_virtual,
    hasChildren: raw.has_children
  };
}

function normalizeLinkEdge(raw: RawLinkEdge): LinkEdge {
  return {
    sourcePath: raw.source_path,
    targetPath: raw.target_path,
    rawHref: raw.raw_href,
    linkText: raw.link_text,
    linkKind: raw.link_kind,
    updatedAt: raw.updated_at.toString()
  };
}

function normalizeNodeContext(raw: RawNodeContext): NodeContext {
  return {
    node: normalizeNode(raw.node),
    incomingLinks: raw.incoming_links.map(normalizeLinkEdge),
    outgoingLinks: raw.outgoing_links.map(normalizeLinkEdge)
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

function normalizeNodeKind(kind: Variant): NodeKind {
  return "Source" in kind ? "source" : "file";
}

function normalizeEntryKind(kind: Variant): NodeEntryKind {
  if ("Directory" in kind) {
    return "directory";
  }
  return "Source" in kind ? "source" : "file";
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

function databaseRoleVariant(role: DatabaseRole): Variant {
  if (role === "owner") {
    return { Owner: null };
  }
  if (role === "writer") {
    return { Writer: null };
  }
  return { Reader: null };
}

function databaseTokenScopeVariant(scope: DatabaseTokenScope): Variant {
  return scope === "write" ? { Write: null } : { Read: null };
}

function nodeKindVariant(kind: NodeKind): Variant {
  if (kind === "source") return { Source: null };
  return { File: null };
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
