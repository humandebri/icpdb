// Where: crates/vfs_canister/src/tests_sync_contract.rs
// What: Candid contract tests for the ICPDB public API.
// Why: The checked-in DID must track the SQL hosting surface and exclude retired methods.

const REMOVED_METHODS: &[&str] = &[
    concat!("memory", "_manifest"),
    concat!("read", "_node"),
    concat!("write", "_node"),
    concat!("append", "_node"),
    concat!("edit", "_node"),
    concat!("delete", "_node"),
    concat!("move", "_node"),
    concat!("mkdir", "_node"),
    concat!("multi_edit", "_node"),
    concat!("list", "_nodes"),
    concat!("list", "_children"),
    concat!("glob", "_nodes"),
    concat!("recent", "_nodes"),
    concat!("incoming", "_links"),
    concat!("outgoing", "_links"),
    concat!("graph", "_links"),
    concat!("graph", "_neighborhood"),
    concat!("read", "_node_context"),
    concat!("query", "_context"),
    concat!("source", "_evidence"),
    concat!("search", "_nodes"),
    concat!("search", "_node_paths"),
    concat!("export", "_snapshot"),
    concat!("fetch", "_updates"),
];

#[test]
fn exported_candid_matches_checked_in_vfs_did() {
    assert_eq!(
        super::candid_interface().trim_end(),
        include_str!("../vfs.did").trim_end()
    );
}

#[test]
fn candid_excludes_retired_methods() {
    let generated = super::candid_interface();
    let checked_in = include_str!("../vfs.did");

    for did in [generated.as_str(), checked_in] {
        for method in REMOVED_METHODS {
            let signature = format!("  {method} :");
            assert!(
                !did.lines().any(|line| line.starts_with(&signature)),
                "{method} must not remain in the public Candid interface",
            );
        }
    }
}
