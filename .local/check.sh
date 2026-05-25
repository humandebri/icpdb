#!/usr/bin/env bash
set -euo pipefail

# Where: .local/check.sh
# What: Run the same checks this repo expects in CI from a single local entrypoint.
# Why: Pre-commit hooks and manual verification should fail on the same build and lint conditions as GitHub Actions.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

cargo fmt --all -- --check
node scripts/check-icpdb-http-cli.mjs
node scripts/check-icpdb-goal.mjs
node scripts/icpdb-mainnet-preflight.mjs --skip-build
cargo test --workspace --locked -- --test-threads=1
cargo clippy --workspace --all-targets --locked -- -D warnings

ICP_WASM_OUTPUT_PATH="${TMPDIR:-/tmp}/icpdb_canister.wasm" \
  bash scripts/build-icpdb-canister.sh

ICP_WASM_OUTPUT_PATH="${TMPDIR:-/tmp}/icpdb_database_canister.wasm" \
  bash scripts/build-icpdb-database-canister.sh
