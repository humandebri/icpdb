import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function assertNoAnyAs(source) {
  const code = sourceWithoutStringsAndComments(source);
  assert.doesNotMatch(code, /\bany\b/);
  assert.doesNotMatch(code, /\bas\b/);
}

function sourceWithoutStringsAndComments(source) {
  let output = "";
  let mode = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (mode === "line") {
      if (char === "\n") {
        output += "\n";
        mode = "code";
      } else {
        output += " ";
      }
      continue;
    }
    if (mode === "block") {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        mode = "code";
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (mode === "single" || mode === "double" || mode === "template") {
      const quote = mode === "single" ? "'" : mode === "double" ? "\"" : "`";
      if (char === "\\") {
        output += " ";
        if (next) {
          output += next === "\n" ? "\n" : " ";
          index += 1;
        }
        continue;
      }
      if (char === quote) mode = "code";
      output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line";
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block";
      continue;
    }
    if (char === "'") {
      output += " ";
      mode = "single";
      continue;
    }
    if (char === "\"") {
      output += " ";
      mode = "double";
      continue;
    }
    if (char === "`") {
      output += " ";
      mode = "template";
      continue;
    }
    output += char;
  }
  return output;
}

function assertMatches(source, patterns) {
  for (const pattern of patterns) assert.match(source, pattern);
}

