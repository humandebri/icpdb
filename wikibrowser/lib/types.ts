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

export type DatabaseUsage = {
  databaseId: string;
  status: DatabaseStatus;
  logicalSizeBytes: string;
  maxLogicalSizeBytes: string;
  usageEventCount: string;
};

export type DatabaseBillingStatus = "active" | "suspended";

export type DatabaseBilling = {
  databaseId: string;
  status: DatabaseBillingStatus;
  balanceUnits: string;
  spentUnits: string;
  usageEventCount: string;
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

export type DatabaseTokenScope = "read" | "write";

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
};

export type SqlExecuteResponse = {
  columns: string[];
  rows: SqlValue[][];
  rowsAffected: string;
  lastInsertRowId: string;
  truncated: boolean;
};
