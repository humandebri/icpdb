"use client";

// icpdb-console/components/icpdb-token-panel.tsx
// API token creation, search, scope filtering, status, and revoke controls.

import { KeyRound, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { parseTokenScope } from "@/lib/workbench-state";
import type { DatabaseTokenInfo, DatabaseTokenScope } from "@/lib/types";

export function TokenPanel({
  canManageDatabase,
  tokenName,
  tokenScope,
  tokens,
  onCreateToken,
  onRevokeToken,
  onTokenNameChange,
  onTokenScopeChange
}: {
  canManageDatabase: boolean;
  tokenName: string;
  tokenScope: DatabaseTokenScope;
  tokens: DatabaseTokenInfo[];
  onCreateToken: () => void;
  onRevokeToken: (tokenId: string) => void;
  onTokenNameChange: (value: string) => void;
  onTokenScopeChange: (scope: DatabaseTokenScope) => void;
}) {
  const [tokenSearch, setTokenSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<TokenScopeFilter>("all");
  const tokenScopeCounts = useMemo(() => countTokenScopes(tokens), [tokens]);
  const visibleTokens = useMemo(() => filterTokens(tokens, tokenSearch, scopeFilter), [scopeFilter, tokenSearch, tokens]);
  const tokenFiltered = tokenSearch.trim() || scopeFilter !== "all";
  const tokenCountLabel = tokenFiltered ? `${visibleTokens.length}/${tokens.length}` : String(tokens.length);
  return (
    <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Tokens</h3>
        <KeyRound aria-hidden size={16} />
      </div>
      <div className="mt-3 grid gap-2">
        <input className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm text-[#182230]" value={tokenName} onChange={(event) => onTokenNameChange(event.target.value)} />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm text-[#182230]" value={tokenScope} onChange={(event) => onTokenScopeChange(parseTokenScope(event.target.value))}>
            <option value="read">read</option>
            <option value="write">write</option>
            <option value="owner">owner</option>
          </select>
          <button className="rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!canManageDatabase} type="button" onClick={onCreateToken}>
            Create
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[#667085]">
        <span>{tokens.length} tokens</span>
        <label className="flex h-8 min-w-0 max-w-48 flex-1 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2">
          <Search aria-hidden size={14} />
          <input
            aria-label="Search tokens"
            className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
            placeholder="Search tokens"
            value={tokenSearch}
            onChange={(event) => setTokenSearch(event.target.value)}
          />
          <span className="font-mono">{tokenCountLabel}</span>
        </label>
      </div>
      <div className="mt-2 grid grid-cols-4 overflow-hidden rounded-md border border-[#c9ced8] text-xs">
        {tokenScopeFilters.map((filter) => (
          <button
            aria-pressed={scopeFilter === filter.value}
            className={scopeFilter === filter.value ? activeTokenFilterClass : inactiveTokenFilterClass}
            key={filter.value}
            type="button"
            onClick={() => setScopeFilter(filter.value)}
          >
            <span>{filter.label}</span>
            <span className="font-mono">{tokenScopeCountLabel(filter.value, tokenScopeCounts)}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 max-h-64 space-y-2 overflow-auto pr-1">
        {tokens.length === 0 ? <p className="text-xs text-[#667085]">No tokens</p> : null}
        {tokens.length > 0 && visibleTokens.length === 0 ? <p className="text-xs text-[#667085]">No matching tokens</p> : null}
        {visibleTokens.map((token) => (
          <div className="rounded-md border border-[#eef1f5] p-2 text-xs" key={token.tokenId}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono" title={token.name}>{token.name}</span>
              <span className={token.revokedAtMs ? "text-[#b42318]" : "text-[#027a48]"}>
                {token.revokedAtMs ? "revoked" : "active"}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[#5f6c7b]">
              <span>{token.scope}</span>
              <span className="text-right">last used {formatTimestamp(token.lastUsedAtMs)}</span>
            </div>
            {token.revokedAtMs ? (
              <div className="mt-1 text-[#b42318]">revoked {formatTimestamp(token.revokedAtMs)}</div>
            ) : null}
            <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2">
              <span className="truncate font-mono text-[#5f6c7b]" title={token.tokenId}>{token.tokenId}</span>
              <button className="rounded-md border border-[#fecdca] px-2 py-1 font-medium text-[#b42318] disabled:opacity-50" disabled={!canManageDatabase || Boolean(token.revokedAtMs)} type="button" onClick={() => onRevokeToken(token.tokenId)}>
                Revoke
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type TokenScopeFilter = "all" | DatabaseTokenScope;

const tokenScopeFilters: { label: string; value: TokenScopeFilter }[] = [
  { label: "All", value: "all" },
  { label: "Read", value: "read" },
  { label: "Write", value: "write" },
  { label: "Owner", value: "owner" }
];

export function formatTimestamp(timestampMs: string | null): string {
  if (!timestampMs) return "never";
  const numericTimestamp = Number(timestampMs);
  if (!Number.isFinite(numericTimestamp)) return timestampMs;
  return new Date(numericTimestamp).toISOString();
}

function filterTokens(tokens: DatabaseTokenInfo[], tokenSearch: string, scopeFilter: TokenScopeFilter): DatabaseTokenInfo[] {
  const query = tokenSearch.trim().toLowerCase();
  return tokens.filter((token) => {
    if (scopeFilter !== "all" && token.scope !== scopeFilter) return false;
    if (!query) return true;
    const fields = [
      token.name,
      token.tokenId,
      token.scope,
      token.revokedAtMs ? "revoked" : "active",
      formatTimestamp(token.createdAtMs),
      formatTimestamp(token.lastUsedAtMs),
      formatTimestamp(token.revokedAtMs)
    ];
    return fields.some((field) => field.toLowerCase().includes(query));
  });
}

function countTokenScopes(tokens: DatabaseTokenInfo[]): Record<TokenScopeFilter, number> {
  return {
    all: tokens.length,
    read: tokens.filter((token) => token.scope === "read").length,
    write: tokens.filter((token) => token.scope === "write").length,
    owner: tokens.filter((token) => token.scope === "owner").length
  };
}

function tokenScopeCountLabel(filter: TokenScopeFilter, counts: Record<TokenScopeFilter, number>): string {
  return String(counts[filter]);
}

const activeTokenFilterClass = "flex h-8 min-w-0 items-center justify-center gap-1 bg-[#182230] px-1 font-medium text-white";
const inactiveTokenFilterClass = "flex h-8 min-w-0 items-center justify-center gap-1 bg-white px-1 text-[#5f6c7b] hover:bg-[#f7f8fb]";
