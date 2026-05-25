#!/usr/bin/env bash
set -euo pipefail

# Where: scripts/build-icpdb-database-canister.sh
# What: Build the release wasm artifact for the internal ICPDB database canister.
# Why: Sharded data-plane canisters need a checked Candid metadata artifact.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
unset CARGO_TARGET_DIR
TARGET_DIR="${REPO_ROOT}/target/wasm32-unknown-unknown/release"
OUTPUT_WASM="${TARGET_DIR}/icpdb_database_canister.wasm"
ICP_WASM_OUTPUT_PATH="${ICP_WASM_OUTPUT_PATH:-${OUTPUT_WASM}}"

cargo build \
  --manifest-path "${REPO_ROOT}/Cargo.toml" \
  --package icpdb-database-canister \
  --release \
  --locked \
  --target wasm32-unknown-unknown

if [[ "${OUTPUT_WASM}" != "${ICP_WASM_OUTPUT_PATH}" ]]; then
  cp "${OUTPUT_WASM}" "${ICP_WASM_OUTPUT_PATH}"
fi

ic-wasm "${ICP_WASM_OUTPUT_PATH}" \
  -o "${ICP_WASM_OUTPUT_PATH}" \
  metadata candid:service \
  -f "${REPO_ROOT}/crates/icpdb_database_canister/icpdb_database.did" \
  -v public \
  --keep-name-section
