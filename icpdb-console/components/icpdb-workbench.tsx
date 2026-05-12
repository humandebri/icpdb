"use client";

// icpdb-console/components/icpdb-workbench.tsx
// Live SQL panel: connects the ICPDB console prototype to the canister SQL API.

import { AuthClient } from "@icp-sdk/auth/client";
import { Principal } from "@icp-sdk/core/principal";
import { DEFAULT_SIGNER_WINDOW_CENTER, RelyingPartyDisconnectedError, RelyingPartyResponseError } from "@dfinity/oisy-wallet-signer";
import { IcpWallet } from "@dfinity/oisy-wallet-signer/icp-wallet";
import { Coins, Database, KeyRound, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DELEGATION_TTL_NS, identityProviderUrl } from "@/lib/auth";
import type {
  DatabaseBilling,
  DatabaseSummary,
  DatabaseTokenInfo,
  DatabaseUsage,
  DepositQuote,
  PaymentRecord,
  SqlExecuteResponse,
  SqlValue
} from "@/lib/types";
import {
  createDatabaseTokenAuthenticated,
  createDatabaseAuthenticated,
  depositWithApprovalAuthenticated,
  getBillingAuthenticated,
  getDepositQuoteAuthenticated,
  getUsageAuthenticated,
  listDatabaseTokensAuthenticated,
  listDatabasesAuthenticated,
  listPaymentsAuthenticated,
  sqlExecuteAuthenticated,
  sqlQueryAuthenticated
} from "@/lib/icpdb-client";

type SqlMode = "query" | "update";
type LoadState = "idle" | "loading" | "ready" | "error";
type WalletStatus = "disconnected" | "connecting" | "ready" | "approving" | "approved" | "error";
type ApprovedDeposit = {
  amountE8s: string;
  owner: string;
};

const defaultSql = `select name, type
from sqlite_schema
where type in (?1, ?2)
order by name
limit 25;`;
const defaultWalletSignerUrl = "https://oisy.com/sign";
const defaultWalletHost = "https://icp-api.io";

