// Where: icpdb-console/scripts/check-http-admin-client.mjs
// What: Execute owner-token HTTP admin client against mocked ICPDB responses.
// Why: Token sessions must manage quota, API tokens, and permissions without Internet Identity.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../lib/icpdb-http-admin-client.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true }
}).outputText;
const session = { baseUrl: " https://db.example/// ", token: " secret ", databaseId: " db_alpha " };
const calls = [];
const snapshotHash = Array(32).fill(9);
const mockFetch = async (url, request) => {
  calls.push({ url, request, body: JSON.parse(request.body) });
  if (url.endsWith("/v1/billing")) return json({ database_id: "db_alpha", status: "active", balance_units: 9, spent_units: 1, usage_event_count: 2 });
  if (url.endsWith("/v1/quota/set")) return json({ database_id: "db_alpha", status: "hot", logical_size_bytes: 10, max_logical_size_bytes: 99, usage_event_count: 2 });
  if (url.endsWith("/v1/tokens/list")) return json([tokenInfo("tok_1", "owner")]);
  if (url.endsWith("/v1/tokens/create")) return json({ token: "icpdb_secret", info: tokenInfo("tok_2", "write") });
  if (url.endsWith("/v1/tokens/revoke")) return json({ ...tokenInfo("tok_1", "owner"), revoked_at_ms: 4 });
  if (url.endsWith("/v1/members/list")) return json([memberInfo("aaaaa-aa", "owner")]);
  if (url.endsWith("/v1/payments/list")) return json([paymentInfo("pay_1")]);
  if (url.endsWith("/v1/members/grant") || url.endsWith("/v1/members/revoke")) return json(null);
  if (url.endsWith("/v1/database/delete")) return json(null);
  if (url.endsWith("/v1/archive/cancel")) return json(null);
  if (url.endsWith("/v1/archive/begin")) return json({ database_id: "db_alpha", size_bytes: 3 });
  if (url.endsWith("/v1/archive/read")) return json({ bytes: [1, 2, 3] });
  if (url.endsWith("/v1/archive/finalize")) return json(null);
  if (url.endsWith("/v1/restore/begin") || url.endsWith("/v1/restore/write") || url.endsWith("/v1/restore/finalize")) return json(null);
  return json({ error: "unknown endpoint" }, 404);
};
const cjsModule = { exports: {} };
vm.runInNewContext(compiled, { module: cjsModule, exports: cjsModule.exports, fetch: mockFetch, Response, require });

const {
  beginArchiveWithToken,
  beginRestoreWithToken,
  cancelArchiveWithToken,
  createTokenWithToken,
  deleteDatabaseWithToken,
  finalizeArchiveWithToken,
  finalizeRestoreWithToken,
  getBillingWithToken,
  grantMemberWithToken,
  listMembersWithToken,
  listPaymentsWithToken,
  listTokensWithToken,
  readArchiveChunkWithToken,
  revokeMemberWithToken,
  revokeTokenWithToken,
  setQuotaWithToken,
  writeRestoreChunkWithToken
} = cjsModule.exports;

