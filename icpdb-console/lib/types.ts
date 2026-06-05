export type CanisterHealth = {
  cyclesBalance: bigint;
};

export type DatabaseRole = "reader" | "writer" | "owner";
export type DatabaseStatus = "hot" | "restoring" | "archiving" | "archived" | "deleted";

export type DatabaseSummary = {
  databaseId: string;
  role: DatabaseRole;
  status: DatabaseStatus;
  logicalSizeBytes: string;
  archivedAtMs: string | null;
  deletedAtMs: string | null;
};

export type DatabaseInfo = {
  databaseId: string;
  status: DatabaseStatus;
  logicalSizeBytes: string;
  schemaVersion: string;
  mountId: number | null;
  snapshotHash: number[] | null;
  archivedAtMs: string | null;
  deletedAtMs: string | null;
};

export type DatabaseShardPlacement = {
  databaseId: string;
  shardId: string;
  canisterId: string | null;
  mountId: number | null;
  status: DatabaseStatus;
  schemaVersion: string;
  createdAtMs: string;
  updatedAtMs: string;
};

export type DatabaseShardInfo = {
  shardId: string;
  canisterId: string;
  status: string;
  maxDatabases: number;
  assignedDatabases: string;
  createdAtMs: string;
  updatedAtMs: string;
};

export type DatabaseShardStatus = {
  shard: DatabaseShardInfo;
  canisterStatus: string;
  cyclesBalance: string;
  memorySizeBytes: string;
  idleCyclesBurnedPerDay: string;
  moduleHash: number[] | null;
};

export type CreateDatabaseShardRequest = {
  initialCycles: string | number | bigint;
  maxDatabases: number;
};

export type RegisterDatabaseShardRequest = {
  databaseCanisterId: string;
  maxDatabases: number;
};

export type CreateRemoteDatabaseRequest = {
  databaseId: string;
  databaseCanisterId: string;
};

export type DatabaseShardMaintenanceAction = {
  action: string;
  databaseCanisterId: string | null;
  shardId: string | null;
  cycles: string;
  reason: string;
};

export type DatabaseShardMaintenanceReport = {
  availableSlots: string;
  inspectedShards: DatabaseShardStatus[];
  actions: DatabaseShardMaintenanceAction[];
};

export type MaintainDatabaseShardsRequest = {
  minAvailableSlots: string | number | bigint;
  minCyclesBalance: string | number | bigint;
  topUpCycles: string | number | bigint;
  maxNewShards: number;
  newShardMaxDatabases: number;
  newShardInitialCycles: string | number | bigint;
};

export type RoutedOperationStatus = "pending" | "applied" | "failed" | "unknown";
export type ShardOperationReconcileStatus = "applied" | "failed";

export type RoutedOperationInfo = {
  operationId: string;
  databaseId: string;
  databaseCanisterId: string;
  method: string;
  requestHash: number[];
  status: RoutedOperationStatus;
  error: string | null;
  createdAtMs: string;
  updatedAtMs: string;
};

export type ShardOperationInfo = {
  operationId: string;
  operationKind: string;
  target: string | null;
  requestHash: number[];
  status: RoutedOperationStatus;
  error: string | null;
  createdAtMs: string;
  updatedAtMs: string;
};

export type ShardOperationReconcileRequest = {
  operationId: string;
  status: ShardOperationReconcileStatus;
  error: string | null;
};

export type DatabaseMember = {
  databaseId: string;
  principal: string;
  role: DatabaseRole;
  createdAtMs: string;
};

export type DatabaseUsage = {
  databaseId: string;
  status: DatabaseStatus;
  logicalSizeBytes: string;
  maxLogicalSizeBytes: string;
  usageEventCount: string;
};

export type DatabaseUsageEventSummary = {
  method: string;
  operation: string | null;
  success: boolean;
  eventCount: string;
  totalCyclesDelta: string;
  totalRowsReturned: string;
  totalRowsAffected: string;
  lastCreatedAtMs: string;
};

