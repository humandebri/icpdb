# ICPDB

ICPDB is an MVP for SQLite hosting on the Internet Computer.

The current product surface is intentionally small:

- one Rust canister hosting multiple isolated SQLite databases
- Candid SQL query/update APIs with quota and billing-unit checks
- ICP prepaid deposit using ICRC-2 approve / transfer_from
- payment history, usage, dump, restore, and token management APIs
- Next.js console at `/icpdb`

Phase 2 cleanup removes the old node/search/graph API and keeps the repository focused on the ICPDB SQL hosting surface.

## Repository

```text
crates/vfs_canister   Rust canister entrypoints and Candid API
crates/vfs_runtime    SQLite runtime, billing, quota, payments
crates/vfs_types      Shared SQL, lifecycle, billing, and deposit types
wikibrowser           ICPDB web console
scripts               Canister build helpers
```

Forked dependencies are pinned in `Cargo.toml`:

- `ic-stable-structures`
- `stable-fs`
- `ic-wasi-polyfill`

## Local Canister

```bash
bash scripts/build-vfs-canister.sh
icp network start -d -e local-icpdb
icp deploy -e local-icpdb
```

If the WASI target is missing:

```bash
rustup target add wasm32-wasip1
```

## Web Console

```bash
cd wikibrowser
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

## Checks

```bash
cargo test -p vfs-runtime
cargo test -p vfs-canister
icp build

pnpm --dir wikibrowser test
pnpm --dir wikibrowser typecheck
pnpm --dir wikibrowser lint
pnpm --dir wikibrowser build
```

## Scope Limits

- ICP only; ckBTC, ckUSDC, and USD-denominated billing are future work.
- Deposit is prepaid top-up, not automatic recurring billing.
- The canister does not expose raw SQLite or Postgres wire protocols.
- Large responses still need pagination or chunking to fit IC response limits.
