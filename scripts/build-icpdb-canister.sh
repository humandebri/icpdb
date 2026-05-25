#!/usr/bin/env bash
set -euo pipefail

# Where: scripts/build-icpdb-canister.sh
# What: Build the release wasm artifact used by the ICPDB canister deployment flow.
# Why: ICPDB stores SQLite through ic-sqlite-vfs, so the canister no longer needs WASI or wasi2ic.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# Always emit wasm under the repo `target/` tree. Cursor/agent shells may set
# CARGO_TARGET_DIR to a sandbox cache, which would hide the expected wasm output path.
unset CARGO_TARGET_DIR
TARGET_DIR="${REPO_ROOT}/target/wasm32-unknown-unknown/release"
OUTPUT_WASM="${TARGET_DIR}/icpdb_canister.wasm"
# `icp deploy` sets this; standalone runs default to the repo artifact path.
ICP_WASM_OUTPUT_PATH="${ICP_WASM_OUTPUT_PATH:-${OUTPUT_WASM}}"

build_cmd=(
  cargo build
  --manifest-path "${REPO_ROOT}/Cargo.toml"
  --package icpdb-canister
  --release
  --locked
  --target wasm32-unknown-unknown
)

maybe_dump_wasm_sections() {
  local label="$1"
  local wasm_path="$2"
  if [[ "${ICPDB_CANISTER_WASM_DEBUG_SECTIONS:-0}" != "1" ]]; then
    return
  fi
  if ! command -v wasm-tools >/dev/null 2>&1; then
    return
  fi
  echo "wasm section dump (${label}): ${wasm_path}" >&2
  wasm-tools objdump "${wasm_path}" >&2
}

bash "${REPO_ROOT}/scripts/build-icpdb-database-canister.sh"

"${build_cmd[@]}"

maybe_dump_wasm_sections "cargo-build output" "${OUTPUT_WASM}"
if [[ "${OUTPUT_WASM}" != "${ICP_WASM_OUTPUT_PATH}" ]]; then
  cp "${OUTPUT_WASM}" "${ICP_WASM_OUTPUT_PATH}"
fi

ic-wasm "${ICP_WASM_OUTPUT_PATH}" \
  -o "${ICP_WASM_OUTPUT_PATH}" \
  metadata candid:service \
  -f "${REPO_ROOT}/crates/icpdb_canister/icpdb.did" \
  -v public \
  --keep-name-section