export type DatabaseBillingStatus = "active" | "suspended";

export type DatabaseBilling = {
  databaseId: string;
  status: DatabaseBillingStatus;
  balanceUnits: string;
  spentUnits: string;
  usageEventCount: string;
};

export type DatabaseArchiveInfo = {
  databaseId: string;
  sizeBytes: string;
};

export type DepositQuote = {
  databaseId: string;
  amountE8s: string;
  expectedFeeE8s: string;
  creditedUnits: string;
  ledgerCanisterId: string;
  spenderPrincipal: string;
};

export type DepositResult = {
  databaseId: string;
  amountE8s: string;
  creditedUnits: string;
  blockIndex: string;
  balanceUnits: string;
};

export type PaymentRecord = {
  paymentId: string;
  databaseId: string;
  payerPrincipal: string;
  amountE8s: string;
  creditedUnits: string;
  blockIndex: string;
  createdAtMs: string;
};

export type DatabaseTokenScope = "read" | "write" | "owner";

export type DatabaseTokenInfo = {
  tokenId: string;
  databaseId: string;
  name: string;
  scope: DatabaseTokenScope;
  createdAtMs: string;
  lastUsedAtMs: string | null;
  revokedAtMs: string | null;
};

export type CreateDatabaseTokenResponse = {
  token: string;
  info: DatabaseTokenInfo;
};

export type DatabaseObjectType = "table" | "view";

export type DatabaseTable = {
  name: string;
  objectType: DatabaseObjectType;
  schemaSql: string | null;
};

export type DatabaseColumn = {
  cid: number;
  name: string;
  declaredType: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKeyPosition: number;
  hidden: number;
};

export type DatabaseIndex = {
  name: string;
  tableName: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: DatabaseIndexColumn[];
  schemaSql: string | null;
};

export type DatabaseIndexColumn = {
  seqno: number;
  cid: string;
  name: string | null;
  descending: boolean;
  collation: string;
  key: boolean;
};

export type DatabaseTrigger = {
  name: string;
  tableName: string;
  schemaSql: string | null;
};

export type DatabaseForeignKey = {
  id: number;
  seq: number;
  tableName: string;
  fromColumn: string;
  toColumn: string | null;
  onUpdate: string;
  onDelete: string;
  matchClause: string;
};

export type TableDescription = {
  databaseId: string;
  tableName: string;
  objectType: DatabaseObjectType;
  schemaSql: string | null;
  columns: DatabaseColumn[];
  indexes: DatabaseIndex[];
  triggers: DatabaseTrigger[];
  foreignKeys: DatabaseForeignKey[];
};

export type TablePreviewRequest = {
  databaseId: string;
  tableName: string;
  limit: number | null;
  offset: number | null;
};

export type TablePreviewResponse = {
  databaseId: string;
  tableName: string;
  columns: string[];
  rows: SqlValue[][];
  offset: number;
  limit: number;
  totalCount: string;
  truncated: boolean;
};

export type SqlValue =
  | { kind: "null" }
  | { kind: "integer"; value: string }
  | { kind: "real"; value: number }
  | { kind: "text"; value: string }
  | { kind: "blob"; value: number[] };

export type SqlExecuteRequest = {
  databaseId: string;
  sql: string;
  params: SqlValue[];
  maxRows: number | null;
  idempotencyKey?: string | null;
};

export type SqlStatement = {
  sql: string;
  params: SqlValue[];
};

export type SqlBatchRequest = {
  databaseId: string;
  statements: SqlStatement[];
  maxRows: number | null;
  idempotencyKey?: string | null;
};

export type SqlExecuteResponse = {
  columns: string[];
  rows: SqlValue[][];
  rowsAffected: string;
  lastInsertRowId: string;
  truncated: boolean;
  routedOperationId: string | null;
};