assert.equal((await getBillingWithToken(session)).balanceUnits, "9");
assert.equal((await setQuotaWithToken(session, "99")).maxLogicalSizeBytes, "99");
const postSetQuotaCallCount = calls.length;
await assert.rejects(() => setQuotaWithToken(session, "1.5"), /quota bytes must be a non-negative safe integer/);
await assert.rejects(() => setQuotaWithToken(session, "9007199254740992"), /quota bytes must be a non-negative safe integer/);
assert.equal(calls.length, postSetQuotaCallCount);
assert.equal((await listTokensWithToken(session))[0].scope, "owner");
assert.equal((await createTokenWithToken(session, " web-write ", "write")).token, "icpdb_secret");
const postCreateTokenCallCount = calls.length;
await assert.rejects(() => createTokenWithToken(session, " ", "write"), /database token name must be a non-empty string/);
await assert.rejects(() => createTokenWithToken(session, "web-admin", "admin"), /database token scope must be read, write, or owner/);
assert.equal(calls.length, postCreateTokenCallCount);
assert.equal((await revokeTokenWithToken(session, " tok_1 ")).revokedAtMs, "4");
const postRevokeTokenCallCount = calls.length;
await assert.rejects(() => revokeTokenWithToken(session, " "), /database token id must be a non-empty string/);
assert.equal(calls.length, postRevokeTokenCallCount);
assert.equal((await listMembersWithToken(session))[0].role, "owner");
assert.equal((await listPaymentsWithToken(session))[0].blockIndex, "99");
await grantMemberWithToken(session, " rrkah-fqaaa-aaaaa-aaaaq-cai ", "reader");
assert.equal(calls.at(-1)?.body.principal, "rrkah-fqaaa-aaaaa-aaaaq-cai");
const postGrantCallCount = calls.length;
await assert.rejects(() => grantMemberWithToken(session, "rrkah-fqaaa-aaaaa-aaaaq-cai", "admin"), /database role must be reader, writer, or owner/);
await assert.rejects(() => grantMemberWithToken(session, "", "reader"), /database member principal must be a non-empty string/);
await assert.rejects(() => grantMemberWithToken(session, "   ", "reader"), /database member principal must be a non-empty string/);
await assert.rejects(() => grantMemberWithToken(session, "not-principal", "reader"), /database member principal must be a valid principal/);
await assert.rejects(() => grantMemberWithToken(session, "2vxsx-fae", "reader"), /anonymous principal cannot be granted database access/);
assert.equal(calls.length, postGrantCallCount);
await revokeMemberWithToken(session, " rrkah-fqaaa-aaaaa-aaaaq-cai ");
assert.equal(calls.at(-1)?.body.principal, "rrkah-fqaaa-aaaaa-aaaaq-cai");
const postRevokeCallCount = calls.length;
await assert.rejects(() => revokeMemberWithToken(session, ""), /database member principal must be a non-empty string/);
await assert.rejects(() => revokeMemberWithToken(session, "   "), /database member principal must be a non-empty string/);
await assert.rejects(() => revokeMemberWithToken(session, "not-principal"), /database member principal must be a valid principal/);
assert.equal(calls.length, postRevokeCallCount);
await cancelArchiveWithToken(session);
await deleteDatabaseWithToken(session);
assert.equal((await beginArchiveWithToken(session)).sizeBytes, "3");
assert.deepEqual(await readArchiveChunkWithToken(session, 0, 3), [1, 2, 3]);
await finalizeArchiveWithToken(session, snapshotHash);
await beginRestoreWithToken(session, snapshotHash, "3");
await writeRestoreChunkWithToken(session, 0, [1, 2, 3]);
await finalizeRestoreWithToken(session);
const postTransferCallCount = calls.length;
await assert.rejects(() => readArchiveChunkWithToken(session, -1, 3), /archive offset must be a non-negative safe integer/);
await assert.rejects(() => readArchiveChunkWithToken(session, 0, 0), /archive maxBytes must be an integer from 1 to 4294967295/);
await assert.rejects(() => finalizeArchiveWithToken(session, [9]), /snapshot hash must be a 32-byte SHA-256 digest/);
await assert.rejects(() => beginRestoreWithToken(session, snapshotHash, "9007199254740992"), /restore sizeBytes must be a non-negative safe integer/);
await assert.rejects(() => writeRestoreChunkWithToken(session, -1, [1]), /restore offset must be a non-negative safe integer/);
await assert.rejects(() => writeRestoreChunkWithToken(session, 0, [256]), /restore bytes\[0\] must be a byte/);
await assert.rejects(() => getBillingWithToken({ ...session, baseUrl: "   " }), /HTTP base URL must be a non-empty string/);
await assert.rejects(() => getBillingWithToken({ ...session, token: "   " }), /api token must be a non-empty string/);
await assert.rejects(() => getBillingWithToken({ ...session, databaseId: "   " }), /token session database_id must be a non-empty string/);
assert.equal(calls.length, postTransferCallCount);
assert.equal(calls[0].request.headers.authorization, "Bearer secret");
assert.equal(calls[0].url, "https://db.example/v1/billing");
assert.equal(calls[0].body.database_id, "db_alpha");
assert.equal(calls[1].body.max_logical_size_bytes, 99);
assert.equal(calls[3].body.name, "web-write");
assert.equal(calls[3].body.scope, "write");
assert.equal(calls[9].body.database_id, "db_alpha");
assert.equal(calls[10].body.database_id, "db_alpha");
assert.equal(calls[12].body.max_bytes, 3);
assert.deepEqual(calls[13].body.snapshot_hash, snapshotHash);
assert.equal(calls[14].body.size_bytes, 3);

console.log("ICPDB HTTP admin client checks OK");

function tokenInfo(tokenId, scope) {
  return { token_id: tokenId, database_id: "db_alpha", name: "web", scope, created_at_ms: 1, last_used_at_ms: null, revoked_at_ms: null };
}

function memberInfo(principal, role) {
  return { database_id: "db_alpha", principal, role, created_at_ms: 1 };
}

function paymentInfo(paymentId) {
  return {
    payment_id: paymentId,
    database_id: "db_alpha",
    payer_principal: "aaaaa-aa",
    amount_e8s: 1000000,
    credited_units: 1000,
    block_index: 99,
    created_at_ms: 7
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
