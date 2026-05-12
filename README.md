# ICPDB

ICPDB is an MVP for SQLite hosting on the Internet Computer.

The current product surface is intentionally small:

- one Rust canister hosting multiple isolated SQLite databases
- Candid SQL read query APIs with quota checks, plus billed update/write APIs
- ICP prepaid deposit using ICRC-2 approve / transfer_from
- payment history, usage, dump, restore, and token management APIs
- Next.js console at `/icpdb`

Phase 2 cleanup removes the old node/search/graph API and keeps the repository focused on the ICPDB SQL hosting surface.

## Repository

```text
crates/icpdb_canister   Rust canister entrypoints and Candid API
crates/icpdb_runtime    SQLite runtime, billing, quota, payments
crates/icpdb_types      Shared SQL, lifecycle, billing, and deposit types
icpdb-console           ICPDB web console
scripts               Canister build helpers
```

Forked dependencies are pinned in `Cargo.toml`:

- `ic-stable-structures`
- `stable-fs`
- `ic-wasi-polyfill`

## Local Canister

```bash
bash scripts/build-icpdb-canister.sh
icp network start -d -e local-icpdb
icp deploy -e local-icpdb
```

If the WASI target is missing:

```bash
rustup target add wasm32-wasip1
```

## Web Console

```bash
cd icpdb-console
pnpm install
cp .env.local.example .env.local
pnpm dev
```

Required browser env:

```bash
NEXT_PUBLIC_ICPDB_IC_HOST=http://127.0.0.1:8001
NEXT_PUBLIC_II_PROVIDER_URL=http://id.ai.localhost:8001
NEXT_PUBLIC_ICPDB_CANISTER_ID=<local-icpdb-canister-id>
```

Wallet approve env:

```bash
NEXT_PUBLIC_ICPDB_WALLET_SIGNER_URL=https://oisy.com/sign
NEXT_PUBLIC_ICPDB_WALLET_HOST=https://icp-api.io
```

Local signer tests can override `NEXT_PUBLIC_ICPDB_WALLET_HOST`.

## Deposit Flow

The UI uses the existing canister APIs:

1. `get_deposit_quote(database_id, amount_e8s)`
2. wallet `icrc2_approve` for the ICP ledger
3. `deposit_with_approval(database_id, amount_e8s)`
4. refresh billing and payment history

Initial rate:

- `1 ICP = 100_000 billing units`
- minimum deposit: `0.01 ICP`
- default ICP transfer fee cache: `10_000 e8s`

`top_up_database_balance` remains an operator correction API and is not exposed in the normal UI.

## Billing Model

Read-only `sql_query` calls are free and remain Candid query calls. They still enforce SQL mode, response limits, and role checks.

Write/update APIs consume billing units only after successful execution. `sql_execute` costs `5` units, and `sql_batch` costs `5 * statement_count` units.

## Checks

```bash
cargo test -p icpdb-runtime
cargo test -p icpdb-canister
icp build

pnpm --dir icpdb-console test
pnpm --dir icpdb-console typecheck
pnpm --dir icpdb-console lint
pnpm --dir icpdb-console build
```

## Scope Limits

- ICP only; ckBTC, ckUSDC, and USD-denominated billing are future work.
- Deposit is prepaid top-up, not automatic recurring billing.
- The canister does not expose raw SQLite or Postgres wire protocols.
- Large responses still need pagination or chunking to fit IC response limits.
