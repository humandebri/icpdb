"use client";

// icpdb-console/lib/use-icpdb-resource-refresh.ts
// Resource refresh hook: loads table/account/database resources and writes them into console state.

import { AuthClient } from "@icp-sdk/auth/client";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  describeTableAuthenticated,
  getBillingAuthenticated,
  getUsageAuthenticated,
  getUsageEventSummariesAuthenticated,
  listDatabaseMembersAuthenticated,
  listDatabaseTokensAuthenticated,
  listPaymentsAuthenticated,
  listTablesAuthenticated,
  previewTableAuthenticated
} from "@/lib/icpdb-client";
import {
  canLoadOwnerResources,
  selectPreferredTableName
} from "@/lib/workbench-state";
import type {
  DatabaseBilling,
  DatabaseMember,
  DatabaseSummary,
  DatabaseTable,
  DatabaseTokenInfo,
  DatabaseUsage,
  DatabaseUsageEventSummary,
  PaymentRecord,
  TableDescription,
  TablePreviewResponse
} from "@/lib/types";

type ResourceRefreshOptions = {
  canisterId: string;
  databases: DatabaseSummary[];
  skipHostedResources: boolean;
  tableLimit: number;
  tableName: string;
  resetRowEditor: () => void;
  setUsage: Dispatch<SetStateAction<DatabaseUsage | null>>;
  setUsageEvents: Dispatch<SetStateAction<DatabaseUsageEventSummary[]>>;
  setBilling: Dispatch<SetStateAction<DatabaseBilling | null>>;
  setTokens: Dispatch<SetStateAction<DatabaseTokenInfo[]>>;
  setMembers: Dispatch<SetStateAction<DatabaseMember[]>>;
  setPayments: Dispatch<SetStateAction<PaymentRecord[]>>;
  setQuotaBytes: Dispatch<SetStateAction<string>>;
  setTables: Dispatch<SetStateAction<DatabaseTable[]>>;
  setTableName: Dispatch<SetStateAction<string>>;
  setTableOffset: Dispatch<SetStateAction<number>>;
  setTableDescription: Dispatch<SetStateAction<TableDescription | null>>;
  setTablePreview: Dispatch<SetStateAction<TablePreviewResponse | null>>;
  setSelectedRowIndex: Dispatch<SetStateAction<number | null>>;
  setRowJson: Dispatch<SetStateAction<string>>;
};

