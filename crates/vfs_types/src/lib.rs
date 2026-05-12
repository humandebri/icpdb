// Where: crates/vfs_types/src/lib.rs
// What: Shared contracts for the ICPDB canister, runtime, and frontend bindings.
// Why: SQL hosting clients need stable database, billing, deposit, and SQL transport types.
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