const sdkPackage = await import("icpdb-console/sdk");
const serviceIdentityPackage = await import("icpdb-console/service-identity");

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
const authUrl = new URL("../lib/auth.ts", import.meta.url);
const tokenSessionHelperUrl = new URL("../lib/icpdb-token-session.ts", import.meta.url);
const rowMutationsUrl = new URL("../lib/row-mutations.ts", import.meta.url);
const icpdbClientUrl = new URL("../lib/icpdb-client.ts", import.meta.url);
const icpdbActorUrl = new URL("../lib/icpdb-actor.ts", import.meta.url);
const icpdbRawTypesUrl = new URL("../lib/icpdb-raw-types.ts", import.meta.url);
const icpdbDatabaseCodecUrl = new URL("../lib/icpdb-database-codec.ts", import.meta.url);
const icpdbTableCodecUrl = new URL("../lib/icpdb-table-codec.ts", import.meta.url);
const icpdbSdkUrl = new URL("../lib/icpdb-sdk.ts", import.meta.url);
const icpdbServiceIdentityUrl = new URL("../lib/icpdb-service-identity.ts", import.meta.url);
const icpdbSqlScriptUrl = new URL("../lib/icpdb-sql-script.ts", import.meta.url);
const sdkClientCheckUrl = new URL("check-sdk-client.mjs", import.meta.url);
const sdkPackageArtifactCheckUrl = new URL("check-sdk-package-artifact.mjs", import.meta.url);
const sdkPackageManifestWriterUrl = new URL("write-sdk-package-manifest.mjs", import.meta.url);
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
const sdkTsconfigUrl = new URL("../tsconfig.sdk.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const sdkPackageImportCheckUrl = new URL("./check-sdk-package-import.ts", import.meta.url);
const rowMutationCheckUrl = new URL("./check-row-mutations.mjs", import.meta.url);
const sqlDumpCheckUrl = new URL("./check-sql-dump.mjs", import.meta.url);
const httpAdminClientCheckUrl = new URL("./check-http-admin-client.mjs", import.meta.url);
const httpClientCheckUrl = new URL("./check-http-client.mjs", import.meta.url);

for (const url of [
  pageUrl, rootPageUrl, accountPanelsUrl, backupBillingPanelsUrl, dataGridUrl, databaseListPanelUrl, displayPanelsUrl, navigationPanelsUrl, operationPanelUrl, responseAdminPanelsUrl, responseMetricsPanelUrl, responseSidebarUrl, resultGridUrl, rowEditorPanelUrl, schemaViewersUrl, shardPanelsUrl, sqlEditorPanelUrl, tableDataPanelUrl, tableEditorPanelUrl, tableListPanelUrl, tableOverviewPanelUrl, tableSchemaPanelUrl, tokenSessionPanelUrl, tokenPanelUrl, usageEventsPanelUrl, workbenchUrl, permissionPanelUrl, authUrl, tokenSessionHelperUrl, rowMutationsUrl, icpdbClientUrl, icpdbActorUrl, icpdbRawTypesUrl, icpdbDatabaseCodecUrl, icpdbTableCodecUrl, icpdbSdkUrl, icpdbServiceIdentityUrl, icpdbSqlScriptUrl, icpdbDatabaseApiUrl, icpdbAccountApiUrl, icpdbTransferApiUrl, icpdbTableApiUrl, httpAdminClientUrl, httpClientUrl, resultGridHelpersUrl, sqlDumpUrl, tableDataHelpersUrl, workbenchStateUrl,
  databaseTransferUrl, resourceRefreshUrl, accountActionsUrl, backupActionsUrl, billingActionsUrl, databaseActionsUrl, operationActionsUrl,
  controllerUrl, derivedStateUrl, sessionActionsUrl, shardActionsUrl, sqlActionsUrl, tableActionsUrl, tokenAdminActionsUrl, tokenActionsUrl, tokenBackupActionsUrl,
  workbenchLocalStateUrl, readmeUrl, sdkTsconfigUrl, sdkPackageImportCheckUrl, sdkPackageArtifactCheckUrl, sdkPackageManifestWriterUrl, rowMutationCheckUrl, sqlDumpCheckUrl, httpAdminClientCheckUrl, httpClientCheckUrl
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
const auth = readFileSync(authUrl, "utf8");
const tokenSessionHelper = readFileSync(tokenSessionHelperUrl, "utf8");
const rowMutations = readFileSync(rowMutationsUrl, "utf8");
const icpdbClient = readFileSync(icpdbClientUrl, "utf8");
const icpdbActor = readFileSync(icpdbActorUrl, "utf8");
const icpdbRawTypes = readFileSync(icpdbRawTypesUrl, "utf8");
const icpdbDatabaseCodec = readFileSync(icpdbDatabaseCodecUrl, "utf8");
const icpdbTableCodec = readFileSync(icpdbTableCodecUrl, "utf8");
const icpdbSdk = readFileSync(icpdbSdkUrl, "utf8");
const icpdbServiceIdentity = readFileSync(icpdbServiceIdentityUrl, "utf8");
const icpdbSqlScript = readFileSync(icpdbSqlScriptUrl, "utf8");
const sdkClientCheck = readFileSync(sdkClientCheckUrl, "utf8");
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
const sdkTsconfig = readFileSync(sdkTsconfigUrl, "utf8");
const sdkPackageImportCheck = readFileSync(sdkPackageImportCheckUrl, "utf8");
const sdkPackageArtifactCheck = readFileSync(sdkPackageArtifactCheckUrl, "utf8");
const sdkPackageManifestWriter = readFileSync(sdkPackageManifestWriterUrl, "utf8");
const rowMutationCheck = readFileSync(rowMutationCheckUrl, "utf8");
const sqlDumpCheck = readFileSync(sqlDumpCheckUrl, "utf8");
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
assert.match(readme, /starter batch that creates `notes`, inserts a seed row, shows its schema SQL, and selects it/);
assert.match(readme, /Console shortest path/);
assert.match(readme, /Open `\/icpdb` and click `Login`/);
assert.match(readme, /Click `Create database`/);
assert.match(readme, /Click `Run batch`/);
assert.match(readme, /`Search result rows`, `Copy result CSV`,/);
assert.match(readme, /`Download result CSV`, the table list, and `Open SELECT SQL`/);
assert.match(readme, /`Open SELECT SQL`/);
assert.match(readme, /`Copy schema SQL`, `Open schema SQL`,/);
assert.match(readme, /`Copy SQL` to copy the current editor SQL/);
assert.match(readme, /`Open schema lookup SQL`, `Open column SQL`, `Open foreign key SQL`,/);
assert.match(readme, /`Open INSERT SQL`, `Open count SQL`, `Open page SQL`, `Copy page SQL`, and `Copy table CSV`/);
assert.match(readme, /Copy `Connection URL`/);

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

assertMatches(resultGrid, [/BatchResultList/, /Batch results/, /Grid/, /nextResponse\.columns\.length > 0/, /nextResponse\.columns\.length/, /rowResponses/, /Batch result grids/, /No batch rows/, /Search batch rows/, /icpdb-batch-statement-/, /No matching batch rows/, /SqlResultSummary/, /SQL result/, /label="Columns"/, /response\.columns\.length/, /ResultMetric/, /Search result rows/, /Copy result CSV/, /copiedResultCsv/, /navigator\.clipboard\.writeText\(sqlRowsCsv\(response\.columns, visibleRows\)\)/, /Download result CSV/, /downloadResultCsv/, /downloadTextFile/, /No matching result rows/, /searchPlaceholder/, /noMatchLabel/, /filterResultRows/, /sortResultRows/, /nextColumnSort/, /visibleRowEntries/, /visibleRowNumbers/, /rowNumbers=\{visibleRowNumbers\}/, /resultCountLabel/, /DataGrid/, /GridColumnSort/]);
assertNoAnyAs(resultGrid);

assertMatches(resultGridHelpers, [/export function formatSqlValue/, /downloadSqlRowsCsv/, /sqlRowsCsv/, /downloadTextFile/, /buildResultCsv/, /escapeCsvField/, /compareSqlValues/, /rowMatchesResultSearch/, /ResultRowEntry/]);
assertNoAnyAs(resultGridHelpers);

assertMatches(dataGrid, [/DataGrid/, /onToggleColumnSort/, /columnSortLabel/, /Sort \$\{columnName\} ascending/, /SortIcon/, /cellDisplayValue/, /title=\{cellDisplayValue\}/, /columnDetails/, /columnHeaderMeta/, /rowNumberOffset/, /rowNumbers/, /rowNumberCellClass/, /sticky left-0 z-20/, /sticky left-0 z-10/, /\(no rows\)/, /emptyLabel/, /editableColumnNames/, /onCommitEdit/, /autoFocus/, /event\.key === "Enter"/]);
assertNoAnyAs(dataGrid);

assertMatches(schemaViewers, [/IndexViewer/, /Search indexes/, /No matching indexes/, /Open index SQL/, /Open index SQL for/, /ensureSqlSemicolon/, /filterIndexes/, /indexColumnsLabel/, /expressionIndexColumnLabel/, /TriggerViewer/, /Search triggers/, /No matching triggers/, /Open trigger SQL/, /Open trigger SQL for/, /filterTriggers/, /ForeignKeyViewer/, /Search foreign keys/, /No matching foreign keys/, /Open foreign key SQL/, /onOpenForeignKeySql/, /filterForeignKeys/, /Foreign keys/, /key\.matchClause/, /key\.seq/]);
assertNoAnyAs(schemaViewers);

assert.match(navigationPanels, /DatabaseNavigator/);
assert.match(navigationPanels, /WorkbenchToolbar/);
assert.match(navigationPanels, /TokenSessionPanel/);
assert.match(navigationPanels, /DatabaseList/);
assert.match(navigationPanels, /Principal/);
assert.match(navigationPanels, /icpdb-table-list-panel/);
assert.match(navigationPanels, /onOpenSetupSql/);
assert.match(navigationPanels, /onOpenTableSql/);
assert.match(navigationPanels, /Issue read token/);
assert.match(navigationPanels, /CanisterField/);
assertNoAnyAs(navigationPanels);

assertMatches(tableListPanel, [/TableList/, /Create table/, /Open setup SQL/, /canOpenSetupSql/, /onOpenSetupSql/, /Search tables/, /No matching tables/, /Open SELECT SQL/, /onOpenTableSql/, /filterTables/, /tableSelectionLabel/, /selectedTableBadgeClass/, /TableObjectTypeFilter/, /tableObjectTypeFilters/, /countTableObjectTypes/, /tableObjectCountLabel/, /Views/]);
assertNoAnyAs(tableListPanel);

assertMatches(databaseListPanel, [/DatabaseList/, /Databases/, /Search databases/, /No matching databases/, /filterDatabases/, /DatabaseLifecycleFilter/, /databaseLifecycleFilters/, /countDatabaseLifecycles/, /databaseLifecycleCountLabel/, /databaseLifecycleMatches/, /databaseLifecycleFilterValue/, /Current/, /Archived/, /Deleted/, /databaseSelectionLabel/, /selectedDatabaseBadgeClass/, /selected/, /available/, /databaseLifecycleLabel/, /formatDatabaseLifecycleTimestamp/, /archivedAtMs/, /deletedAtMs/, /current/, /formatBytes/]);
assertNoAnyAs(databaseListPanel);

assertMatches(accountPanels, [/StorageQuotaPanel/, /TokenPanel/, /PermissionPanel/, /Set quota/, /icpdb-token-panel/, /icpdb-permission-panel/]);
assert.doesNotMatch(accountPanels, /tokens\.slice/);
assertNoAnyAs(accountPanels);

assertMatches(tokenPanel, [/TokenPanel/, /parseTokenScope/, /Search tokens/, /TokenScopeFilter/, /tokenScopeFilters/, /countTokenScopes/, /tokenScopeCountLabel/, /activeTokenFilterClass/, /filterTokens/, /No matching tokens/, /visibleTokens\.map/, /last used/, /formatTimestamp/, /revoked/]);
assert.doesNotMatch(tokenPanel, /tokens\.slice/);
assertNoAnyAs(tokenPanel);

assertMatches(permissionPanel, [/PermissionPanel/, /parseDatabaseRole/, /Current caller/, /Copy current caller principal/, /copiedCallerPrincipal/, /Copy member principal/, /copiedMemberPrincipal/, /Copy member principal \$\{member\.principal\}/, /navigator\.clipboard\.writeText\(nextPrincipal\)/, /Paste member principal/, /ClipboardPaste/, /pastedMemberPrincipal/, /navigator\.clipboard\.readText\(\)/, /Member principal/, /service-principal/, /aria-describedby=\{showMemberPrincipalFeedback \? memberPrincipalFeedbackId : undefined\}/, /aria-invalid=\{showMemberPrincipalFeedback \? true : undefined\}/, /memberPrincipalFeedbackId/, /showMemberPrincipalFeedback/, /Member role/, /Grant member access/, /Update member role from/, /Member principal is required/, /Anonymous principal cannot be granted database access/, /Current caller cannot downgrade itself/, /Cannot downgrade the last owner/, /ownerMemberCount <= 1/, /Member already has this role/, /MemberRow/, /ownerMemberCount/, /isLastOwner/, /revokeMemberTitle/, /Cannot revoke the last owner/, /Revoke access for/, /Search members/, /MemberRoleFilter/, /memberRoleFilters/, /Filter members by all roles/, /Filter members by \$\{filter\.label\} role/, /countMemberRoles/, /memberRoleCountLabel/, /activeMemberFilterClass/, /filterMembers/, /No matching members/, /visibleMembers\.map/, /granted/]);
assertNoAnyAs(permissionPanel);

assertMatches(auth, [/DELEGATION_TTL_NS = BigInt\(8\) \* BigInt\(3_600_000_000_000\)/, /identityProviderUrl/, /NEXT_PUBLIC_II_PROVIDER_URL/, /http:\/\/id\.ai\.localhost:8000/, /https:\/\/id\.ai/, /host\.endsWith\("\.localhost"\)/]);
assert.doesNotMatch(auth, /derivationOrigin/);
assertNoAnyAs(auth);

assertMatches(backupBillingPanels, [/BackupRestorePanel/, /DepositPanel/, /Archive current DB/, /DB status/, /Snapshot DB/, /Download SQL dump/, /Restore snapshot/, /ICRC-2 approve/, /Search payments/, /filterPayments/, /No matching payments/, /visiblePayments\.map/, /payerPrincipal/, /formatTimestamp/]);
assert.doesNotMatch(backupBillingPanels, /\bdfx\b/);
assertNoAnyAs(backupBillingPanels);

assertMatches(operationPanel, [/RoutedOperationPanel/, /Operation status/, /Lookup routed operation/, /idempotency key/, /operation\.operationId/, /operation\.databaseCanisterId/, /MetricRow/]);
assertNoAnyAs(operationPanel);

assertMatches(responseSidebar, [/ResponseSidebar/, /ResponseMetricsPanel/, /canisterId/, /RoutedOperationPanel/, /canLoadRoutedOperation/, /onLoadRoutedOperation/, /UsageEventSummaryPanel/, /ShardPlacementPanel/, /shardPlacementStatus/, /onRefreshAllShardPlacements/, /ShardOperationJournalPanel/, /onReconcileShardOperation/, /ResponseAccessPanel/, /ResponseLifecyclePanel/]);
assertNoAnyAs(responseSidebar);

assertMatches(responseAdminPanels, [/ResponseAccessPanel/, /StorageQuotaPanel/, /TokenPanel/, /PermissionPanel/, /ResponseLifecyclePanel/, /BackupRestorePanel/, /selectedDatabaseStatus/, /onDownloadSqlDump/]);
assert.doesNotMatch(responseAdminPanels, /<DepositPanel/);
assertNoAnyAs(responseAdminPanels);

assertMatches(responseMetricsPanel, [/ResponseMetricsPanel/, /IssuedTokenPanel/, /Copy issued token/, /navigator\.clipboard\.writeText\(token\)/, /ResponseMetrics/, /canisterId/, /selectedDatabaseId/, /callerRole/, /selectedDatabase\?\.role \?\? "none"/, /label="Caller role"/, /value=\{callerRole\}/, /connectionUrl/, /formatConsoleConnectionUrl\(canisterId, selectedDatabase\.databaseId\)/, /encodeURIComponent\(databaseId\)/, /icpdb:\/\//, /label="Connection URL"/, /value=\{connectionUrl\}/, /copyValue=\{selectedDatabase && canisterId \? connectionUrl : undefined\}/, /label="Columns"/, /response\?\.columns\.length/, /Batch row sets/, /batchRowSetCount/, /nextResponse\.columns\.length > 0/, /Batch rows/, /batchRowCount/, /Batch affected/, /batchAffectedCount/, /BigInt\(nextResponse\.rowsAffected\)/, /StorageUsageMeter/, /quotaUsagePercent/, /role="progressbar"/]);
assertNoAnyAs(responseMetricsPanel);

assertMatches(tableDataPanel, [/TableDataPanel/, /Search table rows/, /Open page SQL/, /Open page SQL for/, /limit \$\{tableLimit\} offset \$\{tablePreview\.offset\}/, /title="Open page SQL"/, /onOpenPageSql/, /Copy page SQL/, /copiedPageSql/, /currentPageSql/, /navigator\.clipboard\.writeText\(currentPageSql\)/, /Copy table CSV/, /copiedTableCsv/, /navigator\.clipboard\.writeText\(sqlRowsCsv\(previewColumns, visibleRows\)\)/, /Download table CSV/, /downloadSqlRowsCsv/, /tableCsvFileName/, /Refresh table rows/, /Previous table page/, /Next table page/, /filterPreviewRows/, /sortPreviewRows/, /nextColumnSort/, /columnSort/, /No matching table rows/, /visibleRowEntries/, /rowNumbers=\{visibleRowNumbers\}/, /activeVisibleRowIndex/, /rowNumberOffset=\{tablePreview\.offset\}/, /DataGrid/, /hasNextTablePage/]);
assertNoAnyAs(tableDataPanel);

assertMatches(tableDataHelpers, [/PreviewRowEntry/, /activeVisibleRowIndex/, /filterPreviewRows/, /sortPreviewRows/, /nextColumnSort/, /compareSqlValues/, /rowMatchesPreviewSearch/, /tablePageSelectSql/, /quoteSqlIdentifier/, /tableCsvFileName/, /sanitizeCsvFilePart/, /formatSqlValue/]);
assertNoAnyAs(tableDataHelpers);

assertMatches(tableEditorPanel, [/TableEditorPanel/, /TableDataPanel/, /TableOverviewPanel/, /TableSchemaPanel/, /onOpenCountSql/, /onOpenColumnSql/, /onOpenForeignKeySql/, /onOpenInsertSql/, /onOpenPageSql/, /onOpenSchemaLookupSql/, /onOpenSchemaSql/, /onOpenTableSql/, /RowEditorPanel/, /rowEditorStatus/, /Views are read-only/, /Rows are read-only for this session or database state/, /Row editing enabled/]);
assertNoAnyAs(tableEditorPanel);

assertMatches(tableOverviewPanel, [/TableOverviewPanel/, /Table overview/, /Open SELECT SQL/, /Open INSERT SQL/, /Open count SQL/, /Open count SQL for/, /title="Open count SQL"/, /Open schema lookup SQL/, /Open schema lookup SQL for/, /title="Open schema lookup SQL"/, /onOpenCountSql/, /onOpenInsertSql/, /onOpenSchemaLookupSql/, /onOpenTableSql/, /Code2/, /Plus/, /canOpenInsertSql/, /canWriteColumn/, /Search/, /Selected row/, /Selected cell/, /Selected value/, /Selected type/, /Selected kind/, /formatSelectedCellValue/, /formatSqlValue/, /columnKindLabel/]);
assertNoAnyAs(tableOverviewPanel);

assertMatches(tableSchemaPanel, [/TableSchemaPanel/, /Columns/, /Search columns/, /No matching columns/, /Open column SQL/, /onOpenColumnSql/, /filterColumns/, /Schema SQL/, /Copy schema SQL/, /copiedSchemaSql/, /navigator\.clipboard\.writeText\(schemaSql\)/, /Open schema SQL/, /Code2/, /Open schema lookup SQL/, /onOpenSchemaLookupSql/, /onOpenSchemaSql/, /Download schema SQL/, /buildTableSchemaSql/, /tableSchemaFileName/, /sanitizeSchemaFilePart/, /Kind/, /columnKindLabel/, /IndexViewer/, /onOpenSchemaSql=\{onOpenSchemaSql\}/, /TriggerViewer/, /ForeignKeyViewer/, /onOpenForeignKeySql=\{onOpenForeignKeySql\}/]);
assertNoAnyAs(tableSchemaPanel);

assertMatches(tokenSessionPanel, [/TokenSessionPanel/, /TokenSessionPanelProps/, /HTTP token/, /Connect/, /Disconnect/]);
assertNoAnyAs(tokenSessionPanel);

assertMatches(operationActions, [/useIcpdbOperationActions/, /getRoutedOperationAuthenticated/, /getRoutedOperationWithToken/, /loadRoutedOperation/, /!tokenSession && \(!authClient \|\| !canisterId \|\| !databaseId\)/, /tokenSession\s+\?\s+await getRoutedOperationWithToken/, /:\s+await getRoutedOperationAuthenticated/, /clearRoutedOperation/, /requireIdentity/, /Login and database required/, /Operation id required/, /Operation \$\{operation\.status\}/]);
assert.doesNotMatch(operationActions, /if \(!tokenSession\) return/);
assertNoAnyAs(operationActions);

assertMatches(rowEditorPanel, [/RowEditorPanel/, /Row editor/, /editStatus/, /disabled=\{!canEditRows\}/, /disabled:cursor-not-allowed/, /Column inputs/, /Fix row JSON/, /Save cell/, /Primary key/, /onMutateRow/]);
assertNoAnyAs(rowEditorPanel);

assertMatches(sqlEditorPanel, [/SqlEditorPanel/, /handleSqlKeyDown/, /event\.metaKey/, /event\.ctrlKey/, /copySql/, /navigator\.clipboard\.writeText\(props\.sql\)/, /Copy SQL/, /copiedSql/, /Max rows/, /sqlMaxRows/, /onSqlMaxRowsChange/, /Batch mode runs semicolon-separated statements without params/, /Run query/, /Run update/, /Run batch/, /runButtonLabel/, /BatchResultList/, /SqlResultSummary/, /ResultTable/, /aria-label=\{shortcut\.title\}/, /Open sqlite_schema SQL/, /Open table list SQL/, /Open schema object count SQL/, /Open column catalog SQL/, /Open view list SQL/, /Open index list SQL/, /Open foreign key catalog SQL/, /Open trigger list SQL/, /GROUP BY type/, /BarChart3/, /pragma_table_xinfo\(m\.name\)/, /pragma_foreign_key_list\(m\.name\)/, /WHERE type = 'index'/, /WHERE type = 'trigger'/]);
assertNoAnyAs(sqlEditorPanel);

assert.match(sqlDump, /buildSqlDump/);
assert.match(sqlDump, /splitSqlDumpStatements/);
assert.match(sqlDump, /buildSqlBatchRequest/);
assert.match(sqlDump, /quoteSqlIdentifier/);
assert.match(sqlDump, /sqlQueryAuthenticated/);
assert.match(sqlDump, /sqlQueryWithToken/);
assert.match(sqlDump, /sqlite_sequence/);
assert.match(sqlDump, /DELETE FROM sqlite_sequence WHERE name/);
assert.match(sqlDump, /INSERT INTO sqlite_sequence\(name, seq\)/);
assert.match(sqlDump, /formatDumpInsertStatement/);
assert.match(sqlDump, /hidden === 0/);
assertNoAnyAs(sqlDump);

assertMatches(sqlDumpCheck, [/buildSqlDumpWithReader/, /sqlite_sequence/, /GENERATED ALWAYS/, /body_len/, /note_lengths/, /INSERT INTO "notes" \\\\?\("id", "body"\\\\?\)/, /doesNotMatch/, /other_table/, /previewCalls/, /ICPDB SQL dump checks OK/]);

assertMatches(icpdbSqlScript, [/splitSqlStatements/, /splitSqlDumpStatements/, /trimSqlSemicolon/, /TEMPORARY/, /CREATE\\s\+\(\?:\(\?:TEMP\|TEMPORARY\)\\s\+\)\?TRIGGER/, /line_comment/, /block_comment/, /mainSqlToken/, /sqlTokenAt/, /firstSqlTokenIndex/, /skipWithClauseList/, /skipSqlIdentifier/, /skipBalancedSql/]);
assertNoAnyAs(icpdbSqlScript);

assert.match(rowMutations, /buildInsertRequest/);
assert.match(rowMutations, /buildSelectedRowMutationRequest/);
assert.match(rowMutations, /buildSelectedCellMutationRequest/);
assert.match(rowMutations, /buildNewRowDraft/);
assert.match(rowMutations, /canWriteColumn/);
assert.match(rowMutations, /blob column requires a byte array/);
assert.match(rowMutations, /rowToJsonObject/);
assert.match(rowMutations, /quoteSqlIdentifier/);
assertNoAnyAs(rowMutations);

assertMatches(httpClient, [/IcpdbTokenSession/, /IcpdbWriteOptions/, /onIdempotencyKey/, /Bearer/, /getSessionInfoWithToken/, /getRoutedOperationWithToken/, /listTablesWithToken/, /describeTableWithToken/, /previewTableWithToken/, /sqlQueryWithToken/, /sqlExecuteWithToken/, /sqlBatchWithToken/, /idempotency-key/, /writeIdempotencyKey/, /optionalClientString/, /nextIdempotencyKey/, /crypto\.randomUUID/, /sessionBaseUrl/, /sessionToken/, /sessionDatabaseId/, /HTTP base URL/, /api token/, /requestDatabaseId/, /requiredClientString/, /request database_id must match token session database_id/, /idempotencyKey/, /SQL text/, /operation_id/, /table_name/, /must be a non-empty string/, /collation/, /descending/]);
assertNoAnyAs(httpClient);
assertMatches(tokenSessionHelper, [/normalizeTokenSession/, /HTTP base URL is required/, /database_id is required/, /api token is required/]);
assertNoAnyAs(tokenSessionHelper);

assertMatches(icpdbClient, [/Stable public entrypoint/, /canisterHealth/, /healthCache/, /createIcpdbActor/, /normalizeCanisterHealth/, /listAllDatabasePlacementsAuthenticated/, /getRoutedOperationAuthenticated/, /sqlBatchAuthenticated/, /beginDatabaseArchiveAuthenticated/, /createDatabaseTokenAuthenticated/]);
assert.doesNotMatch(icpdbClient, /icpdb-sdk/);
assertNoAnyAs(icpdbClient);

assertMatches(icpdbActor, [/IcpdbActor/, /IcpdbActorOptions/, /rootKey\?: Uint8Array/, /createIcpdbActor/, /createAuthenticatedActor/, /validateCanisterId/, /callIcpdb/, /throwCanisterError/, /Actor\.createActor/, /fetchRootKey/, /localReplicaFetchForHost/, /fetchLocalReplica/, /retryDelaysMs/, /delay\(retryDelayMs\)/, /rewriteLocalReplicaApiUrl/, /input instanceof Request/, /headers\.delete\("host"\)/, /input\.clone\(\)\.arrayBuffer\(\)/, /\/api\/v2\//, /\^\\\/\+api\\\/v\[34\]\\\//, /get_routed_operation/, /list_all_database_placements/, /reconcile_shard_operation/, /top_up_database_balance/, /sql_batch/]);
assert.doesNotMatch(icpdbActor, /@\/lib/);
assertNoAnyAs(icpdbActor);

assertMatches(icpdbRawTypes, [/RawDatabaseSummary/, /RawDatabaseShardPlacement/, /RawRoutedOperationInfo/, /RawShardOperationInfo/, /RawDatabaseIndexColumn/, /RawSqlBatchRequest/, /RawSqlExecuteResponse/, /routed_operation_id/, /idempotency_key/]);
assertNoAnyAs(icpdbRawTypes);

assertMatches(icpdbDatabaseCodec, [/normalizeCanisterHealth/, /normalizeDatabaseSummary/, /normalizeDatabaseShardPlacement/, /normalizeShardOperationInfo/, /rawShardOperationReconcileRequest/, /normalizeDatabaseTokenInfo/, /databaseTokenScopeVariant/, /databaseRoleVariant/, /unknown database token scope variant/, /unknown database role variant/, /unknown database status variant/, /unknown routed operation status variant/]);
assert.doesNotMatch(icpdbDatabaseCodec, /@\/lib/);
assertNoAnyAs(icpdbDatabaseCodec);

assertMatches(icpdbTableCodec, [/normalizeDatabaseTable/, /normalizeTableDescription/, /normalizeDatabaseIndexColumn/, /normalizeDatabaseForeignKey/, /rawTablePreviewRequest/, /rawSqlBatchRequest/, /idempotency_key/, /normalizeSqlResponse/]);
assert.doesNotMatch(icpdbTableCodec, /@\/lib/);
assertNoAnyAs(icpdbTableCodec);

assertMatches(icpdbSdk, [/connectIcpdbDatabase/, /createIcpdbDatabase/, /connectDatabase/, /createClient/, /connectClient/, /createClientFromDatabase/, /createLibsqlClient/, /createTursoLikeClient/, /createClientFromDatabase/, /IcpdbSqlClientDatabaseSource/, /IcpdbSqlClientDatabase/, /enrichSqlClientDatabase/, /IcpdbSqlClient/, /IcpdbSqlClientMetadata/, /principal: \(\) => Promise<string>/, /async function principal/, /principal is not available on this database source/, /identityPrincipalText/, /principal must be a non-empty string/, /IcpdbSqlClientResult/, /IcpdbSqlClientJsonResult/, /IcpdbResultSet/, /IcpdbCreateClientOptions/, /IcpdbSqlArgsInput/, /IcpdbCellValue/, /IcpdbJsonCellValue/, /IcpdbJsonRow/, /IcpdbSnapshotInfo/, /snapshotInfo/, /isSqlClientStatementTuple/, /isSqlClientBatchTuple/, /readonly \[string, IcpdbSqlArgsInput\?\]/, /IcpdbMigration/, /IcpdbMigrationResult/, /setupStatements\?: readonly IcpdbSqlClientBatchStatement\[\]/, /setupMigrations\?: readonly IcpdbMigration\[\]/, /migrate: \{/, /\(migrations: readonly IcpdbMigration\[\]\): Promise<IcpdbMigrationResult>/, /\(statements: readonly IcpdbSqlClientBatchStatement\[\]\): Promise<IcpdbSqlClientResult\[\]>/, /function migrateDatabase/, /function migrateOnSource/, /migrate: \{[\s\S]*\(migrations: readonly IcpdbMigration\[\], databaseId\?: string\): Promise<IcpdbMigrationResult>[\s\S]*\(statements: readonly IcpdbSqlClientBatchStatement\[\], databaseId\?: string\): Promise<IcpdbSqlClientResult\[\]>/, /IcpdbPreparedStatementInput/, /IcpdbPreparedStatement/, /prepare: \(statement: IcpdbPreparedStatementInput, args\?: IcpdbSqlArgsInput\) => IcpdbPreparedStatement/, /function prepare\(statement: IcpdbPreparedStatementInput, boundArgs\?: IcpdbSqlArgsInput\)/, /all: \(args/, /get: \(args/, /values: \(args/, /first: \(args/, /firstValue: \(args/, /run: \(args/, /all: \(statement: IcpdbSqlClientStatementInput/, /get: \(statement: IcpdbSqlClientStatementInput/, /values: \(statement: IcpdbSqlClientStatementInput/, /first: \(statement: IcpdbSqlClientStatementInput/, /firstValue: \(statement: IcpdbSqlClientStatementInput/, /run: \(statement: IcpdbSqlClientStatementInput/, /all: \(statement: string \| IcpdbStatementInput/, /get: \(statement: string \| IcpdbStatementInput/, /values: \(statement: string \| IcpdbStatementInput/, /first: \(statement: string \| IcpdbStatementInput/, /firstValue: \(statement: string \| IcpdbStatementInput/, /async function all/, /async function get/, /async function values/, /async function first/, /async function firstValue/, /async function run/, /responseValues/, /firstResponseValue/, /resultValues/, /firstResultValue/, /rowValues/, /Promise\.resolve\(\)\.then\(databaseSource\)/, /cachedPromise = nextPromise\.then/, /databasePromise = cachedPromise/, /databasePromise = null/, /MIGRATIONS_TABLE/, /icpdb_schema_migrations/, /ensureMigrationTable/, /sqlite_master/, /normalizeMigrations/, /duplicate migration version/, /has no SQL statements/, /namedSqlParameters/, /seenTokens/, /namedSqlArgValue/, /missing SQL named arg/, /named SQL args require named placeholders/, /columnTypes: string\[\]/, /responseColumnTypes/, /rowsAffected: number/, /changes: number/, /lastInsertRowid: bigint \| undefined/, /lastInsertRowid: string \| null/, /toJSON: \(\) => IcpdbSqlClientJsonResult/, /routedOperationId: string \| null/, /idempotencyKey/, /assertSqlResponseShape/, /SQL result columns must be an array/, /SQL result column name must be a string/, /SQL result rows must be an array/, /SQL result row must be an array/, /SQL result row length must match columns length/, /integer result must be a base-10 integer string/, /real result must be a finite number/, /text result must be a string/, /blob result must be a byte array/, /SQL result value kind must be null, integer, real, text, or blob/, /safeIntegerText/, /integerTextBigInt/, /must be a non-negative integer/, /must be an integer/, /exceeds JavaScript safe integer range/, /IcpdbBatchMode/, /IcpdbSqlClientBatchOptions/, /databaseId: async \(\) =>/, /queryRows: \(statement: IcpdbSqlClientStatementInput/, /queryOne: \(statement: IcpdbSqlClientStatementInput/, /batch: \(statements: readonly IcpdbSqlClientBatchStatement\[\], options\?: IcpdbSqlClientBatchOptions/, /transaction: \{/, /\(statements: readonly IcpdbSqlClientBatchStatement\[\]/, /\(mode\?: IcpdbBatchMode\): Promise<never>/, /transaction: \(statements: readonly IcpdbBatchStatementInput\[\]/, /transaction: batchWithDatabase/, /async function transaction/, /executeMultiple: \(source: string/, /async function executeMultiple/, /executeMultipleOnDatabase/, /executeMultipleWithDatabase/, /sqlScriptStatements/, /sqlClientBatchOptions/, /read batch mode only accepts read SQL/, /batch mode must be read, write, or deferred/, /skipLineComment/, /skipBlockComment/, /health: \(\) => Promise<CanisterHealth>/, /async function health/, /normalizeCanisterHealth/, /canister_health/, /topUpDatabaseBalance/, /normalizeDatabaseBilling/, /listTables: \(\) => Promise<DatabaseTable/, /tables: \(\) => Promise<DatabaseTable/, /tables: \(databaseId\?: string\) => Promise<DatabaseTable/, /describeTable: \(tableName: string\) => Promise<TableDescription>/, /describe: \(tableName: string\) => Promise<TableDescription>/, /describe: \(tableName: string, databaseId\?: string\) => Promise<TableDescription>/, /previewTable: \(tableName: string, options\?: IcpdbDatabasePreviewOptionsObject/, /preview: \(tableName: string, options\?: IcpdbDatabasePreviewOptionsObject/, /preview: \(tableName: string, options\?: IcpdbPreviewOptions\) => Promise<TablePreviewResponse>/, /delete: \(\) => Promise<void>/, /getUsage: \(\) => Promise<DatabaseUsage>/, /listUsageEvents: \(\) => Promise<DatabaseUsageEventSummary\[\]>/, /grantMember: \(principal: string, role: DatabaseRole\) => Promise<void>/, /revokeMember: \(principal: string\) => Promise<void>/, /listMembers: \(\) => Promise<DatabaseMember\[\]>/, /placement: \(\) => Promise<DatabaseShardPlacement \| null>/, /listAllPlacements: \(\) => Promise<DatabaseShardPlacement\[\]>/, /listShardOperations: \(\) => Promise<ShardOperationInfo\[\]>/, /reconcileShardOperation: \(request: ShardOperationReconcileRequest\) => Promise<ShardOperationInfo>/, /archive: \(\) => Promise<Uint8Array>/, /restore: \(snapshot: IcpdbRestoreInput, options\?: IcpdbRestoreOptions\) => Promise<void>/, /delete is not available on this database source/, /getUsage is not available on this database source/, /listUsageEvents is not available on this database source/, /grantMember is not available on this database source/, /revokeMember is not available on this database source/, /listMembers is not available on this database source/, /placement is not available on this database source/, /archive is not available on this database source/, /restore is not available on this database source/, /executeScript/, /executeScriptBatches/, /dumpSql/, /loadSqlDump/, /dumpSqlFromDatabase/, /loadSqlDumpBatches/, /splitSqlStatements/, /splitSqlDumpStatements/, /SCRIPT_BATCH_STATEMENTS/, /sqlClientStatement/, /sqlClientResult/, /isReadSql/, /createIcpdbClient/, /IcpdbDatabaseClient/, /rootKey\?: Uint8Array/, /createDatabase/, /IcpdbCreateSetup/, /createDatabaseWithSetup/, /await db\.delete\(\)/, /Preserve the setup failure/, /setupSql\/setupStatements\/setupMigrations require creating a database/, /queryWithDatabase/, /queryRowsWithDatabase/, /queryOneWithDatabase/, /responseRows/, /jsonRows/, /jsonCellValue/, /executeWithDatabase/, /migrateWithDatabase/, /batchWithDatabase/, /schemaWithDatabase/, /grantMemberWithDatabase/, /revokeMemberWithDatabase/, /listMembersWithDatabase/, /getUsageWithDatabase/, /listUsageEventsWithDatabase/, /placementWithDatabase/, /listAllPlacements/, /listShardOperations/, /reconcileShardOperation/, /deleteDatabaseWithDatabase/, /archiveWithDatabase/, /restoreWithDatabase/, /sha256/, /bytesToHex/, /databaseRoleVariant/, /rawShardOperationReconcileRequest/, /normalizeShardOperationInfo/, /sqlValue/, /Uint8Array/]);
assertMatches(icpdbSdk, [/requiredMigrateInput/, /migrate input must be an array/, /normalizeMigrations\(migrateInput\)/, /migrateInput\.map\(sqlClientBatchStatement\)/, /normalizedSqlScriptBatchOptions/, /normalizedSqlDumpBatchOptions/, /const normalizedOptions = sqlClientBatchOptions\(request, options\)/, /source\.transaction\(request, normalizedOptions\)/, /normalizedRestorePayload/, /snapshotInfoOnSource/, /normalizeSnapshotInfo/, /normalizeSourceSqlResponse/, /normalizeSourceSqlResponses/, /normalizeSourceSqlClientResults/, /normalizeSourceMigrationResult/, /SQL result must be an object/, /SQL result truncated must be a boolean/, /SQL client result columnTypes length must match columns length/, /normalizeSourcePreparedStatement/, /prepared statement sql does not match requested SQL/, /preparedSourceArgs/, /prepared statement execute must be a function/, /normalizeSourceRows/, /normalizeSourceOptionalRow/, /normalizeSourceCellValueRows/, /normalizeSourceOptionalCellValue/, /SQL row list must be an array/, /normalizeSourceCellValue\(value, "SQL value row cell"\)/, /must be null, string, number, bigint, or ArrayBuffer/, /normalizeSourceDatabaseInspection/, /normalizeSourceTableInspections/, /normalizeSourceString/, /database inspection must be an object/, /database inspection tables must be an array/, /normalizeSourceString\(await source\.schema\(normalizedTableName \?\? undefined\), "schema result"\)/, /normalizeSourceString\(await source\.dumpSql\(dumpOptions\), "SQL dump result"\)/, /normalizeSourceDatabaseTables/, /database table objectType must be table or view/, /normalizeSourceTableDescription/, /table description tableName does not match requested table/, /normalizeSourceDatabaseColumns/, /normalizeSourceDatabaseIndexes/, /normalizeSourceDatabaseTriggers/, /normalizeSourceDatabaseForeignKeys/, /normalizeSourceTablePreview/, /table preview tableName does not match requested table/, /normalizeSourceDatabaseUsage/, /normalizeSourceDatabaseUsageEvents/, /normalizeSourceRoutedOperationInfo/, /normalizeSourceDatabaseMembers/, /normalizeSourceDatabaseShardPlacementOrNull/, /normalizeSourceDatabaseStatus/, /database usage events must be an array/, /sourceByteArray\(operation\.requestHash/, /must be a byte array/, /database table status objectType must be table or view/, /snapshot sha256 must be a 64-character hex SHA-256 hash/, /migration name must be a string/, /migration SQL must be a string/, /migration SQL must be a non-empty string/]);
assertMatches(icpdbSdk, [/requiredTableName[\s\S]*return value\.trim\(\)/]);
assertMatches(icpdbSdk, [/requiredOperationId[\s\S]*return value\.trim\(\)/]);
assertMatches(icpdbSdk, [/rejectPreparedStatementOptions/, /prepared statement idempotencyKey is not supported/, /prepared statement maxRows is not supported/, /prepared statement databaseId is not supported/]);
assertMatches(icpdbSdk, [/assertSqlClientDatabaseSource/, /database source must be an object/, /database source query must be a function/, /database source execute must be a function/]);
assertMatches(icpdbSdk, [/OPTIONAL_DATABASE_SOURCE_METHODS/, /database source \$\{method\} must be a function/, /"batch"/, /"queryRows"/, /"connectionUrl"/, /"close"/]);
assertMatches(icpdbSdk, [/IcpdbSqlClientStatementInput/, /IcpdbSqlClientStatement[\s\S]*databaseId\?: never/, /rejectSqlClientStatementDatabaseId/, /SQL client statement databaseId is not supported; choose database at the client or database handle/, /IcpdbSqlClientScriptOptionsObject[\s\S]*databaseId\?: never/, /IcpdbDatabasePreviewOptionsObject[\s\S]*databaseId\?: never/, /IcpdbInspectOptions[\s\S]*databaseId\?: never/, /IcpdbSqlDumpOptions[\s\S]*databaseId\?: never/, /IcpdbRestoreOptions[\s\S]*databaseId\?: never/, /IcpdbWaitForRoutedOperationOptions[\s\S]*databaseId\?: never/, /databaseBoundPreviewOptions/, /rejectPreviewOptionDatabaseId/, /database preview option databaseId is not supported; choose database at the client or database handle/, /rejectInspectOptionDatabaseId/, /database inspect option databaseId is not supported; choose database at the client, low-level inspect argument, or database handle/, /rejectSqlDumpOptionDatabaseId/, /database dump option databaseId is not supported; choose database at the client, low-level dump argument, or database handle/, /rejectRestoreOptionDatabaseId/, /database restore option databaseId is not supported; choose database at the client, low-level restore argument, or database handle/, /rejectWaitForRoutedOperationOptionDatabaseId/, /database wait option databaseId is not supported; choose database at the client, low-level wait argument, or database handle/, /IcpdbDatabaseStatementInput[\s\S]*databaseId\?: never/, /databaseBoundStatement/, /database handle statement databaseId is not supported; choose database when creating the handle/, /IcpdbDatabaseBatchOptionsObject[\s\S]*databaseId\?: never/, /IcpdbSqlClientBatchOptionsObject[\s\S]*databaseId\?: never/, /rejectSqlClientBatchOptionDatabaseId/, /SQL client batch option databaseId is not supported; choose database at the client or database handle/, /IcpdbSqlClientBatchStatementObject/, /idempotencyKey\?: never/, /maxRows\?: never/, /databaseId\?: never/, /IcpdbSqlClientBatchStatement/, /IcpdbSnapshotInfo/, /snapshotInfo/, /bytesToHex/, /bind: \(args\?: IcpdbSqlArgsInput\) => IcpdbPreparedStatement/, /statementArgs/, /prepare\(normalizedSql, statementArgs\(args\)\)/]);
assertMatches(icpdbSdk, [/IcpdbCreateDatabaseOptions[\s\S]*databaseId\?: never/]);
assertMatches(icpdbSdk, [/const databaseId = normalizeDatabaseId\(source\.databaseId\)/]);
assertMatches(icpdbSdk, [/IcpdbCreateSetupOptions[\s\S]*databaseId\?: never/, /create setup databaseId is not supported/]);
assertMatches(icpdbSdk, [/IcpdbConnectSqlClientOptions/, /IcpdbExistingDatabaseSqlClientOptions[\s\S]*setupSql\?: never[\s\S]*setupStatements\?: never[\s\S]*setupMigrations\?: never/, /IcpdbCreateSqlClientOptions[\s\S]*databaseId\?: never/]);
assertMatches(icpdbSdk, [/optionalNonEmptyString\(options\.host, "host"\)/]);
assertMatches(icpdbSdk, [/optionalNonEmptyBytes\(options\.rootKey, "rootKey"\)/, /must be non-empty bytes/]);
assertMatches(icpdbSdk, [/ANONYMOUS_PRINCIPAL/, /memberPrincipal/, /grantablePrincipal/, /Principal\.fromText/, /assertDatabaseRole/, /database member principal must be a non-empty string/, /database member principal must be a valid principal/, /anonymous principal cannot be granted database access/, /database role must be reader, writer, or owner/]);
assertMatches(icpdbSdk, [/scriptOptions\?\.idempotencyKey/, /dumpOptions\?\.idempotencyKey/]);
assertMatches(icpdbSdk, [/rejectBatchStatementOptions/, /batch statement idempotencyKey is not supported; use batch option idempotencyKey/, /batch statement maxRows is not supported; use batch option maxRows/, /batch statement databaseId is not supported; choose database at the client or batch option/]);
assertMatches(icpdbSdk, [/expectedSnapshotSha256/, /expectedSha256 must be a 64-character hex SHA-256 hash/]);
assertMatches(icpdbSdk, [/export type IcpdbStatementInput/, /args\?: IcpdbSqlArgsInput/, /export type IcpdbBatchStatementInput/, /requiredSqlString/, /statementInputParams/, /use either args or params, not both/, /use either statement args or call args, not both/, /use either tuple args or call args, not both/, /SQL statement must be a string, \[sql, args\?\] tuple, or \{ sql, args\? \} object/, /SQL statement tuple must be \[sql, args\?\]/, /requiredSqlString\(sql, "SQL statement tuple SQL"\)/, /must be a non-empty string/, /SQL statement tuple args must be an array or named object/, /SQL args must be an array or named object/, /isSqlArgsRecord/, /Object\.getPrototypeOf/, /unsupported SQL bind value/]);
assertMatches(icpdbSdk, [/boolean/, /value \? "1" : "0"/]);
assertMatches(icpdbSdk, [/Date/, /toISOString\(\)/, /invalid Date SQL bind value/]);
assertMatches(icpdbSdk, [/ArrayBufferView/, /ArrayBuffer\.isView/, /new Uint8Array\(value\.buffer, value\.byteOffset, value\.byteLength\)/]);
assertMatches(icpdbSdk, [/requiredNonEmptyString/, /trim\(\)\.length/]);
assert.doesNotMatch(icpdbSdk, /@\/lib/);
assertNoAnyAs(icpdbSdk);

assertMatches(icpdbServiceIdentity, [/loadIcpdbServiceIdentity/, /assertSingleServiceIdentitySecret/, /service identity must use exactly one secret source/, /readOptionalSecretText/, /must be a non-empty string/, /requiredFilePath/, /path must be a non-empty string/, /loadIcpdbServicePrincipal/, /loadIcpdbServicePrincipalFromEnv/, /loadIcpdbServicePrincipalFromEnvFile/, /loadIcpdbServiceSetupFromEnv/, /loadIcpdbServiceSetupFromEnvFile/, /grantIcpdbServiceIdentity/, /grantIcpdbServiceIdentityFromEnv/, /grantIcpdbServiceIdentityFromEnvFile/, /provisionIcpdbServiceEnvFile/, /IcpdbProvisionedServiceEnv/, /IcpdbServiceEnvInspection[\s\S]*hasDatabase: boolean/, /hasDatabase: databaseId !== undefined/, /database connection URL does not match databaseId/, /assertDatabaseRole/, /database role must be reader, writer, or owner/, /createIcpdbServiceClient/, /createIcpdbServiceClientFromEnv/, /createIcpdbServiceClientFromEnvFile/, /connectIcpdbServiceDatabase/, /connectIcpdbServiceDatabaseFromEnv/, /connectIcpdbServiceDatabaseFromEnvFile/, /createIcpdbServiceSqlClient/, /createIcpdbServiceSqlClientFromEnv/, /createIcpdbServiceSqlClientFromEnvFile/, /connectClientFromEnv/, /connectClientFromEnvFile/, /createIcpdbPersistedServiceSqlClientFromEnvFile/, /principal: \(\) => loadIcpdbServicePrincipalFromEnvFile\(path\)/, /persistServiceDatabaseIdOrDelete/, /await db\.delete\(\)/, /createIcpdbServiceDatabaseFromEnvFile/, /createClientFromDatabase/, /serviceConnectionHasDatabase/, /loadIcpdbServiceEnvFile/, /formatIcpdbServiceEnv/, /assertServiceEnvObject/, /service env must be an object/, /requiredEnvKey/, /must be a valid env key/, /writeIcpdbServiceEnvFile/, /persistIcpdbServiceDatabaseId/, /formatIcpdbDatabaseUrl/, /setupSqlFromEnv/, /ICPDB_SETUP_SQL_FILE/, /setupStatementsFromEnv/, /setupStatementFromJson/, /ICPDB_SETUP_STATEMENTS/, /ICPDB_SETUP_STATEMENTS_FILE/, /setupMigrationsFromEnv/, /ICPDB_SETUP_MIGRATIONS/, /ICPDB_SETUP_MIGRATIONS_FILE/, /SERVICE_ENV_FILE_MODE/, /0o600/, /chmod/, /databaseId is required/, /parseServiceEnvFile/, /ICPDB_IDENTITY_PEM_FILE/, /ICPDB_IDENTITY_JSON_FILE/, /ICPDB_ROOT_KEY/, /hexToBytes/, /Secp256k1KeyIdentity\.fromPem/, /Ed25519KeyIdentity\.fromJSON/, /Preserve the finalize failure; archive cancellation is best-effort cleanup/]);
assertMatches(icpdbServiceIdentity, [/assertServiceArchiveFileSource/, /archive database source must be an object/, /archive database source databaseId must be a non-empty string/, /archive database source beginArchive must be a function/, /archive database source readArchiveChunk must be a function/, /archive database source finalizeArchive must be a function/, /archive database source cancelArchive must be a function/, /assertServiceRestoreFileTarget/, /restore database target must be an object/, /restore database target databaseId must be a non-empty string/, /restore database target beginRestore must be a function/, /restore database target writeRestoreChunk must be a function/, /restore database target finalizeRestore must be a function/]);
assertMatches(icpdbServiceIdentity, [/IcpdbServiceCreateDatabaseOptions[\s\S]*databaseId\?: never/]);
assertMatches(icpdbServiceIdentity, [/IcpdbServiceExistingDatabaseSqlClientOptions[\s\S]*setupSql\?: never[\s\S]*setupStatements\?: never[\s\S]*setupMigrations\?: never/, /IcpdbServiceCreateSqlClientOptions[\s\S]*databaseId\?: never/, /assertServiceSqlClientSetupOptions/]);
assertMatches(icpdbServiceIdentity, [/Preserve the open\/transfer failure; archive cancellation is best-effort cleanup/]);
assertMatches(icpdbServiceIdentity, [/requiredNonEmptyEnvValue/, /trim\(\)\.length/, /databaseId is required/]);
assertMatches(icpdbServiceIdentity, [/setupStructuredValueFromJson/, /kind must be null, integer, real, text, or blob/, /base-10 integer string/]);
assert.doesNotMatch(icpdbServiceIdentity, /@\/lib/);
assertNoAnyAs(icpdbServiceIdentity);

assertMatches(icpdbDatabaseApi, [/listDatabasesAuthenticated/, /listDatabasePlacementsAuthenticated/, /listAllDatabasePlacementsAuthenticated/, /listShardOperationsAuthenticated/, /getRoutedOperationAuthenticated/, /normalizeRoutedOperationInfo/, /reconcileShardOperationAuthenticated/, /createDatabaseAuthenticated/, /deleteDatabaseAuthenticated/]);
assertNoAnyAs(icpdbDatabaseApi);

assertMatches(icpdbAccountApi, [/getUsageAuthenticated/, /getBillingAuthenticated/, /getDepositQuoteAuthenticated/, /depositWithApprovalAuthenticated/, /listPaymentsAuthenticated/, /grantDatabaseAccessAuthenticated/, /revokeDatabaseAccessAuthenticated/, /createDatabaseTokenAuthenticated/, /setDatabaseQuotaAuthenticated/, /memberPrincipalValue/, /grantablePrincipalValue/, /Principal\.fromText/, /normalizedPrincipal/, /assertDatabaseRole/, /assertDatabaseTokenScope/, /tokenNameValue/, /tokenIdValue/, /quotaBytesBigInt/, /Number\.MAX_SAFE_INTEGER/, /database member principal must be a non-empty string/, /database member principal must be a valid principal/, /anonymous principal cannot be granted database access/, /database role must be reader, writer, or owner/, /database token scope must be read, write, or owner/, /database token name must be a non-empty string/, /database token id must be a non-empty string/, /quota bytes must be a non-negative safe integer/]);
assertNoAnyAs(icpdbAccountApi);

assertMatches(icpdbTransferApi, [/beginDatabaseArchiveAuthenticated/, /readDatabaseArchiveChunkAuthenticated/, /finalizeDatabaseArchiveAuthenticated/, /cancelDatabaseArchiveAuthenticated/, /beginDatabaseRestoreAuthenticated/, /writeDatabaseRestoreChunkAuthenticated/, /finalizeDatabaseRestoreAuthenticated/]);
assertNoAnyAs(icpdbTransferApi);

assertMatches(icpdbTableApi, [/listTablesAuthenticated/, /describeTableAuthenticated/, /previewTableAuthenticated/, /sqlQueryAuthenticated/, /sqlExecuteAuthenticated/, /sqlBatchAuthenticated/]);
assertNoAnyAs(icpdbTableApi);

assertMatches(httpAdminClient, [/getBillingWithToken/, /setQuotaWithToken/, /listTokensWithToken/, /createTokenWithToken/, /revokeTokenWithToken/, /listMembersWithToken/, /grantMemberWithToken/, /revokeMemberWithToken/, /deleteDatabaseWithToken/, /cancelArchiveWithToken/, /beginArchiveWithToken/, /readArchiveChunkWithToken/, /finalizeArchiveWithToken/, /beginRestoreWithToken/, /writeRestoreChunkWithToken/, /finalizeRestoreWithToken/, /sessionBaseUrl/, /sessionToken/, /sessionDatabaseId/, /HTTP base URL/, /api token/, /quotaBytesNumber/, /tokenNameValue/, /tokenIdValue/, /snapshotHashBytes/, /nonNegativeSafeInteger/, /positiveUint32/, /byteArrayValue/, /quota bytes must be a non-negative safe integer/, /database token name must be a non-empty string/, /database token id must be a non-empty string/, /snapshot hash must be a 32-byte SHA-256 digest/, /memberPrincipalValue/, /grantablePrincipalValue/, /Principal\.fromText/, /normalizedPrincipal/, /assertDatabaseRole/, /assertDatabaseTokenScope/, /database member principal must be a non-empty string/, /database member principal must be a valid principal/, /anonymous principal cannot be granted database access/, /database role must be reader, writer, or owner/, /database token scope must be read, write, or owner/]);
assertNoAnyAs(httpAdminClient);

assert.match(workbenchState, /parseParams/);
assert.match(workbenchState, /isValidPrincipalText/);
assert.match(workbenchState, /Principal\.fromText/);
assert.match(workbenchState, /namedSqlParameters/);
assert.match(workbenchState, /named SQL params require named placeholders/);
assert.match(workbenchState, /missing SQL named param/);
assert.match(workbenchState, /skipLineComment/);
assert.match(workbenchState, /skipBlockComment/);
assert.match(workbenchState, /jsonToSqlValue/);
assert.match(workbenchState, /structuredSqlValue/);
assert.match(workbenchState, /value \? "1" : "0"/);
assert.match(workbenchState, /Array\.isArray\(value\) && value\.every\(isByteValue\)/);
assert.match(workbenchState, /SqlValue object params must be null, integer, real, text, or blob/);
assert.match(workbenchState, /integer params must be safe JS integers/);
assert.match(workbenchState, /Number\.isSafeInteger/);
assert.match(workbenchState, /tablePageLabel/);
assert.match(workbenchState, /hasNextTablePage/);
assert.match(workbenchState, /tableLimitOptions/);
assert.match(workbenchState, /parseSqlMaxRows/);
assert.match(workbenchState, /max rows must be an integer from 1 to 500/);
assert.match(workbenchState, /quotaUsagePercent/);
assert.match(workbenchState, /isSafeQuotaBytes/);
assert.match(derivedState, /canSetQuota = canManageDatabase && isSafeQuotaBytes\(quotaBytes\)/);
assert.match(workbenchState, /parseIcpToE8s/);
assert.match(workbenchState, /normalizeCreateTableName/);
assert.match(workbenchLocalState, /shardPlacementStatus/);
assertNoAnyAs(workbenchState);
assertNoAnyAs(workbenchLocalState);
assert.match(sqlActions, /parseParams\(paramsJson, sql\)/);
assert.match(tokenActions, /parseParams\(paramsJson, sql\)/);

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
assert.match(databaseActions, /newDatabaseStarterSql/);
assert.match(databaseActions, /CREATE TABLE notes/);
assert.match(databaseActions, /hello from ICPDB/);
assert.match(databaseActions, /SELECT name, type, sql FROM sqlite_schema WHERE name = 'notes'/);
assert.match(databaseActions, /SELECT id, body FROM notes ORDER BY id DESC/);
assert.match(databaseActions, /createDatabaseAuthenticated/);
assert.match(databaseActions, /deleteDatabaseAuthenticated/);
assert.match(databaseActions, /cancelDatabaseArchiveAuthenticated/);
assert.match(databaseActions, /refreshDatabaseDetails/);
assert.match(databaseActions, /refreshDatabases/);
assert.match(databaseActions, /clearTableState/);
assert.match(databaseActions, /resetDepositApproval/);
assert.match(databaseActions, /setMode\("batch"\)/);
assert.match(databaseActions, /setParamsJson\("\[\]"\)/);
assert.match(databaseActions, /setSql\(newDatabaseStarterSql\)/);
assert.match(databaseActions, /setView\("sql"\)/);
assertNoAnyAs(databaseActions);

assertMatches(controller, [/useIcpdbWorkbenchController/, /navigatorProps/, /toolbarProps/, /tableEditorProps/, /sqlEditorProps/, /responseSidebarProps/, /useIcpdbShardActions/, /useIcpdbWorkbenchState/, /useIcpdbResourceRefresh/, /useIcpdbAccountActions/, /useIcpdbBackupActions/, /useIcpdbBillingActions/, /useIcpdbTokenAdminActions/, /useIcpdbTokenBackupActions/, /useIcpdbTokenActions/, /useIcpdbWorkbenchDerivedState/, /openCreateTableSetupSql/, /openTableSelectSql/, /openTableColumnSql/, /openTableForeignKeySql/, /openTableInsertSql/, /openTablePageSql/, /openSchemaLookupSql/, /openSchemaSql/, /onOpenSetupSql: openCreateTableSetupSql/, /onOpenColumnSql: openTableColumnSql/, /onOpenForeignKeySql: openTableForeignKeySql/, /onOpenInsertSql: openTableInsertSql/, /onOpenPageSql: openTablePageSql/, /onOpenSchemaLookupSql: openSchemaLookupSql/, /onOpenSchemaSql: openSchemaSql/, /onOpenTableSql: openTableSelectSql/, /buildNewRowDraft/, /canWriteColumn/, /quoteSqlIdentifier/, /tablePageSelectSql/, /normalizeCreateTableName/, /normalizeCreateTableColumns/, /sqlite_schema/, /WHERE tbl_name = \?1 OR name = \?1/, /quoteSqlString/, /INSERT INTO/, /hello from ICPDB/, /SELECT \* FROM/, /PRAGMA table_xinfo/, /PRAGMA foreign_key_list/, /LIMIT \$\{tableLimit\}/, /setSql\(tablePageSelectSql\(nextTableName, limit, offset\)\)/, /function openSchemaSql\(source: string\) \{\n    state\.setMode\("batch"\);/, /function openSchemaLookupSql\(nextTableName: string\) \{\n    if \(!nextTableName\) return;\n    state\.setTableName\(nextTableName\);\n    state\.setMode\("query"\);/, /setSql\(source\)/, /setOperationId: state\.setOperationId/, /setRoutedOperation: state\.setRoutedOperation/, /canLoadRoutedOperation: Boolean\(tokenSession \|\| \(authClient && canisterId && databaseId\)\)/, /setMode: state\.setMode/, /setParamsJson: state\.setParamsJson/, /setSql: state\.setSql/, /setView: state\.setView/]);
assertNoAnyAs(controller);

assert.match(derivedState, /useIcpdbWorkbenchDerivedState/);
assert.match(derivedState, /selectedDatabase/);
assert.match(derivedState, /selectedTable/);
assert.match(derivedState, /primaryKeyColumns/);
assert.match(derivedState, /editableColumns/);
assert.match(derivedState, /canWriteColumn/);
assert.match(derivedState, /canWriteDatabaseRole/);
assert.match(derivedState, /depositQuoteMatchesAmount/);
assert.match(derivedState, /ANONYMOUS_PRINCIPAL/);
assert.match(derivedState, /isGrantableMemberPrincipal/);
assert.match(derivedState, /isValidPrincipalText\(value\)/);
assert.match(derivedState, /isCallerSelfDowngrade/);
assert.match(derivedState, /isLastOwnerDowngrade/);
assert.match(derivedState, /hasSameMemberRole/);
assert.match(derivedState, /value !== ANONYMOUS_PRINCIPAL/);
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
assert.match(sqlActions, /recordSqlResponseOperation/);
assert.match(sqlActions, /routedOperationId/);
assert.match(sqlActions, /Last write operation/);
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
assert.match(tableActions, /recordSqlResponseOperation/);
assert.match(tableActions, /routedOperationId/);
assert.match(tableActions, /Last write operation/);
assertNoAnyAs(tableActions);

assert.match(tokenActions, /useIcpdbTokenActions/);
assert.match(tokenActions, /connectTokenSession/);
assert.match(tokenActions, /getSessionInfoWithToken/);
assert.match(tokenActions, /previewTableWithToken/);
assert.match(tokenActions, /deleteDatabaseWithToken/);
assert.match(tokenActions, /sqlExecuteWithToken/);
assert.match(tokenActions, /recordIdempotencyKey/);
assert.match(tokenActions, /recordSqlResponseOperation/);
assert.match(tokenActions, /routedOperationId/);
assert.match(tokenActions, /Last write operation/);
assert.match(tokenActions, /setOperationId/);
assert.match(tokenActions, /setRoutedOperation\(null\)/);
assert.match(tokenActions, /parseSqlMaxRows/);
assert.match(tokenActions, /buildSelectedCellMutationRequest/);
assert.match(tokenActions, /buildSelectedRowMutationRequest/);
assertNoAnyAs(tokenActions);

assert.match(tokenAdminActions, /useIcpdbTokenAdminActions/);
assert.match(tokenAdminActions, /canManageDatabase/);
assert.match(tokenAdminActions, /canGrantMember/);
assert.match(tokenAdminActions, /canMutateMembers/);
assert.match(tokenAdminActions, /canSetQuota/);
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
assert.match(packageJson.scripts.test, /check-sql-dump\.mjs/);
assert.match(packageJson.scripts.test, /check-sdk-package-artifact\.mjs/);
assert.match(packageJson.scripts.test, /check-sdk-client\.mjs/);
assert.match(packageJson.scripts.test, /check-row-mutations\.mjs/);
assert.match(packageJson.scripts.test, /check-http-client\.mjs/);
assert.match(packageJson.scripts.test, /check-http-admin-client\.mjs/);
assert.match(packageJson.scripts.test, /build:sdk/);
assert.match(packageJson.scripts.typecheck, /build:sdk/);
assert.match(packageJson.scripts["build:sdk"], /tsconfig\.sdk\.json/);
assert.match(packageJson.scripts["build:sdk"], /write-sdk-package-manifest\.mjs/);
assert.equal(packageJson.type, "module");
assert.deepEqual(packageJson.files, ["dist-sdk"]);
assertMatches(sdkTsconfig, [/"module": "ES2022"/, /"moduleResolution": "Bundler"/, /"outDir": "dist-sdk"/, /"declaration": true/, /"lib\/icpdb-sdk\.ts"/, /"lib\/icpdb-node\.ts"/, /"lib\/icpdb-server\.ts"/, /"lib\/icpdb-service-identity\.ts"/]);
assert.deepEqual(packageJson.exports["./sdk"], {
  types: "./dist-sdk/icpdb-sdk.d.ts",
  import: "./dist-sdk/icpdb-sdk.js"
});
assert.deepEqual(packageJson.exports["."], packageJson.exports["./sdk"]);
assert.deepEqual(packageJson.exports["./node"], {
  types: "./dist-sdk/icpdb-node.d.ts",
  import: "./dist-sdk/icpdb-node.js"
});
assert.deepEqual(packageJson.exports["./server"], {
  types: "./dist-sdk/icpdb-server.d.ts",
  import: "./dist-sdk/icpdb-server.js"
});
assert.deepEqual(packageJson.exports["./service-identity"], {
  types: "./dist-sdk/icpdb-service-identity.d.ts",
  import: "./dist-sdk/icpdb-service-identity.js"
});
assertMatches(sdkPackageImportCheck, [/from "icpdb-console"/, /from "icpdb-console\/service-identity"/, /checkIcpdbSdkPackageImports/, /checkIcpdbServiceIdentityPackageImports/, /connectIcpdbDatabase/, /createIcpdbDatabase/, /createClient/, /connectClient/, /createLibsqlClient/, /createTursoLikeClient/, /createClientFromDatabase/, /IcpdbSqlClient/, /IcpdbDatabaseInspection/, /IcpdbDatabaseStatus/, /IcpdbResultSet/, /IcpdbPreparedStatement/, /DatabaseArchiveInfo/, /DatabaseMember/, /DatabaseRole/, /DatabaseTable/, /DatabaseUsage/, /DatabaseUsageEventSummary/, /RoutedOperationInfo/, /ShardOperationInfo/, /SqlExecuteResponse/, /SqlStatement/, /SqlValue/, /TableDescription/, /TablePreviewResponse/, /setupStatements/, /setupMigrations/, /package_setup_migrated/, /package_client_setup_migrated/, /ICPDB_SETUP_STATEMENTS/, /ICPDB_SETUP_STATEMENTS_FILE/, /ICPDB_SETUP_MIGRATIONS/, /ICPDB_SETUP_MIGRATIONS_FILE/, /service_client_migrated/, /service_created_migrated/, /createIcpdbServiceClientFromEnv/, /createIcpdbServiceClientFromEnvFile/, /createIcpdbServiceSqlClientFromEnv/, /createIcpdbServiceSqlClientFromEnvFile/, /createIcpdbPersistedServiceSqlClientFromEnvFile/, /persistedFileSqlClient/, /connectIcpdbServiceDatabaseFromEnv/, /connectIcpdbServiceDatabaseFromEnvFile/, /loadIcpdbServiceSetupFromEnv/, /loadIcpdbServiceSetupFromEnvFile/, /archiveDatabaseToFileFromEnv/, /restoreDatabaseFromFileFromEnv/, /columnTypes: string\[\]/, /rowsAffected: number/, /changes: number/, /changes\.toString\(\)/, /lastInsertRowid: bigint \| undefined/, /jsonLastInsertRowid: string \| null/, /result\.toJSON\(\)\.lastInsertRowid/, /routedOperationId: string \| null/, /args: \{ value: 1 \}/, /params: \{ value: 1 \}/, /SELECT :value AS value/, /lowLevelRows/, /lowLevelValues/, /lowLevelRow/, /lowLevelFirst/, /lowLevelFirstValue/, /client\.inspect\(\)/, /sqlClient\.inspect\(/, /connectedDb\.inspect\(/, /client\.status\(\)/, /sqlClient\.status\(\)/, /connectedDb\.status\(\)/, /client\.listAllPlacements/, /client\.listShardOperations/, /client\.reconcileShardOperation/, /fileClient\.listAllPlacements/, /fileClient\.listShardOperations/, /fileClient\.reconcileShardOperation/, /operator verified failure/, /client\.run\("INSERT INTO notes/, /client\.transaction\(\[\{ sql: "INSERT INTO notes/, /low_level_multiple/, /client\.migrate/, /low_level_migrated/, /tupleGetRow/, /valueRows/, /firstRow/, /firstCell/, /preparedValues/, /preparedFirst/, /preparedFirstValue/, /taggedPreparedRows/, /objectPreparedRows/, /tuplePreparedRows/, /sqlClientDatabaseValues/, /sqlClientDatabaseFirst/, /sqlClientDatabaseFirstValue/, /connectedDb\.run/, /connectedDb\.execute/, /connectedDb\.transaction/, /connectedDb\.get/, /connectedDb\.all/, /connectedDb\.executeMultiple/, /connected_multiple/, /connectedDb\.migrate/, /connected_migrated/, /connectedDb\.tables\(/, /connectedDb\.describe\(/, /connectedDb\.preview\(/, /\.schema\("notes"\)/, /\.databaseId\(\)/, /\.close\(\)/, /\.queryRows\(/, /\.queryOne\(/, /\.values\(/, /\.first\(/, /\.firstValue\(/, /sqlClient\.all\(/, /sqlClient\.get\(/, /sqlClient\.values\(/, /sqlClient\.first\(/, /sqlClient\.firstValue\(/, /sqlClient\.run\(/, /\.prepare\(/, /sqlClient\.prepare\(sql`SELECT/, /sqlClient\.prepare\(\{ sql: "SELECT :value AS value"/, /sqlClient\.prepare\(\["SELECT \?1 AS value"/, /\.all\(/, /\.get\(/, /\.run\(/, /\.batch\(\[\{ sql: "INSERT INTO notes/, /\["INSERT INTO notes/, /\.transaction\(/, /"write"\)/, /\.migrate\(/, /package_migration/, /\.executeMultiple\(/, /\.listTables\(/, /\.describeTable\(/, /\.previewTable\(/, /\.inspect\(/, /\.getUsage\(/, /\.status\(\)/, /\.listUsageEvents\(/, /\.grantMember\(/, /\.listMembers\(/, /\.revokeMember\(/, /\.placement\(/, /\.executeScript\(/, /\.dumpSql\(/, /\.loadSqlDump\(/, /\.restore\(await .*\.archive\(\)\)/, /loadIcpdbServiceEnvFile/, /formatIcpdbServiceEnv/, /writeIcpdbServiceEnvFile/, /persistIcpdbServiceDatabaseId/, /loadIcpdbServicePrincipalFromEnv/, /loadIcpdbServicePrincipalFromEnvFile/, /grantIcpdbServiceIdentityFromEnv/, /grantIcpdbServiceIdentityFromEnvFile/]);
assertMatches(sdkPackageImportCheck, [/connectClientFromEnv/, /connectClientFromEnvFile/, /NodeConnectedServiceSqlClient/, /ServerConnectedServiceSqlClient/]);
assertMatches(sdkPackageImportCheck, [/IcpdbCreateDatabaseOptions/, /IcpdbConnectSqlClientOptions/, /IcpdbServiceCreateDatabaseOptions/, /invalidCreateOptions/, /invalidServiceCreateOptions/]);
assertMatches(sdkPackageImportCheck, [/invalidCreateClientSetupOptions/, /invalidConnectClientSetupOptions/]);
assertMatches(sdkPackageImportCheck, [/invalidLowLevelCreateSetup/]);
assertMatches(sdkPackageImportCheck, [/IcpdbServiceSqlClientOptions/, /invalidServiceSqlClientSetupOptions/]);
assertMatches(sdkPackageImportCheck, [/9007199254740993/, /kind: "integer"/, /kind: "blob"/]);
assertMatches(sdkPackageImportCheck, [/IcpdbCellValue/, /IcpdbJsonCellValue/, /IcpdbJsonRow/, /typedBlobCell/, /jsonBlobCell/, /jsonRows/]);
assertMatches(sdkPackageImportCheck, [/fileSqlClient\.principal\(\)/, /persistedFileSqlClient\.principal\(\)/]);
assertMatches(sdkPackageImportCheck, [/defaultServiceEnvFileMode/, /checkIcpdbServiceEnvFileMode\(\)/, /defaultServiceEnv/, /loadIcpdbServiceEnvFile\(\)/]);
assertMatches(sdkPackageImportCheck, [/client\.execute\(\{ sql: "INSERT INTO notes\(id\) VALUES \(:id\)", args/, /client\.batch\(\[\{ sql: "INSERT INTO notes\(id\) VALUES \(:id\)", args/, /connectedDb\.execute\(\{ sql: "INSERT INTO notes\(id\) VALUES \(:id\)", args/, /connectedDb\.batch\(\[\{ sql: "INSERT INTO notes\(id\) VALUES \(:id\)", args/]);
assertMatches(sdkPackageImportCheck, [/enabled: true/, /SELECT :enabled AS enabled/]);
assertMatches(sdkPackageImportCheck, [/new Date\("2026-05-29T00:00:00.000Z"\)/, /SELECT :created_at AS created_at/]);
assertMatches(sdkPackageImportCheck, [/new ArrayBuffer\(2\)/, /SELECT :payload AS payload/]);
assertMatches(sdkPackageImportCheck, [/new DataView\(new ArrayBuffer\(2\)\)/]);
assertNoAnyAs(sdkPackageImportCheck);
assertMatches(sdkPackageManifestWriter, [/connectClientFromEnv/, /connectClientFromEnvFile/, /shortest create-or-connect env-file path/]);
assertMatches(sdkPackageManifestWriter, [/"@icpdb\/client"/, /description/, /publishConfig/, /access/, /public/, /## Install/, /npm install @icpdb\/client/, /npm install \.\/icpdb-console\/dist-sdk/, /main/, /types/, /files/, /README\.md/, /dist-sdk/, /"@icp-sdk\/core"/, /"\.\/service-identity"/, /rewriteSdkImportExtensions/, /\.js/, /Create a hosted DB, set up schema, execute, query, and persist one handoff object with one client/, /Shortest app path/, /import \{ createClient, sql \} from \\"@icpdb\/client\\"/, /setupSql: \\\"CREATE TABLE notes/, /connectionUrl.*url.*client\.info\(\).*reusable.*Server, CLI, or CI/, /client\.info\(\).*one handoff object/, /libSQL-shaped `client\.execute\(\{ sql, args \}\)` form/, /Start from a canister-only ICPDB URL/, /url: \\\"icpdb:\/\/<canister-id>\\\"/, /Reconnect later with the explicit DB connection URL/, /import \{ connectClient \} from \\"@icpdb\/client\\"/, /const client = connectClient\(\{/, /Using `connectClient` requires a DB-bearing URL or `databaseId`/, /canister-only URLs fail with `databaseId is required`/, /connectionUrl,/, /Add parameterized setup statements or versioned migrations/, /client\.execute\(\{ sql: \\\"INSERT INTO notes/, /const result = await client\.query/, /const rows = result\.rows/, /createIcpdbDatabase/, /connectClient/, /createLibsqlClient/, /createTursoLikeClient/, /Turso \/ libSQL-shaped API/, /not a drop-in/, /authToken/, /syncUrl/, /syncInterval/, /tls/, /fetch/, /concurrency/, /offline/, /readYourWrites/, /encryptionKey/, /silently ignored/, /embedded replicas/, /multi-call interactive transactions/, /setupStatements/, /setupMigrations/, /delete the created DB if setup fails/, /ICPDB_SETUP_STATEMENTS/, /ICPDB_SETUP_STATEMENTS_FILE/, /ICPDB_SETUP_MIGRATIONS/, /ICPDB_SETUP_MIGRATIONS_FILE/, /setup_direct_settings/, /setup_settings/, /direct_notes/, /direct_multiple/, /from-direct-named/, /from-direct-transaction/, /create_direct_settings/, /Direct database clients accept/, /low-level `createIcpdbClient` surface also exposes/, /listAllPlacements\(\)/, /listShardOperations\(\)/, /reconcileShardOperation\(\.\.\.\)/, /waitForRoutedOperation/, /directFirst/, /directAll/, /rawValues/, /firstBody/, /noteCount/, /createIcpdbServiceClientFromEnvFile/, /service identity low-level client/, /operator reconcile/, /createIcpdbServiceSqlClientFromEnv/, /createIcpdbServiceSqlClientFromEnvFile/, /createIcpdbPersistedServiceSqlClientFromEnvFile/, /provisionIcpdbServiceEnvFile/, /Choose one service identity secret form/, /Multiple secret sources are rejected/, /Grant and provision helpers reject roles/, /deletes the newly created DB if env persistence fails/, /principal --format table/, /console Permissions/, /from-persisted-ci/, /loadIcpdbServiceSetupFromEnvFile/, /persistIcpdbServiceDatabaseId/, /mode 0600/, /service\.env/, /queryRows/, /queryOne/, /client\.get\(/, /client\.values/, /client\.firstValue/, /client\.scalar/, /tupleFirst/, /from-tuple-run/, /Single statement calls also accept/, /client\.all\(/, /client\.run\(/, /top-level shortcuts/, /from-run/, /client\.prepare/, /from-prepare/, /from-named-params/, /from-batch-params/, /prepare\(sql, args\?\)/, /initiallyBound/, /`values\(\)` for array rows/, /`firstValue\(\)` \/ `scalar\(\)` for the first column/, /client\.batch/, /from-tuple/, /client\.transaction/, /from-transaction/, /transaction\(statements\)/, /client\.migrate/, /icpdb_schema_migrations/, /create_settings/, /executeMultiple/, /named objects/, /params.*named objects/, /Repeated named placeholders/, /\{ sql, params \}/, /:name/, /libSQL-style/, /read.*write.*deferred/, /\[sql, args\?\]/, /Batch execution is atomic/, /columnTypes/, /rowsAffected/, /changes/, /lastInsertRowid/, /result\.toJSON\(\)/, /routedOperationId/, /SQL client statement objects, SQL client script\/dump options, database preview\/inspect\/dump\/restore\/wait options, database handle statement objects, database handle batch\/script options, and SQL client batch options reject `databaseId`/, /low-level DB-first inspect\/dump\/restore\/wait overloads also reject a conflicting option `databaseId`/, /idempotencyKey/, /single-statement write objects/, /Per-statement batch\/transaction `idempotencyKey`, `maxRows`, and `databaseId` are rejected/, /tables\(\)/, /describe\(tableName\)/, /preview\(tableName\)/, /listTables/, /describeTable/, /previewTable/, /client\.inspect/, /schema SQL plus table descriptions and preview rows/, /client\.getUsage/, /client\.status/, /aggregate stats/, /client\.grantMember/, /client\.listMembers/, /client\.revokeMember/, /client\.placement/, /client\.delete/, /client\.close/, /cached database handle/, /Failed initial connect/, /create attempts are not cached/, /loadSqlDump/, /client\.archive/, /client\.restore/]);
assertMatches(sdkPackageManifestWriter, [/import \{ createClient, sql \}/, /sql`INSERT INTO notes\(body\) VALUES/, /The same `sql` tagged template works for single statements, `batch`, `transaction`, `setupStatements`, and libSQL-shaped `migrate` statement arrays/]);
assertMatches(sdkPackageManifestWriter, [/structured/, /9007199254740993/, /blob byte arrays/]);
assertMatches(sdkPackageManifestWriter, [/blob cells return `ArrayBuffer`/, /converts blob cells to byte arrays/]);
assertMatches(sdkPackageManifestWriter, [/client\.principal\(\)/, /persistedClient\.principal\(\)/]);
assertMatches(sdkPackageManifestWriter, [/reject empty or whitespace-only `canisterId`, `databaseId`, SDK `host`, empty SDK `rootKey`, and `ICPDB_\*` connection values/, /Whitespace-only database ids are rejected before the env file is rewritten/]);
assertMatches(sdkPackageManifestWriter, [/CTE-leading statements/, /CTE-leading write statements/]);
assertMatches(sdkPackageManifestWriter, [/Boolean bind values map to SQLite integer/, /enabled: true/]);
assertMatches(sdkPackageManifestWriter, [/Date bind values map to SQLite ISO-8601 text/]);
assertMatches(sdkPackageManifestWriter, [/ArrayBuffer and Uint8Array bind values map to SQLite blobs/, /new ArrayBuffer\(2\)/]);
assertMatches(sdkPackageManifestWriter, [/DataView and typed-array bind values map to SQLite blobs/, /new DataView\(new ArrayBuffer\(2\)\)/]);
assertMatches(sdkPackageManifestWriter, [/Browser Internet Identity principals and Server\/CI service identity principals are intentionally different/, /Do not share a private key to force principal equality/, /grant the service principal to the same database ACL/, /Member principal/, /Grant member access/, /database ACL is the boundary that authorizes both principals/]);
assert.doesNotMatch(sdkPackageManifestWriter, /\bas const\b/);
assertMatches(sdkPackageArtifactCheck, [/connectClientFromEnv/, /connectClientFromEnvFile/, /connectNodeClientFromEnvFile/, /connectServerClientFromEnvFile/, /shortest create-or-connect env-file path/]);
assertMatches(sdkPackageArtifactCheck, [/smokeDb = await createClientFromEnvFile/, /firstValue = await smokeDb/, /Canister-only service/, /without setup SQL/, /first scalar/, /icpdb scalar "SELECT 1 AS value" --format table/, /Without setup SQL, a first `scalar/]);
assertMatches(sdkPackageArtifactCheck, [/"@icpdb\/client"/, /manifest\.description/, /manifest\.publishConfig/, /## Install/, /npm install @icpdb\\\/client/, /icpdb-console\\\/dist-sdk/, /@icpdb\/client\/service-identity/, /fileURLToPath\(import\.meta\.url\)/, /process\.chdir\(consoleRoot\)/, /execFileAsync/, /symlink/, /consumerDir/, /icpdb-sdk-consumer/, /checkConsumer/, /installedConsumerDir/, /icpdb-sdk-installed-consumer/, /installCacheDir/, /tarballPackDir/, /tarballConsumerDir/, /tarballCacheDir/, /icpdb-sdk-tarball-consumer/, /--pack-destination/, /tarballPath/, /checkTarballConsumer/, /publishDryRunCacheDir/, /npm_config_cache/, /"publish"/, /--dry-run/, /published\.id/, /publishedFiles/, /"install"/, /--ignore-scripts/, /--no-audit/, /--package-lock=false/, /checkInstalledConsumer/, /node_modules", "@icpdb"/, /node_modules", "@icp-sdk"/, /npm/, /pack/, /--dry-run/, /packFiles/, /dist-sdk\/package\.json/, /dist-sdk\/README\.md/, /manifest\.main/, /manifest\.types/, /manifest\.files/, /Object\.keys\(manifest\.dependencies\)/, /"@icp-sdk\/core"/, /typecheckDir/, /checkIcpdbClientTypes/, /createIcpdbDatabase/, /connectClient/, /createLibsqlClient/, /createTursoLikeClient/, /IcpdbResultSet/, /IcpdbDatabaseInspection/, /IcpdbDatabaseStatus/, /IcpdbWaitForRoutedOperationOptions/, /libSQL-shaped API/, /not a drop-in/, /authToken/, /embedded replicas/, /interactive `transaction/, /setupStatements/, /setupMigrations/, /delete the created DB if setup fails/, /ICPDB_SETUP_STATEMENTS/, /ICPDB_SETUP_STATEMENTS_FILE/, /ICPDB_SETUP_MIGRATIONS/, /ICPDB_SETUP_MIGRATIONS_FILE/, /package_setup_migrated/, /package_client_setup_migrated/, /service_created_migrated/, /formatIcpdbDatabaseUrl/, /connectionUrl/, /const info = await client\\\.info\\\(\\\)/, /Direct database clients accept/, /direct_multiple/, /from-direct-named/, /from-direct-transaction/, /create_direct_settings/, /low-level `createIcpdbClient` surface also exposes/, /lowLevelClient/, /lowLevelClient\.connectionUrl/, /lowLevelClient\.url/, /lowLevelClient\.run/, /lowLevelClient\.execute/, /lowLevelClient\.transaction/, /lowLevelClient\.database\("db_alpha"\)\.executeMultiple/, /lowLevelClient\.migrate/, /lowLevelClient\.inspect\(\)/, /lowLevelClient\.status\(\)/, /lowLevelClient\.waitForRoutedOperation/, /lowLevelClient\.listAllPlacements/, /lowLevelClient\.listShardOperations/, /lowLevelClient\.reconcileShardOperation/, /serviceLowLevelClient\.listAllPlacements/, /serviceLowLevelClient\.listShardOperations/, /serviceLowLevelClient\.reconcileShardOperation/, /serviceLowLevelClient\.waitForRoutedOperation/, /serviceFileLowLevelClient\.listAllPlacements/, /serviceFileLowLevelClient\.listShardOperations/, /serviceFileLowLevelClient\.reconcileShardOperation/, /serviceFileLowLevelClient\.waitForRoutedOperation/, /persistedServiceFileClient/, /createIcpdbPersistedServiceSqlClientFromEnvFile/, /low_level_multiple/, /low_level_migrated/, /lowLevelClient\.get/, /lowLevelClient\.all/, /lowLevelClient\.values/, /lowLevelClient\.first/, /lowLevelClient\.firstValue/, /db\.connectionUrl/, /db\.url/, /db\.run/, /db\.execute/, /db\.transaction/, /db\.executeMultiple/, /db\.migrate/, /direct_migrated/, /db\.get/, /db\.all/, /db\.tables/, /db\.describe/, /db\.preview/, /IcpdbSqlClient/, /IcpdbPreparedStatement/, /createIcpdbServiceClientFromEnvFile/, /createIcpdbServiceSqlClientFromEnvFile/, /loadIcpdbServiceEnvFile/, /loadIcpdbServiceSetupFromEnv/, /loadIcpdbServiceSetupFromEnvFile/, /formatIcpdbServiceEnv/, /writeIcpdbServiceEnvFile/, /persistIcpdbServiceDatabaseId/, /0o600/, /chmod/, /prepare/, /top-level shortcuts/, /from-prepare/, /client\.prepare/, /client\.all/, /client\.get/, /client\.get\(\["SELECT/, /client\.run\(\["INSERT/, /Single statement calls also accept/, /client\.run/, /client\.waitForRoutedOperation/, /prepared\.all/, /prepared\.get/, /prepared\.run/, /prepared\.bind/, /executeMultiple/, /client\.transaction/, /transaction\\\(statements\\\)/, /client\.migrate/, /package_migration/, /icpdb_schema_migrations/, /named objects/, /:name/, /args: \{ value: 1 \}/, /params: \{ value: 1 \}/, /\\\{ sql, params \\\}/, /\["INSERT INTO notes/, /\[sql, args\?\]/, /Batch execution is atomic/, /columnTypes: string\[\]/, /rowsAffected: number/, /changes: number/, /changes\.toString\(\)/, /lastInsertRowid: bigint \| undefined/, /jsonLastInsertRowid: string \| null/, /result\.toJSON\(\)\.lastInsertRowid/, /routedOperationId: string \| null/, /client\.queryRows\(/, /client\.queryOne\(/, /client\.batch\(/, /"write"\)/, /client\.listTables\(/, /client\.describeTable\(/, /client\.previewTable\(/, /client\.inspect\(/, /schema SQL plus table descriptions and preview rows/, /client\.getUsage\(/, /client\.status\(\)/, /aggregate stats/, /client\.listUsageEvents\(/, /client\.grantMember\(/, /client\.listMembers\(/, /client\.revokeMember\(/, /client\.placement\(/, /client\.connectionUrl\(/, /client\.url\(/, /client\.close\(\)/, /cached database handle/, /Failed initial connect/, /create attempts are not cached/, /clientSnapshot = await client\.archive\(\)/, /client\.restore\(clientSnapshot, \{ expectedSha256:/, /Database bearer tokens are not the SDK's Server\\\/CI path/, /--noEmit/, /NodeNext/, /Next\.js/, /React/, /ICPDB SDK package artifact checks OK/]);
assertMatches(sdkPackageArtifactCheck, [/authToken/, /syncUrl/, /syncInterval/, /tls/, /fetch/, /concurrency/, /offline/, /readYourWrites/, /encryptionKey/]);
assertMatches(sdkPackageArtifactCheck, [/Browser Internet Identity principals/, /Server\\\/CI service identity principals are intentionally different/, /Do not share a private key to force principal equality/, /grant the service principal to the same database ACL/, /Member principal/, /Grant member access/, /database ACL is the boundary that authorizes both principals/]);
assertMatches(sdkPackageArtifactCheck, [/IcpdbCreateDatabaseOptions/, /IcpdbServiceCreateDatabaseOptions/, /invalidCreateOptions/, /invalidServiceCreateOptions/]);
assertMatches(sdkPackageArtifactCheck, [/IcpdbConnectSqlClientOptions/, /IcpdbExistingDatabaseSqlClientOptions[\s\S]*setupSql\\\?: never/, /IcpdbCreateSqlClientOptions[\s\S]*databaseId\\\?: never/, /invalidCreateClientSetupOptions/, /invalidConnectClientSetupOptions/]);
assertMatches(sdkPackageArtifactCheck, [/IcpdbCreateSetupOptions[\s\S]*databaseId\\\?: never/, /invalidLowLevelCreateSetup/]);
assertMatches(sdkPackageArtifactCheck, [/IcpdbServiceExistingDatabaseSqlClientOptions[\s\S]*setupSql\\\?: never/, /IcpdbServiceCreateSqlClientOptions[\s\S]*databaseId\\\?: never/, /invalidServiceSqlClientSetupOptions/]);
assertMatches(sdkPackageArtifactCheck, [/IcpdbCellValue/, /IcpdbJsonCellValue/, /IcpdbJsonRow/, /typedBlobCell/, /jsonBlobCell/, /jsonRows/, /blob cells return `ArrayBuffer`/, /converts blob cells to byte arrays/]);
assertMatches(sdkPackageArtifactCheck, [/DatabaseArchiveInfo/, /DatabaseMember/, /DatabaseRole/, /DatabaseTable/, /DatabaseUsage/, /DatabaseUsageEventSummary/, /RoutedOperationInfo/, /ShardOperationInfo/, /ShardOperationReconcileRequest/, /SqlExecuteResponse/, /SqlStatement/, /SqlValue/, /TableDescription/, /TablePreviewResponse/, /lowLevelArchiveInfo/, /lowLevelUsageEvent/, /lowLevelShardReconcileRequest/, /consumerArchiveInfo/, /installedArchiveInfo/, /tarballArchiveInfo/, /consumerShortTable/, /installedShortTable/, /tarballShortTable/]);
assertMatches(sdkPackageArtifactCheck, [/provisionIcpdbServiceEnvFile/, /one-call service env provisioning/]);
assertMatches(sdkPackageArtifactCheck, [/service identity artifact should let env loading default to service\.env/, /service identity artifact should let env mode checks default to service\.env/, /checkIcpdbServiceEnvFileMode\(\)/, /loadIcpdbServiceEnvFile\(\)/, /reads `service\\\.env` by default/]);
assertMatches(sdkPackageArtifactCheck, [/sqlClientPrincipal/, /serviceClient\.principal\(\)/, /serviceFileClient\.principal\(\)/, /persistedServiceFileClient\.principal\(\)/]);
assertMatches(sdkPackageArtifactCheck, [/named `args` \\\//, /`params` objects/, /db\.execute\(\{ sql: "INSERT INTO notes\(id\) VALUES \(:id\)", args/, /db\.batch\(\[\{ sql: "INSERT INTO notes\(id\) VALUES \(:id\)", args/, /lowLevelClient\.execute\(\{ sql: "INSERT INTO notes\(id\) VALUES \(:id\)", args/, /lowLevelClient\.batch\(\[\{ sql: "INSERT INTO notes\(id\) VALUES \(:id\)", args/]);
assertMatches(sdkPackageArtifactCheck, [/Boolean bind values map to SQLite integer/, /enabled: true/]);
assertMatches(sdkPackageArtifactCheck, [/Date bind values map to SQLite ISO-8601 text/, /libsqlShapedDateInput/, /SELECT :created_at AS created_at/]);
assertMatches(sdkPackageArtifactCheck, [/ArrayBuffer and Uint8Array bind values map to SQLite blobs/, /new ArrayBuffer\(2\)/]);
assertMatches(sdkPackageArtifactCheck, [/DataView and typed-array bind values map to SQLite blobs/, /new DataView\(new ArrayBuffer\(2\)\)/]);
assertMatches(sdkClientCheck, [/createClientFromDatabase/, /connectClient/, /should_not_connect_setup/, /createLibsqlClient/, /createTursoLikeClient/, /unsupported libSQL option: authToken/, /unsupported libSQL option: syncUrl/, /unsupportedLibsqlOption/, /syncInterval/, /tls/, /fetch/, /concurrency/, /offline/, /readYourWrites/, /encryptionKey/, /formatIcpdbDatabaseUrl/, /snapshotInfo/, /snapshotHash/, /tursoLikeClient/, /libsqlNamedClient/, /paddedPrincipalIdentity/, /blankPrincipalStatusActorCalls/, /client\.databaseId/, /client\.connectionUrl/, /client\.url/, /client\.execute/, /columnTypes/, /rowsAffected, 1/, /changes, 1/, /writeResult\.toJSON\(\)\.changes/, /lastInsertRowid, 42n/, /writeResult\.toJSON\(\)\.lastInsertRowid/, /JSON\.stringify\(writeResult\)/, /routedOperationId, null/, /idempotencyKey/, /sdk_retry_script_1/, /sdk_retry_exec_1/, /sdk_retry_load_1/, /rowsAffected exceeds JavaScript safe integer range/, /negativeRowsAffectedClient/, /invalidRowsAffectedClient/, /rowsAffected must be a non-negative integer/, /invalidLastInsertRowidClient/, /negativeLastInsertRowidResult/, /lastInsertRowid must be an integer/, /invalidColumnsResultClient/, /SQL result columns must be an array/, /invalidColumnNameResultClient/, /SQL result column name must be a string/, /invalidRowsResultClient/, /SQL result rows must be an array/, /invalidRowResultClient/, /SQL result row must be an array/, /shortResultRowClient/, /wideResultRowClient/, /SQL result row length must match columns length/, /invalidIntegerResultClient/, /integer result must be a base-10 integer string/, /invalidRealResultClient/, /real result must be a finite number/, /invalidBlobResultClient/, /blob result must be a byte array/, /unknownResultKindClient/, /SQL result value kind must be null, integer, real, text, or blob/, /args/, /namedParamsResult/, /positionalParamsResult/, /:value AS first, :value AS second, @value AS third/, /params, \[7, 7\]/, /@value/, /\$token/, /missing SQL named arg/, /named SQL args require named placeholders/, /leading comment/, /block comment/, /client\.queryRows/, /client\.queryOne/, /client\.prepare/, /preparedSelect/, /preparedInsert/, /preparedNamed/, /preparedSelect\.bind/, /preparedInsert\.bind/, /preparedNamed\.bind/, /\.all\(/, /\.get\(/, /client\.get\(\["SELECT/, /\.run\(/, /client\.run\(\["INSERT/, /client\.batch/, /params: \[3\]/, /client\.transaction/, /\["INSERT INTO notes/, /"write"\)/, /"read"\)/, /"invalid"\)/, /read batch mode only accepts read SQL/, /batch mode must be read, write, or deferred/, /client\.executeMultiple/, /from-multiple/, /client\.migrate/, /migrationResult/, /icpdb_schema_migrations/, /duplicate migration version/, /has no SQL statements/, /client\.executeScript/, /client\.dumpSql/, /client\.loadSqlDump/, /client\.delete/, /client\.inspect/, /inspection\.tables/, /client\.getUsage/, /client\.status/, /tableStatuses/, /status is not available/, /client\.listUsageEvents/, /client\.grantMember/, /grantCallCount/, /2vxsx-fae/, /anonymous principal cannot be granted database access/, /database role must be reader, writer, or owner/, /client\.listMembers/, /client\.revokeMember/, /client\.placement/, /client\.archive/, /client\.restore/, /client\.tables/, /client\.describe/, /client\.preview/, /client\.listTables/, /client\.describeTable/, /client\.previewTable/, /trimmedPrincipalClient/, /principal must be a non-empty string/, /autoClient\.close\(\)/, /createdDatabaseCalls, 2/, /retryClient/, /temporary database create failure/, /retryDatabaseCalls, 2/, /strictShapeDatabaseCalls, 0/, /minimalSqlCalls/, /minimalSqlClient/, /minimalSqlClient\.prepare/, /minimalSqlClient\.transaction/, /minimalSqlClient\.executeScript/, /minimalSqlClient\.exec/, /customReadHelperClient/, /customReadHelperDatabase/, /customReadHelperCalls/, /customReadHelperDatabase\.queryOne/, /customReadHelperDatabase\.firstValue/, /schema is not available/, /listTables is not available/, /views is not available/, /describeTable is not available/, /previewTable is not available/, /connectionUrl is not available/, /delete is not available/, /getUsage is not available/, /listUsageEvents is not available/, /grantMember is not available/, /revokeMember is not available/, /listMembers is not available/, /placement is not available/, /archive is not available/, /restore is not available/, /createIcpdbPersistedServiceSqlClientFromEnvFile/, /persistedExistingClient/, /persistedLazyClient/, /ICPDB_SETUP_STATEMENTS/, /ICPDB_SETUP_STATEMENTS_FILE/, /loadIcpdbServiceSetupFromEnv/, /loadIcpdbServiceSetupFromEnvFile/, /file_setup/, /cannot both be set/, /loadIcpdbServiceEnvFile/, /formatIcpdbServiceEnv/, /writeIcpdbServiceEnvFile/, /persistIcpdbServiceDatabaseId/, /db%2Fpersisted/, /0o600/, /databaseId is required/, /service\.env/, /invalid env file line 1/, /quote '' semi; blob/, /SQL dump has no executable statements/, /semi;colon/, /script requires/, /client\.schema/, /use either args or params/, /use either statement args or call args/, /use either tuple args or call args/, /SQL statement must be a string/, /SQL statement tuple must be/, /SQL statement SQL must be a non-empty string/, /SQL statement SQL must be a string/, /SQL args must be an array or named object/, /ICPDB SDK client checks OK/]);
assertMatches(sdkClientCheck, [/connectClientFromEnv/, /connectClientFromEnvFile/, /connectedServiceClient/, /defaultConnectPathClient/]);
assertMatches(sdkClientCheck, [/persisted-query-only\.env/, /db_service_query_only/, /SELECT 1 AS value/]);
assertMatches(sdkClientCheck, [/migrate input must be an array/, /migration version is required/, /migration name must be a string/, /migration SQL must be a string/]);
assertMatches(sdkClientCheck, [/database source must be an object/, /database source query must be a function/, /database source execute must be a function/, /database source batch must be a function/]);
assertMatches(sdkClientCheck, [/database source queryRows must be a function/, /database source connectionUrl must be a function/]);
assertMatches(sdkClientCheck, [/9007199254740993/, /kind: "integer"/, /kind: "blob"/, /must be a base-10 integer string/, /kind must be null, integer, real, text, or blob/]);
assertMatches(sdkClientCheck, [/missing-archive-dir/, /\["beginArchive", "cancelArchive"\]/]);
assertMatches(sdkClientCheck, [/emptySecretIdentityPath/, /service identity file must be a non-empty string/]);
assertMatches(sdkClientCheck, [/writeGeneratedIcpdbServiceEnvFile\("   "/, /provisionIcpdbServiceEnvFile\(\{/, /serviceEnvGrantCallCount/, /formatIcpdbServiceEnv\(null\)/, /loadIcpdbServicePrincipalFromEnv\(null\)/, /inspectIcpdbServiceEnv\(null\)/, /loadIcpdbServiceSetupFromEnv\(null\)/, /service env must be an object/, /ICPDB-BAD/, /ICPDB BAD/, /must be a valid env key/, /snapshotInfoFile\("   "\)/, /archiveIcpdbServiceDatabaseToFile\(serviceTransferDatabase, "   "\)/, /archiveIcpdbServiceDatabaseToFileFromEnv\("   "/, /archiveIcpdbServiceDatabaseToFileFromEnvFile\("   "/, /restoreIcpdbServiceDatabaseFromFileFromEnv\("   "/, /restoreIcpdbServiceDatabaseFromFileFromEnvFile\("   "/, /service-env-object\.sqlite/, /expectedSha256: "not-a-sha256"/, /expectedSha256: ""/, /expectedSha256: "   "/, /assert\.equal\(serviceArchiveCalls\.length, 0\)/]);
assertMatches(sdkClientCheck, [/archiveIcpdbServiceDatabaseToFile\(null/, /archive database source must be an object/, /archive database source databaseId must be a non-empty string/, /archive database source beginArchive must be a function/, /restoreIcpdbServiceDatabaseFromFile\(null/, /restore database target must be an object/, /restore database target databaseId must be a non-empty string/, /restore database target writeRestoreChunk must be a function/]);
assertMatches(sdkClientCheck, [/host: ""/, /host: "   "/, /host must be a non-empty string/]);
assertMatches(sdkClientCheck, [/rootKey: new Uint8Array\(\)/, /rootKey must be non-empty bytes/]);
assertMatches(sdkClientCheck, [/urlCreateClient/, /formatIcpdbCanisterUrl\("aaaaa-aa"\)/, /db_url_auto/, /SELECT count\(\*\) AS total FROM url_notes/, /formatIcpdbDatabaseUrl\("aaaaa-aa", "db_url_auto"\)/, /urlCreateDatabaseCalls, \["create_database"\]/, /method: "query", databaseId: "db_url_auto"/, /method: "execute", databaseId: "db_url_auto"/]);
assertMatches(sdkClientCheck, [/trimmedDatabaseIdClient/, /blankDatabaseIdClient/, /databaseId must be a non-empty string/]);
assertMatches(sdkClientCheck, [/urlLowLevelClient\.execute\(\{ sql: "SELECT 1", idempotencyKey: "read_retry" \}\)/, /urlLowLevelClient\.database\("db_url_auto"\)\.execute\(\{ sql: "SELECT 1", idempotencyKey: "read_retry" \}\)/]);
assertMatches(sdkClientCheck, [/urlLowLevelClient\.batch\(\[\{ sql: "INSERT", idempotencyKey: "statement_retry" \}\], "write"\)/, /urlLowLevelClient\.database\("db_url_auto"\)\.batch\(\[\{ sql: "INSERT", idempotencyKey: "statement_retry" \}\], "write"\)/, /batch statement idempotencyKey is not supported/, /batch statement maxRows is not supported/, /batch statement databaseId is not supported/]);
assertMatches(sdkClientCheck, [/client\.execute\(\{ sql: "SELECT 1", databaseId: "db_other" \}\)/, /client\.run\(\{ sql: "INSERT INTO notes\(id\) VALUES \(18\)", databaseId: "db_other" \}\)/, /SQL client statement databaseId is not supported/]);
assertMatches(sdkClientCheck, [/client\.batch\(\["SELECT count\(\*\) AS total FROM notes"\], \{ mode: "read", databaseId: "db_other" \}\)/, /client\.executeScript\("INSERT INTO notes\(id\) VALUES \(22\)", \{ databaseId: "db_other" \}\)/, /SQL client batch option databaseId is not supported/]);
assertMatches(sdkClientCheck, [/clientDatabase\.query\(\{ sql: "SELECT 1", databaseId: "db_other" \}\)/, /clientDatabase\.run\(\{ sql: "INSERT INTO notes\(id\) VALUES \(25\)", databaseId: "db_other" \}\)/, /database handle statement databaseId is not supported/]);
assertMatches(sdkClientCheck, [/clientDatabase\.exec\("INSERT INTO notes\(id\) VALUES \(26\)", \{ databaseId: "db_other" \}\)/, /clientDatabase\.executeScript\("INSERT INTO notes\(id\) VALUES \(27\)", \{ databaseId: "db_other" \}\)/, /clientDatabase\.loadSqlDump\("INSERT INTO notes\(id\) VALUES \(28\)", \{ databaseId: "db_other" \}\)/, /SQL client batch option databaseId is not supported/]);
assertMatches(sdkClientCheck, [/clientDatabase\.previewTable\("notes", \{ databaseId: "db_other" \}\)/, /client\.previewTable\("notes", \{ databaseId: "db_other" \}\)/, /client\.preview\("notes", \{ databaseId: "db_other" \}\)/, /database preview option databaseId is not supported/]);
assertMatches(sdkClientCheck, [/clientDatabase\.schema\("   "\)/, /clientDatabase\.describeTable\("   "\)/, /clientDatabase\.columns\("   "\)/, /clientDatabase\.preview\("   "\)/, /tableNameCallCount/, /tableName must be a non-empty string/]);
assertMatches(sdkClientCheck, [/clientDatabase\.inspect\(\{ databaseId: "db_other" \}\)/, /urlLowLevelClient\.inspect\("db_url_auto", \{ databaseId: "db_other" \}\)/, /client\.inspect\(\{ databaseId: "db_other" \}\)/, /database inspect option databaseId is not supported/]);
assertMatches(sdkClientCheck, [/clientDatabase\.dumpSql\(\{ databaseId: "db_other" \}\)/, /urlLowLevelClient\.dumpSql\(\{ databaseId: "db_other" \}\)/, /urlLowLevelClient\.dumpSql\("db_url_auto", \{ databaseId: "db_other" \}\)/, /client\.dumpSql\(\{ databaseId: "db_other" \}\)/, /database dump option databaseId is not supported/]);
assertMatches(sdkClientCheck, [/shardClient\.restore\(\[999\], \{ databaseId: "db_other" \}\)/, /urlLowLevelClient\.restore\(\[999\], "db_url_auto", \{ databaseId: "db_other" \}\)/, /clientDatabase\.restore\(new Uint8Array\(\[4, 5, 6\]\), \{ databaseId: "db_other" \}\)/, /client\.restore\(new Uint8Array\(\[4, 5, 6\]\), \{ databaseId: "db_other" \}\)/, /database restore option databaseId is not supported/]);
assertMatches(sdkClientCheck, [/urlLowLevelClient\.waitForRoutedOperation\("op_1", \{ databaseId: "db_other" \}\)/, /urlLowLevelClient\.waitForRoutedOperation\("db_url_auto", "op_1", \{ databaseId: "db_other" \}\)/, /clientDatabase\.waitForRoutedOperation\("op_db_handle_unknown", \{ databaseId: "db_other" \}\)/, /client\.waitForRoutedOperation\("op_wait", \{ databaseId: "db_other" \}\)/, /database wait option databaseId is not supported/]);
assertMatches(sdkClientCheck, [/customWaitClient/, /customWaitDatabase\.waitForRoutedOperation\(" op_wait_custom_trim "/, /operationId: "op_wait_custom_trim"/, /clientDatabase\.describe\(" notes "\)/, /client\.describe\(" notes "\)/, /method: "describeTable", tableName: "notes"/, /customTablesClient/, /customTablesDatabase\.views\(\)/, /database table objectType must be table or view/, /customDescriptionClient/, /customDescriptionDatabase\.describeTable\(" notes "\)/, /table description tableName does not match requested table/, /database column name must be a non-empty string/, /database index tableName does not match requested table/, /database trigger tableName does not match requested table/, /customPreviewClient/, /customPreviewDatabase\.previewTable\(" notes "/, /table preview tableName does not match requested table/, /customSnapshotInfoClient/, /customSnapshotInfoDatabase\.snapshotInfo\(\[999\]\)/, /snapshot sizeBytes does not match snapshot byte length/, /snapshot hash bytes do not match snapshot sha256/, /customArchiveClient/, /customArchiveSnapshot instanceof Uint8Array/, /archive: async \(\) => \[999\]/, /method: "restore"/, /snapshotIsUint8Array: true/, /customRestoreDatabase\.restore\(\[999\]\)/, /blob bytes must be integers from 0 to 255/, /customMigrateClient/, /method: "customMigrate"/, /version: "005", name: "custom"/, /customLibsqlMigrateClient/, /method: "customLibsqlMigrate"/, /customScriptClient/, /method: "executeScript"/, /method: "loadSqlDump"/, /script_retry/, /dump_retry/, /SQL statement SQL must be a non-empty string/, /script requires at least one SQL statement/, /SQL dump has no executable statements/, /migration SQL must be a non-empty string/, /customWaitDatabase\.waitForRoutedOperation\("op_wait_custom", \{ intervalMs: -1 \}\)/, /timeoutMs: Number\.POSITIVE_INFINITY/, /waitForRoutedOperation intervalMs must be a non-negative number/, /waitForRoutedOperation timeoutMs must be a non-negative number/]);
assertMatches(sdkClientCheck, [/blobResult/, /instanceof ArrayBuffer/, /blobResult\.toJSON\(\)\.rows/, /"payload":\\\[1,2,3\\\]/]);
assertMatches(sdkClientCheck, [/\.principal\(\)/, /principal is not available/, /provisionIcpdbServiceEnvFile/, /provisionedServiceEnv/, /database connection URL does not match databaseId/, /persistedExistingClient\.principal\(\)/, /persistedLazyClient\.principal\(\)/, /persistedCanisterUrlPath/, /db_persisted_auto/, /persistedCreateDatabaseCalls, 1/, /persistedSqlExecuteDatabaseIds/]);
assertMatches(sdkClientCheck, [/databaseId: "   "/, /canisterId: "   "/, /ICPDB_CANISTER_ID: "   "/, /ICPDB_DATABASE_ID: "   "/, /persistIcpdbServiceDatabaseId\(writtenEnvPath, "   "\)/]);
assertMatches(sdkClientCheck, [/cteReadResult/, /WITH payload\(value\) AS \(SELECT \?1\) SELECT value FROM payload/, /WITH payload\(value\) AS \(SELECT \?1\) INSERT INTO notes/, /pragmaReadResult/, /PRAGMA table_info\(notes\)/, /PRAGMA foreign_keys=off/, /PRAGMA main\.user_version = 7/, /read batch mode only accepts read SQL/]);
assertMatches(sdkClientCheck, [/enabled: true/, /disabled: false/, /\[true, false\]/]);
assertMatches(sdkClientCheck, [/new Date\("2026-05-29T00:00:00.000Z"\)/, /toISOString\(\)/]);
assertNoAnyAs(sdkClientCheck);
assert.equal(typeof sdkPackage.connectIcpdbDatabase, "function");
assert.equal(typeof sdkPackage.createIcpdbDatabase, "function");
assert.equal(typeof sdkPackage.createClient, "function");
assert.equal(typeof sdkPackage.connectClient, "function");
assert.equal(typeof sdkPackage.createLibsqlClient, "function");
assert.equal(typeof sdkPackage.createTursoLikeClient, "function");
assert.equal(typeof sdkPackage.createClientFromDatabase, "function");
assert.equal(typeof sdkPackage.createIcpdbClient, "function");
assert.equal(typeof sdkPackage.snapshotInfo, "function");
assert.equal(typeof serviceIdentityPackage.connectIcpdbServiceDatabaseFromEnv, "function");
assert.equal(typeof serviceIdentityPackage.createIcpdbServiceSqlClientFromEnv, "function");
assert.equal(typeof serviceIdentityPackage.createIcpdbServiceSqlClientFromEnvFile, "function");
assert.equal(typeof serviceIdentityPackage.connectClientFromEnv, "function");
assert.equal(typeof serviceIdentityPackage.connectClientFromEnvFile, "function");
assert.equal(typeof serviceIdentityPackage.createIcpdbServiceClientFromEnv, "function");
assert.equal(typeof serviceIdentityPackage.createIcpdbServiceClientFromEnvFile, "function");
assert.equal(typeof serviceIdentityPackage.loadIcpdbServicePrincipalFromEnv, "function");
assert.equal(typeof serviceIdentityPackage.loadIcpdbServicePrincipalFromEnvFile, "function");
assert.equal(typeof serviceIdentityPackage.loadIcpdbServiceEnvFile, "function");
assert.equal(typeof serviceIdentityPackage.formatIcpdbServiceEnv, "function");
assert.equal(typeof serviceIdentityPackage.writeIcpdbServiceEnvFile, "function");
assert.equal(typeof serviceIdentityPackage.persistIcpdbServiceDatabaseId, "function");
assert.equal(typeof serviceIdentityPackage.provisionIcpdbServiceEnvFile, "function");
assert.equal(typeof serviceIdentityPackage.grantIcpdbServiceIdentityFromEnv, "function");
assert.equal(typeof serviceIdentityPackage.grantIcpdbServiceIdentityFromEnvFile, "function");
assertMatches(rowMutationCheck, [/buildSelectedCellMutationRequest/, /buildSelectedRowMutationRequest/, /buildInsertRequest/, /ICPDB row mutation checks OK/]);
assertMatches(httpClientCheck, [/describeTableWithToken/, /getRoutedOperationWithToken/, /calls\[2\]\.body\.database_id, "db_alpha"/, /sqlExecuteWithToken/, /capturedIdempotencyKeys/, /routedOperationId/, /ICPDB HTTP client checks OK/]);
assertMatches(httpAdminClientCheck, [/createTokenWithToken/, /grantMemberWithToken/, /revokeMemberWithToken/, /listPaymentsWithToken/, /setQuotaWithToken/, /deleteDatabaseWithToken/, /cancelArchiveWithToken/, /beginArchiveWithToken/, /finalizeRestoreWithToken/, /HTTP base URL must be a non-empty string/, /api token must be a non-empty string/, /token session database_id must be a non-empty string/, /calls\[0\]\.body\.database_id, "db_alpha"/, /quota bytes must be a non-negative safe integer/, /database token name must be a non-empty string/, /database token id must be a non-empty string/, /snapshot hash must be a 32-byte SHA-256 digest/, /restore bytes\\\[0\\\] must be a byte/, /database member principal must be a non-empty string/, /database member principal must be a valid principal/, /database role must be reader, writer, or owner/, /database token scope must be read, write, or owner/, /anonymous principal cannot be granted database access/, /ICPDB HTTP admin client checks OK/]);
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
