"use client";

// icpdb-console/lib/use-icpdb-billing-actions.ts
// Billing action hook: handles deposit quote, wallet approval, and approved deposit submission.

import { Principal } from "@icp-sdk/core/principal";
import { DEFAULT_SIGNER_WINDOW_CENTER, RelyingPartyDisconnectedError, RelyingPartyResponseError } from "@dfinity/oisy-wallet-signer";
import { IcpWallet } from "@dfinity/oisy-wallet-signer/icp-wallet";
import type { AuthClient } from "@icp-sdk/auth/client";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  depositWithApprovalAuthenticated,
  getBillingAuthenticated,
  getDepositQuoteAuthenticated,
  listPaymentsAuthenticated
} from "@/lib/icpdb-client";
import { parseIcpToE8s } from "@/lib/workbench-state";
import type {
  DatabaseBilling,
  DepositQuote,
  PaymentRecord
} from "@/lib/types";

export type WalletStatus = "disconnected" | "connecting" | "ready" | "approving" | "approved" | "error";

export type ApprovedDeposit = {
  amountE8s: string;
  owner: string;
};

type LoadState = "idle" | "loading" | "ready" | "error";

type BillingActionOptions = {
  authClient: AuthClient | null;
  canisterId: string;
  databaseId: string;
  principal: string | null;
  depositAmount: string;
  depositQuote: DepositQuote | null;
  depositQuoteMatchesAmount: boolean;
  approvedDeposit: ApprovedDeposit | null;
  walletHost: string;
  walletRef: MutableRefObject<IcpWallet | null>;
  walletSignerUrl: string;
  walletStatus: WalletStatus;
  setApprovedDeposit: Dispatch<SetStateAction<ApprovedDeposit | null>>;
  setBilling: Dispatch<SetStateAction<DatabaseBilling | null>>;
  setDepositQuote: Dispatch<SetStateAction<DepositQuote | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setPayments: Dispatch<SetStateAction<PaymentRecord[]>>;
  setWalletOwner: Dispatch<SetStateAction<string | null>>;
  setWalletStatus: Dispatch<SetStateAction<WalletStatus>>;
};

export function useIcpdbBillingActions(options: BillingActionOptions) {
  const {
    authClient,
    canisterId,
    databaseId,
    principal,
    depositAmount,
    depositQuote,
    depositQuoteMatchesAmount,
    approvedDeposit,
    walletHost,
    walletRef,
    walletSignerUrl,
    walletStatus,
    setApprovedDeposit,
    setBilling,
    setDepositQuote,
    setError,
    setLoadState,
    setPayments,
    setWalletOwner,
    setWalletStatus
  } = options;

  function resetDepositApproval() {
    setDepositQuote(null);
    setApprovedDeposit(null);
    if (walletStatus === "approved") {
      setWalletStatus(walletRef.current ? "ready" : "disconnected");
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
      const identity = authClient.getIdentity();
      await depositWithApprovalAuthenticated(canisterId, identity, databaseId, amountE8s);
      setBilling(await getBillingAuthenticated(canisterId, identity, databaseId));
      setPayments(await listPaymentsAuthenticated(canisterId, identity, databaseId));
      setDepositQuote(null);
      setApprovedDeposit(null);
      setWalletStatus(walletRef.current ? "ready" : "disconnected");
      setLoadState("ready");
    } catch (cause) {
      setError(depositErrorMessage(cause));
      setLoadState("error");
    }
  }

  return { approveDepositInWallet, depositApproved, quoteDeposit, resetDepositApproval };
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
