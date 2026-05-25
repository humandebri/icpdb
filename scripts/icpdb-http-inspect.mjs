// Where: scripts/icpdb-http-inspect.mjs
// What: Inspect, schema, stats, and table metadata helpers for the ICPDB HTTP CLI.
// Why: Turso-style inspect and Supabase-style table browsing share the same read-only database introspection flow.

import { requiredArg } from "./icpdb-http-command-utils.mjs";
import { schemaEntry } from "./icpdb-http-output.mjs";

export async function inspectIcpdb(command, fetchImpl, callHttp) {
  if (command.tableName) {
    if (command.includeAccess) {
      throw new Error("inspect --access is only supported without table_name");
    }
    const [description, preview] = await Promise.all([
      callHttp(tableDescribeCommand(command, command.tableName), fetchImpl),
      callHttp(tablePreviewCommand(command, command.tableName, command.limit, command.offset), fetchImpl)
    ]);
    return {
      database_id: command.databaseId,
      table: description,
      preview
    };
  }
  const session = await callHttp(databaseSessionCommand(command), fetchImpl);
  const isOwner = session.role === "owner";
  if (command.includeAccess && !isOwner) {
    throw new Error("inspect --access requires an owner token");
  }
  const baseRequests = [
    callHttp(databasePlacementCommand(command), fetchImpl),
    callHttp(databaseUsageCommand(command), fetchImpl),
    isOwner ? callHttp(databaseBillingCommand(command), fetchImpl) : Promise.resolve(null),
    callHttp(databaseUsageEventsCommand(command), fetchImpl),
    callHttp(tableListCommand(command), fetchImpl)
  ];
  const accessRequests = command.includeAccess
    ? [
        callHttp(databaseTokensCommand(command), fetchImpl),
        callHttp(databaseMembersCommand(command), fetchImpl),
        callHttp(databasePaymentsCommand(command), fetchImpl)
      ]
    : [];
  const [placement, usage, billing, usageEvents, tables, tokens, members, payments] = await Promise.all([...baseRequests, ...accessRequests]);
  const entries = await Promise.all(
    tables.map(async (table) => {
      const [description, preview] = await Promise.all([
        callHttp(tableDescribeCommand(command, table.name), fetchImpl),
        callHttp(tablePreviewCommand(command, table.name, 1, 0), fetchImpl)
      ]);
      return { description, preview };
    })
  );
  return {
    database_id: command.databaseId,
    placement,
    usage,
    billing,
    usage_events: usageEvents,
    access: command.includeAccess ? { tokens, members, payments } : null,
    table_summaries: tableSummaryEntries(entries),
    tables: entries.map((entry) => entry.description)
  };
}

export async function statsIcpdb(command, fetchImpl, callHttp) {
  const tables = await callHttp(tableListCommand(command), fetchImpl);
  const entries = await Promise.all(
    tables.map(async (table) => {
      const [description, preview] = await Promise.all([
        callHttp(tableDescribeCommand(command, table.name), fetchImpl),
        callHttp(tablePreviewCommand(command, table.name, 1, 0), fetchImpl)
      ]);
      return { description, preview };
    })
  );
  const tableSummaries = tableSummaryEntries(entries);
  return {
    database_id: command.databaseId,
    stats: databaseStats(tableSummaries),
    table_summaries: tableSummaries
  };
}

export async function tableColumnsIcpdb(command, fetchImpl, callHttp) {
  const description = await callHttp(tableDescribeCommand(command, command.tableName), fetchImpl);
  const columns = description.columns ?? [];
  return {
    database_id: command.databaseId,
    table_name: command.tableName,
    column_count: columns.length,
    columns
  };
}

export async function tableIndexesIcpdb(command, fetchImpl, callHttp) {
  const description = await callHttp(tableDescribeCommand(command, command.tableName), fetchImpl);
  return {
    database_id: command.databaseId,
    table_name: command.tableName,
    indexes: description.indexes ?? []
  };
}

export async function tableTriggersIcpdb(command, fetchImpl, callHttp) {
  const description = await callHttp(tableDescribeCommand(command, command.tableName), fetchImpl);
  return {
    database_id: command.databaseId,
    table_name: command.tableName,
    triggers: description.triggers ?? []
  };
}

