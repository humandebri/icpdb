import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function assertNoAnyAs(source) {
  assert.doesNotMatch(source, /\bany\b/);
  assert.doesNotMatch(source, /\bas\b/);
}

function assertMatches(source, patterns) {
  for (const pattern of patterns) assert.match(source, pattern);
}

const pageUrl = new URL("../app/icpdb/page.tsx", import.meta.url);
const rootPageUrl = new URL("../app/page.tsx", import.meta.url);
const accountPanelsUrl = new URL("../components/icpdb-account-panels.tsx", import.meta.url);
const backupBillingPanelsUrl = new URL("../components/icpdb-backup-billing-panels.tsx", import.meta.url);
const dataGridUrl = new URL("../components/icpdb-data-grid.tsx", import.meta.url);
const databaseListPanelUrl = new URL("../components/icpdb-database-list-panel.tsx", import.meta.url);
const displayPanelsUrl = new URL("../components/icpdb-display-panels.tsx", import.meta.url);
const navigationPanelsUrl = new URL("../components/icpdb-navigation-panels.tsx", import.meta.url);
const operationPanelUrl = new URL("../components/icpdb-operation-panel.tsx", import.meta.url);
const responseAdminPanelsUrl = new URL("../components/icpdb-response-admin-panels.tsx", import.meta.url);
const responseMetricsPanelUrl = new URL("../components/icpdb-response-metrics-panel.tsx", import.meta.url);
const responseSidebarUrl = new URL("../components/icpdb-response-sidebar.tsx", import.meta.url);
const resultGridUrl = new URL("../components/icpdb-result-grid.tsx", import.meta.url);
const rowEditorPanelUrl = new URL("../components/icpdb-row-editor-panel.tsx", import.meta.url);
const schemaViewersUrl = new URL("../components/icpdb-schema-viewers.tsx", import.meta.url);
const shardPanelsUrl = new URL("../components/icpdb-shard-panels.tsx", import.meta.url);
const sqlEditorPanelUrl = new URL("../components/icpdb-sql-editor-panel.tsx", import.meta.url);
const tableDataPanelUrl = new URL("../components/icpdb-table-data-panel.tsx", import.meta.url);
const tableEditorPanelUrl = new URL("../components/icpdb-table-editor-panel.tsx", import.meta.url);
const tableListPanelUrl = new URL("../components/icpdb-table-list-panel.tsx", import.meta.url);
const tableOverviewPanelUrl = new URL("../components/icpdb-table-overview-panel.tsx", import.meta.url);
const tableSchemaPanelUrl = new URL("../components/icpdb-table-schema-panel.tsx", import.meta.url);
const tokenSessionPanelUrl = new URL("../components/icpdb-token-session-panel.tsx", import.meta.url);
const tokenPanelUrl = new URL("../components/icpdb-token-panel.tsx", import.meta.url);
const usageEventsPanelUrl = new URL("../components/icpdb-usage-events-panel.tsx", import.meta.url);
const workbenchUrl = new URL("../components/icpdb-workbench.tsx", import.meta.url);
const permissionPanelUrl = new URL("../components/icpdb-permission-panel.tsx", import.meta.url);
const tokenSessionHelperUrl = new URL("../lib/icpdb-token-session.ts", import.meta.url);
const rowMutationsUrl = new URL("../lib/row-mutations.ts", import.meta.url);
const icpdbClientUrl = new URL("../lib/icpdb-client.ts", import.meta.url);
const icpdbActorUrl = new URL("../lib/icpdb-actor.ts", import.meta.url);
const icpdbRawTypesUrl = new URL("../lib/icpdb-raw-types.ts", import.meta.url);
const icpdbDatabaseCodecUrl = new URL("../lib/icpdb-database-codec.ts", import.meta.url);
const icpdbTableCodecUrl = new URL("../lib/icpdb-table-codec.ts", import.meta.url);
const icpdbDatabaseApiUrl = new URL("../lib/icpdb-database-api.ts", import.meta.url);
const icpdbAccountApiUrl = new URL("../lib/icpdb-account-api.ts", import.meta.url);
const icpdbTransferApiUrl = new URL("../lib/icpdb-transfer-api.ts", import.meta.url);
const icpdbTableApiUrl = new URL("../lib/icpdb-table-api.ts", import.meta.url);
const httpAdminClientUrl = new URL("../lib/icpdb-http-admin-client.ts", import.meta.url);
const httpClientUrl = new URL("../lib/icpdb-http-client.ts", import.meta.url);
const resultGridHelpersUrl = new URL("../lib/result-grid-helpers.ts", import.meta.url);
const sqlDumpUrl = new URL("../lib/sql-dump.ts", import.meta.url);
const tableDataHelpersUrl = new URL("../lib/table-data-helpers.ts", import.meta.url);
const workbenchStateUrl = new URL("../lib/workbench-state.ts", import.meta.url);
const databaseTransferUrl = new URL("../lib/database-transfer.ts", import.meta.url);
const resourceRefreshUrl = new URL("../lib/use-icpdb-resource-refresh.ts", import.meta.url);
const accountActionsUrl = new URL("../lib/use-icpdb-account-actions.ts", import.meta.url);
const backupActionsUrl = new URL("../lib/use-icpdb-backup-actions.ts", import.meta.url);
const billingActionsUrl = new URL("../lib/use-icpdb-billing-actions.ts", import.meta.url);
const databaseActionsUrl = new URL("../lib/use-icpdb-database-actions.ts", import.meta.url);
const operationActionsUrl = new URL("../lib/use-icpdb-operation-actions.ts", import.meta.url);
const controllerUrl = new URL("../lib/use-icpdb-workbench-controller.ts", import.meta.url);
const derivedStateUrl = new URL("../lib/use-icpdb-workbench-derived-state.ts", import.meta.url);
const sessionActionsUrl = new URL("../lib/use-icpdb-session-actions.ts", import.meta.url);
const shardActionsUrl = new URL("../lib/use-icpdb-shard-actions.ts", import.meta.url);
const sqlActionsUrl = new URL("../lib/use-icpdb-sql-actions.ts", import.meta.url);
const tableActionsUrl = new URL("../lib/use-icpdb-table-actions.ts", import.meta.url);
const tokenAdminActionsUrl = new URL("../lib/use-icpdb-token-admin-actions.ts", import.meta.url);
const tokenActionsUrl = new URL("../lib/use-icpdb-token-actions.ts", import.meta.url);
const tokenBackupActionsUrl = new URL("../lib/use-icpdb-token-backup-actions.ts", import.meta.url);
const workbenchLocalStateUrl = new URL("../lib/use-icpdb-workbench-state.ts", import.meta.url);
const readmeUrl = new URL("../../README.md", import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const rowMutationCheckUrl = new URL("./check-row-mutations.mjs", import.meta.url);
const httpAdminClientCheckUrl = new URL("./check-http-admin-client.mjs", import.meta.url);
const httpClientCheckUrl = new URL("./check-http-client.mjs", import.meta.url);

for (const url of [
  pageUrl, rootPageUrl, accountPanelsUrl, backupBillingPanelsUrl, dataGridUrl, databaseListPanelUrl, displayPanelsUrl, navigationPanelsUrl, operationPanelUrl, responseAdminPanelsUrl, responseMetricsPanelUrl, responseSidebarUrl, resultGridUrl, rowEditorPanelUrl, schemaViewersUrl, shardPanelsUrl, sqlEditorPanelUrl, tableDataPanelUrl, tableEditorPanelUrl, tableListPanelUrl, tableOverviewPanelUrl, tableSchemaPanelUrl, tokenSessionPanelUrl, tokenPanelUrl, usageEventsPanelUrl, workbenchUrl, permissionPanelUrl, tokenSessionHelperUrl, rowMutationsUrl, icpdbClientUrl, icpdbActorUrl, icpdbRawTypesUrl, icpdbDatabaseCodecUrl, icpdbTableCodecUrl, icpdbDatabaseApiUrl, icpdbAccountApiUrl, icpdbTransferApiUrl, icpdbTableApiUrl, httpAdminClientUrl, httpClientUrl, resultGridHelpersUrl, sqlDumpUrl, tableDataHelpersUrl, workbenchStateUrl,
  databaseTransferUrl, resourceRefreshUrl, accountActionsUrl, backupActionsUrl, billingActionsUrl, databaseActionsUrl, operationActionsUrl,
  controllerUrl, derivedStateUrl, sessionActionsUrl, shardActionsUrl, sqlActionsUrl, tableActionsUrl, tokenAdminActionsUrl, tokenActionsUrl, tokenBackupActionsUrl,
  workbenchLocalStateUrl, readmeUrl, rowMutationCheckUrl, httpAdminClientCheckUrl, httpClientCheckUrl
]) {
  assert.equal(existsSync(url), true);
}

const page = readFileSync(pageUrl, "utf8");
const rootPage = readFileSync(rootPageUrl, "utf8");
const accountPanels = readFileSync(accountPanelsUrl, "utf8");
const backupBillingPanels = readFileSync(backupBillingPanelsUrl, "utf8");
const dataGrid = readFileSync(dataGridUrl, "utf8");
const databaseListPanel = readFileSync(databaseListPanelUrl, "utf8");
const displayPanels = readFileSync(displayPanelsUrl, "utf8");
const navigationPanels = readFileSync(navigationPanelsUrl, "utf8");
const operationPanel = readFileSync(operationPanelUrl, "utf8");
const responseAdminPanels = readFileSync(responseAdminPanelsUrl, "utf8");
const responseMetricsPanel = readFileSync(responseMetricsPanelUrl, "utf8");
const responseSidebar = readFileSync(responseSidebarUrl, "utf8");
const resultGrid = readFileSync(resultGridUrl, "utf8");
const rowEditorPanel = readFileSync(rowEditorPanelUrl, "utf8");
const schemaViewers = readFileSync(schemaViewersUrl, "utf8");
const shardPanels = readFileSync(shardPanelsUrl, "utf8");
const sqlEditorPanel = readFileSync(sqlEditorPanelUrl, "utf8");
const tableDataPanel = readFileSync(tableDataPanelUrl, "utf8");
const tableEditorPanel = readFileSync(tableEditorPanelUrl, "utf8");
const tableListPanel = readFileSync(tableListPanelUrl, "utf8");
const tableOverviewPanel = readFileSync(tableOverviewPanelUrl, "utf8");
const tableSchemaPanel = readFileSync(tableSchemaPanelUrl, "utf8");
const tokenSessionPanel = readFileSync(tokenSessionPanelUrl, "utf8");
const tokenPanel = readFileSync(tokenPanelUrl, "utf8");
const usageEventsPanel = readFileSync(usageEventsPanelUrl, "utf8");
const workbench = readFileSync(workbenchUrl, "utf8");
const permissionPanel = readFileSync(permissionPanelUrl, "utf8");
const tokenSessionHelper = readFileSync(tokenSessionHelperUrl, "utf8");
const rowMutations = readFileSync(rowMutationsUrl, "utf8");
const icpdbClient = readFileSync(icpdbClientUrl, "utf8");
const icpdbActor = readFileSync(icpdbActorUrl, "utf8");
const icpdbRawTypes = readFileSync(icpdbRawTypesUrl, "utf8");
const icpdbDatabaseCodec = readFileSync(icpdbDatabaseCodecUrl, "utf8");
const icpdbTableCodec = readFileSync(icpdbTableCodecUrl, "utf8");
const icpdbDatabaseApi = readFileSync(icpdbDatabaseApiUrl, "utf8");
const icpdbAccountApi = readFileSync(icpdbAccountApiUrl, "utf8");
const icpdbTransferApi = readFileSync(icpdbTransferApiUrl, "utf8");
const icpdbTableApi = readFileSync(icpdbTableApiUrl, "utf8");
const httpAdminClient = readFileSync(httpAdminClientUrl, "utf8");
const httpClient = readFileSync(httpClientUrl, "utf8");
const resultGridHelpers = readFileSync(resultGridHelpersUrl, "utf8");
const sqlDump = readFileSync(sqlDumpUrl, "utf8");
const tableDataHelpers = readFileSync(tableDataHelpersUrl, "utf8");
const workbenchState = readFileSync(workbenchStateUrl, "utf8");
const databaseTransfer = readFileSync(databaseTransferUrl, "utf8");
const resourceRefresh = readFileSync(resourceRefreshUrl, "utf8");
const accountActions = readFileSync(accountActionsUrl, "utf8");
const backupActions = readFileSync(backupActionsUrl, "utf8");
const billingActions = readFileSync(billingActionsUrl, "utf8");
const databaseActions = readFileSync(databaseActionsUrl, "utf8");
const operationActions = readFileSync(operationActionsUrl, "utf8");
const controller = readFileSync(controllerUrl, "utf8");
const derivedState = readFileSync(derivedStateUrl, "utf8");
const sessionActions = readFileSync(sessionActionsUrl, "utf8");
const shardActions = readFileSync(shardActionsUrl, "utf8");
const sqlActions = readFileSync(sqlActionsUrl, "utf8");
const tableActions = readFileSync(tableActionsUrl, "utf8");
const tokenAdminActions = readFileSync(tokenAdminActionsUrl, "utf8");
const tokenActions = readFileSync(tokenActionsUrl, "utf8");
const tokenBackupActions = readFileSync(tokenBackupActionsUrl, "utf8");
const workbenchLocalState = readFileSync(workbenchLocalStateUrl, "utf8");
const readme = readFileSync(readmeUrl, "utf8");
const rowMutationCheck = readFileSync(rowMutationCheckUrl, "utf8");
const httpAdminClientCheck = readFileSync(httpAdminClientCheckUrl, "utf8");
const httpClientCheck = readFileSync(httpClientCheckUrl, "utf8");

assert.match(rootPage, /redirect\("\/icpdb"\)/);
assert.doesNotMatch(rootPage, /Open console/);
assertNoAnyAs(rootPage);

assert.match(page, /Canister SQLite Console/);
assert.match(page, /SQL Workbench/);
assertNoAnyAs(page);

assert.match(readme, /SQL dump download \/ load controls/);
assert.match(readme, /selected cell value/);
assert.match(readme, /index column metadata/);
assert.match(readme, /foreign key group\/seq\/match metadata/);

assert.match(displayPanels, /Copy/);
assert.match(displayPanels, /Copy \$\{label\}/);
assert.match(displayPanels, /copyValue\?: string/);
assert.match(displayPanels, /copyMetric/);
assert.match(displayPanels, /navigator\.clipboard\.writeText\(nextCopyValue\)/);
assert.match(displayPanels, /icpdb-result-grid/);
assert.match(displayPanels, /icpdb-schema-viewers/);
assert.match(displayPanels, /icpdb-shard-panels/);
assert.match(displayPanels, /icpdb-usage-events-panel/);
assertNoAnyAs(displayPanels);

assertMatches(usageEventsPanel, [/UsageEventSummaryPanel/, /Search usage events/, /filterUsageEvents/, /No matching usage events/, /visibleEvents\.map/, /lastCreatedAtMs/]);
assertNoAnyAs(usageEventsPanel);

assertMatches(shardPanels, [/ShardPlacementPanel/, /onRefreshAll/, /Search shard placements/, /filterShardPlacements/, /No matching shard placements/, /visiblePlacements\.map/, /ShardOperationJournalPanel/, /Search shard operations/, /filterShardOperations/, /No matching shard operations/, /visibleOperations\.map/, /Mark applied/, /Mark failed/]);
assertNoAnyAs(shardPanels);

assertMatches(resultGrid, [/BatchResultList/, /Batch results/, /Grid/, /nextResponse\.columns\.length > 0/, /nextResponse\.columns\.length/, /rowResponses/, /Batch result grids/, /No batch rows/, /Search batch rows/, /icpdb-batch-statement-/, /No matching batch rows/, /SqlResultSummary/, /SQL result/, /label="Columns"/, /response\.columns\.length/, /ResultMetric/, /Search result rows/, /Download result CSV/, /downloadResultCsv/, /downloadTextFile/, /No matching result rows/, /searchPlaceholder/, /noMatchLabel/, /filterResultRows/, /sortResultRows/, /nextColumnSort/, /visibleRowEntries/, /visibleRowNumbers/, /rowNumbers=\{visibleRowNumbers\}/, /resultCountLabel/, /DataGrid/, /GridColumnSort/]);
assertNoAnyAs(resultGrid);

assertMatches(resultGridHelpers, [/export function formatSqlValue/, /downloadSqlRowsCsv/, /downloadTextFile/, /buildResultCsv/, /escapeCsvField/, /compareSqlValues/, /rowMatchesResultSearch/, /ResultRowEntry/]);
assertNoAnyAs(resultGridHelpers);

assertMatches(dataGrid, [/DataGrid/, /onToggleColumnSort/, /columnSortLabel/, /Sort \$\{columnName\} ascending/, /SortIcon/, /cellDisplayValue/, /title=\{cellDisplayValue\}/, /columnDetails/, /columnHeaderMeta/, /rowNumberOffset/, /rowNumbers/, /rowNumberCellClass/, /sticky left-0 z-20/, /sticky left-0 z-10/, /\(no rows\)/, /emptyLabel/, /editableColumnNames/, /onCommitEdit/, /autoFocus/, /event\.key === "Enter"/]);
assertNoAnyAs(dataGrid);

assertMatches(schemaViewers, [/IndexViewer/, /Search indexes/, /No matching indexes/, /filterIndexes/, /indexColumnsLabel/, /expressionIndexColumnLabel/, /TriggerViewer/, /Search triggers/, /No matching triggers/, /filterTriggers/, /ForeignKeyViewer/, /Search foreign keys/, /No matching foreign keys/, /filterForeignKeys/, /Foreign keys/, /key\.matchClause/, /key\.seq/]);
assertNoAnyAs(schemaViewers);

assert.match(navigationPanels, /DatabaseNavigator/);
assert.match(navigationPanels, /WorkbenchToolbar/);
assert.match(navigationPanels, /TokenSessionPanel/);
assert.match(navigationPanels, /DatabaseList/);
assert.match(navigationPanels, /Principal/);
assert.match(navigationPanels, /icpdb-table-list-panel/);
assert.match(navigationPanels, /Issue read token/);
assert.match(navigationPanels, /CanisterField/);
assertNoAnyAs(navigationPanels);

assertMatches(tableListPanel, [/TableList/, /Create table/, /Search tables/, /No matching tables/, /filterTables/, /tableSelectionLabel/, /selectedTableBadgeClass/, /TableObjectTypeFilter/, /tableObjectTypeFilters/, /countTableObjectTypes/, /tableObjectCountLabel/, /Views/]);
assertNoAnyAs(tableListPanel);

assertMatches(databaseListPanel, [/DatabaseList/, /Databases/, /Search databases/, /No matching databases/, /filterDatabases/, /DatabaseLifecycleFilter/, /databaseLifecycleFilters/, /countDatabaseLifecycles/, /databaseLifecycleCountLabel/, /databaseLifecycleMatches/, /databaseLifecycleFilterValue/, /Current/, /Archived/, /Deleted/, /databaseSelectionLabel/, /selectedDatabaseBadgeClass/, /selected/, /available/, /databaseLifecycleLabel/, /formatDatabaseLifecycleTimestamp/, /archivedAtMs/, /deletedAtMs/, /current/, /formatBytes/]);
assertNoAnyAs(databaseListPanel);

assertMatches(accountPanels, [/StorageQuotaPanel/, /TokenPanel/, /PermissionPanel/, /Set quota/, /icpdb-token-panel/, /icpdb-permission-panel/]);
assert.doesNotMatch(accountPanels, /tokens\.slice/);
assertNoAnyAs(accountPanels);

assertMatches(tokenPanel, [/TokenPanel/, /parseTokenScope/, /Search tokens/, /TokenScopeFilter/, /tokenScopeFilters/, /countTokenScopes/, /tokenScopeCountLabel/, /activeTokenFilterClass/, /filterTokens/, /No matching tokens/, /visibleTokens\.map/, /last used/, /formatTimestamp/, /revoked/]);
assert.doesNotMatch(tokenPanel, /tokens\.slice/);
assertNoAnyAs(tokenPanel);

assertMatches(permissionPanel, [/PermissionPanel/, /parseDatabaseRole/, /Revoke access/, /Search members/, /MemberRoleFilter/, /memberRoleFilters/, /countMemberRoles/, /memberRoleCountLabel/, /activeMemberFilterClass/, /filterMembers/, /No matching members/, /visibleMembers\.map/, /granted/]);
assertNoAnyAs(permissionPanel);

assertMatches(backupBillingPanels, [/BackupRestorePanel/, /DepositPanel/, /Archive current DB/, /DB status/, /Snapshot DB/, /Download SQL dump/, /Restore snapshot/, /ICRC-2 approve/, /Search payments/, /filterPayments/, /No matching payments/, /visiblePayments\.map/, /payerPrincipal/, /formatTimestamp/]);
assert.doesNotMatch(backupBillingPanels, /\bdfx\b/);
assertNoAnyAs(backupBillingPanels);

assertMatches(operationPanel, [/RoutedOperationPanel/, /Operation status/, /Lookup routed operation/, /idempotency key/, /operation\.operationId/, /operation\.databaseCanisterId/, /MetricRow/]);
assertNoAnyAs(operationPanel);

assertMatches(responseSidebar, [/ResponseSidebar/, /ResponseMetricsPanel/, /RoutedOperationPanel/, /canLoadRoutedOperation/, /onLoadRoutedOperation/, /UsageEventSummaryPanel/, /ShardPlacementPanel/, /shardPlacementStatus/, /onRefreshAllShardPlacements/, /ShardOperationJournalPanel/, /onReconcileShardOperation/, /ResponseAccessPanel/, /ResponseLifecyclePanel/]);
assertNoAnyAs(responseSidebar);

assertMatches(responseAdminPanels, [/ResponseAccessPanel/, /StorageQuotaPanel/, /TokenPanel/, /PermissionPanel/, /ResponseLifecyclePanel/, /BackupRestorePanel/, /DepositPanel/, /selectedDatabaseStatus/, /onDownloadSqlDump/, /onQuoteDeposit/]);
assertNoAnyAs(responseAdminPanels);

assertMatches(responseMetricsPanel, [/ResponseMetricsPanel/, /IssuedTokenPanel/, /Copy issued token/, /navigator\.clipboard\.writeText\(token\)/, /ResponseMetrics/, /selectedDatabaseId/, /copyValue=\{selectedDatabase\?\.databaseId\}/, /label="Columns"/, /response\?\.columns\.length/, /Batch row sets/, /batchRowSetCount/, /nextResponse\.columns\.length > 0/, /Batch rows/, /batchRowCount/, /Batch affected/, /batchAffectedCount/, /BigInt\(nextResponse\.rowsAffected\)/, /StorageUsageMeter/, /quotaUsagePercent/, /role="progressbar"/]);
assertNoAnyAs(responseMetricsPanel);

assertMatches(tableDataPanel, [/TableDataPanel/, /Search table rows/, /Download table CSV/, /downloadSqlRowsCsv/, /tableCsvFileName/, /Refresh table rows/, /Previous table page/, /Next table page/, /filterPreviewRows/, /sortPreviewRows/, /nextColumnSort/, /columnSort/, /No matching table rows/, /visibleRowEntries/, /rowNumbers=\{visibleRowNumbers\}/, /activeVisibleRowIndex/, /rowNumberOffset=\{tablePreview\.offset\}/, /DataGrid/, /hasNextTablePage/]);
assertNoAnyAs(tableDataPanel);

assertMatches(tableDataHelpers, [/PreviewRowEntry/, /activeVisibleRowIndex/, /filterPreviewRows/, /sortPreviewRows/, /nextColumnSort/, /compareSqlValues/, /rowMatchesPreviewSearch/, /tableCsvFileName/, /sanitizeCsvFilePart/, /formatSqlValue/]);
assertNoAnyAs(tableDataHelpers);

assertMatches(tableEditorPanel, [/TableEditorPanel/, /TableDataPanel/, /TableOverviewPanel/, /TableSchemaPanel/, /RowEditorPanel/, /rowEditorStatus/, /Views are read-only/, /Rows are read-only for this session or database state/, /Row editing enabled/]);
assertNoAnyAs(tableEditorPanel);

assertMatches(tableOverviewPanel, [/TableOverviewPanel/, /Table overview/, /Selected row/, /Selected cell/, /Selected value/, /Selected type/, /Selected kind/, /formatSelectedCellValue/, /formatSqlValue/, /columnKindLabel/]);
assertNoAnyAs(tableOverviewPanel);

assertMatches(tableSchemaPanel, [/TableSchemaPanel/, /Columns/, /Search columns/, /No matching columns/, /filterColumns/, /Schema SQL/, /Download schema SQL/, /buildTableSchemaSql/, /tableSchemaFileName/, /sanitizeSchemaFilePart/, /Kind/, /columnKindLabel/, /IndexViewer/, /ForeignKeyViewer/]);
assertNoAnyAs(tableSchemaPanel);

assertMatches(tokenSessionPanel, [/TokenSessionPanel/, /TokenSessionPanelProps/, /HTTP token/, /Connect/, /Disconnect/]);
assertNoAnyAs(tokenSessionPanel);

assertMatches(operationActions, [/useIcpdbOperationActions/, /getRoutedOperationWithToken/, /loadRoutedOperation/, /clearRoutedOperation/, /Operation id required/, /Operation \$\{operation\.status\}/]);
assertNoAnyAs(operationActions);

assertMatches(rowEditorPanel, [/RowEditorPanel/, /Row editor/, /editStatus/, /disabled=\{!canEditRows\}/, /disabled:cursor-not-allowed/, /Column inputs/, /Fix row JSON/, /Save cell/, /Primary key/, /onMutateRow/]);
assertNoAnyAs(rowEditorPanel);

assertMatches(sqlEditorPanel, [/SqlEditorPanel/, /handleSqlKeyDown/, /event\.metaKey/, /event\.ctrlKey/, /Max rows/, /sqlMaxRows/, /onSqlMaxRowsChange/, /Batch mode runs semicolon-separated statements without params/, /Run batch/, /Run statement/, /BatchResultList/, /SqlResultSummary/, /ResultTable/]);
assertNoAnyAs(sqlEditorPanel);

assert.match(sqlDump, /buildSqlDump/);
assert.match(sqlDump, /splitSqlDumpStatements/);
assert.match(sqlDump, /buildSqlBatchRequest/);
assert.match(sqlDump, /quoteSqlIdentifier/);
assert.match(sqlDump, /CREATE\s*\+?TRIGGER|CREATE\\s\+TRIGGER/);
assertNoAnyAs(sqlDump);

assert.match(rowMutations, /buildInsertRequest/);
assert.match(rowMutations, /buildSelectedRowMutationRequest/);
assert.match(rowMutations, /buildSelectedCellMutationRequest/);
assert.match(rowMutations, /buildNewRowDraft/);
assert.match(rowMutations, /canWriteColumn/);
assert.match(rowMutations, /blob column requires a byte array/);
assert.match(rowMutations, /rowToJsonObject/);
assert.match(rowMutations, /quoteSqlIdentifier/);
assertNoAnyAs(rowMutations);

assertMatches(httpClient, [/IcpdbTokenSession/, /IcpdbWriteOptions/, /onIdempotencyKey/, /Bearer/, /getSessionInfoWithToken/, /getRoutedOperationWithToken/, /listTablesWithToken/, /describeTableWithToken/, /previewTableWithToken/, /sqlQueryWithToken/, /sqlExecuteWithToken/, /sqlBatchWithToken/, /idempotency-key/, /nextIdempotencyKey/, /crypto\.randomUUID/, /collation/, /descending/]);
assertNoAnyAs(httpClient);
assertMatches(tokenSessionHelper, [/normalizeTokenSession/, /HTTP base URL is required/, /database_id is required/, /api token is required/]);
assertNoAnyAs(tokenSessionHelper);

assertMatches(icpdbClient, [/Stable public entrypoint/, /canisterHealth/, /healthCache/, /createIcpdbActor/, /normalizeCanisterHealth/, /listAllDatabasePlacementsAuthenticated/, /sqlBatchAuthenticated/, /beginDatabaseArchiveAuthenticated/, /createDatabaseTokenAuthenticated/]);
assertNoAnyAs(icpdbClient);

assertMatches(icpdbActor, [/IcpdbActor/, /createIcpdbActor/, /createAuthenticatedActor/, /validateCanisterId/, /callIcpdb/, /throwCanisterError/, /Actor\.createActor/, /fetchRootKey/, /get_routed_operation/, /list_all_database_placements/, /reconcile_shard_operation/, /sql_batch/]);
assertNoAnyAs(icpdbActor);

assertMatches(icpdbRawTypes, [/RawDatabaseSummary/, /RawDatabaseShardPlacement/, /RawRoutedOperationInfo/, /RawShardOperationInfo/, /RawDatabaseIndexColumn/, /RawSqlBatchRequest/, /RawSqlExecuteResponse/]);
assertNoAnyAs(icpdbRawTypes);

assertMatches(icpdbDatabaseCodec, [/normalizeCanisterHealth/, /normalizeDatabaseSummary/, /normalizeDatabaseShardPlacement/, /normalizeShardOperationInfo/, /rawShardOperationReconcileRequest/, /normalizeDatabaseTokenInfo/, /databaseTokenScopeVariant/, /databaseRoleVariant/]);
assertNoAnyAs(icpdbDatabaseCodec);

assertMatches(icpdbTableCodec, [/normalizeDatabaseTable/, /normalizeTableDescription/, /normalizeDatabaseIndexColumn/, /normalizeDatabaseForeignKey/, /rawTablePreviewRequest/, /rawSqlBatchRequest/, /normalizeSqlResponse/]);
assertNoAnyAs(icpdbTableCodec);

assertMatches(icpdbDatabaseApi, [/listDatabasesAuthenticated/, /listDatabasePlacementsAuthenticated/, /listAllDatabasePlacementsAuthenticated/, /listShardOperationsAuthenticated/, /reconcileShardOperationAuthenticated/, /createDatabaseAuthenticated/, /deleteDatabaseAuthenticated/]);
assertNoAnyAs(icpdbDatabaseApi);

assertMatches(icpdbAccountApi, [/getUsageAuthenticated/, /getBillingAuthenticated/, /getDepositQuoteAuthenticated/, /depositWithApprovalAuthenticated/, /listPaymentsAuthenticated/, /grantDatabaseAccessAuthenticated/, /createDatabaseTokenAuthenticated/, /setDatabaseQuotaAuthenticated/]);
assertNoAnyAs(icpdbAccountApi);

assertMatches(icpdbTransferApi, [/beginDatabaseArchiveAuthenticated/, /readDatabaseArchiveChunkAuthenticated/, /finalizeDatabaseArchiveAuthenticated/, /cancelDatabaseArchiveAuthenticated/, /beginDatabaseRestoreAuthenticated/, /writeDatabaseRestoreChunkAuthenticated/, /finalizeDatabaseRestoreAuthenticated/]);
assertNoAnyAs(icpdbTransferApi);

assertMatches(icpdbTableApi, [/listTablesAuthenticated/, /describeTableAuthenticated/, /previewTableAuthenticated/, /sqlQueryAuthenticated/, /sqlExecuteAuthenticated/, /sqlBatchAuthenticated/]);
assertNoAnyAs(icpdbTableApi);

assertMatches(httpAdminClient, [/getBillingWithToken/, /setQuotaWithToken/, /listTokensWithToken/, /createTokenWithToken/, /revokeTokenWithToken/, /listMembersWithToken/, /grantMemberWithToken/, /revokeMemberWithToken/, /deleteDatabaseWithToken/, /cancelArchiveWithToken/, /beginArchiveWithToken/, /readArchiveChunkWithToken/, /finalizeArchiveWithToken/, /beginRestoreWithToken/, /writeRestoreChunkWithToken/, /finalizeRestoreWithToken/]);
assertNoAnyAs(httpAdminClient);

assert.match(workbenchState, /parseParams/);
assert.match(workbenchState, /jsonToSqlValue/);
assert.match(workbenchState, /integer params must be safe JS integers/);
assert.match(workbenchState, /Number\.isSafeInteger/);
assert.match(workbenchState, /tablePageLabel/);
assert.match(workbenchState, /hasNextTablePage/);
assert.match(workbenchState, /tableLimitOptions/);
assert.match(workbenchState, /parseSqlMaxRows/);
assert.match(workbenchState, /max rows must be an integer from 1 to 500/);
assert.match(workbenchState, /quotaUsagePercent/);
assert.match(workbenchState, /parseIcpToE8s/);
assert.match(workbenchState, /normalizeCreateTableName/);
assert.match(workbenchLocalState, /shardPlacementStatus/);
assertNoAnyAs(workbenchState);
assertNoAnyAs(workbenchLocalState);

assert.match(databaseTransfer, /archiveDatabaseToSnapshot/);
assert.match(databaseTransfer, /archiveDatabaseToSnapshotWithToken/);
assert.match(databaseTransfer, /loadArchiveSnapshotFromFile/);
assert.match(databaseTransfer, /downloadArchiveSnapshotFile/);
assert.match(databaseTransfer, /downloadSqlDumpFile/);
assert.match(databaseTransfer, /loadSqlDumpFromFile/);
assert.match(databaseTransfer, /restoreArchiveSnapshot/);
assert.match(databaseTransfer, /restoreArchiveSnapshotWithToken/);
assert.match(databaseTransfer, /beginDatabaseRestoreAuthenticated/);
assertNoAnyAs(databaseTransfer);

assert.match(resourceRefresh, /useIcpdbResourceRefresh/);
assert.match(resourceRefresh, /loadTable/);
assert.match(resourceRefresh, /refreshDatabaseDetails/);
assert.match(resourceRefresh, /refreshDatabaseAccount/);
assert.match(resourceRefresh, /describeTableAuthenticated/);
assert.match(resourceRefresh, /previewTableAuthenticated/);
assert.match(resourceRefresh, /getUsageAuthenticated/);
assert.match(resourceRefresh, /getUsageEventSummariesAuthenticated/);
assert.match(resourceRefresh, /getBillingAuthenticated/);
assert.match(resourceRefresh, /shouldLoadOwnerResources \? getBillingAuthenticated/);
assert.match(resourceRefresh, /shouldLoadOwnerResources \? listPaymentsAuthenticated/);
assert.match(resourceRefresh, /listTablesAuthenticated/);
assertNoAnyAs(resourceRefresh);

assert.match(accountActions, /useIcpdbAccountActions/);
assert.match(accountActions, /createReadToken/);
assert.match(accountActions, /createToken/);
assert.match(accountActions, /revokeToken/);
assert.match(accountActions, /grantMember/);
assert.match(accountActions, /revokeMember/);
assert.match(accountActions, /setQuota/);
assert.match(accountActions, /createDatabaseTokenAuthenticated/);
assert.match(accountActions, /grantDatabaseAccessAuthenticated/);
assert.match(accountActions, /revokeDatabaseAccessAuthenticated/);
assertNoAnyAs(accountActions);

assert.match(backupActions, /useIcpdbBackupActions/);
assert.match(backupActions, /archiveDatabase/);
assert.match(backupActions, /loadArchiveFile/);
assert.match(backupActions, /downloadArchiveSnapshot/);
assert.match(backupActions, /downloadSqlDump/);
assert.match(backupActions, /loadSqlDumpFile/);
assert.match(backupActions, /restoreArchive/);
assert.match(backupActions, /archiveDatabaseToSnapshot/);
assert.match(backupActions, /loadArchiveSnapshotFromFile/);
assert.match(backupActions, /downloadArchiveSnapshotFile/);
assert.match(backupActions, /downloadSqlDumpFile/);
assert.match(backupActions, /loadSqlDumpFromFile/);
assert.match(backupActions, /restoreArchiveSnapshot/);
assertNoAnyAs(backupActions);

assert.match(billingActions, /useIcpdbBillingActions/);
assert.match(billingActions, /quoteDeposit/);
assert.match(billingActions, /approveDepositInWallet/);
assert.match(billingActions, /depositApproved/);
assert.match(billingActions, /resetDepositApproval/);
assert.match(billingActions, /getDepositQuoteAuthenticated/);
assert.match(billingActions, /depositWithApprovalAuthenticated/);
assert.match(billingActions, /getBillingAuthenticated/);
assert.match(billingActions, /IcpWallet\.connect/);
assert.match(billingActions, /icrc2Approve/);
assert.match(billingActions, /wallet approve required before deposit/);
assertNoAnyAs(billingActions);

assert.match(databaseActions, /useIcpdbDatabaseActions/);
assert.match(databaseActions, /createDatabase/);
assert.match(databaseActions, /deleteSelectedDatabase/);
assert.match(databaseActions, /cancelArchive/);
assert.match(databaseActions, /createDatabaseAuthenticated/);
assert.match(databaseActions, /deleteDatabaseAuthenticated/);
assert.match(databaseActions, /cancelDatabaseArchiveAuthenticated/);
assert.match(databaseActions, /refreshDatabaseDetails/);
assert.match(databaseActions, /refreshDatabases/);
assert.match(databaseActions, /clearTableState/);
assert.match(databaseActions, /resetDepositApproval/);
assertNoAnyAs(databaseActions);

assertMatches(controller, [/useIcpdbWorkbenchController/, /navigatorProps/, /toolbarProps/, /tableEditorProps/, /sqlEditorProps/, /responseSidebarProps/, /useIcpdbShardActions/, /useIcpdbWorkbenchState/, /useIcpdbResourceRefresh/, /useIcpdbAccountActions/, /useIcpdbBackupActions/, /useIcpdbBillingActions/, /useIcpdbTokenAdminActions/, /useIcpdbTokenBackupActions/, /useIcpdbTokenActions/, /useIcpdbWorkbenchDerivedState/]);
assertNoAnyAs(controller);

assert.match(derivedState, /useIcpdbWorkbenchDerivedState/);
assert.match(derivedState, /selectedDatabase/);
assert.match(derivedState, /selectedTable/);
assert.match(derivedState, /primaryKeyColumns/);
assert.match(derivedState, /editableColumns/);
assert.match(derivedState, /canWriteColumn/);
assert.match(derivedState, /canWriteDatabaseRole/);
assert.match(derivedState, /depositQuoteMatchesAmount/);
assertNoAnyAs(derivedState);

assert.match(sessionActions, /useIcpdbSessionActions/);
assert.match(sessionActions, /AuthClient\.create/);
assert.match(sessionActions, /listDatabasesAuthenticated/);
assert.match(sessionActions, /listDatabasePlacementsAuthenticated/);
assert.match(sessionActions, /setShardPlacementStatus/);
assert.match(sessionActions, /refreshDatabases/);
assert.match(sessionActions, /selectDatabase/);
assert.match(sessionActions, /login/);
assert.match(sessionActions, /identityProviderUrl/);
assert.match(sessionActions, /DELEGATION_TTL_NS/);
assertNoAnyAs(sessionActions);

assertMatches(shardActions, [/useIcpdbShardActions/, /listAllDatabasePlacementsAuthenticated/, /refreshAllShardPlacements/, /listShardOperationsAuthenticated/, /refreshShardOperations/, /reconcileShardOperationAuthenticated/, /reconcileShardOperation/, /Failure reason required/, /setShardPlacementStatus/, /setShardJournalStatus/]);
assertNoAnyAs(shardActions);

assert.match(sqlActions, /useIcpdbSqlActions/);
assert.match(sqlActions, /sqlQueryAuthenticated/);
assert.match(sqlActions, /sqlExecuteAuthenticated/);
assert.match(sqlActions, /sqlBatchAuthenticated/);
assert.match(sqlActions, /CREATE TABLE/);
assert.match(sqlActions, /normalizeCreateTableName/);
assert.match(sqlActions, /normalizeCreateTableColumns/);
assert.match(sqlActions, /buildSqlBatchRequest/);
assert.match(sqlActions, /parseSqlMaxRows/);
assert.match(sqlActions, /@\/lib\/sql-dump/);
assertNoAnyAs(sqlActions);

assert.match(tableActions, /useIcpdbTableActions/);
assert.match(tableActions, /previewTableAuthenticated/);
assert.match(tableActions, /sqlExecuteAuthenticated/);
assert.match(tableActions, /buildSelectedCellMutationRequest/);
assert.match(tableActions, /buildInsertRequest/);
assert.match(tableActions, /buildSelectedRowMutationRequest/);
assert.match(tableActions, /buildNewRowDraft/);
assert.match(tableActions, /cellValueForRow/);
assert.match(tableActions, /startNewRow/);
assert.match(tableActions, /selectPreviewCell/);
assertNoAnyAs(tableActions);

assert.match(tokenActions, /useIcpdbTokenActions/);
assert.match(tokenActions, /connectTokenSession/);
assert.match(tokenActions, /getSessionInfoWithToken/);
assert.match(tokenActions, /previewTableWithToken/);
assert.match(tokenActions, /deleteDatabaseWithToken/);
assert.match(tokenActions, /sqlExecuteWithToken/);
assert.match(tokenActions, /recordIdempotencyKey/);
assert.match(tokenActions, /Last write operation/);
assert.match(tokenActions, /setOperationId/);
assert.match(tokenActions, /setRoutedOperation\(null\)/);
assert.match(tokenActions, /parseSqlMaxRows/);
assert.match(tokenActions, /buildSelectedCellMutationRequest/);
assert.match(tokenActions, /buildSelectedRowMutationRequest/);
assertNoAnyAs(tokenActions);

assert.match(tokenAdminActions, /useIcpdbTokenAdminActions/);
assert.match(tokenAdminActions, /createTokenWithToken/);
assert.match(tokenAdminActions, /grantMemberWithToken/);
assert.match(tokenAdminActions, /setQuotaWithToken/);
assertNoAnyAs(tokenAdminActions);

assert.match(tokenBackupActions, /useIcpdbTokenBackupActions/);
assert.match(tokenBackupActions, /archiveDatabaseToSnapshotWithToken/);
assert.match(tokenBackupActions, /restoreArchiveSnapshotWithToken/);
assertNoAnyAs(tokenBackupActions);

assertMatches(workbenchLocalState, [/useIcpdbWorkbenchState/, /defaultSql/, /walletRef/, /setArchiveSnapshot/, /setWalletStatus/, /sqlMaxRows/, /setSqlMaxRows/, /shardOperations/, /shardPlacements/, /shardReconcileError/, /tokenSession/, /setTokenSession/]);
assertNoAnyAs(workbenchLocalState);

assertMatches(workbench, [/useIcpdbWorkbenchController/, /DatabaseNavigator/, /WorkbenchToolbar/, /ResponseSidebar/, /SqlEditorPanel/, /TableEditorPanel/]);
assertNoAnyAs(workbench);

assert.match(packageJson.scripts.test, /check-icpdb\.mjs/);
assert.match(packageJson.scripts.test, /check-row-mutations\.mjs/);
assert.match(packageJson.scripts.test, /check-http-client\.mjs/);
assert.match(packageJson.scripts.test, /check-http-admin-client\.mjs/);
assertMatches(rowMutationCheck, [/buildSelectedCellMutationRequest/, /buildSelectedRowMutationRequest/, /buildInsertRequest/, /ICPDB row mutation checks OK/]);
assertMatches(httpClientCheck, [/describeTableWithToken/, /getRoutedOperationWithToken/, /sqlExecuteWithToken/, /capturedIdempotencyKeys/, /ICPDB HTTP client checks OK/]);
assertMatches(httpAdminClientCheck, [/createTokenWithToken/, /grantMemberWithToken/, /listPaymentsWithToken/, /setQuotaWithToken/, /deleteDatabaseWithToken/, /cancelArchiveWithToken/, /beginArchiveWithToken/, /finalizeRestoreWithToken/, /ICPDB HTTP admin client checks OK/]);
const removedScriptChecks = [
  ["check-", "dash", "board"].join(""),
  "check-paths",
  "check-smoke-url",
  "check-ui-helpers"
];
for (const removedScriptCheck of removedScriptChecks) {
  assert.equal(packageJson.scripts.test.includes(removedScriptCheck), false);
}
assert.equal(packageJson.dependencies["@dfinity/oisy-wallet-signer"], "^4.1.3");

console.log("ICPDB console checks OK");
