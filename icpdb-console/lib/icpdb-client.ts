// icpdb-console/lib/icpdb-client.ts
// Stable public entrypoint for console ICPDB API calls.

import type { CanisterHealth } from "@/lib/types";
import { callIcpdb, createIcpdbActor } from "@/lib/icpdb-actor";
import { normalizeCanisterHealth } from "@/lib/icpdb-database-codec";

const healthCache = new Map<string, Promise<CanisterHealth>>();

export { createIcpdbActor, validateCanisterId } from "@/lib/icpdb-actor";
export {
  createDatabaseAuthenticated,
  deleteDatabaseAuthenticated,
  listAllDatabasePlacementsAuthenticated,
  listDatabasePlacementsAuthenticated,
  listDatabasesAuthenticated,
  listShardOperationsAuthenticated,
  reconcileShardOperationAuthenticated
} from "@/lib/icpdb-database-api";
export {
  createDatabaseTokenAuthenticated,
  depositWithApprovalAuthenticated,
  getBillingAuthenticated,
  getDepositQuoteAuthenticated,
  getUsageAuthenticated,
  getUsageEventSummariesAuthenticated,
  grantDatabaseAccessAuthenticated,
  listDatabaseMembersAuthenticated,
  listDatabaseTokensAuthenticated,
  listPaymentsAuthenticated,
  revokeDatabaseAccessAuthenticated,
  revokeDatabaseTokenAuthenticated,
  setDatabaseQuotaAuthenticated
} from "@/lib/icpdb-account-api";
export {
  cancelDatabaseArchiveAuthenticated,
  beginDatabaseArchiveAuthenticated,
  beginDatabaseRestoreAuthenticated,
  finalizeDatabaseArchiveAuthenticated,
  finalizeDatabaseRestoreAuthenticated,
  readDatabaseArchiveChunkAuthenticated,
  writeDatabaseRestoreChunkAuthenticated
} from "@/lib/icpdb-transfer-api";
export {
  describeTableAuthenticated,
  listTablesAuthenticated,
  previewTableAuthenticated,
  sqlBatchAuthenticated,
  sqlExecuteAuthenticated,
  sqlQueryAuthenticated
} from "@/lib/icpdb-table-api";

export function canisterHealth(canisterId: string): Promise<CanisterHealth> {
  const cached = healthCache.get(canisterId);
  if (cached) return cached;
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