export async function tableForeignKeysIcpdb(command, fetchImpl, callHttp) {
  const description = await callHttp(tableDescribeCommand(command, command.tableName), fetchImpl);
  return {
    database_id: command.databaseId,
    table_name: command.tableName,
    foreign_keys: description.foreign_keys ?? []
  };
}

export async function databaseViewsIcpdb(command, fetchImpl, callHttp) {
  const tables = await callHttp(tableListCommand(command), fetchImpl);
  return tables.filter((table) => (table.object_type ?? "table").toLowerCase() === "view");
}

export async function schemaIcpdb(command, fetchImpl, callHttp) {
  if (command.tableName) {
    const description = await callHttp(tableDescribeCommand(command, command.tableName), fetchImpl);
    return {
      database_id: command.databaseId,
      schemas: [schemaEntry(description)]
    };
  }
  const tables = await callHttp(tableListCommand(command), fetchImpl);
  const descriptions = await Promise.all(
    tables.map((table) => callHttp(tableDescribeCommand(command, table.name), fetchImpl))
  );
  return {
    database_id: command.databaseId,
    schemas: descriptions.map(schemaEntry)
  };
}

export function tableListCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/tables/list",
    body: { database_id: command.databaseId }
  };
}

export function tableDescribeCommand(command, tableName) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/tables/describe",
    body: {
      database_id: command.databaseId,
      table_name: requiredArg(tableName, "table_name")
    }
  };
}

export function tablePreviewCommand(command, tableName, limit, offset) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/tables/preview",
    body: {
      database_id: command.databaseId,
      table_name: requiredArg(tableName, "table_name"),
      limit,
      offset
    }
  };
}

function tableSummaryEntries(entries) {
  return entries.map((entry) => ({
    table_name: entry.preview.table_name,
    object_type: entry.description.object_type ?? "table",
    row_count: entry.preview.total_count ?? entry.preview.rows?.length ?? 0,
    column_count: entry.description.columns?.length ?? entry.preview.columns?.length ?? 0,
    columns: entry.preview.columns ?? [],
    index_count: entry.description.indexes?.length ?? 0,
    trigger_count: entry.description.triggers?.length ?? 0,
    foreign_key_count: entry.description.foreign_keys?.length ?? 0
  }));
}

function databaseStats(tableSummaries) {
  const totals = tableSummaries.reduce((next, table) => ({
    table_count: next.table_count + (table.object_type === "view" ? 0 : 1),
    view_count: next.view_count + (table.object_type === "view" ? 1 : 0),
    row_count: next.row_count + BigInt(String(table.row_count ?? 0)),
    column_count: next.column_count + Number(table.column_count ?? 0),
    index_count: next.index_count + Number(table.index_count ?? 0),
    trigger_count: next.trigger_count + Number(table.trigger_count ?? 0),
    foreign_key_count: next.foreign_key_count + Number(table.foreign_key_count ?? 0)
  }), {
    table_count: 0,
    view_count: 0,
    row_count: 0n,
    column_count: 0,
    index_count: 0,
    trigger_count: 0,
    foreign_key_count: 0
  });
  return {
    table_count: totals.table_count,
    view_count: totals.view_count,
    row_count: totals.row_count.toString(),
    column_count: totals.column_count,
    index_count: totals.index_count,
    trigger_count: totals.trigger_count,
    foreign_key_count: totals.foreign_key_count
  };
}

function databaseUsageCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/usage",
    body: { database_id: command.databaseId }
  };
}

function databaseSessionCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/session",
    body: { database_id: command.databaseId }
  };
}

function databaseBillingCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/billing",
    body: { database_id: command.databaseId }
  };
}

function databasePaymentsCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/payments/list",
    body: { database_id: command.databaseId }
  };
}

function databasePlacementCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/placements/get",
    body: { database_id: command.databaseId }
  };
}

function databaseUsageEventsCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/usage/events",
    body: { database_id: command.databaseId }
  };
}

function databaseTokensCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/tokens/list",
    body: { database_id: command.databaseId }
  };
}

function databaseMembersCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/members/list",
    body: { database_id: command.databaseId }
  };
}