export function useIcpdbResourceRefresh(options: ResourceRefreshOptions) {
  const {
    canisterId,
    databases,
    skipHostedResources,
    tableLimit,
    tableName,
    resetRowEditor,
    setUsage,
    setUsageEvents,
    setBilling,
    setTokens,
    setMembers,
    setPayments,
    setQuotaBytes,
    setTables,
    setTableName,
    setTableOffset,
    setTableDescription,
    setTablePreview,
    setSelectedRowIndex,
    setRowJson
  } = options;

  const loadTable = useCallback(
    async (client: AuthClient, nextDatabaseId: string, nextTableName: string, nextOffset: number) => {
      const identity = client.getIdentity();
      const [nextDescription, nextPreview] = await Promise.all([
        describeTableAuthenticated(canisterId, identity, nextDatabaseId, nextTableName),
        previewTableAuthenticated(canisterId, identity, {
          databaseId: nextDatabaseId,
          tableName: nextTableName,
          limit: tableLimit,
          offset: nextOffset
        })
      ]);
      setTableName(nextTableName);
      setTableOffset(nextPreview.offset);
      setTableDescription(nextDescription);
      setTablePreview(nextPreview);
      if (nextTableName !== tableName) {
        resetRowEditor();
      }
    },
    [canisterId, resetRowEditor, setTableDescription, setTableName, setTableOffset, setTablePreview, tableLimit, tableName]
  );

  const refreshDatabaseDetails = useCallback(
    async (client: AuthClient, nextDatabaseId: string, preferredTableName: string) => {
      const identity = client.getIdentity();
      if (skipHostedResources) {
        const nextTables = await listTablesAuthenticated(canisterId, identity, nextDatabaseId);
        setUsage(null);
        setUsageEvents([]);
        setBilling(null);
        setTokens([]);
        setMembers([]);
        setPayments([]);
        setQuotaBytes("");
        setTables(nextTables);
        const nextTableName = selectPreferredTableName(nextTables, preferredTableName);
        if (!nextTableName) {
          setTableName("");
          setTableDescription(null);
          setTablePreview(null);
          return;
        }
        await loadTable(client, nextDatabaseId, nextTableName, 0);
        return;
      }
      const shouldLoadOwnerResources = canLoadOwnerResources(databases, nextDatabaseId);
      const [nextUsage, nextUsageEvents, nextBilling, nextTokens, nextMembers, nextPayments, nextTables] = await Promise.all([
        getUsageAuthenticated(canisterId, identity, nextDatabaseId),
        getUsageEventSummariesAuthenticated(canisterId, identity, nextDatabaseId),
        shouldLoadOwnerResources ? getBillingAuthenticated(canisterId, identity, nextDatabaseId) : Promise.resolve(null),
        shouldLoadOwnerResources ? listDatabaseTokensAuthenticated(canisterId, identity, nextDatabaseId) : Promise.resolve([]),
        shouldLoadOwnerResources ? listDatabaseMembersAuthenticated(canisterId, identity, nextDatabaseId) : Promise.resolve([]),
        shouldLoadOwnerResources ? listPaymentsAuthenticated(canisterId, identity, nextDatabaseId) : Promise.resolve([]),
        listTablesAuthenticated(canisterId, identity, nextDatabaseId)
      ]);
      setUsage(nextUsage);
      setUsageEvents(nextUsageEvents);
      setBilling(nextBilling);
      setTokens(nextTokens);
      setMembers(nextMembers);
      setPayments(nextPayments);
      setQuotaBytes(nextUsage.maxLogicalSizeBytes);
      setTables(nextTables);
      const nextTableName = selectPreferredTableName(nextTables, preferredTableName);
      if (!nextTableName) {
        setTableName("");
        setTableDescription(null);
        setTablePreview(null);
        return;
      }
      await loadTable(client, nextDatabaseId, nextTableName, 0);
    },
    [
      canisterId,
      databases,
      loadTable,
      skipHostedResources,
      setBilling,
      setMembers,
      setPayments,
      setQuotaBytes,
      setTableDescription,
      setTableName,
      setTablePreview,
      setTables,
      setTokens,
      setUsage,
      setUsageEvents
    ]
  );

  const refreshDatabaseAccount = useCallback(
    async (client: AuthClient, nextDatabaseId: string) => {
      const identity = client.getIdentity();
      if (skipHostedResources) {
        setUsage(null);
        setUsageEvents([]);
        setBilling(null);
        setTokens([]);
        setMembers([]);
        setPayments([]);
        setQuotaBytes("");
        setTables([]);
        setTableName("");
        setTableOffset(0);
        setTableDescription(null);
        setTablePreview(null);
        setSelectedRowIndex(null);
        setRowJson("{}");
        return;
      }
      const shouldLoadOwnerResources = canLoadOwnerResources(databases, nextDatabaseId);
      const [nextUsage, nextUsageEvents, nextBilling, nextTokens, nextMembers, nextPayments] = await Promise.all([
        getUsageAuthenticated(canisterId, identity, nextDatabaseId),
        getUsageEventSummariesAuthenticated(canisterId, identity, nextDatabaseId),
        shouldLoadOwnerResources ? getBillingAuthenticated(canisterId, identity, nextDatabaseId) : Promise.resolve(null),
        shouldLoadOwnerResources ? listDatabaseTokensAuthenticated(canisterId, identity, nextDatabaseId) : Promise.resolve([]),
        shouldLoadOwnerResources ? listDatabaseMembersAuthenticated(canisterId, identity, nextDatabaseId) : Promise.resolve([]),
        shouldLoadOwnerResources ? listPaymentsAuthenticated(canisterId, identity, nextDatabaseId) : Promise.resolve([])
      ]);
      setUsage(nextUsage);
      setUsageEvents(nextUsageEvents);
      setBilling(nextBilling);
      setTokens(nextTokens);
      setMembers(nextMembers);
      setPayments(nextPayments);
      setQuotaBytes(nextUsage.maxLogicalSizeBytes);
      setTables([]);
      setTableName("");
      setTableOffset(0);
      setTableDescription(null);
      setTablePreview(null);
      setSelectedRowIndex(null);
      setRowJson("{}");
    },
    [
      canisterId,
      databases,
      skipHostedResources,
      setBilling,
      setMembers,
      setPayments,
      setQuotaBytes,
      setRowJson,
      setSelectedRowIndex,
      setTableDescription,
      setTableName,
      setTableOffset,
      setTablePreview,
      setTables,
      setTokens,
      setUsage,
      setUsageEvents
    ]
  );

  return { loadTable, refreshDatabaseAccount, refreshDatabaseDetails };
}