export function IcpdbWorkbench() {
  const canisterId = process.env.NEXT_PUBLIC_ICPDB_CANISTER_ID ?? "";
  const walletSignerUrl = process.env.NEXT_PUBLIC_ICPDB_WALLET_SIGNER_URL ?? defaultWalletSignerUrl;
  const walletHost = process.env.NEXT_PUBLIC_ICPDB_WALLET_HOST ?? defaultWalletHost;
  const walletRef = useRef<IcpWallet | null>(null);
  const [authClient, setAuthClient] = useState<AuthClient | null>(null);
  const [principal, setPrincipal] = useState<string | null>(null);
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [databaseId, setDatabaseId] = useState("");
  const [mode, setMode] = useState<SqlMode>("query");
  const [sql, setSql] = useState(defaultSql);
  const [paramsJson, setParamsJson] = useState(`["table", "view"]`);
  const [response, setResponse] = useState<SqlExecuteResponse | null>(null);
  const [usage, setUsage] = useState<DatabaseUsage | null>(null);
  const [billing, setBilling] = useState<DatabaseBilling | null>(null);
  const [tokens, setTokens] = useState<DatabaseTokenInfo[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [depositAmount, setDepositAmount] = useState("0.01");
  const [depositQuote, setDepositQuote] = useState<DepositQuote | null>(null);
  const [approvedDeposit, setApprovedDeposit] = useState<ApprovedDeposit | null>(null);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>("disconnected");
  const [walletOwner, setWalletOwner] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  const selectedDatabase = useMemo(
    () => databases.find((database) => database.databaseId === databaseId) ?? null,
    [databaseId, databases]
  );
  const canRun = Boolean(authClient && principal && databaseId && canisterId && loadState !== "loading");
  const depositQuoteMatchesAmount = useMemo(() => {
    if (!depositQuote) return false;
    try {
      return parseIcpToE8s(depositAmount) === depositQuote.amountE8s;
    } catch {
      return false;
    }
  }, [depositAmount, depositQuote]);
  const walletBusy = walletStatus === "connecting" || walletStatus === "approving";
  const approvedDepositMatches =
    Boolean(depositQuote && principal && approvedDeposit) &&
    approvedDeposit?.amountE8s === depositQuote?.amountE8s &&
    approvedDeposit?.owner === principal &&
    depositQuoteMatchesAmount;
  const canQuoteDeposit = canRun && !walletBusy;
  const canApproveDeposit = canRun && depositQuoteMatchesAmount && !walletBusy;
  const canDeposit = canRun && approvedDepositMatches && !walletBusy;

  function resetDepositApproval() {
    setDepositQuote(null);
    setApprovedDeposit(null);
    if (walletStatus === "approved") {
      setWalletStatus(walletRef.current ? "ready" : "disconnected");
    }
  }

  const refreshDatabases = useCallback(
    async (client: AuthClient) => {
      if (!canisterId) {
        setError("NEXT_PUBLIC_ICPDB_CANISTER_ID is not configured.");
        setLoadState("error");
        return;
      }
      setLoadState("loading");
      setError(null);
      try {
        const identity = client.getIdentity();
        const nextDatabases = await listDatabasesAuthenticated(canisterId, identity);
        setDatabases(nextDatabases);
        setPrincipal(identity.getPrincipal().toText());
        setDatabaseId((current) => current || (nextDatabases[0]?.databaseId ?? ""));
        setLoadState("ready");
      } catch (cause) {
        setError(errorMessage(cause));
        setLoadState("error");
      }
    },
    [canisterId]
  );

  useEffect(() => {
    let cancelled = false;
    AuthClient.create()
      .then(async (client) => {
        if (cancelled) return;
        setAuthClient(client);
        if (await client.isAuthenticated()) {
          await refreshDatabases(client);
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(errorMessage(cause));
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshDatabases]);

  useEffect(() => {
    return () => {
      const wallet = walletRef.current;
      walletRef.current = null;
      if (wallet) {
        void wallet.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (!authClient || !principal || !databaseId || !canisterId) return;
    let cancelled = false;
    Promise.all([
      getUsageAuthenticated(canisterId, authClient.getIdentity(), databaseId),
      getBillingAuthenticated(canisterId, authClient.getIdentity(), databaseId),
      listDatabaseTokensAuthenticated(canisterId, authClient.getIdentity(), databaseId),
      listPaymentsAuthenticated(canisterId, authClient.getIdentity(), databaseId)
    ])
      .then(([nextUsage, nextBilling, nextTokens, nextPayments]) => {
        if (cancelled) return;
        setUsage(nextUsage);
        setBilling(nextBilling);
        setTokens(nextTokens);
        setPayments(nextPayments);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [authClient, canisterId, databaseId, principal]);

  async function login() {
    if (!authClient) return;
    setError(null);
    await authClient.login({
      identityProvider: identityProviderUrl(),
      maxTimeToLive: DELEGATION_TTL_NS,
      onSuccess: () => {
        void refreshDatabases(authClient);
      },
      onError: (cause) => {
        setError(errorMessage(cause));
        setLoadState("error");
      }
    });
  }

  async function createDatabase() {
    if (!authClient || !principal || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      const nextDatabaseId = await createDatabaseAuthenticated(canisterId, authClient.getIdentity());
      await refreshDatabases(authClient);
      setDatabaseId(nextDatabaseId);
      setUsage(await getUsageAuthenticated(canisterId, authClient.getIdentity(), nextDatabaseId));
      setBilling(await getBillingAuthenticated(canisterId, authClient.getIdentity(), nextDatabaseId));
      setTokens([]);
      setPayments([]);
      resetDepositApproval();
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function createReadToken() {
    if (!authClient || !principal || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    setIssuedToken(null);
    try {
      const nextToken = await createDatabaseTokenAuthenticated(canisterId, authClient.getIdentity(), databaseId, `web-read-${Date.now()}`, "read");
      setIssuedToken(nextToken.token);
      setTokens(await listDatabaseTokensAuthenticated(canisterId, authClient.getIdentity(), databaseId));
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function runSql() {
    if (!authClient || !canRun) return;
    setLoadState("loading");
    setError(null);
    setResponse(null);
    try {
      const params = parseParams(paramsJson);
      const request = { databaseId, sql, params, maxRows: 100 };
      const nextResponse =
        mode === "query"
          ? await sqlQueryAuthenticated(canisterId, authClient.getIdentity(), request)
          : await sqlExecuteAuthenticated(canisterId, authClient.getIdentity(), request);
      setResponse(nextResponse);
      setUsage(await getUsageAuthenticated(canisterId, authClient.getIdentity(), databaseId));
      setBilling(await getBillingAuthenticated(canisterId, authClient.getIdentity(), databaseId));
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function quoteDeposit() {
    if (!authClient || !principal || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      const amountE8s = parseIcpToE8s(depositAmount);
      const quote = await getDepositQuoteAuthenticated(canisterId, authClient.getIdentity(), databaseId, amountE8s);
      setDepositQuote(quote);
      setApprovedDeposit(null);
      if (walletStatus === "approved") {
        setWalletStatus(walletRef.current ? "ready" : "disconnected");
      }
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function approveDepositInWallet() {
    if (!principal || !depositQuote || !depositQuoteMatchesAmount) {
      setError("fresh quote required before wallet approve");
      setWalletStatus("error");
      return;
    }
    setWalletStatus(walletRef.current ? "ready" : "connecting");
    setError(null);
    try {
      let wallet = walletRef.current;
      if (!wallet) {
        wallet = await IcpWallet.connect({
          url: walletSignerUrl,
          host: walletHost,
          windowOptions: DEFAULT_SIGNER_WINDOW_CENTER,
          onDisconnect: () => {
            walletRef.current = null;
            setWalletStatus("disconnected");
            setWalletOwner(null);
            setApprovedDeposit(null);
          }
        });
        walletRef.current = wallet;
      }
      setWalletStatus("ready");
      const permissions = await wallet.requestPermissionsNotGranted();
      if (!permissions.allPermissionsGranted) {
        throw new Error("wallet permission not granted");
      }
      const accounts = await wallet.accounts();
      const account = accounts[0];
      if (!account) {
        throw new Error("wallet account not found");
      }
      if (account.owner !== principal) {
        throw new Error("wallet principal must match login principal");
      }
      setWalletOwner(account.owner);
      setWalletStatus("approving");
      await wallet.icrc2Approve({
        owner: account.owner,
        request: {
          amount: BigInt(depositQuote.amountE8s),
          fee: BigInt(depositQuote.expectedFeeE8s),
          spender: {
            owner: Principal.fromText(depositQuote.spenderPrincipal),
            subaccount: []
          }
        }
      });
      setApprovedDeposit({ amountE8s: depositQuote.amountE8s, owner: account.owner });
      setWalletStatus("approved");
    } catch (cause) {
      setApprovedDeposit(null);
      setWalletStatus("error");
      setError(walletErrorMessage(cause));
    }
  }

  async function depositApproved() {
    if (!authClient || !principal || !databaseId || !canisterId) return;
    let amountE8s: string;
    try {
      amountE8s = parseIcpToE8s(depositAmount);
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
      return;
    }
    if (!depositQuote || depositQuote.amountE8s !== amountE8s) {
      setError("fresh quote required before deposit");
      setLoadState("error");
      return;
    }
    if (!approvedDeposit || approvedDeposit.amountE8s !== amountE8s || approvedDeposit.owner !== principal) {
      setError("wallet approve required before deposit");
      setLoadState("error");
      return;
    }
    setLoadState("loading");
    setError(null);
    try {
      await depositWithApprovalAuthenticated(canisterId, authClient.getIdentity(), databaseId, amountE8s);
      setBilling(await getBillingAuthenticated(canisterId, authClient.getIdentity(), databaseId));
      setPayments(await listPaymentsAuthenticated(canisterId, authClient.getIdentity(), databaseId));
      setDepositQuote(null);
      setApprovedDeposit(null);
      setWalletStatus(walletRef.current ? "ready" : "disconnected");
      setLoadState("ready");
    } catch (cause) {
      setError(depositErrorMessage(cause));
      setLoadState("error");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <CanisterField label="Canister" value={canisterId || "not configured"} />
          {principal ? (
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={loadState === "loading"} type="button" onClick={() => authClient && void refreshDatabases(authClient)}>
              <RefreshCw aria-hidden size={16} />
              <span>Sync</span>
            </button>
          ) : null}
          {principal ? (
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={loadState === "loading"} type="button" onClick={createDatabase}>
              <Database aria-hidden size={16} />
              <span>Create database</span>
            </button>
          ) : null}
          {principal && databaseId ? (
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={loadState === "loading"} type="button" onClick={createReadToken}>
              <KeyRound aria-hidden size={16} />
              <span>Issue read token</span>
            </button>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <select
            className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm text-[#182230]"
            disabled={!principal || databases.length === 0}
            value={databaseId}
            onChange={(event) => {
              setDatabaseId(event.target.value);
              resetDepositApproval();
            }}
          >
            {databases.length === 0 ? <option value="">No database loaded</option> : null}
            {databases.map((database) => (
              <option key={database.databaseId} value={database.databaseId}>
                {database.databaseId}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[#c9ced8] text-sm">
            <button className={mode === "query" ? activeModeClass : inactiveModeClass} type="button" onClick={() => setMode("query")}>
              Query
            </button>
            <button className={mode === "update" ? activeModeClass : inactiveModeClass} type="button" onClick={() => setMode("update")}>
              Update
            </button>
          </div>
        </div>
        <textarea
          className="min-h-56 w-full resize-y rounded-md border border-[#c9ced8] bg-[#0d1117] p-4 font-mono text-sm leading-6 text-[#d6e2ff] outline-none"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
        />
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <input
            className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 font-mono text-sm text-[#182230]"
            value={paramsJson}
            onChange={(event) => setParamsJson(event.target.value)}
          />
          {principal ? (
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!canRun} type="button" onClick={runSql}>
              <Play aria-hidden size={16} />
              <span>{loadState === "loading" ? "Running" : "Run statement"}</span>
            </button>
          ) : (
            <button className="rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!authClient} type="button" onClick={login}>
              Login
            </button>
          )}
        </div>
        {error ? <p className="rounded-md border border-[#fecdca] bg-[#fffbfa] px-3 py-2 text-sm text-[#b42318]">{error}</p> : null}
      </div>
      <div className="rounded-md border border-[#d5d9e2] bg-[#fbfcff] p-4">
        <h3 className="text-sm font-semibold">Response</h3>
        <dl className="mt-4 space-y-3 text-sm">
          <MetricRow label="Database" value={selectedDatabase?.databaseId ?? "none"} />
          <MetricRow label="Size" value={usage ? formatBytes(usage.logicalSizeBytes) : "0 B"} />
          <MetricRow label="Quota" value={usage ? formatBytes(usage.maxLogicalSizeBytes) : "0 B"} />
          <MetricRow label="Usage events" value={usage?.usageEventCount ?? "0"} />
          <MetricRow label="Billing" value={billing?.status ?? "active"} />
          <MetricRow label="Balance units" value={billing?.balanceUnits ?? "0"} />
          <MetricRow label="Spent units" value={billing?.spentUnits ?? "0"} />
          <MetricRow label="API tokens" value={String(tokens.length)} />
          <MetricRow label="Rows" value={String(response?.rows.length ?? 0)} />
          <MetricRow label="Affected" value={response?.rowsAffected ?? "0"} />
          <MetricRow label="Insert rowid" value={response?.lastInsertRowId ?? "0"} />
          <MetricRow label="Truncated" value={response?.truncated ? "yes" : "no"} />
        </dl>
        {issuedToken ? (
          <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
            <p className="text-xs text-[#5f6c7b]">Issued token</p>
            <p className="mt-1 break-all font-mono text-xs">{issuedToken}</p>
          </div>
        ) : null}
        <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Deposit</h3>
            <Coins aria-hidden size={16} />
          </div>
          <div className="mt-3 grid gap-2">
            <input
              className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 font-mono text-sm text-[#182230]"
              inputMode="decimal"
              value={depositAmount}
              onChange={(event) => {
                setDepositAmount(event.target.value);
                resetDepositApproval();
              }}
            />
            <div className="grid grid-cols-3 gap-2">
              <button className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={!canQuoteDeposit} type="button" onClick={quoteDeposit}>
                Quote
              </button>
              <button className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={!canApproveDeposit} type="button" onClick={approveDepositInWallet}>
                {walletStatus === "approving" ? "Approving" : "Approve"}
              </button>
              <button className="rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!canDeposit} type="button" onClick={depositApproved}>
                Deposit
              </button>
            </div>
          </div>
          {depositQuote ? (
            <div className="mt-3 space-y-2 text-xs">
              <MetricRow label="Fee ICP" value={formatIcpE8s(depositQuote.expectedFeeE8s)} />
              <MetricRow label="Credit units" value={depositQuote.creditedUnits} />
              <MetricRow label="Spender" value={depositQuote.spenderPrincipal} />
              <MetricRow label="Wallet" value={walletOwner ?? walletStatus} />
              <p className="break-all rounded-md bg-[#f7f8fb] p-2 font-mono text-[#344054]">
                dfx ledger approve --amount {formatIcpE8s(depositQuote.amountE8s)} --spender {depositQuote.spenderPrincipal}
              </p>
            </div>
          ) : null}
          {payments.length > 0 ? (
            <div className="mt-3 space-y-2">
              {payments.slice(0, 3).map((payment) => (
                <div className="rounded-md border border-[#eef1f5] p-2 text-xs" key={payment.paymentId}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono">{formatIcpE8s(payment.amountE8s)} ICP</span>
                    <span className="font-mono text-[#5f6c7b]">#{payment.blockIndex}</span>
                  </div>
                  <div className="mt-1 text-[#5f6c7b]">{payment.creditedUnits} units</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {response && response.columns.length > 0 ? <ResultTable response={response} /> : null}
      </div>
    </div>
  );
}

const activeModeClass = "bg-[#182230] px-3 py-1.5 text-white";
const inactiveModeClass = "bg-white px-3 py-1.5 text-[#5f6c7b]";

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#5f6c7b]">{label}</dt>
      <dd className="max-w-40 truncate font-mono" title={value}>{value}</dd>
    </div>
  );
}

function CanisterField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[#d5d9e2] bg-[#fbfcff] px-3 py-2">
      <p className="text-xs text-[#5f6c7b]">{label}</p>
      <p className="mt-1 truncate font-mono text-sm" title={value}>{value}</p>
    </div>
  );
}

function ResultTable({ response }: { response: SqlExecuteResponse }) {
  return (
    <div className="mt-4 max-h-72 overflow-auto rounded-md border border-[#d5d9e2] bg-white">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-[#f7f8fb] text-[#5f6c7b]">
          <tr>
            {response.columns.map((column) => (
              <th className="border-b border-[#d5d9e2] px-2 py-2 font-medium" key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {response.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, cellIndex) => (
                <td className="border-b border-[#eef1f5] px-2 py-2 font-mono" key={`${rowIndex}-${cellIndex}`}>
                  {formatSqlValue(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseParams(source: string): SqlValue[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed)) {
    throw new Error("params must be a JSON array");
  }
  return parsed.map(jsonToSqlValue);
}

function jsonToSqlValue(value: unknown): SqlValue {
  if (value === null) return { kind: "null" };
  if (typeof value === "string") return { kind: "text", value };
  if (typeof value === "number" && Number.isFinite(value)) {
    if (!Number.isInteger(value)) return { kind: "real", value };
    if (!Number.isSafeInteger(value)) {
      throw new Error("integer params must be safe JS integers; use a string for large values");
    }
    return { kind: "integer", value: String(value) };
  }
  throw new Error("params may contain only null, string, or number values");
}

function formatSqlValue(value: SqlValue): string {
  if (value.kind === "null") return "NULL";
  if (value.kind === "blob") return `<${value.value.length} bytes>`;
  return String(value.value);
}

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function parseIcpToE8s(source: string): string {
  const trimmed = source.trim();
  if (!/^\d+(\.\d{0,8})?$/.test(trimmed)) {
    throw new Error("ICP amount must have up to 8 decimal places");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const e8s = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0") || "0");
  if (e8s <= 0n) {
    throw new Error("ICP amount must be greater than 0");
  }
  return e8s.toString();
}

function formatIcpE8s(value: string): string {
  const e8s = BigInt(value);
  const whole = e8s / 100_000_000n;
  const fraction = (e8s % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error";
}

function depositErrorMessage(cause: unknown): string {
  const message = errorMessage(cause);
  if (message.includes("fee更新済み") || message.includes("BadFee")) {
    return "fee更新済み。再quoteしてapprove額を更新";
  }
  if (
    message.includes("operator verification required") ||
    message.includes("temporarily unavailable") ||
    message.includes("rejected") ||
    message.includes("decode failed")
  ) {
    return `再実行前にledger履歴確認: ${message}`;
  }
  return message;
}

function walletErrorMessage(cause: unknown): string {
  if (cause instanceof RelyingPartyDisconnectedError) {
    return "wallet disconnected before approval completed";
  }
  if (cause instanceof RelyingPartyResponseError) {
    if (cause.code === 3000) return "wallet permission not granted";
    if (cause.code === 3001) return "wallet approval cancelled";
    if (cause.code === 4000) return "wallet network error";
    if (cause.code === 503) return "wallet is busy";
  }
  return errorMessage(cause);
}
