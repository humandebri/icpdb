export type ApiErrorCode =
  | "canister_not_found"
  | "ic_host_unreachable"
  | "icpdb_api_missing"
  | "invalid_canister_id"
  | "icpdb_request_failed";

export type PublicApiError = {
  error: string;
  hint: string;
  code: ApiErrorCode;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly hint: string | null = null, readonly code: string | null = null) {
    super(message);
    this.name = "ApiError";
  }
}

export function invalidCanisterIdError(reason: string): PublicApiError {
  return {
    error: "Invalid canister ID",
    hint: `Check the URL canister segment. ${reason}`,
    code: "invalid_canister_id"
  };
}

export function classifyApiError(error: unknown, host: string): PublicApiError {
  const raw = error instanceof Error ? error.message : String(error);
  const local = isLocalHost(host);
  if (/Canister\s+[\w-]+\s+not found/i.test(raw) || /IC0301/i.test(raw)) {
    return {
      error: "Canister not found on this IC host",
      hint: local
        ? "Check that the local replica is running, the icp local network state matches this canister ID, and the ICPDB canister has been deployed."
        : "Check the canister ID and confirm that the target canister exists on this IC host.",
      code: "canister_not_found"
    };
  }
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|network/i.test(raw)) {
    return {
      error: "Cannot reach IC host",
      hint: local
        ? "Check that the local replica or icp local network is running and that NEXT_PUBLIC_ICPDB_IC_HOST points to it."
        : "Check NEXT_PUBLIC_ICPDB_IC_HOST and network connectivity to the IC gateway.",
      code: "ic_host_unreachable"
    };
  }
  if (/method .*not found|no (query|update) method|does not expose|Cannot find field|subtype|type mismatch|Candid|IDL/i.test(raw)) {
    return {
      error: "This canister does not expose the ICPDB API",
      hint: "Use an ICPDB canister with database, billing, deposit, token, and SQL methods.",
      code: "icpdb_api_missing"
    };
  }
  return {
    error: "ICPDB request failed",
    hint: local
      ? "Check the local replica logs and confirm the ICPDB canister is healthy."
      : "Check the canister ID, gateway host, and ICPDB API availability.",
    code: "icpdb_request_failed"
  };
}

function isLocalHost(host: string): boolean {
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?/i.test(host);
}
