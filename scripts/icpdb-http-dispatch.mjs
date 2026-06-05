// Where: scripts/icpdb-http-dispatch.mjs
// What: Command dispatch tables for the ICPDB HTTP CLI and interactive shell.
// Why: Turso-like command growth should add routes without nesting execution branches in the CLI entrypoint.

export async function executeIcpdbCommand(command, handlers) {
  if (command.inspect) return handlers.inspect(command);
  if (command.databaseViews) return handlers.databaseViews(command);
  if (command.stats) return handlers.stats(command);
  if (command.schema) return handlers.schema(command);
  if (command.tableColumns) return handlers.tableColumns(command);
  if (command.tableIndexes) return handlers.tableIndexes(command);
  if (command.tableTriggers) return handlers.tableTriggers(command);
  if (command.tableForeignKeys) return handlers.tableForeignKeys(command);
  if (command.dump) return handlers.dump(command);
  if (command.load) return handlers.load(command);
  if (command.script) return handlers.script(command);
  if (command.migrate) return handlers.migrate(command);
  if (command.createDatabase) return handlers.createDatabase(command);
  if (command.databases) return handlers.databases(command);
  if (command.databasePlacements) return handlers.databasePlacements(command);
  if (command.databaseShards) return handlers.databaseShards(command);
  if (command.databaseShardStatus) return handlers.databaseShardStatus(command);
  if (command.topUpDatabaseShard) return handlers.topUpDatabaseShard(command);
  if (command.maintainDatabaseShards) return handlers.maintainDatabaseShards(command);
  if (command.migrateDatabaseToShard) return handlers.migrateDatabaseToShard(command);
  if (command.shardOperations) return handlers.shardOperations(command);
  if (command.reconcileShardOperation) return handlers.reconcileShardOperation(command);
  if (command.reconcileRoutedOperation) return handlers.reconcileRoutedOperation(command);
  if (command.archive) return handlers.archive(command);
  if (command.restore) return handlers.restore(command);
  if (command.snapshotInfo) return handlers.snapshotInfo(command);
  return handlers.http(command);
}

export async function executeShellCommand(command, handlers) {
  if (command.inspect) return handlers.inspect(command);
  if (command.databaseViews) return handlers.databaseViews(command);
  if (command.stats) return handlers.stats(command);
  if (command.tableColumns) return handlers.tableColumns(command);
  if (command.tableIndexes) return handlers.tableIndexes(command);
  if (command.tableTriggers) return handlers.tableTriggers(command);
  if (command.tableForeignKeys) return handlers.tableForeignKeys(command);
  if (command.schema) return handlers.schema(command);
  if (command.dump) return handlers.dump(command);
  if (command.load) return handlers.load(command);
  if (command.script) return handlers.script(command);
  if (command.migrate) return handlers.migrate(command);
  if (command.archive) return handlers.archive(command);
  if (command.restore) return handlers.restore(command);
  if (command.snapshotInfo) return handlers.snapshotInfo(command);
  return handlers.http(command);
}
