// Where: scripts/icpdb-http-account-command.mjs
// What: Account, backup, token, member, quota, and lifecycle command builders.
// Why: Owner/admin API parsing should be separated from SQL/table command parsing.

import {
  databaseIdArg,
  filePathArg,
  grantablePrincipalArg,
  memberPrincipalArg,
  operationIdArg,
  outputFormatOption,
  parseDatabaseRole,
	  parseNonNegativeInteger,
	  parseTokenScope,
	  requiredArg,
	  tokenIdArg,
	  tokenNameArg
	} from "./icpdb-http-command-utils.mjs";

export function buildAccountCommand(command, databaseId, tableNameOrSql, rest, options, auth) {
  const { baseUrl, token } = auth;
  if (command === "usage") return http(baseUrl, token, "/v1/usage", databaseId, options);
  if (command === "usage-events") return http(baseUrl, token, "/v1/usage/events", databaseId, options);
  if (command === "billing") return http(baseUrl, token, "/v1/billing", databaseId, options);
  if (command === "payments") return http(baseUrl, token, "/v1/payments/list", databaseId, options);
  if (command === "placement") return http(baseUrl, token, "/v1/placements/get", databaseId, options);
  if (command === "operation") {
    return {
      baseUrl,
      token,
      endpoint: "/v1/operations/get",
      body: {
        database_id: databaseIdArg(databaseId),
        operation_id: operationIdArg(tableNameOrSql)
      },
      ...outputFormatOption(options)
    };
  }
  if (command === "quota") {
    return {
      baseUrl,
      token,
      endpoint: "/v1/quota/set",
      body: {
        database_id: databaseIdArg(databaseId),
        max_logical_size_bytes: parseNonNegativeInteger(requiredArg(tableNameOrSql, "max_logical_size_bytes"), "max_logical_size_bytes")
      },
      ...outputFormatOption(options)
    };
  }
  if (command === "tokens") return http(baseUrl, token, "/v1/tokens/list", databaseId, options);
  if (command === "create-token") {
    return {
      baseUrl,
      token,
      endpoint: "/v1/tokens/create",
      body: {
        database_id: databaseIdArg(databaseId),
        name: tokenNameArg(tableNameOrSql),
        scope: parseTokenScope(requiredArg(rest[0], "scope"))
      },
      ...outputFormatOption(options)
    };
	  }
	  if (command === "revoke-token") {
	    return { baseUrl, token, endpoint: "/v1/tokens/revoke", body: { database_id: databaseIdArg(databaseId), token_id: tokenIdArg(tableNameOrSql) }, ...outputFormatOption(options) };
	  }
  if (command === "archive") return transfer("archive", baseUrl, token, databaseId, tableNameOrSql, options);
  if (command === "restore") return transfer("restore", baseUrl, token, databaseId, tableNameOrSql, options);
  if (command === "archive-cancel") return http(baseUrl, token, "/v1/archive/cancel", databaseId, options);
  if (command === "members") return http(baseUrl, token, "/v1/members/list", databaseId, options);
  if (command === "grant-member") {
    return {
      baseUrl,
      token,
      endpoint: "/v1/members/grant",
      body: {
        database_id: databaseIdArg(databaseId),
        principal: grantablePrincipalArg(tableNameOrSql),
        role: parseDatabaseRole(requiredArg(rest[0], "role"))
      },
      ...outputFormatOption(options)
    };
  }
  if (command === "revoke-member") {
    return { baseUrl, token, endpoint: "/v1/members/revoke", body: { database_id: databaseIdArg(databaseId), principal: memberPrincipalArg(tableNameOrSql) }, ...outputFormatOption(options) };
  }
  if (command === "delete-db") return http(baseUrl, token, "/v1/database/delete", databaseId, options);
  return null;
}

function http(baseUrl, token, endpoint, databaseId, options) {
  return { baseUrl, token, endpoint, body: { database_id: databaseIdArg(databaseId) }, ...outputFormatOption(options) };
}

function transfer(flag, baseUrl, token, databaseId, filePath, options) {
  return {
    [flag]: true,
    baseUrl,
    token,
    databaseId: databaseIdArg(databaseId),
    filePath: filePathArg(filePath),
    ...(options.expectedSnapshotHash ? { expectedSnapshotHash: options.expectedSnapshotHash } : {}),
    ...outputFormatOption(options)
  };
}
