// Where: scripts/icpdb-local-deposit.mjs
// What: Local-network ICP ledger deposit helper for live ICPDB smoke tests.
// Why: Payment history must be verified with real canister state, not static UI fixtures.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { shouldPassRootKey } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);
const icpLedgerCanisterId = "ryjl3-tyaaa-aaaaa-aaaba-cai";
const smokeDepositAmountE8s = 1_000_000;

export async function recordLocalIcpdbPayment(network, databaseId) {
  const quoteOutput = await callLocalCanister(
    network,
    network.canisterId,
    "get_deposit_quote",
    `(${candidText(databaseId)}, ${smokeDepositAmountE8s} : nat64)`
  );
  const expectedFeeE8s = parseCandidNatField(quoteOutput, "expected_fee_e8s", "get_deposit_quote");
  const approvalAmountE8s = smokeDepositAmountE8s + expectedFeeE8s;
  const approveOutput = await callLocalCanister(
    network,
    icpLedgerCanisterId,
    "icrc2_approve",
    icrc2ApproveArgs(network.canisterId, approvalAmountE8s)
  );
  assertCandidOk(approveOutput, "icrc2_approve");
  const depositOutput = await callLocalCanister(
    network,
    network.canisterId,
    "deposit_with_approval",
    `(${candidText(databaseId)}, ${smokeDepositAmountE8s} : nat64)`
  );
  assertCandidOk(depositOutput, "deposit_with_approval");
}

async function callLocalCanister(network, canisterId, method, candidArgs) {
  const args = ["canister", "call", "-n", network.canisterNetwork];
  if (shouldPassRootKey(network)) args.push("-k", network.rootKey);
  args.push(canisterId, method, candidArgs, "-o", "candid");
  const { stdout } = await execFileAsync("icp", args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

function icrc2ApproveArgs(spenderPrincipal, amountE8s) {
  return [
    "(record {",
    ` amount = ${amountE8s} : nat;`,
    ` spender = record { owner = principal ${candidText(spenderPrincipal)}; subaccount = null };`,
    " expected_allowance = null;",
    " expires_at = null;",
    " fee = null;",
    " from_subaccount = null;",
    " memo = null;",
    " created_at_time = null",
    "})"
  ].join("");
}

function assertCandidOk(output, label) {
  const error = output.match(/Err\s*=\s*"([^"]+)"/)?.[1];
  if (error) throw new Error(`${label} returned Err: ${error}`);
  if (!/Ok\s*=/.test(output)) throw new Error(`${label} did not return Ok: ${output}`);
}

function parseCandidNatField(output, field, label) {
  assertCandidOk(output, label);
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = output.match(new RegExp(`${escapedField}\\s*=\\s*([0-9_]+)\\s*:?\\s*nat`))?.[1]
    ?? output.match(new RegExp(`${escapedField}\\s*=\\s*([0-9_]+)`))?.[1];
  if (!value) throw new Error(`${label} missing ${field}: ${output}`);
  return Number(value.replace(/_/g, ""));
}

function candidText(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
