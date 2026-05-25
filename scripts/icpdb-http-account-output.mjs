// Where: scripts/icpdb-http-account-output.mjs
// What: Token, member, payment, and usage-event output helpers for the ICPDB HTTP CLI.
// Why: Account/permission display changes should stay independent from SQL inspect rendering.

import { formatRecordTable } from "./icpdb-http-table-format.mjs";

export function formatDatabaseAccess(access) {
  const tokens = Array.isArray(access.tokens) ? access.tokens : [];
  const members = Array.isArray(access.members) ? access.members : [];
  const payments = Array.isArray(access.payments) ? access.payments : [];
  return [
    "tokens",
    formatTokenList(tokens),
    "members",
    formatMemberList(members),
    "payments",
    formatPaymentList(payments)
  ].join("\n");
}

export function formatTokenList(tokens) {
  return formatRecordTable(tokens.map(tokenRecord));
}

export function formatMemberList(members) {
  return formatRecordTable(members.map(memberRecord));
}

export function formatPaymentList(payments) {
  return formatRecordTable(payments.map(paymentRecord));
}

export function formatCreatedDatabase(value) {
  return formatRecordTable([{
    database_id: value.database_id,
    owner_token_id: value.owner_token?.token_id ?? "",
    owner_token: value.owner_token?.token ?? ""
  }]);
}

export function formatCreatedToken(value) {
  const info = value.info ?? {};
  return formatRecordTable([{ token: value.token, ...tokenRecord(info) }]);
}

export function formatUsageEventSummaries(events) {
  return formatRecordTable(events.map((event) => ({
    method: event.method,
    operation: event.operation ?? "",
    success: event.success ? "yes" : "no",
    count: event.event_count,
    cycles: event.total_cycles_delta,
    rows: event.total_rows_returned,
    affected: event.total_rows_affected,
    last_created_at_ms: event.last_created_at_ms
  })));
}

function paymentRecord(payment) {
  return {
    payment_id: payment.payment_id,
    payer: payment.payer_principal,
    amount_e8s: payment.amount_e8s,
    credited_units: payment.credited_units,
    block_index: payment.block_index,
    created_at_ms: payment.created_at_ms
  };
}

function tokenRecord(token) {
  return {
    token_id: token.token_id,
    name: token.name,
    scope: token.scope,
    status: token.revoked_at_ms ? "revoked" : "active",
    created_at_ms: token.created_at_ms,
    last_used_at_ms: token.last_used_at_ms ?? "",
    revoked_at_ms: token.revoked_at_ms ?? ""
  };
}

function memberRecord(member) {
  return {
    principal: member.principal,
    role: member.role,
    granted_at_ms: member.granted_at_ms
  };
}
