// Where: crates/icpdb_types/src/lib.rs
// What: Shared contracts for the SQLite admin protocol, ICPDB canister, and frontend bindings.
// Why: Protocol clients and the hosted reference canister need stable SQL transport types.
mod fs;
mod sql;

use candid::CandidType;
use serde::{Deserialize, Serialize};

pub use fs::*;
pub use sql::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct CanisterHealth {
    pub cycles_balance: u128,
}
